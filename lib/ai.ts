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

  if (agent.provider === "ollama") {
    aiSections = await generateFieldsWithOllama(input, sections, agent);
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

async function generateFieldsWithOllama(input: GenerationInput, sections: TemplateSection[], agent: AiAgentDefinition) {
  if (!agent.endpoint || !agent.model) return undefined;
  const output: Record<string, string> = {};

  for (const section of sections) {
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
          prompt: buildFieldPrompt(input, section),
          options: {
            temperature: 0.05,
            top_p: 0.8,
            repeat_penalty: 1.18,
            num_predict: 360,
            num_ctx: 8192
          }
        })
      });

      if (!response.ok) {
        output[section.title] = "Brak danych w załączonych materiałach.";
      } else {
        const data = (await response.json()) as { response?: string; thinking?: string };
        output[section.title] = sanitizeFieldAnswer(data.response);
      }
    } catch {
      output[section.title] = "Brak danych w załączonych materiałach.";
    } finally {
      clearTimeout(timeout);
    }
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
