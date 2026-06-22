import type { Child, DocumentTemplate, KnowledgeExample, UploadedFile } from "../generated/prisma/client";
import { getAiAgent, type AiAgentId } from "@/lib/ai-agents";
import { asTemplateSections, composeFromTemplate, validateAgainstTemplate, type ValidationReport } from "@/lib/document-knowledge";

export const PPP_AGENT_SYSTEM_PROMPT = `Jesteś asystentem wspierającym tworzenie projektów dokumentów PPP. Najważniejsza zasada: wzór dokumentu jest nadrzędny wobec modelu AI. Nie wolno tworzyć własnej struktury dokumentu, dodawać nowych sekcji ani usuwać sekcji ze wzoru. Generujesz wyłącznie treść brakujących sekcji wskazanych w aktywnym wzorze. Nie diagnozujesz samodzielnie. Nie dopisujesz faktów, których nie ma w materiałach źródłowych, danych dziecka albo zweryfikowanych przykładach. Jeżeli brakuje danych, wpisz to w sekcji braków.`;

// Moduł anonimizacji (struktura)
export function anonymizeData(text: string, child: Child): string {
  // TODO: Pełna implementacja anonimizacji
  // Zastępowanie imienia, nazwiska, szkoły, daty urodzenia itp.
  // np. Jan Kowalski -> [DZIECKO_1]
  let anonymized = text;
  if (child.firstName) anonymized = anonymized.replaceAll(child.firstName, "[DZIECKO_1]");
  if (child.lastName) anonymized = anonymized.replaceAll(child.lastName, "[NAZWISKO_1]");
  if (child.school) anonymized = anonymized.replaceAll(child.school, "[SZKOŁA_1]");
  // ...
  return anonymized;
}

export function deanonymizeData(text: string, child: Child): string {
  // TODO: Pełna implementacja deanonimizacji
  let deanonymized = text;
  if (child.firstName) deanonymized = deanonymized.replaceAll("[DZIECKO_1]", child.firstName);
  if (child.lastName) deanonymized = deanonymized.replaceAll("[NAZWISKO_1]", child.lastName);
  if (child.school) deanonymized = deanonymized.replaceAll("[SZKOŁA_1]", child.school);
  // ...
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
  let aiSections: Record<string, string> | undefined;
  if (agent.provider === "ollama") {
    aiSections = (await generateWithOllama({
      ...input,
      agentId: agent.id
    })) ?? undefined;
  }

  const content = composeFromTemplate({
    template: input.template,
    child: input.child,
    documentType: input.documentType,
    specialistNotes: input.specialistNotes,
    sourceFiles: input.uploadedFiles,
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
  specialistNotes?: string | null;
  uploadedFiles?: UploadedFile[];
}) {
  const missing: string[] = [];
  if (!input.child.school) missing.push("szkoła lub przedszkole");
  if (!input.child.guardians) missing.push("dane rodziców/opiekunów");

  return [
    `Projekt opinii PPP - ${input.documentType}`,
    "",
    `Dane dziecka: ${input.child.firstName} ${input.child.lastName}`,
    `Data urodzenia: ${input.child.birthDate.toISOString().slice(0, 10)}`,
    input.child.school ? `Placówka: ${input.child.school}` : "",
    input.child.classGroup ? `Klasa/grupa: ${input.child.classGroup}` : "",
    "",
    "Podstawa opracowania",
    input.uploadedFiles?.length
      ? `Uwzględniono ${input.uploadedFiles.length} załączonych plików źródłowych.`
      : "Na tym etapie nie dodano plików źródłowych.",
    input.specialistNotes ? `Uwagi specjalisty: ${input.specialistNotes}` : "",
    "",
    "Wstępny projekt treści",
    "Nie znaleziono aktywnego wzoru dla tego typu dokumentu. System nie powinien generować finalnej struktury bez wzoru. Dodaj aktywny wzór w module Wzory dokumentów i wygeneruj dokument ponownie.",
    "",
    "Brakujące informacje do uzupełnienia",
    missing.length ? missing.map((item) => `- ${item}`).join("\n") : "- brak na podstawie danych formularza",
    "",
    "Dokument wymaga weryfikacji i zatwierdzenia przez uprawnionego specjalistę"
  ]
    .filter(Boolean)
    .join("\n");
}

async function generateWithOllama(input: {
  child: Child;
  documentType: string;
  specialistNotes?: string | null;
  uploadedFiles?: UploadedFile[];
  sourceTexts?: string[];
  template?: DocumentTemplate | null;
  similarExamples?: Pick<KnowledgeExample, "title" | "extractedText">[];
  agentId: AiAgentId;
}) {
  const agent = getAiAgent(input.agentId);
  if (!agent.endpoint || !agent.model) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(agent.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: agent.model,
        stream: false,
        system: PPP_AGENT_SYSTEM_PROMPT,
        prompt: buildOpinionPrompt(input),
        options: {
          temperature: 0.25,
          top_p: 0.9
        }
      })
    });

    if (!response.ok) return null;
    const data = (await response.json()) as { response?: string };
    return parseSectionJson(data.response);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildOpinionPrompt(input: {
  child: Child;
  documentType: string;
  specialistNotes?: string | null;
  uploadedFiles?: UploadedFile[];
  sourceTexts?: string[];
  template?: DocumentTemplate | null;
  similarExamples?: Pick<KnowledgeExample, "title" | "extractedText">[];
}) {
  const sections = input.template ? asTemplateSections(input.template.sections) : [];
  return [
    `Typ dokumentu: ${input.documentType}`,
    input.template ? `Aktywny wzór: ${input.template.name}, wersja ${input.template.version}` : "Aktywny wzór: brak",
    "",
    "Sekcje wzoru, których nie wolno zmieniać:",
    sections.map((section) => `- ${section.title}`).join("\n") || "brak",
    "",
    "Dane dziecka:",
    `- Imię i nazwisko: ${input.child.firstName} ${input.child.lastName}`,
    `- Data urodzenia: ${input.child.birthDate.toISOString().slice(0, 10)}`,
    `- Placówka: ${input.child.school || "brak"}`,
    `- Klasa/grupa: ${input.child.classGroup || "brak"}`,
    `- Rodzice/opiekunowie: ${input.child.guardians || "brak"}`,
    `- Notatki w bazie dziecka: ${input.child.notes || "brak"}`,
    "",
    `Uwagi specjalisty: ${input.specialistNotes || "brak"}`,
    `Załączone pliki źródłowe: ${input.uploadedFiles?.length || 0}`,
    ...(input.sourceTexts?.length ? ["", "Fragmenty dokumentów źródłowych:", input.sourceTexts.join("\n---\n")] : []),
    ...(input.similarExamples?.length
      ? ["", "Zweryfikowane przykłady wzorcowe RAG:", input.similarExamples.map((example) => `# ${example.title}\n${example.extractedText.slice(0, 2400)}`).join("\n---\n")]
      : []),
    "",
    "Zwróć wyłącznie JSON w formacie: {\"Nazwa sekcji\":\"treść sekcji\"}. Kluczami mogą być tylko nazwy sekcji z listy wzoru. Nie zwracaj pełnego dokumentu, nie dodawaj nowych sekcji."
  ].join("\n");
}

function parseSectionJson(response?: string | null) {
  if (!response) return undefined;
  const start = response.indexOf("{");
  const end = response.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(response.slice(start, end + 1));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string")
        .map(([key, value]) => [key, value.trim()])
    );
  } catch {
    return undefined;
  }
}
