import type { Child, DocumentTemplate, KnowledgeExample, UploadedFile } from "../generated/prisma/client";
import { getAiAgent, type AiAgentDefinition, type AiAgentId } from "@/lib/ai-agents";
import { asTemplateSections, composeFromTemplate, validateAgainstTemplate, type TemplateSection, type ValidationReport } from "@/lib/document-knowledge";

export const PPP_AGENT_SYSTEM_PROMPT = `Jesteś asystentem pAgent do wypełniania dokumentów WWR. Twoim jedynym zadaniem jest uzupełnienie konkretnego pola wzoru dokumentu na podstawie dokumentów źródłowych dziecka. Odpowiadasz wyłącznie na jedno wskazane pytanie lub zagadnienie. Nie piszesz całego dokumentu. Nie zmieniasz struktury wzoru. Nie kopiujesz całych źródeł. Nie powtarzasz treści z innych pól. Nie tworzysz faktów, których nie ma w materiale. Jeśli brak danych, wpisz: "Brak danych w załączonych materiałach." Pisz formalnym, rzeczowym językiem zgodnym ze stylem dokumentacji PPP.`;

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
}): Promise<{ content: string; validationReport?: ValidationReport; aiSections?: Record<string, string> }> {
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
    validationReport: validateAgainstTemplate(content, input.template),
    aiSections
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
  const output: Record<string, string> = {};

  for (const section of sections) {
    let generated = "";

    for (const agent of agents) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90_000);

      try {
        const prompt = buildFieldPrompt(input, section, output);
        const raw = agent.provider === "gemini"
          ? await callGeminiAgent(agent, prompt, controller.signal)
          : agent.provider === "openrouter"
            ? await callOpenRouterAgent(agent, prompt, controller.signal)
            : await callPollinationsAgent(agent, prompt, controller.signal);
        generated = sanitizeFieldAnswer(parseSingleFieldAnswer(raw), input.sourceTexts, Object.values(output));
        break;
      } catch (error) {
        console.warn("[AI] Field agent failed, trying fallback", {
          field: section.title,
          agentId: agent.id,
          provider: agent.provider,
          model: agent.model,
          error: error instanceof Error ? error.message : "UNKNOWN_ERROR"
        });
      } finally {
        clearTimeout(timeout);
      }
    }

    output[section.title] = generated || "Brak danych w załączonych materiałach.";
  }

  return output;
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
        output[section.title] = sanitizeFieldAnswer(data.answer, input.sourceTexts, Object.values(output));
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

function parseSingleFieldAnswer(text: string) {
  const cleaned = text.trim();
  try {
    const parsed = parseFieldJson(cleaned);
    return parsed.content || parsed.answer || parsed.text || Object.values(parsed)[0] || cleaned;
  } catch {
    return cleaned;
  }
}

function buildFieldPrompt(input: GenerationInput, section: TemplateSection, previousFields: Record<string, string> = {}) {
  const relevantSources = selectRelevantSourceFragments(section, input.sourceTexts);
  return [
    `Typ dokumentu: ${input.documentType || "WWR"}.`,
    input.template ? `Aktywny wzór: ${input.template.name}, wersja ${input.template.version}` : "",
    "",
    "Wypełniasz dokładnie jedno miejsce oznaczone w aktywnym wzorze jako Tekst, tekst albo - tekst.",
    `Sekcja: ${section.parentHeading || inferWwrSection(section) || "nieustalona"}`,
    `Punkt/podpunkt: ${section.pointNumber || "brak numeru"}`,
    `Pytanie ze wzoru: ${section.instruction ?? section.title}`,
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
    relevantSources.length
      ? `Dane źródłowe dziecka:\n${relevantSources.join("\n---\n")}`
      : "Dokumenty źródłowe: brak odczytanego tekstu.",
    "",
    input.similarExamples?.length
      ? `Przykłady stylu, tylko pomocniczo:\n${input.similarExamples.map((example) => example.extractedText.slice(0, 1200)).join("\n---\n")}`
      : "",
    Object.values(previousFields).filter(Boolean).length
      ? `Treści już użyte w innych polach - nie powtarzaj ich:\n${Object.values(previousFields).filter(Boolean).map((value) => value.slice(0, 500)).join("\n---\n")}`
      : "",
    "",
    "Zadanie:",
    "Wygeneruj odpowiedź wyłącznie dla tego jednego pola. Odpowiedź ma być konkretna, formalna i oparta tylko na danych źródłowych. Nie dodawaj zaleceń, jeśli pytanie dotyczy diagnozy. Nie opisuj diagnozy, jeśli pytanie dotyczy zaleceń. Nie kopiuj całego źródła. Nie powtarzaj akapitów z innych pól.",
    "",
    "Dodatkowe ograniczenia:",
    "- nie pisz całego dokumentu;",
    "- nie dodawaj sekcji, nagłówków ani punktów spoza wzoru;",
    "- nie zmieniaj struktury wzoru;",
    "- nie dodawaj nagłówków, numerów punktów, komentarzy technicznych ani instrukcji dla AI;",
    "- nie używaj fraz: Materiał źródłowy, Brak przykładów wzorcowych, Treść wymaga uzupełnienia, Plik ...;",
    "- jeśli materiały nie zawierają danych dla tego pola, zwróć dokładnie: Brak danych w załączonych materiałach.",
    "",
    "Zwróć wyłącznie treść do wklejenia w miejsce Tekst/tekst/- tekst."
  ]
    .filter(Boolean)
    .join("\n");
}

