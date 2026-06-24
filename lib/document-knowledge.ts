import { readFile } from "node:fs/promises";
import AdmZip from "adm-zip";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
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
  marker?: "TEKST";
  occurrence?: number;
  instruction?: string;
  parentHeading?: string;
  pointNumber?: string;
  fieldId?: string;
};

export type ValidationReport = {
  valid: boolean;
  missingSections: string[];
  addedSections: string[];
  emptyRequiredFields: string[];
  remainingPlaceholders: string[];
  repeatedParagraphs: string[];
  forbiddenPhrases: string[];
  shortFields?: string[];
};

export function normalizePppType(value?: string | null): PppDocumentType {
  const normalized = (value ?? "").trim().toUpperCase();
  if (normalized === "KS") return "KS";
  if (normalized === "WWR") return "WWR";
  if (normalized.includes("OPINIA")) return "OPINIA_PPP";
  if (normalized === "OPINIA_PPP") return "OPINIA_PPP";
  return "INNE";
}

export function inferPppType(input: {
  explicitType?: PppDocumentType | string | null;
  title?: string | null;
  documentType?: string | null;
  notes?: string | null;
}): PppDocumentType {
  const text = [input.title, input.documentType, input.notes].filter(Boolean).join(" ").toUpperCase();
  if (/\bWWR\b/.test(text) || text.includes("WCZESNE WSPOMAGANIE")) return "WWR";
  if (/\bKS\b/.test(text) || text.includes("KS -") || text.includes("KARTA SPECJALISTYCZNA")) return "KS";
  if (input.explicitType) return normalizePppType(input.explicitType);
  return normalizePppType(input.documentType);
}

export function pppTypeLabel(type: PppDocumentType | string) {
  return PPP_DOCUMENT_TYPES.find((item) => item.value === type)?.label ?? "Inne";
}

export function fileHasExtension(fileName: string, extensions: string[]) {
  const lower = fileName.toLowerCase();
  return extensions.some((extension) => lower.endsWith(extension));
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

export async function extractPdfText(storagePath: string) {
  try {
    const parser = new PDFParse({ data: await readFile(storagePath) });
    const result = await parser.getText();
    await parser.destroy();
    return normalizeText(result.text);
  } catch {
    return "";
  }
}

export async function extractPlainText(storagePath: string, mimeType?: string | null, fileName?: string | null) {
  if (mimeType === "application/pdf" || fileHasExtension(fileName ?? storagePath, [".pdf"])) {
    return extractPdfText(storagePath);
  }
  if (mimeType === "application/msword" || fileHasExtension(fileName ?? storagePath, [".doc"])) {
    return extractDocText(storagePath);
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || fileHasExtension(fileName ?? storagePath, [".docx"])) {
    return extractDocxText(storagePath);
  }
  if (mimeType?.startsWith("text/") || fileHasExtension(fileName ?? storagePath, [".txt"])) {
    return normalizeText(await readFile(storagePath, "utf8"));
  }
  return "";
}

export function extractDocxTemplateSections(storagePath: string): TemplateSection[] {
  try {
    const zip = new AdmZip(storagePath);
    const documentEntry = zip.getEntry("word/document.xml");
    if (!documentEntry) return [];
    const paragraphs = extractDocxParagraphTexts(documentEntry.getData().toString("utf8"));
    return extractTextMarkerSections(paragraphs);
  } catch {
    return [];
  }
}

export function extractTemplateSections(text: string): TemplateSection[] {
  const lines = normalizeText(text).split("\n");
  const textMarkerSections = extractTextMarkerSections(lines);
  if (textMarkerSections.length) return textMarkerSections;

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
  sourceTexts?: string[];
  similarExamples?: Pick<KnowledgeExample, "title" | "extractedText">[];
  aiSections?: Record<string, string>;
}) {
  const sections = asTemplateSections(input.template.sections);
  const isMarkerTemplate = sections.some((section) => section.marker === "TEKST");
  const sectionContent = Object.fromEntries(
    sections.map((section) => [
      section.title,
      getGeneratedSectionContent(section, input.aiSections) || (isMarkerTemplate ? missingFieldContent() : builtinSectionContent(section.title, input))
    ])
  );
  const filled = fillTemplateText(input.template.extractedText, sections, sectionContent);
  const footer = "Dokument wymaga weryfikacji i zatwierdzenia przez uprawnionego specjalistę";
  return filled.toLowerCase().includes(footer.toLowerCase()) ? filled : `${filled}\n\n${footer}`;
}

function missingFieldContent() {
  return "Brak danych w załączonych materiałach.";
}

