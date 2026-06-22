import type { Child, DocumentTemplate, KnowledgeExample, UploadedFile } from "../generated/prisma/client";
import { getAiAgent, type AiAgentDefinition, type AiAgentId } from "@/lib/ai-agents";
import { asTemplateSections, composeFromTemplate, validateAgainstTemplate, type TemplateSection, type ValidationReport } from "@/lib/document-knowledge";

export const PPP_AGENT_SYSTEM_PROMPT = `Jesteś specjalistycznym asystentem do przygotowywania projektów opinii WWR w aplikacji pAgent. Twoim jedynym zadaniem jest wypełnienie obowiązującego wzoru dokumentu na podstawie dokumentów źródłowych. Wzór dokumentu jest nadrzędny i nie wolno zmieniać jego struktury. Wypełniaj wyłącznie miejsca oznaczone jako "tekst" lub "Tekst". Każde pole wypełniaj osobno, zgodnie z pytaniem lub zagadnieniem znajdującym się bezpośrednio przed tym polem. Nie kopiuj całych dokumentów źródłowych. Nie powtarzaj tych samych akapitów w różnych sekcjach. Nie twórz diagnoz ani faktów, których nie ma w materiałach. Jeśli brakuje danych, wpisz: "Brak danych w załączonych materiałach." Pisz językiem formalnym, rzeczowym i zgodnym ze stylem dokumentacji poradni psychologiczno-pedagogicznej.`;

export function anonymizeData(text: string, child: Child): string {
  let anonymized = text;
  if (child.firstName) anonymized = anonymized.replaceAll(child.firstName, "[DZIECKO_1]");
  if (child.lastName) anonymized = anonymized.replaceAll(child.lastName, "[NAZWISKO_1]");
  if (child.school) anonymized = anonymized.replaceAll(child.school, "[SZKOŁA_1]");
  return anonymized;
}

export function deanonymizeData(text: string, child: Child): string {
  let deanonymized = text;
  if (child.firstName) deanonymized = deanonymized.replaceAll("[DZIECKO_1]", child.firstName);
  if (child.lastName) deanonymized = deanonymized.replaceAll("[NAZWISKO_1]", child.lastName);
  if (child.school) deanonymized = deanonymized.replaceAll("[SZKOŁA_1]", child.school);
  return deanonymized;
}

export async function generateOpinionDraft(input: {
  child: Child;
  documentType: string;
  specialistNotes?: string | null;
  uploadedFiles?: UploadedFile[];
  sourceTexts?: string[];
  template?: DocumentTemplate | null;
  similarExamples?: Pick<KnowledgeExample, "title" | "extractedText">[];
  agentId?: string | null;
}): Promise<{ content: string; validationReport?: ValidationReport }> {
  if (!input.template) {
    return { content: generateNoTemplateDraft(input) };
  }

  const agent = getAiAgent(input.agentId);
  const sections = asTemplateSections(input.template.sections);
  let aiSections: Record<string, string> | undefined;

  if (agent.provider === "gemini" || agent.provider === "openrouter") {
    aiSections = await generateFieldsWithOnlineAgent(input, sections, agent);
  }

  if (agent.provider === "dify") {
    aiSections = await generateFieldsWithDify(input, sections);
  }

  const content = composeFromTemplate({
    template: input.template,
    child: input.child,
    documentType: input.documentType,
    specialistNotes: input.specialistNotes,
    sourceFiles: input.uploadedFiles,
    sourceTexts: input.sourceTexts,
    similarExamples: input.similarExamples,
    aiSections
  });

  return {
    content,
    validationReport: validateAgainstTemplate(content, input.template)
  };
}