function sanitizeFieldAnswer(answer?: string | null, sourceTexts?: string[], previousAnswers: string[] = []) {
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

  if (hasCopiedSourceFragment(cleaned, sourceTexts) || repeatsPreviousAnswer(cleaned, previousAnswers)) {
    return "Brak danych w załączonych materiałach.";
  }

  return cleaned || "Brak danych w załączonych materiałach.";
}

function selectRelevantSourceFragments(section: TemplateSection, sourceTexts?: string[]) {
  if (!sourceTexts?.length) return [];
  const query = [
    section.parentHeading,
    section.pointNumber,
    section.instruction,
    section.title,
    inferWwrSection(section)
  ].filter(Boolean).join(" ");
  const queryTerms = new Set(normalizeForCopyCheck(query).split(/\s+/).filter((word) => word.length > 3));
  const chunks = sourceTexts.flatMap((source) => chunkText(source, 900));

  const scored = chunks
    .map((chunk, index) => {
      const normalized = normalizeForCopyCheck(chunk);
      const score = [...queryTerms].reduce((sum, term) => sum + (normalized.includes(term) ? 1 : 0), 0);
      return { chunk, index, score };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected = scored.filter((item) => item.score > 0).slice(0, 5);
  const chunksToUse = selected.length ? selected : scored.slice(0, 4);
  const output: string[] = [];
  let totalLength = 0;
  for (const item of chunksToUse) {
    if (totalLength >= 7000) break;
    const chunk = item.chunk.slice(0, Math.max(0, 7000 - totalLength));
    output.push(chunk);
    totalLength += chunk.length;
  }
  return output;
}

function chunkText(text: string, maxLength: number) {
  const paragraphs = text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current.length + paragraph.length > maxLength && current) {
      chunks.push(current);
      current = "";
    }
    current = [current, paragraph].filter(Boolean).join("\n\n");
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks.map((chunk) => chunk.slice(0, maxLength)) : [text.slice(0, maxLength)];
}

function inferWwrSection(section: TemplateSection) {
  const text = [section.parentHeading, section.instruction, section.title].filter(Boolean).join(" ").toLowerCase();
  if (text.includes("diagnoz") || text.includes("możliwości") || text.includes("potencja") || text.includes("barier")) return "Diagnoza";
  if (text.includes("zalec") || text.includes("wspar") || text.includes("warunki") || text.includes("formy")) return "Zalecenia";
  if (text.includes("aac") || text.includes("migow") || text.includes("dodatkow") || text.includes("nowej opinii")) return "Dodatkowe informacje";
  return "";
}

function repeatsPreviousAnswer(answer: string, previousAnswers: string[]) {
  const normalized = normalizeForCopyCheck(answer);
  if (normalized.length < 150) return false;
  return previousAnswers.some((previous) => {
    const normalizedPrevious = normalizeForCopyCheck(previous);
    return normalizedPrevious.length >= 150 && (normalizedPrevious.includes(normalized) || normalized.includes(normalizedPrevious));
  });
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