function getGeneratedSectionContent(section: TemplateSection, aiSections?: Record<string, string>) {
  if (!aiSections) return "";
  return (section.fieldId ? aiSections[section.fieldId]?.trim() : "") || aiSections[section.title]?.trim() || "";
}

export function validateAgainstTemplate(content: string, template: Pick<DocumentTemplate, "sections">): ValidationReport {
  const sections = asTemplateSections(template.sections);
  const contentLines = normalizeText(content).split("\n").map((line) => line.trim()).filter(Boolean);
  const isMarkerTemplate = sections.some((section) => section.marker === "TEKST");
  const missingSections = sections
    .filter(() => !isMarkerTemplate)
    .filter((section) => !contentLines.some((line) => sameHeading(line, section.title)))
    .map((section) => section.title);
  const allowedTitles = new Set(sections.map((section) => section.title.toLowerCase()));
  const addedSections = isMarkerTemplate
    ? []
    : contentLines
        .filter((line) => isLikelyHeading(line))
        .map((line) => line.replace(/^\d+[\).\s-]+/, "").trim())
        .filter((line) => !allowedTitles.has(line.toLowerCase()))
        .filter((line) => !["dokument wymaga weryfikacji i zatwierdzenia przez uprawnionego specjalistę"].includes(line.toLowerCase()));
  const emptyRequiredFields = sections
    .filter(() => !isMarkerTemplate)
    .filter((section) => section.required)
    .filter((section) => {
      const body = getSectionBody(content, section.title, sections.map((item) => item.title));
      return body.trim().length < 8 || /\{\{[^}]+\}\}/.test(body);
    })
    .map((section) => section.title);
  const remainingPlaceholders = contentLines.filter((line) => isTextMarker(line) || /\{\{[^}]+\}\}/.test(line));
  const repeatedParagraphs = findRepeatedParagraphs(content);
  const forbiddenPhrases = findForbiddenPhrases(content);

  return {
    valid:
      missingSections.length === 0 &&
      addedSections.length === 0 &&
      emptyRequiredFields.length === 0 &&
      remainingPlaceholders.length === 0 &&
      repeatedParagraphs.length === 0 &&
      forbiddenPhrases.length === 0,
    missingSections,
    addedSections: [...new Set(addedSections)],
    emptyRequiredFields,
    remainingPlaceholders,
    repeatedParagraphs,
    forbiddenPhrases
  };
}

export function asTemplateSections(value: unknown): TemplateSection[] {
  if (Array.isArray(value)) {
    return value
      .map((item): TemplateSection => {
        const section = {
          title: typeof item?.title === "string" ? repairTemplateContextText(item.title) : "",
          required: item?.required !== false,
          marker: item?.marker === "TEKST" ? "TEKST" as const : undefined,
          occurrence: typeof item?.occurrence === "number" ? item.occurrence : undefined,
          instruction: typeof item?.instruction === "string" ? repairTemplateContextText(item.instruction) : undefined,
          parentHeading: typeof item?.parentHeading === "string" ? repairTemplateContextText(item.parentHeading) : undefined,
          pointNumber: typeof item?.pointNumber === "string" ? item.pointNumber : undefined,
          fieldId: typeof item?.fieldId === "string" ? item.fieldId : undefined
        };
        return {
          ...section,
          fieldId: section.fieldId ?? inferWwrFieldId(section)
        };
      })
      .filter((item) => item.title);
  }
  return [];
}

