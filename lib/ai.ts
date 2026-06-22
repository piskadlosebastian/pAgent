import type { Child, UploadedFile } from "../generated/prisma/client";
import { getAiAgent, type AiAgentId } from "@/lib/ai-agents";

export const PPP_AGENT_SYSTEM_PROMPT = `Jesteś asystentem wspierającym tworzenie projektu opinii do Poradni Psychologiczno-Pedagogicznej. Twoim jedynym zadaniem jest przygotowanie projektu dokumentu na podstawie danych dziecka, załączonych dokumentów, notatek specjalisty oraz ustalonego wzoru opinii. Nie diagnozujesz samodzielnie. Nie dopisujesz faktów, których nie ma w materiałach. Jeżeli brakuje danych, wypisz je w sekcji "Brakujące informacje do uzupełnienia". Dokument musi być napisany językiem formalnym, profesjonalnym i zgodnym ze stylem dokumentacji PPP. Na końcu dodaj informację: "Dokument wymaga weryfikacji i zatwierdzenia przez uprawnionego specjalistę".`;

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
  agentId?: string | null;
}) {
  const agent = getAiAgent(input.agentId);
  if (agent.provider === "ollama") {
    const generated = await generateWithOllama({
      ...input,
      agentId: agent.id
    });
    if (generated) return generated;
  }

  return generateBuiltinOpinionDraft(input);
}

function generateBuiltinOpinionDraft(input: {
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
    "Niniejszy szkic stanowi uporządkowaną bazę do opracowania opinii. Treść wymaga uzupełnienia przez specjalistę na podstawie materiałów źródłowych, obserwacji oraz obowiązującego wzoru placówki.",
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
    return data.response?.trim() || null;
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
}) {
  return [
    `Typ dokumentu: ${input.documentType}`,
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
    "",
    "Przygotuj projekt opinii PPP. Nie twórz diagnozy. Nie dopisuj faktów spoza danych. Jeżeli brakuje informacji, wypisz je w sekcji braków."
  ].join("\n");
}
