import { readFile } from "node:fs/promises";
import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import type { Child, DocumentTemplate, KnowledgeExample, PppDocumentType, UploadedFile } from "../generated/prisma/client";

export const PPP_DOCUMENT_TYPES: { value: PppDocumentType; label: string }[] = [
  { value: "KS", label: "KS" },
  { value: "WWR", label: "WWR" },
  { value: "OPINIA_PPP", label: "Opinia PPP" },
  { value: "INNE", label: "Inne" }
];

export type TemplateSection = {
  title: string;
  required: boolean;
};

export type ValidationReport = {
  valid: boolean;
  missingSections: string[];
  addedSections: string[];
  emptyRequiredFields: string[];
};

export function normalizePppType(value?: string | null): PppDocumentType {
  const normalized = (value ?? "").trim().toUpperCase();
  if (normalized === "KS") return "KS";
  if (normalized === "WWR") return "WWR";
  if (normalized.includes("OPINIA")) return "OPINIA_PPP";
  if (normalized === "OPINIA_PPP") return "OPINIA_PPP";
  return "INNE";
}

export function pppTypeLabel(type: PppDocumentType | string) {
  return PPP_DOCUMENT_TYPES.find((item) => item.value === type)?.label ?? "Inne";
}

export async function extractDocxText(storagePath: string) {
  const result = await mammoth.extractRawText({ path: storagePath });
  return normalizeText(result.value);
}

export async function extractDocText(storagePath: string) {
  try {
    const extractor = new WordExtractor();
    const document = await extractor.extract(storagePath);
    return normalizeText(document.getBody());
  } catch {
    return "";
  }
}

export async function extractPlainText(storagePath: string, mimeType?: string | null) {
  if (mimeType === "application/msword") {
    return extractDocText(storagePath);
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return extractDocxText(storagePath);
  }
  if (mimeType?.startsWith("text/")) {
    return normalizeText(await readFile(storagePath, "utf8"));
  }
  return "";
}

export function extractTemplateSections(text: string): TemplateSection[] {
  const lines = normalizeText(text).split("\n");
  const sections: TemplateSection[] = [];

  for (const line of lines) {
    const value = line.trim();
    if (!value) continue;
    const isNumbered = /^\d+[\).\s-]+[A-ZĄĆĘŁŃÓŚŹŻ]/.test(value);
    const isHeadingLike = value.length <= 90 && /[A-ZĄĆĘŁŃÓŚŹŻ]/.test(value) && value === value.toUpperCase();
    const isPlaceholderHeading = /\{\{[^}]+\}\}/.test(value);
    if (isNumbered || isHeadingLike || isPlaceholderHeading) {
      const title = value.replace(/^\d+[\).\s-]+/, "").replace(/\{\{|\}\}/g, "").trim();
      if (title && !sections.some((section) => section.title.toLowerCase() === title.toLowerCase())) {
        sections.push({ title, required: true });
      }
    }
  }

  if (!sections.length) {
    return [
      { title: "Dane dziecka", required: true },
      { title: "Podstawa opracowania", required: true },
      { title: "Opis funkcjonowania", required: true },
      { title: "Wnioski", required: true },
      { title: "Zalecenia", required: true },
      { title: "Brakujące informacje do uzupełnienia", required: true }
    ];
  }

  return sections.slice(0, 24);
}

export function findSimilarExamples(input: {
  query: string;
  examples: Pick<KnowledgeExample, "id" | "title" | "extractedText" | "status">[];
  limit?: number;
}) {
  const queryTerms = tokenize(input.query);
  return input.examples
    .map((example) => ({
      ...example,
      score: similarity(queryTerms, tokenize(example.extractedText))
    }))
    .filter((example) => example.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit ?? 3);
}

export function buildKnowledgeQuery(input: {
  child: Child;
  specialistNotes?: string | null;
  sourceTexts?: string[];
}) {
  return [
    input.child.school,
    input.child.classGroup,
    input.child.notes,
    input.specialistNotes,
    ...(input.sourceTexts ?? [])
  ]
    .filter(Boolean)
    .join("\n");
}

export function composeFromTemplate(input: {
  template: Pick<DocumentTemplate, "name" | "version" | "extractedText" | "sections">;
  child: Child;
  documentType: string;
  specialistNotes?: string | null;
  sourceFiles?: UploadedFile[];
  similarExamples?: Pick<KnowledgeExample, "title" | "extractedText">[];
  aiSections?: Record<string, string>;
}) {
  const sections = asTemplateSections(input.template.sections);
  const sectionBlocks = sections.map((section) => {
    const generated = input.aiSections?.[section.title] || builtinSectionContent(section.title, input);
    return `${section.title}\n${generated}`;
  });

  return [
    input.template.name,
    `Wersja wzoru: ${input.template.version}`,
    `Typ dokumentu: ${input.documentType}`,
    "",
    ...sectionBlocks,
    "",
    "Dokument wymaga weryfikacji i zatwierdzenia przez uprawnionego specjalistę"
  ].join("\n\n");
}