function builtinSectionContent(sectionTitle: string, input: {
  child: Child;
  specialistNotes?: string | null;
  sourceFiles?: UploadedFile[];
  sourceTexts?: string[];
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
    const fileList = input.sourceFiles?.map((file) => `- ${file.originalName}`).join("\n");
    return input.sourceFiles?.length
      ? `Uwzględniono następujące dokumenty źródłowe:\n${fileList}`
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
  const sourceNote = input.sourceTexts?.length
    ? summarizeSourceForFallback(input.sourceTexts.join(" ").slice(0, 900))
    : "Brak danych w załączonych materiałach.";
  return [sourceNote, input.specialistNotes || "", exampleNote === "Brak przykładów wzorcowych dla tej kategorii." ? "" : exampleNote]
    .filter(Boolean)
    .join("\n");
}

function fillTemplateText(templateText: string, sections: TemplateSection[], sectionContent: Record<string, string>) {
  let output = normalizeText(templateText);
  let replacedPlaceholder = false;
  const textMarkerSections = sections.filter((section) => section.marker === "TEKST");

  if (textMarkerSections.length) {
    return fillTextMarkers(output, textMarkerSections, sectionContent);
  }

  for (const section of sections) {
    const content = sectionContent[section.title];
    if (!content) continue;
    const escapedTitle = escapeRegExp(section.title);
    const placeholder = new RegExp(`\\{\\{\\s*${escapedTitle}\\s*\\}\\}`, "gi");
    if (placeholder.test(output)) {
      output = output.replace(placeholder, content);
      replacedPlaceholder = true;
    }
  }

  const lines = output.split("\n");
  const headingIndexes = sections
    .map((section) => ({
      section,
      index: lines.findIndex((line) => sameHeading(line.trim(), section.title))
    }))
    .filter((item) => item.index !== -1)
    .sort((a, b) => a.index - b.index);

  if (!headingIndexes.length) {
    const appended = sections
      .map((section) => `${section.title}\n${sectionContent[section.title] || ""}`)
      .join("\n\n");
    return [output, appended].filter(Boolean).join("\n\n");
  }

  for (let i = headingIndexes.length - 1; i >= 0; i -= 1) {
    const { section, index } = headingIndexes[i];
    const nextIndex = headingIndexes[i + 1]?.index ?? lines.length;
    const existingBody = lines.slice(index + 1, nextIndex).join("\n").trim();
    const content = sectionContent[section.title] || "";
    const shouldReplaceBody = replacedPlaceholder || isEmptyTemplateBody(existingBody);
    const replacement = shouldReplaceBody
      ? [lines[index], content].filter(Boolean)
      : [lines[index], existingBody, content].filter(Boolean);
    lines.splice(index, nextIndex - index, ...replacement);
  }

  return normalizeText(lines.join("\n"));
}

function extractTextMarkerSections(lines: string[]): TemplateSection[] {
  const sections: TemplateSection[] = [];
  let occurrence = 0;

  for (let index = 0; index < lines.length; index += 1) {
    if (!isTextMarker(lines[index])) continue;
    occurrence += 1;
    const instruction = repairTemplateContextText(findNearestInstructionAbove(lines, index) ?? `Pole tekst ${occurrence}`);
    const parentHeading = findParentHeadingAbove(lines, index, instruction);
    const pointNumber = extractPointNumber(instruction);
    const fieldId = inferWwrFieldId({ instruction, parentHeading, pointNumber, occurrence });
    sections.push({
      title: `${instruction} [TEKST ${occurrence}]`,
      required: true,
      marker: "TEKST",
      occurrence,
      instruction,
      parentHeading: parentHeading ? repairTemplateContextText(parentHeading) : undefined,
      pointNumber,
      fieldId
    });
  }

  return sections;
}

export function inferWwrFieldId(section: Pick<TemplateSection, "instruction" | "parentHeading" | "pointNumber" | "occurrence"> & { title?: string }) {
  const text = normalizeForFieldId([section.parentHeading, section.pointNumber, section.instruction, section.title].filter(Boolean).join(" "));

  if (hasAny(text, ["mozliwosci psychofizycz", "potencjale rozwoj", "mocnych stron", "uzdolnien"])) return "diagnoza_potencjal";
  if (hasAny(text, ["zasobach w srodowisku", "srodowisku opieki", "wychowania i nauczania"])) return "diagnoza_zasoby";
  if (hasAny(text, ["barierach", "ograniczeniach", "wplywajacych na funkcjonowanie"])) return "diagnoza_bariery";
  if (hasAny(text, ["warunki i formy wsparcia", "formy wsparcia indywidualnych potrzeb", "indywidualnych potrzeb dziecka"])) return "zalecenia_wsparcie";
  if (hasAny(text, ["przejscia do edukacji szkolnej", "edukacji szkolnej"])) return "zalecenia_przejscie_szkolne";
  if (hasAny(text, ["wykorzystania i wzmacniania zasobow", "wzmacniania zasobow dziecka"])) return "zalecenia_wzmacnianie_zasobow";
  if (hasAny(text, ["usuwania barier"]) && hasAny(text, ["wwr", "wczesnego wspomagania"])) return "zalecenia_wwr";
  if (hasAny(text, ["usuwania barier"]) && hasAny(text, ["wychowania przedszkolnego", "przedszkol"])) return "zalecenia_przedszkole";
  if (hasAny(text, ["inne formy wsparcia dziecka", "inne formy wsparcia", "wsparcia dziecka i rodziny"])) return "zalecenia_inne";
  if (hasAny(text, ["aac", "alternatywn", "wspomagajac", "migow"])) return "aac";
  if (hasAny(text, ["okolicznosci wydania nowej opinii", "nowej opinii", "nowa opinia"])) return "nowa_opinia";
  if (hasAny(text, ["inne informacje", "dodatkowe informacje"])) return "inne";

  return section.occurrence ? `pole_${section.occurrence}` : undefined;
}

function fillTextMarkers(templateText: string, sections: TemplateSection[], sectionContent: Record<string, string>) {
  const lines = templateText.split("\n");
  let occurrence = 0;
  let lastFilledSignature = "";

  return normalizeText(
    lines
      .map((line) => {
        if (!isTextMarker(line)) {
          if (line.trim()) lastFilledSignature = "";
          return line;
        }
        occurrence += 1;
        const section = sections.find((item) => item.occurrence === occurrence);
        const signature = sectionSignature(section);
        if (signature && signature === lastFilledSignature) return "";
        if (signature) lastFilledSignature = signature;
        const content = section ? sectionContent[section.title] : "";
        return content || "Brak danych w załączonych materiałach - do uzupełnienia przez specjalistę";
      })
      .join("\n")
  );
}

export function isTextMarker(line: string) {
  return /^-?\s*tekst(?:\s+tekst)*\s*$/i.test(line.trim());
}

function sectionSignature(section?: Pick<TemplateSection, "marker" | "instruction" | "parentHeading" | "pointNumber">) {
  if (!section || section.marker !== "TEKST") return "";
  return [section.parentHeading, section.pointNumber, section.instruction]
    .filter(Boolean)
    .join("|")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function findNearestInstructionAbove(lines: string[], textIndex: number) {
  for (let index = textIndex - 1; index >= 0; index -= 1) {
    const candidate = lines[index].trim();
    if (!candidate || isTextMarker(candidate)) continue;
    if (candidate.length > 240) continue;
    return candidate.replace(/\s+/g, " ");
  }
  return null;
}

function findParentHeadingAbove(lines: string[], textIndex: number, instruction: string) {
  for (let index = textIndex - 1; index >= 0; index -= 1) {
    const candidate = lines[index].trim();
    if (!candidate || candidate === instruction || isTextMarker(candidate)) continue;
    const isMainHeading = candidate.length <= 100 && (candidate === candidate.toUpperCase() || /^\d+[\).]\s+\S/.test(candidate));
    if (isMainHeading) return candidate.replace(/\s+/g, " ");
  }
  return undefined;
}

export function repairGluedPolishText(value: string) {
  if (!value) return "";
  return value
    .replace(/\bZespółorzekający\b/g, "Zespół orzekający")
    .replace(/\bzespołorzekający\b/gi, "zespół orzekający")
    .replace(/\borzekającyzaleca\b/gi, "orzekający zaleca")
    .replace(/\bzalecawynikającezdiagnozy\b/gi, "zaleca wynikające z diagnozy")
    .replace(/\bwynikającezdiagnozy\b/gi, "wynikające z diagnozy")
    .replace(/\bdiagnozywarunki\b/gi, "diagnozy warunki")
    .replace(/\biograniczeniach\b/gi, "i ograniczeniach")
    .replace(/\bwpływającychna\b/gi, "wpływających na")
    .replace(/\bwczesnegowspomagania\b/gi, "wczesnego wspomagania")
    .replace(/\brozwojudziecka\b/gi, "rozwoju dziecka")
    .replace(/\bmożliwościachpsychofizycznych\b/gi, "możliwościach psychofizycznych")
    .replace(/\bpotencjalerozwojowym\b/gi, "potencjale rozwojowym")
    .replace(/\bmocnychstronach\b/gi, "mocnych stronach")
    .replace(/\buzdolnieniachdziecka\b/gi, "uzdolnieniach dziecka")
    .replace(/\bśrodowiskuopieki\b/gi, "środowisku opieki")
    .replace(/\bwychowaniai\b/gi, "wychowania i")
    .replace(/\binauczania\b/gi, "i nauczania")
    .replace(/\bformywsparcia\b/gi, "formy wsparcia")
    .replace(/\bindywidualnychpotrzeb\b/gi, "indywidualnych potrzeb")
    .replace(/\bpotrzebdziecka\b/gi, "potrzeb dziecka")
    .replace(/\bedukacjiszkolnej\b/gi, "edukacji szkolnej")
    .replace(/\bwzmacnianiazasobów\b/gi, "wzmacniania zasobów")
    .replace(/\bzasobówdziecka\b/gi, "zasobów dziecka")
    .replace(/\busuwaniabarier\b/gi, "usuwania barier")
    .replace(/\bwychowaniuprzedszkolnym\b/gi, "wychowaniu przedszkolnym")
    .replace(/\binneformy\b/gi, "inne formy")
    .replace(/\bwsparciadziecka\b/gi, "wsparcia dziecka")
    .replace(/\birodziny\b/gi, "i rodziny")
    .replace(/\bZespółorzekającyzaleca\b/gi, "Zespół orzekający zaleca")
    .replace(/\bzespółorzekającyzaleca\b/gi, "zespół orzekający zaleca")
    .replace(/\bwynikającez diagnozy\b/gi, "wynikające z diagnozy")
    .replace(/\bopiekiewychowania\b/gi, "opieki wychowania")
    .replace(/\bopiekiwychowania\b/gi, "opieki wychowania")
    .replace(/\bwychowania nauczania\b/gi, "wychowania i nauczania")
    .replace(/\bopieki wychowania i nauczania\b/gi, "opieki, wychowania i nauczania")
    .replace(/\bprocesieprzejścia\b/gi, "procesie przejścia")
    .replace(/\bdoedukacji\b/gi, "do edukacji")
    .replace(/\bindywidualnepotrzeby\b/gi, "indywidualne potrzeby")
    .replace(/\bpsychofizycznei\b/gi, "psychofizyczne i")
    .replace(/\brozwojowydziecka\b/gi, "rozwojowy dziecka")
    .replace(/\bfunkcjonowaniedziecka\b/gi, "funkcjonowanie dziecka")
    .replace(/\bmotorykamała\b/gi, "motoryka mała")
    .replace(/\bkoordynacjawzrokowo-ruchowa\b/gi, "koordynacja wzrokowo-ruchowa")
    .replace(/\bpercepcjawzrokowa\b/gi, "percepcja wzrokowa")
    .replace(/\bfunkcjonowanieemocjonalno-społeczne\b/gi, "funkcjonowanie emocjonalno-społeczne")
    .replace(/\bfunkcjonowaniepoznawcze\b/gi, "funkcjonowanie poznawcze")
    .replace(/\bDzieckoposługuje\b/g, "Dziecko posługuje")
    .replace(/\bdzieckoposługuje\b/gi, "dziecko posługuje")
    .replace(/\bposługuje sięwspomagającąlub\b/gi, "posługuje się wspomagającą lub")
    .replace(/\bsięwspomagającą\b/gi, "się wspomagającą")
    .replace(/\bwspomagającąlub\b/gi, "wspomagającą lub")
    .replace(/\balternatywnąmetodąkomunikacji\b/gi, "alternatywną metodą komunikacji")
    .replace(/\bmetodąkomunikacji\b/gi, "metodą komunikacji")
    .replace(/\s+/g, " ")
    .trim();
}

export function repairGluedPolishTextPreservingLayout(value: string) {
  if (!value) return "";
  return value
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => repairGluedPolishText(line))
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function repairTemplateContextText(value: string) {
  return repairGluedPolishText(value);
}

function extractPointNumber(text: string) {
  return text.match(/^((?:\d+[\).]\s*)+(?:[a-z]\))?)/i)?.[1]?.trim();
}