function generateNoTemplateDraft(input: {
  child: Child;
  documentType: string;
  uploadedFiles?: UploadedFile[];
}) {
  return [
    `Projekt dokumentu - ${input.documentType}`,
    "",
    `Dziecko: ${input.child.firstName} ${input.child.lastName}`,
    `Data urodzenia: ${input.child.birthDate.toISOString().slice(0, 10)}`,
    "",
    "Brak aktywnego wzoru dla wybranego typu dokumentu. Dodaj aktywny wzór i wygeneruj dokument ponownie."
  ].join("\n");
}

async function generateFieldsWithOnlineAgent(input: GenerationInput, sections: TemplateSection[], selectedAgent: AiAgentDefinition) {
  const agents = getOnlineFallbackAgents(selectedAgent);

  for (const agent of agents) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    try {
      const prompt = buildAllFieldsPrompt(input, sections);
      const raw = agent.provider === "gemini"
        ? await callGeminiAgent(agent, prompt, controller.signal)
        : await callOpenRouterAgent(agent, prompt, controller.signal);
      const parsed = parseFieldJson(raw);
      const output = Object.fromEntries(
        sections.map((section) => [
          section.title,
          sanitizeFieldAnswer(parsed[section.title])
        ])
      );
      return output;
    } catch {
      // Try the next configured online agent.
    } finally {
      clearTimeout(timeout);
    }
  }

  return undefined;
}

async function generateFieldsWithDify(input: GenerationInput, sections: TemplateSection[]) {
  const apiUrl = process.env.DIFY_API_URL;
  const apiKey = process.env.DIFY_API_KEY;
  if (!apiUrl || !apiKey) return undefined;
  const output: Record<string, string> = {};

  for (const section of sections) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);

    try {
      const response = await fetch(`${apiUrl.replace(/\/$/, "")}/chat-messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          inputs: {
            documentType: input.documentType,
            fieldName: section.title
          },
          query: buildFieldPrompt(input, section),
          response_mode: "blocking",
          user: input.child.id
        })
      });

      if (!response.ok) {
        output[section.title] = "Brak danych w załączonych materiałach.";
      } else {
        const data = (await response.json()) as { answer?: string };
        output[section.title] = sanitizeFieldAnswer(data.answer);
      }
    } catch {
      output[section.title] = "Brak danych w załączonych materiałach.";
    } finally {
      clearTimeout(timeout);
    }
  }

  return output;
}

type GenerationInput = {
  child: Child;
  documentType: string;
  specialistNotes?: string | null;
  uploadedFiles?: UploadedFile[];
  sourceTexts?: string[];
  template?: DocumentTemplate | null;
  similarExamples?: Pick<KnowledgeExample, "title" | "extractedText">[];
  agentId?: string | null;
};

function getOnlineFallbackAgents(selectedAgent: AiAgentDefinition) {
  const candidates = [
    selectedAgent,
    getAiAgent("gemini_flash"),
    getAiAgent("gemini_flash_lite"),
    getAiAgent("openrouter_owl_alpha"),
    getAiAgent("openrouter_free"),
    getAiAgent("openrouter_kimi"),
    getAiAgent("openrouter_gpt_oss_20b")
  ];
  const seen = new Set<string>();
  return candidates
    .filter((agent) => {
      if (seen.has(agent.id)) return false;
      seen.add(agent.id);
      if (agent.provider === "gemini") return Boolean(process.env.GEMINI_API_KEY);
      if (agent.provider === "openrouter") return Boolean(process.env.OPENROUTER_API_KEY);
      return false;
    });
}

async function callGeminiAgent(agent: AiAgentDefinition, prompt: string, signal: AbortSignal) {
  if (!agent.model || !process.env.GEMINI_API_KEY) throw new Error("Missing Gemini configuration");
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${agent.model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${PPP_AGENT_SYSTEM_PROMPT}\n\n${prompt}` }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
          responseMimeType: "application/json"
        }
      })
    }
  );
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || `Gemini returned HTTP_${response.status}`);
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!text) throw new Error("Gemini returned empty content");
  return text;
}

