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

  if (agent.provider === "pollinations" || agent.provider === "gemini" || agent.provider === "openrouter") {
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
        : agent.provider === "openrouter"
          ? await callOpenRouterAgent(agent, prompt, controller.signal)
          : await callPollinationsAgent(agent, prompt, controller.signal);
      const parsed = parseFieldJson(raw);
      const output = Object.fromEntries(
        sections.map((section, index) => {
          const answer = parsed[section.title] || parsed[`field_${index + 1}`] || parsed[String(index + 1)];
          return [section.title, sanitizeFieldAnswer(answer, input.sourceTexts)];
        })
      );
      return output;
    } catch (error) {
      console.warn("[AI] Agent failed, trying fallback", {
        agentId: agent.id,
        provider: agent.provider,
        model: agent.model,
        error: error instanceof Error ? error.message : "UNKNOWN_ERROR"
      });
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
    getAiAgent("openrouter_gpt_oss_20b"),
    getAiAgent("pollinations_openai")
  ];
  const seen = new Set<string>();
  return candidates
    .filter((agent) => {
      if (seen.has(agent.id)) return false;
      seen.add(agent.id);
      if (agent.provider === "gemini") return Boolean(process.env.GEMINI_API_KEY);
      if (agent.provider === "openrouter") return Boolean(process.env.OPENROUTER_API_KEY);
      if (agent.provider === "pollinations") return true;
      return false;
    });
}

async function callPollinationsAgent(agent: AiAgentDefinition, prompt: string, signal: AbortSignal) {
  if (!agent.endpoint || !agent.model) throw new Error("Missing Pollinations configuration");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.POLLINATIONS_API_KEY) {
    headers.Authorization = `Bearer ${process.env.POLLINATIONS_API_KEY}`;
  }

  const response = await fetch(agent.endpoint, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      model: agent.model,
      messages: [
        { role: "system", content: PPP_AGENT_SYSTEM_PROMPT },
        { role: "user", content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 8192,
      stream: false,
      reasoning_effort: "none",
      response_format: { type: "json_object" }
    })
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.details?.message || data.error?.message || `Pollinations returned HTTP_${response.status}`);
  }
  const text = data.choices?.[0]?.message?.content || "";
  if (!text) throw new Error("Pollinations returned empty content");
  return text;
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
    id: `field_${index + 1}`,
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
    "{\"fields\":[{\"id\":\"field_1\",\"title\":\"dokładny tytuł pola\",\"content\":\"treść do wklejenia\"}]}",
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
      ? `Wybrane dokumenty źródłowe do analizy, nie do kopiowania:\n${input.sourceTexts.join("\n---\n").slice(0, 18_000)}`
      : "Dokumenty źródłowe: brak odczytanego tekstu.",
    "",
    input.similarExamples?.length
      ? `Przykłady stylu, tylko pomocniczo:\n${input.similarExamples.map((example) => example.extractedText.slice(0, 1800)).join("\n---\n")}`
      : "",
    "",
    "Zasady:",
    "- każde pole odpowiada wyłącznie na swój punkt lub podpunkt wzoru;",
    "- nie wolno przepisywać ani wklejać pełnych zdań, akapitów lub całego badania ze źródeł;",
    "- opracuj własnymi słowami krótką syntezę faktów pasujących tylko do danego pola;",
    "- nie powtarzaj tego samego tekstu w wielu polach;",
    "- jeśli dla pola nie ma danych, wpisz dokładnie: Brak danych w załączonych materiałach.;",
    "- nie dodawaj nagłówków, numerów punktów ani komentarzy technicznych;",
    "- treść jednego pola ma mieć maksymalnie 600 znaków, chyba że punkt wzoru wyraźnie wymaga więcej."
  ]
    .filter(Boolean)
    .join("\n");
}

function parseFieldJson(text: string): Record<string, string> {
  const cleaned = text.trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1] || extractBalancedJsonObject(cleaned) || cleaned.match(/\{[\s\S]*\}/)?.[0] || cleaned;
  const parsed = JSON.parse(candidate) as { fields?: { id?: string; title?: string; content?: string }[] } | Record<string, string>;

  if ("fields" in parsed && Array.isArray(parsed.fields)) {
    const output: Record<string, string> = {};
    for (const field of parsed.fields) {
      const content = typeof field.content === "string" ? field.content : "";
      if (typeof field.id === "string") output[field.id] = content;
      if (typeof field.title === "string") output[field.title] = content;
    }
    return output;
  }

  return Object.fromEntries(
    Object.entries(parsed).filter(([, value]) => typeof value === "string")
  ) as Record<string, string>;
}

function extractBalancedJsonObject(text: string) {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return text.slice(start, index + 1);
  }

  return null;
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

function sanitizeFieldAnswer(answer?: string | null, sourceTexts?: string[]) {
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

  if (hasCopiedSourceFragment(cleaned, sourceTexts)) {
    return "Brak danych w załączonych materiałach.";
  }

  return cleaned || "Brak danych w załączonych materiałach.";
}

function hasCopiedSourceFragment(answer: string, sourceTexts?: string[]) {
  if (!answer.trim() || !sourceTexts?.length) return false;
  const normalizedAnswer = normalizeForCopyCheck(answer);
  if (normalizedAnswer.length < 220) return false;

  const normalizedSources = sourceTexts.map(normalizeForCopyCheck).join("\n");
  if (!normalizedSources) return false;

  const paragraphs = answer
    .split(/\n{1,}/)
    .map((paragraph) => normalizeForCopyCheck(paragraph))
    .filter((paragraph) => paragraph.length >= 180);
  if (paragraphs.some((paragraph) => normalizedSources.includes(paragraph))) return true;

  const words = normalizedAnswer.split(/\s+/).filter(Boolean);
  const windowSize = 36;
  for (let index = 0; index <= words.length - windowSize; index += 12) {
    const fragment = words.slice(index, index + windowSize).join(" ");
    if (fragment.length >= 180 && normalizedSources.includes(fragment)) return true;
  }

  return false;
}

function normalizeForCopyCheck(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