function summarizeSourceForFallback(text: string) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Brak danych w załączonych materiałach.";
  return cleaned.length > 700 ? `${cleaned.slice(0, 700).trim()}...` : cleaned;
}

function findRepeatedParagraphs(content: string) {
  const counts = new Map<string, number>();
  for (const paragraph of normalizeText(content).split(/\n{2,}/).map((item) => item.trim()).filter((item) => item.length > 150)) {
    counts.set(paragraph, (counts.get(paragraph) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([paragraph]) => paragraph.slice(0, 260));
}

function findForbiddenPhrases(content: string) {
  const phrases = [
    "Materiał źródłowy",
    "Brak przykładów wzorcowych",
    "Treść wymaga uzupełnienia",
    "Plik "
  ];
  const lower = content.toLowerCase();
  return phrases.filter((phrase) => lower.includes(phrase.toLowerCase()));
}

function isEmptyTemplateBody(body: string) {
  if (!body.trim()) return true;
  const normalized = body.trim().toLowerCase();
  return (
    /\{\{[^}]+\}\}/.test(body) ||
    normalized.includes("do uzupełnienia") ||
    normalized.includes("uzupełnić") ||
    normalized.includes("wpisz") ||
    normalized === "-"
  );
}

function normalizeText(text: string) {
  return text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function extractDocxParagraphTexts(xml: string) {
  return [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
    .map((match) => extractDocxParagraphText(match[0]))
    .filter((paragraph) => paragraph.length > 0);
}

function extractDocxParagraphText(paragraph: string) {
  return [...paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
    .map((match) => decodeXml(match[1]))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function normalizeForFieldId(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(text: string, fragments: string[]) {
  return fragments.some((fragment) => text.includes(fragment));
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