async function callOpenRouterAgent(agent: AiAgentDefinition, prompt: string, signal: AbortSignal) {
  if (!agent.model || !process.env.OPENROUTER_API_KEY) throw new Error("Missing OpenRouter configuration");
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://pagent.nexurio.pl",
      "X-Title": "pAgent"
    },
    signal,
    body: JSON.stringify({
      model: agent.model,
      messages: [
        { role: "system", content: PPP_AGENT_SYSTEM_PROMPT },
        { role: "user", content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 8192
    })
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || `OpenRouter returned HTTP_${response.status}`);
  }
  const text = data.choices?.[0]?.message?.content || "";
  if (!text) throw new Error("OpenRouter returned empty content");
  return text;
}

function buildAllFieldsPrompt(input: GenerationInput, sections: TemplateSection[]) {
  const fields = sections.map((section, index) => ({
    index: index + 1,
    title: section.title,
    parentHeading: section.parentHeading ?? "",
    pointNumber: section.pointNumber ?? "",
    instruction: section.instruction ?? section.title
  }));

  return [
    `Typ dokumentu: ${input.documentType}`,
    input.template ? `Aktywny wzór: ${input.template.name}, wersja ${input.template.version}` : "",
    "",
    "Wypełnij wszystkie pola TEKST z aktywnego wzoru. Nie twórz nowej struktury dokumentu.",
    "Zwróć wyłącznie poprawny JSON w formacie:",
    "{\"fields\":[{\"title\":\"dokładny tytuł pola\",\"content\":\"treść do wklejenia\"}]}",
    "",
    "Pola do wypełnienia:",
    JSON.stringify(fields, null, 2),
    "",
    "Dane dziecka:",
    `- Imię i nazwisko: ${input.child.firstName} ${input.child.lastName}`,
    `- Data urodzenia: ${input.child.birthDate.toISOString().slice(0, 10)}`,
    `- Placówka: ${input.child.school || "brak"}`,
    `- Klasa/grupa: ${input.child.classGroup || "brak"}`,
    `- Rodzice/opiekunowie: ${input.child.guardians || "brak"}`,
    `- Notatki w bazie dziecka: ${input.child.notes || "brak"}`,
    "",
    input.specialistNotes ? `Uwagi specjalisty: ${input.specialistNotes}` : "",
    "",
    input.sourceTexts?.length
      ? `Wybrane dokumenty źródłowe:\n${input.sourceTexts.join("\n---\n").slice(0, 24_000)}`
      : "Dokumenty źródłowe: brak odczytanego tekstu.",
    "",
    input.similarExamples?.length
      ? `Przykłady stylu, tylko pomocniczo:\n${input.similarExamples.map((example) => example.extractedText.slice(0, 1800)).join("\n---\n")}`
      : "",
    "",
    "Zasady:",
    "- każde pole odpowiada wyłącznie na swój punkt lub podpunkt wzoru;",
    "- nie kopiuj pełnych akapitów ze źródeł, opracuj krótką syntezę;",
    "- nie powtarzaj tego samego tekstu w wielu polach;",
    "- jeśli dla pola nie ma danych, wpisz dokładnie: Brak danych w załączonych materiałach.;",
    "- nie dodawaj nagłówków, numerów punktów ani komentarzy technicznych;",
    "- treść jednego pola zwykle ma mieć 1-2 krótkie akapity."
  ]
    .filter(Boolean)
    .join("\n");
}

function parseFieldJson(text: string): Record<string, string> {
  const cleaned = text.trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1] || cleaned.match(/\{[\s\S]*\}/)?.[0] || cleaned;
  const parsed = JSON.parse(candidate) as { fields?: { title?: string; content?: string }[] } | Record<string, string>;

  if ("fields" in parsed && Array.isArray(parsed.fields)) {
    return Object.fromEntries(
      parsed.fields
        .filter((field) => typeof field.title === "string")
        .map((field) => [field.title!, typeof field.content === "string" ? field.content : ""])
    );
  }

  return Object.fromEntries(
    Object.entries(parsed).filter(([, value]) => typeof value === "string")
  ) as Record<string, string>;
}