export function validateAgainstTemplate(content: string, template: Pick<DocumentTemplate, "sections">): ValidationReport {
  const sections = asTemplateSections(template.sections);
  const contentLines = normalizeText(content).split("\n").map((line) => line.trim()).filter(Boolean);
  const missingSections = sections
    .filter((section) => !contentLines.some((line) => sameHeading(line, section.title)))
    .map((section) => section.title);
  const allowedTitles = new Set(sections.map((section) => section.title.toLowerCase()));
  const addedSections = contentLines
    .filter((line) => isLikelyHeading(line))
    .map((line) => line.replace(/^\d+[\).\s-]+/, "").trim())
    .filter((line) => !allowedTitles.has(line.toLowerCase()))
    .filter((line) => !["dokument wymaga weryfikacji i zatwierdzenia przez uprawnionego specjalistę"].includes(line.toLowerCase()));
  const emptyRequiredFields = sections
    .filter((section) => section.required)
    .filter((section) => {
      const body = getSectionBody(content, section.title, sections.map((item) => item.title));
      return body.trim().length < 8 || /\{\{[^}]+\}\}/.test(body);
    })
    .map((section) => section.title);

  return {
    valid: missingSections.length === 0 && addedSections.length === 0 && emptyRequiredFields.length === 0,
    missingSections,
    addedSections: [...new Set(addedSections)],
    emptyRequiredFields
  };
}

export function asTemplateSections(value: unknown): TemplateSection[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => ({
        title: typeof item?.title === "string" ? item.title : "",
        required: item?.required !== false
      }))
      .filter((item) => item.title);
  }
  return [];
}

function builtinSectionContent(sectionTitle: string, input: {
  child: Child;
  specialistNotes?: string | null;
  sourceFiles?: UploadedFile[];
  similarExamples?: Pick<KnowledgeExample, "title" | "extractedText">[];
}) {
  const lower = sectionTitle.toLowerCase();
  if (lower.includes("dane")) {
    return [
      `${input.child.firstName} ${input.child.lastName}`,
      `Data urodzenia: ${input.child.birthDate.toISOString().slice(0, 10)}`,
      input.child.school ? `Placówka: ${input.child.school}` : "Placówka: do uzupełnienia",
      input.child.classGroup ? `Klasa/grupa: ${input.child.classGroup}` : "Klasa/grupa: do uzupełnienia"
    ].join("\n");
  }
  if (lower.includes("podstawa")) {
    return input.sourceFiles?.length
      ? `Uwzględniono ${input.sourceFiles.length} dokumentów źródłowych.`
      : "Brak załączonych dokumentów źródłowych. Sekcja wymaga uzupełnienia przez specjalistę.";
  }
  if (lower.includes("brak")) {
    const missing = [];
    if (!input.child.school) missing.push("placówka");
    if (!input.child.guardians) missing.push("dane rodziców/opiekunów");
    return missing.length ? missing.map((item) => `- ${item}`).join("\n") : "- brak na podstawie danych formularza";
  }
  const exampleNote = input.similarExamples?.length
    ? `Styl sekcji powinien być zgodny ze zweryfikowanymi przykładami: ${input.similarExamples.map((item) => item.title).join(", ")}.`
    : "Brak przykładów wzorcowych dla tej kategorii.";
  return [
    input.specialistNotes ? `Materiał specjalisty: ${input.specialistNotes}` : "Treść wymaga uzupełnienia na podstawie materiałów źródłowych.",
    exampleNote
  ].join("\n");
}

function normalizeText(text: string) {
  return text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function tokenize(text: string) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((term) => term.length > 3)
  );
}

function similarity(queryTerms: Set<string>, textTerms: Set<string>) {
  if (!queryTerms.size || !textTerms.size) return 0;
  let matches = 0;
  for (const term of queryTerms) {
    if (textTerms.has(term)) matches += 1;
  }
  return matches / Math.sqrt(queryTerms.size * textTerms.size);
}

function sameHeading(line: string, title: string) {
  const normalized = line.replace(/^\d+[\).\s-]+/, "").trim().toLowerCase();
  return normalized === title.toLowerCase();
}

function isLikelyHeading(line: string) {
  return line.length <= 90 && (/^\d+[\).\s-]+/.test(line) || line === line.toUpperCase());
}

function getSectionBody(content: string, title: string, allTitles: string[]) {
  const lines = normalizeText(content).split("\n");
  const start = lines.findIndex((line) => sameHeading(line.trim(), title));
  if (start === -1) return "";
  const end = lines.findIndex((line, index) => index > start && allTitles.some((item) => sameHeading(line.trim(), item)));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}
