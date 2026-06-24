import type { Child, DocumentTemplate, KnowledgeExample, UploadedFile } from "../generated/prisma/client";
import { getAiAgent, type AiAgentDefinition, type AiAgentId } from "@/lib/ai-agents";
import { asTemplateSections, composeFromTemplate, extractDocxTemplateSections, repairGluedPolishTextPreservingLayout, validateAgainstTemplate, type TemplateSection, type ValidationReport } from "@/lib/document-knowledge";

export const PPP_AGENT_SYSTEM_PROMPT = `Jesteś specjalistycznym asystentem pAgent wspierającym przygotowanie projektów opinii WWR. Twoim zadaniem jest wypełnianie konkretnych pól wzoru dokumentu na podstawie wszystkich załączonych dokumentów źródłowych. Nie piszesz dokumentu od zera. Nie zmieniasz wzoru. Nie streszczasz nadmiernie. Tworzysz rozbudowane, merytoryczne i formalne opisy funkcjonowania dziecka, zgodne z pytaniem danego pola. Łączysz informacje z wielu dokumentów w jedną spójną wypowiedź. Nie kopiujesz całych dokumentów. Nie powtarzasz tych samych akapitów. Nie tworzysz faktów, których nie ma w źródłach. Jeżeli dane są niepełne, zaznaczasz to rzeczowo. Styl ma być zgodny z dokumentacją poradni psychologiczno-pedagogicznej.`;