function buildFieldPrompt(input: GenerationInput, section: TemplateSection) {
  return [
    `Typ dokumentu: ${input.documentType}`,
    input.template ? `Aktywny wzór: ${input.template.name}, wersja ${input.template.version}` : "",
    "",
    "Wypełniasz dokładnie jedno miejsce oznaczone w aktywnym wzorze jako tekst/Tekst/- tekst.",
    `Nazwa pola: ${section.title}`,
    section.parentHeading ? `Sekcja główna: ${section.parentHeading}` : "",
    section.pointNumber ? `Numer punktu/podpunktu: ${section.pointNumber}` : "",
    `Pytanie lub zagadnienie bezpośrednio przed polem: ${section.instruction ?? section.title}`,
    "",
    "Dane dziecka:",
    `- Imię i nazwisko: ${input.child.firstName} ${input.child.lastName}`,
    `- Data urodzenia: ${input.child.birthDate.toISOString().slice(0, 10)}`,
    `- Placówka: ${input.child.school || "brak"}`,
    `- Klasa/grupa: ${input.child.classGroup || "brak"}`,
    `- Rodzice/opiekunowie: ${input.child.guardians || "brak"}`,
    `- Notatki w bazie dziecka: ${input.child.notes || "brak"}`,
    "",
    input.specialistNotes ? `Uwagi specjalisty: ${input.specialistNotes}` : "",
    "",
    input.sourceTexts?.length
      ? `Wybrane dokumenty źródłowe:\n${input.sourceTexts.join("\n---\n").slice(0, 10_000)}`
      : "Dokumenty źródłowe: brak odczytanego tekstu.",
    "",
    input.similarExamples?.length
      ? `Przykłady stylu, tylko pomocniczo:\n${input.similarExamples.map((example) => example.extractedText.slice(0, 1200)).join("\n---\n")}`
      : "",
    "",
    "Instrukcja odpowiedzi:",
    "- odpowiedz tylko na to jedno zagadnienie;",
    "- opracuj krótką syntezę na podstawie źródeł, a nie streszczenie całego pliku;",
    "- nie kopiuj całych dokumentów źródłowych ani pełnych akapitów ze źródeł;",
    "- nie powtarzaj informacji, które pasują do innych pól;",
    "- maksymalnie 1-2 krótkie akapity, chyba że punkt wzoru wyraźnie wymaga dłuższego opisu;",
    "- nie dodawaj nagłówków, numerów punktów, komentarzy technicznych ani instrukcji dla AI;",
    "- nie używaj fraz: Materiał źródłowy, Brak przykładów wzorcowych, Treść wymaga uzupełnienia, Plik ...;",
    "- jeśli materiały nie zawierają danych dla tego pola, zwróć dokładnie: Brak danych w załączonych materiałach.",
    "",
    "Zwróć wyłącznie treść do wklejenia w miejsce tekst/Tekst."
  ]
    .filter(Boolean)
    .join("\n");
}

function sanitizeFieldAnswer(answer?: string | null) {
  const cleaned = (answer ?? "")
    .replace(/^```(?:json|text)?/i, "")
    .replace(/```$/i, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^Okay,\s+the\s+user[\s\S]*$/i, "")
    .replace(/^Let me think[\s\S]*$/i, "")
    .replace(/^(odpowiedź|treść|opis)\s*:\s*/i, "")
    .replace(/Materia[lł] źródłowy[^.\n]*(\.|\n)?/gi, "")
    .replace(/Brak przykładów wzorcowych[^.\n]*(\.|\n)?/gi, "")
    .replace(/Treść wymaga uzupełnienia[^.\n]*(\.|\n)?/gi, "")
    .replace(/^Plik\s+[^:\n]+:\s*/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned || "Brak danych w załączonych materiałach.";
}