const PROFILE_AGENT_TIMEOUT_MS = 45_000;
const FIELD_AGENT_TIMEOUT_MS = 35_000;
const ENABLE_FIELD_EXPANSION = process.env.ENABLE_FIELD_EXPANSION === "true";

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
  let sections = asTemplateSections(input.template.sections);
  if (!sections.some((section) => section.marker === "TEKST") && input.template.originalName.toLowerCase().endsWith(".docx")) {
    const docxSections = extractDocxTemplateSections(input.template.storagePath);
    if (docxSections.length) sections = docxSections;
  }
  let aiSections: Record<string, string> | undefined;
  let childProfile = "";
  const unavailableAgentIds = new Set<string>();

  if (agent.provider === "pollinations" || agent.provider === "gemini" || agent.provider === "openrouter") {
    childProfile = await generateChildProfileWithOnlineAgent(input, agent, unavailableAgentIds);
    aiSections = await generateFieldsWithOnlineAgent({ ...input, childProfile }, sections, agent, unavailableAgentIds);
  }

  if (agent.provider === "dify") {
    aiSections = await generateFieldsWithDify(input, sections);
  }
  if (aiSections) {
    aiSections = repairGeneratedSections(aiSections);
  }

  const templateForGeneration = { ...input.template, sections };
  const content = repairGluedPolishTextPreservingLayout(composeFromTemplate({
    template: templateForGeneration,
    child: input.child,
    documentType: input.documentType,
    specialistNotes: input.specialistNotes,
    sourceFiles: input.uploadedFiles,
    sourceTexts: input.sourceTexts,
    similarExamples: input.similarExamples,
    aiSections
  }));

  const validationReport = validateAgainstTemplate(content, templateForGeneration);
  const shortFields = findShortGeneratedFields(sections, aiSections, input.sourceTexts);
  if (shortFields.length) {
    validationReport.shortFields = shortFields;
    validationReport.valid = false;
  }

  return {
    content,
    validationReport,
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

async function generateFieldsWithOnlineAgent(
  input: GenerationInput,
  sections: TemplateSection[],
  selectedAgent: AiAgentDefinition,
  unavailableAgentIds = new Set<string>()
) {
  const agents = getOnlineFallbackAgents(selectedAgent);
  const output: Record<string, string> = {};
  const generatedKeys = new Set<string>();

  for (const section of sections) {
    const key = sectionGenerationKey(section);
    if (key && generatedKeys.has(key)) {
      output[section.title] = "";
      if (section.fieldId) output[section.fieldId] = "";
      continue;
    }
    if (key) generatedKeys.add(key);

    let generated = "";

    for (const agent of agents) {
      if (unavailableAgentIds.has(agent.id)) continue;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FIELD_AGENT_TIMEOUT_MS);

      try {
        const prompt = buildFieldPrompt(input, section, output);
        const raw = agent.provider === "gemini"
          ? await callGeminiAgent(agent, prompt, controller.signal)
          : agent.provider === "openrouter"
            ? await callOpenRouterAgent(agent, prompt, controller.signal)
            : await callPollinationsAgent(agent, prompt, controller.signal);
        generated = sanitizeFieldAnswer(parseSingleFieldAnswer(raw), input.sourceTexts, Object.values(output));
        if (ENABLE_FIELD_EXPANSION && shouldExpandField(section, generated, input.sourceTexts)) {
          try {
            const expanded = await expandFieldAnswer(input, section, generated, output, agent, controller.signal);
            generated = sanitizeFieldAnswer(expanded, input.sourceTexts, Object.values(output)) || generated;
          } catch (error) {
            console.warn("[AI] Field expansion failed", {
              field: section.title,
              agentId: agent.id,
              error: error instanceof Error ? error.message : "UNKNOWN_ERROR"
            });
          }
        }
        break;
      } catch (error) {
        if (isConfigurationOrQuotaError(error) || isSlowOrNetworkError(error)) unavailableAgentIds.add(agent.id);
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

    const content = generated || "Brak danych w załączonych materiałach.";
    output[section.title] = content;
    if (section.fieldId) output[section.fieldId] = content;
  }

  return output;
}

async function generateChildProfileWithOnlineAgent(
  input: GenerationInput,
  selectedAgent: AiAgentDefinition,
  unavailableAgentIds = new Set<string>()
) {
  const agents = getOnlineFallbackAgents(selectedAgent);

  for (const agent of agents) {
    if (unavailableAgentIds.has(agent.id)) continue;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROFILE_AGENT_TIMEOUT_MS);
    try {
      const raw = agent.provider === "gemini"
        ? await callGeminiAgent(agent, buildChildProfilePrompt(input), controller.signal)
        : agent.provider === "openrouter"
          ? await callOpenRouterAgent(agent, buildChildProfilePrompt(input), controller.signal)
          : await callPollinationsAgent(agent, buildChildProfilePrompt(input), controller.signal);
      return sanitizeProfile(parseChildProfileAnswer(raw));
    } catch (error) {
      if (isConfigurationOrQuotaError(error) || isSlowOrNetworkError(error)) unavailableAgentIds.add(agent.id);
      console.warn("[AI] Profile agent failed, trying fallback", {
        agentId: agent.id,
        provider: agent.provider,
        model: agent.model,
        error: error instanceof Error ? error.message : "UNKNOWN_ERROR"
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  return buildFallbackChildProfile(input);
}

async function expandFieldAnswer(
  input: GenerationInput,
  section: TemplateSection,
  currentAnswer: string,
  previousFields: Record<string, string>,
  agent: AiAgentDefinition,
  signal: AbortSignal
) {
  const prompt = [
    buildFieldPrompt(input, section, previousFields),
    "",
    "Dotychczasowa odpowiedź jest zbyt krótka względem ilości materiału źródłowego. Rozwiń opis, uwzględniając więcej szczegółów z profilu dziecka.",
    "Nie zmieniaj zakresu pola i nie dodawaj informacji spoza źródeł.",
    "",
    `Dotychczasowa odpowiedź:\n${currentAnswer}`,
    "",
    "Zwróć JSON w formacie: {\"content\":\"rozbudowana treść pola\"}."
  ].join("\n");
  const raw = agent.provider === "gemini"
    ? await callGeminiAgent(agent, prompt, signal)
    : agent.provider === "openrouter"
      ? await callOpenRouterAgent(agent, prompt, signal)
      : await callPollinationsAgent(agent, prompt, signal);
  return parseSingleFieldAnswer(raw);
}

async function generateFieldsWithDify(input: GenerationInput, sections: TemplateSection[]) {
  const apiUrl = process.env.DIFY_API_URL;
  const apiKey = process.env.DIFY_API_KEY;
  if (!apiUrl || !apiKey) return undefined;
  const output: Record<string, string> = {};

  for (const section of sections) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FIELD_AGENT_TIMEOUT_MS);

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
            fieldName: section.fieldId ?? section.title
          },
          query: buildFieldPrompt(input, section),
          response_mode: "blocking",
          user: input.child.id
        })
      });

      if (!response.ok) {
        output[section.title] = "Brak danych w załączonych materiałach.";
        if (section.fieldId) output[section.fieldId] = output[section.title];
      } else {
        const data = (await response.json()) as { answer?: string };
        const content = sanitizeFieldAnswer(data.answer, input.sourceTexts, Object.values(output));
        output[section.title] = content;
        if (section.fieldId) output[section.fieldId] = content;
      }
    } catch {
      output[section.title] = "Brak danych w załączonych materiałach.";
      if (section.fieldId) output[section.fieldId] = output[section.title];
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
  childProfile?: string;
};

function getOnlineFallbackAgents(selectedAgent: AiAgentDefinition) {
  const candidates = [
    ...(selectedAgent.provider !== "gemini" ? [selectedAgent] : []),
    getAiAgent("pollinations_openai"),
    getAiAgent("openrouter_owl_alpha"),
    getAiAgent("openrouter_free"),
    getAiAgent("openrouter_kimi"),
    getAiAgent("openrouter_gpt_oss_20b"),
    ...(selectedAgent.provider === "gemini" ? [selectedAgent] : []),
    getAiAgent("gemini_flash"),
    getAiAgent("gemini_flash_lite")
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

function repairGeneratedSections(sections: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(sections).map(([key, value]) => [key, repairGluedPolishTextPreservingLayout(value)])
  );
}

function sectionGenerationKey(section: TemplateSection) {
  if (section.marker !== "TEKST") return "";
  if (section.fieldId) return section.fieldId;
  return [section.parentHeading, section.pointNumber, section.instruction]
    .filter(Boolean)
    .join("|")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isConfigurationOrQuotaError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("quota") ||
    message.includes("rate-limit") ||
    message.includes("rate limit") ||
    message.includes("missing") ||
    message.includes("api key") ||
    message.includes("401") ||
    message.includes("403") ||
    message.includes("404")
  );
}

function isSlowOrNetworkError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  const message = error instanceof Error ? `${error.name} ${error.message}`.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("abort") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("enotfound")
  );
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

function parseChildProfileAnswer(text: string) {
  const cleaned = text.trim();
  try {
    const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const candidate = fenced?.[1] || extractBalancedJsonObject(cleaned) || cleaned.match(/\{[\s\S]*\}/)?.[0] || cleaned;
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const profile = parsed.childProfile ?? parsed.profile ?? parsed.ChildProfile;
    if (typeof profile === "string") return profile;
    if (profile && typeof profile === "object") return JSON.stringify(profile, null, 2);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return cleaned;
  }
}

function buildChildProfilePrompt(input: GenerationInput) {
  return [
    "Na podstawie wszystkich załączonych dokumentów utwórz uporządkowany profil funkcjonowania dziecka. Nie pomijaj istotnych informacji. Połącz informacje z wielu źródeł. Usuń duplikaty. Jeżeli informacje się uzupełniają, scal je. Jeżeli są sprzeczne, oznacz je jako wymagające weryfikacji. Nie dodawaj informacji spoza dokumentów.",
    "",
    "Zwróć JSON w formacie: {\"childProfile\":{\"danePodstawowe\":{},\"komunikacja\":{},\"funkcjonowanieSpoleczne\":{},\"emocje\":{},\"motorykaDuza\":{},\"motorykaMala\":{},\"grafomotoryka\":{},\"koordynacjaWzrokowoRuchowa\":{},\"percepcjaWzrokowa\":{},\"samodzielnosc\":{},\"mocneStrony\":[],\"trudnosci\":[],\"potrzeby\":[],\"zaleceniaZeZrodel\":[]}}.",
    "",
    "Profil ma zawierać sekcje:",
    "1. Dane podstawowe",
    "2. Źródła informacji",
    "3. Zachowanie podczas badania/obserwacji",
    "4. Kontakt i komunikacja",
    "5. Funkcjonowanie poznawcze",
    "6. Funkcjonowanie emocjonalno-społeczne",
    "7. Funkcjonowanie ruchowe",
    "8. Motoryka mała i grafomotoryka",
    "9. Lateralizacja",
    "10. Percepcja wzrokowa i koordynacja wzrokowo-ruchowa",
    "11. Samodzielność",
    "12. Mocne strony",
    "13. Trudności i bariery",
    "14. Potrzeby rozwojowe",
    "15. Zalecenia wynikające ze źródeł",
    "16. Informacje brakujące",
    "",
    "Dane dziecka:",
    `- Imię i nazwisko: ${input.child.firstName} ${input.child.lastName}`,
    `- Data urodzenia: ${input.child.birthDate.toISOString().slice(0, 10)}`,
    `- Placówka: ${input.child.school || "brak"}`,
    `- Klasa/grupa: ${input.child.classGroup || "brak"}`,
    `- Rodzice/opiekunowie: ${input.child.guardians || "brak"}`,
    `- Notatki w bazie dziecka: ${input.child.notes || "brak"}`,
    input.specialistNotes ? `- Uwagi specjalisty: ${input.specialistNotes}` : "",
    "",
    input.sourceTexts?.length
      ? `Wszystkie dokumenty źródłowe:\n${input.sourceTexts.join("\n---\n").slice(0, 28_000)}`
      : "Dokumenty źródłowe: brak odczytanego tekstu."
  ].filter(Boolean).join("\n");
}

function sanitizeProfile(profile: string) {
  return profile
    .replace(/^```(?:json|text)?/i, "")
    .replace(/```$/i, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 16_000);
}

function buildFallbackChildProfile(input: GenerationInput) {
  return [
    "1. Dane podstawowe",
    `${input.child.firstName} ${input.child.lastName}, data urodzenia: ${input.child.birthDate.toISOString().slice(0, 10)}.`,
    input.child.school ? `Placówka: ${input.child.school}.` : "",
    input.child.classGroup ? `Klasa/grupa: ${input.child.classGroup}.` : "",
    "",
    "2. Źródła informacji",
    input.uploadedFiles?.length ? input.uploadedFiles.map((file) => `- ${file.originalName}`).join("\n") : "Brak listy źródeł.",
    "",
    "3. Informacje z dokumentów źródłowych",
    input.sourceTexts?.length ? input.sourceTexts.join("\n---\n").slice(0, 12_000) : "Brak odczytanego tekstu.",
    "",
    "16. Informacje brakujące",
    "Profil został utworzony technicznie na podstawie odczytanego tekstu źródłowego i wymaga weryfikacji specjalisty."
  ].filter(Boolean).join("\n");
}

function buildFieldPrompt(input: GenerationInput, section: TemplateSection, previousFields: Record<string, string> = {}) {
  const relevantSources = selectRelevantSourceFragments(section, input.sourceTexts);
  const fieldKind = classifyWwrField(section);
  return [
    `Typ dokumentu: ${input.documentType || "WWR"}.`,
    input.template ? `Aktywny wzór: ${input.template.name}, wersja ${input.template.version}` : "",
    "",
    "Wypełniasz dokładnie jedno miejsce oznaczone w aktywnym wzorze jako Tekst, tekst albo - tekst.",
    `Pole: ${section.fieldId ?? section.title}`,
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
    input.childProfile ? `Profil dziecka:\n${input.childProfile}` : "",
    "",
    relevantSources.length
      ? `Fragmenty źródłowe najbardziej związane z tym pytaniem:\n${relevantSources.join("\n---\n")}`
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
    "Wygeneruj rozbudowaną odpowiedź wyłącznie dla tego jednego pola wzoru. Odpowiedź musi być formalna, rzeczowa i oparta na źródłach. Nie streszczaj nadmiernie. Uwzględnij wszystkie istotne informacje odnoszące się do pytania. Jeżeli pytanie dotyczy diagnozy, nie twórz zaleceń. Jeżeli pytanie dotyczy zaleceń, formułuj konkretne formy wsparcia. Nie kopiuj całych źródeł. Nie powtarzaj gotowych akapitów z innych pól.",
    "",
    "Wymagana objętość:",
    fieldKind === "diagnosis"
      ? "- pole dotyczy głównej diagnozy: 2-4 rozbudowane akapity oddzielone pustą linią;"
      : fieldKind === "resources_barriers"
        ? "- pole dotyczy zasobów lub barier: 1-3 rozbudowane akapity oddzielone pustą linią;"
        : fieldKind === "recommendations"
          ? "- pole dotyczy zaleceń: 5-8 konkretnych punktów, każdy punkt w osobnej linii zaczynającej się od myślnika, albo 2-4 akapity oddzielone pustą linią;"
          : "- pole dotyczy informacji dodatkowych: odpowiedz krótko tylko wtedy, gdy źródła nie zawierają danych;",
    "- jeżeli materiał źródłowy jest obszerny, odpowiedź również ma być bardziej szczegółowa;",
    "- jeśli brak danych, wpisz dokładnie: Brak danych w załączonych materiałach.",
    "- nie zwracaj odpowiedzi jako jednego ciągłego bloku tekstu;",
    "- zachowaj czytelny układ: akapity oddzielaj pustą linią, a listy zaleceń zapisuj punkt po punkcie;",
    "- nie dodawaj własnych nagłówków, bo nagłówki pochodzą wyłącznie ze wzoru dokumentu;",
    "",
    detailedWwrInstruction(section),
    "",
    "Dodatkowe ograniczenia:",
    "- AI nie tworzy dokumentu; generujesz wyłącznie treść odpowiedzi do jednego pola;",
    "- za strukturę, formatowanie, akapity, listy i wygląd odpowiada wyłącznie aplikacja;",
    "- nie pisz całego dokumentu;",
    "- nie używaj słów jako nagłówków: Diagnoza, Zalecenia, Dodatkowe informacje;",
    "- nie dodawaj sekcji, nagłówków ani punktów spoza wzoru;",
    "- nie zmieniaj struktury wzoru;",
    "- nie dodawaj nagłówków, numerów punktów, komentarzy technicznych ani instrukcji dla AI;",
    "- nie używaj markdownu: bez **pogrubień**, bez śródtytułów i bez etykiet typu **Rozwój językowy** –;",
    "- nie używaj fraz: Materiał źródłowy, Brak przykładów wzorcowych, Treść wymaga uzupełnienia, Plik ...;",
    "- jeśli materiały nie zawierają danych dla tego pola, zwróć dokładnie: Brak danych w załączonych materiałach.",
    "",
    "Zwróć JSON w formacie: {\"content\":\"treść do wklejenia w miejsce Tekst/tekst/- tekst\"}."
  ]
    .filter(Boolean)
    .join("\n");
}

function sanitizeFieldAnswer(answer?: string | null, sourceTexts?: string[], previousAnswers: string[] = []) {
  const cleaned = stripMarkdownDecorations(ensureReadableFieldLayout(repairGluedPolishTextPreservingLayout((answer ?? "")
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
    .trim())));

  if (hasCopiedSourceFragment(cleaned, sourceTexts) || repeatsPreviousAnswer(cleaned, previousAnswers)) {
    return "Brak danych w załączonych materiałach.";
  }

  return cleaned || "Brak danych w załączonych materiałach.";
}

function stripMarkdownDecorations(answer: string) {
  return answer
    .replace(/\*\*([^*\n]{2,80})\*\*\s*[-–—:]\s*/g, "")
    .replace(/\*\*([^*\n]{2,80})\*\*/g, "$1")
    .replace(/__([^_\n]{2,80})__\s*[-–—:]\s*/g, "")
    .replace(/__([^_\n]{2,80})__/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+\*\*([^*\n]{2,80})\*\*\s*[-–—:]\s*/gm, "- ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function ensureReadableFieldLayout(answer: string) {
  const trimmed = answer.trim();
  if (!trimmed || trimmed.includes("\n") || trimmed.length < 700) return trimmed;

  const sentences = trimmed.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [trimmed];
  if (sentences.length < 4) return trimmed;

  const paragraphs: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const sentenceCount = current.split(/[.!?]+/).filter(Boolean).length;
    const next = [current, sentence].filter(Boolean).join(" ");
    if (current && (next.length > 520 || sentenceCount >= 3)) {
      paragraphs.push(current);
      current = sentence;
    } else {
      current = next;
    }
  }
  if (current) paragraphs.push(current);
  return paragraphs.join("\n\n");
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

function classifyWwrField(section: TemplateSection) {
  const text = [section.parentHeading, section.instruction, section.title].filter(Boolean).join(" ").toLowerCase();
  if (text.includes("możliwości psychofizycz") || text.includes("potencjał rozwoj") || text.includes("mocne strony")) {
    return "diagnosis";
  }
  if (text.includes("zasob") || text.includes("barier") || text.includes("ogranicze")) {
    return "resources_barriers";
  }
  if (
    text.includes("zalec") ||
    text.includes("warunki") ||
    text.includes("formy wsparcia") ||
    text.includes("wzmacniania") ||
    text.includes("usuwania") ||
    text.includes("przejścia") ||
    text.includes("wsparcia dziecka")
  ) {
    return "recommendations";
  }
  return "additional";
}

function detailedWwrInstruction(section: TemplateSection) {
  const text = [section.parentHeading, section.instruction, section.title].filter(Boolean).join(" ").toLowerCase();
  if (text.includes("możliwości psychofizycz") || text.includes("potencjał rozwoj")) {
    return [
      "Instrukcja szczegółowa dla tego pola:",
      "Uwzględnij zachowanie podczas badania, kontakt wzrokowy, komunikację, mowę, funkcjonowanie ruchowe, motorykę małą, lateralizację, percepcję wzrokową, koordynację wzrokowo-ruchową, funkcjonowanie emocjonalno-społeczne, samodzielność, wiedzę i umiejętności uczenia się, mocne strony oraz obszary wymagające wsparcia. Nie pisz zaleceń w tym polu."
    ].join("\n");
  }
  if (text.includes("zasob")) {
    return "Instrukcja szczegółowa dla tego pola:\nUwzględnij współpracę rodziców, przedszkole/szkołę, możliwość wsparcia specjalistycznego, relacje rówieśnicze, zasoby w domu i placówce oraz wszystko, co wynika ze źródeł.";
  }
  if (text.includes("barier") || text.includes("ogranicze")) {
    return "Instrukcja szczegółowa dla tego pola:\nUwzględnij trudności z koncentracją, zawieszanie się, trudności w spostrzeganiu wzrokowym, koordynacji wzrokowo-ruchowej, analizie i syntezie sylabowej, trudności artykulacyjne, trudności sensoryczne, jeśli wynikają ze źródeł, oraz inne ograniczenia funkcjonalne.";
  }
  if (text.includes("warunki") || text.includes("formy wsparcia")) {
    return "Instrukcja szczegółowa dla tego pola:\nFormułuj konkretne warunki i formy wsparcia: spokojne środowisko, jasne polecenia, wydłużony czas pracy, wsparcie w małych grupach, ćwiczenia motoryki, działania grafomotoryczne, wspieranie komunikacji, wzmacnianie pozytywne oraz współpracę specjalistów i rodziców.";
  }
  if (text.includes("przejścia") || text.includes("edukacji szkolnej")) {
    return "Instrukcja szczegółowa dla tego pola:\nJeżeli dziecko nie jest jeszcze na etapie obowiązkowego rocznego przygotowania przedszkolnego i źródła nie dają podstaw do opisu, wpisz rzeczowo: Na podstawie załączonych materiałów brak danych wskazujących na aktualną potrzebę opisu warunków przejścia dziecka do edukacji szkolnej.";
  }
  if (text.includes("wzmacniania zasob") || text.includes("wykorzystania")) {
    return "Instrukcja szczegółowa dla tego pola:\nOpisz, jak rozwijać mocne strony dziecka: aktywność ruchową, relacje rówieśnicze, samodzielność, mowę, zainteresowania, pozytywną motywację oraz współpracę z rodziną i placówką.";
  }
  if (text.includes("usuwania barier") && text.includes("wwr")) {
    return "Instrukcja szczegółowa dla tego pola:\nPodaj konkretne działania terapeutyczne i rozwojowe: terapię pedagogiczną, ćwiczenia percepcji wzrokowej, koordynacji wzrokowo-ruchowej, grafomotoryki, wspieranie koncentracji, diagnozę SI, jeśli wynika ze źródeł, oraz współpracę specjalistów.";
  }
  if (text.includes("wychowania przedszkolnego") || text.includes("przedszkol")) {
    return "Instrukcja szczegółowa dla tego pola:\nPodaj konkretne dostosowania w przedszkolu: krótkie polecenia, dzielenie zadań, spokojne miejsce pracy, ograniczanie nadmiaru bodźców, wsparcie relacji rówieśniczych, pozytywne wzmacnianie oraz monitorowanie funkcjonowania.";
  }
  if (text.includes("inne formy wsparcia")) {
    return "Instrukcja szczegółowa dla tego pola:\nUwzględnij współpracę z rodzicami, konsultacje specjalistyczne, wsparcie psychologiczno-pedagogiczne, ewentualną diagnozę SI oraz spójność oddziaływań dom-przedszkole-terapia.";
  }
  if (text.includes("aac") || text.includes("migow")) {
    return "Instrukcja szczegółowa dla tego pola:\nJeżeli źródła nie wskazują AAC ani języka migowego, wpisz: Na podstawie załączonych materiałów nie stwierdzono, aby dziecko posługiwało się wspomagającą lub alternatywną metodą komunikacji (AAC) albo językiem migowym.";
  }
  if (text.includes("inne informacje")) {
    return "Instrukcja szczegółowa dla tego pola:\nWpisz tylko informacje istotne, których nie umieszczono wcześniej. Jeżeli brak, wpisz: Brak dodatkowych informacji w załączonych materiałach.";
  }
  if (text.includes("nowa opinia") || text.includes("nowej opinii")) {
    return "Instrukcja szczegółowa dla tego pola:\nJeżeli nie dotyczy, wpisz: Nie dotyczy.";
  }
  return "";
}

function shouldExpandField(section: TemplateSection, answer: string, sourceTexts?: string[]) {
  if (!sourceTexts?.join("").trim()) return false;
  if (isMissingAnswer(answer)) return false;
  const kind = classifyWwrField(section);
  const length = normalizeForCopyCheck(answer).length;
  const sourceLength = sourceTexts.join("\n").length;
  if (sourceLength < 2400) return false;
  if (kind === "diagnosis") return length < 800 || paragraphCount(answer) < 2;
  if (kind === "resources_barriers") return length < 500;
  if (kind === "recommendations") return length < 650 || recommendationCount(answer) < 3;
  return false;
}

function findShortGeneratedFields(sections: TemplateSection[], aiSections?: Record<string, string>, sourceTexts?: string[]) {
  if (!aiSections) return [];
  if (!ENABLE_FIELD_EXPANSION) return [];
  return sections
    .filter((section) => shouldExpandField(section, (section.fieldId ? aiSections[section.fieldId] : "") || aiSections[section.title] || "", sourceTexts))
    .map((section) => section.instruction ?? section.title);
}

function paragraphCount(text: string) {
  return text.split(/\n{2,}/).map((item) => item.trim()).filter((item) => item.length > 120).length;
}

function recommendationCount(text: string) {
  return text
    .split(/\n+/)
    .map((item) => item.trim())
    .filter((item) => /^[-•*]|\d+[\).]/.test(item) || item.length > 80).length;
}

function isMissingAnswer(text: string) {
  return text.trim().toLowerCase().includes("brak danych w załączonych materiałach");
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
