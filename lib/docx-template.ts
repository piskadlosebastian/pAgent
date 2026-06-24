import AdmZip from "adm-zip";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DocumentTemplate } from "../generated/prisma/client";
import { asTemplateSections, extractDocxTemplateSections, fileHasExtension, isTextMarker, repairGluedPolishTextPreservingLayout, type TemplateSection } from "./document-knowledge";
import { convertDocToDocx } from "./office-convert";

type GeneratedDocxInput = {
  documentId: string;
  template: Pick<DocumentTemplate, "storagePath" | "mimeType" | "originalName" | "sections">;
  aiSections: Record<string, string>;
};

type DocxBuildResult = {
  path: string;
  validationErrors: string[];
};

export async function buildDocxFromTemplate(input: GeneratedDocxInput) {
  const outputDirectory = path.join(process.cwd(), "storage", "generated");
  await mkdir(outputDirectory, { recursive: true });
  const docxTemplatePath = await resolveDocxTemplatePath(input.template, outputDirectory);
  if (!docxTemplatePath) return null;

  let sections = asTemplateSections(input.template.sections);
  if (!sections.some((section) => section.marker === "TEKST")) {
    sections = extractDocxTemplateSections(docxTemplatePath);
  }
  const zip = new AdmZip(docxTemplatePath);
  const documentEntry = zip.getEntry("word/document.xml");
  if (!documentEntry) return null;

  const originalXml = documentEntry.getData().toString("utf8");
  const filledXml = fillDocumentXml(originalXml, sections, input.aiSections);
  zip.updateFile("word/document.xml", Buffer.from(filledXml, "utf8"));
  const validationErrors = validateGeneratedDocxXml(originalXml, filledXml);

  const outputPath = path.join(outputDirectory, `${input.documentId}.docx`);
  await writeFile(outputPath, zip.toBuffer());
  return { path: outputPath, validationErrors } satisfies DocxBuildResult;
}

async function resolveDocxTemplatePath(template: Pick<DocumentTemplate, "storagePath" | "mimeType" | "originalName">, outputDirectory: string) {
  if (
    template.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    template.originalName.toLowerCase().endsWith(".docx")
  ) {
    return template.storagePath;
  }

  if (template.mimeType === "application/msword" || fileHasExtension(template.originalName, [".doc"])) {
    const converted = await convertDocToDocx(template.storagePath, outputDirectory);
    return converted.path;
  }

  return null;
}

function fillDocumentXml(xml: string, sections: TemplateSection[], aiSections: Record<string, string>) {
  let occurrence = 0;
  let lastSignature = "";

  return xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraph) => {
    const text = extractParagraphText(paragraph);
    const technicalKeys = extractTechnicalPlaceholderKeys(text);
    if (technicalKeys.length) {
      return replaceTechnicalPlaceholders(paragraph, text, technicalKeys, aiSections, isListParagraph(paragraph));
    }
    if (!isTextMarker(text)) return paragraph;

    occurrence += 1;
    const section = sections.find((item) => item.marker === "TEKST" && item.occurrence === occurrence);
    const signature = sectionSignature(section);
    if (signature && signature === lastSignature) {
      return clearParagraphText(paragraph);
    }
    if (signature) lastSignature = signature;

    const content = section ? (section.fieldId ? aiSections[section.fieldId] : "") || aiSections[section.title] : "";
    return replaceParagraphText(paragraph, content || "Brak danych w załączonych materiałach.", isListParagraph(paragraph));
  });
}

function extractParagraphText(paragraph: string) {
  return [...paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
    .map((match) => decodeXml(match[1]))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function replaceParagraphText(paragraph: string, replacement: string, preferList = false) {
  const textMatches = [...paragraph.matchAll(/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g)];
  if (!textMatches.length) return paragraph;
  const blocks = splitReplacementBlocks(repairDocxReplacementText(replacement), preferList);
  if (!blocks.length) return clearParagraphText(paragraph);

  return blocks.map((block) => replaceParagraphWithSingleBlock(paragraph, block)).join("");
}

function replaceTechnicalPlaceholders(
  paragraph: string,
  text: string,
  keys: string[],
  aiSections: Record<string, string>,
  preferList: boolean
) {
  const replacementText = keys.reduce((output, key) => {
    const value = aiSections[key] ?? aiSections[normalizeTechnicalKey(key)] ?? "";
    return output.replace(new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\s*\\}\\}`, "gi"), value || "Brak danych w załączonych materiałach.");
  }, text);

  const placeholderOnly = /^\s*\{\{\s*[\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ-]+\s*\}\}\s*$/.test(text);
  return replaceParagraphText(paragraph, replacementText, preferList && placeholderOnly);
}

function replaceParagraphWithSingleBlock(paragraph: string, replacement: string) {
  let replacedFirstRun = false;
  return paragraph.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, (run) => {
    if (!/<w:t\b[\s\S]*?<\/w:t>/.test(run)) return run;
    if (replacedFirstRun) return "";
    replacedFirstRun = true;
    return run.replace(/<w:t\b([^>]*)>[\s\S]*?<\/w:t>/, (_match, attrs: string) => {
      return `<w:t${ensurePreserveSpace(attrs)}>${escapeXml(replacement)}</w:t>`;
    });
  });
}

function repairDocxReplacementText(value: string) {
  return repairGluedPolishTextPreservingLayout(value)
    .replace(/([a-ząćęłńóśźż])([A-ZĄĆĘŁŃÓŚŹŻ])/g, "$1 $2")
    .replace(/([a-ząćęłńóśźż])(?=(?:oraz|albo|lub|który|która|które|jego|jej|ich|dziecka|ucznia|środowisku|występujących|uwzględnieniem|ramach|zakresie|procesie|edukacji|funkcjonowaniu|rozwoju|komunikacji|wsparcia|potrzeb|barier|zaleceń|diagnozy)\b)/gi, "$1 ")
    .replace(/\bzuwzględnieniem\b/gi, "z uwzględnieniem")
    .replace(/\bwramach\b/gi, "w ramach")
    .replace(/\bwewspółpracy\b/gi, "we współpracy")
    .replace(/\bdopracy\b/gi, "do pracy")
    .replace(/\bnapodstawie\b/gi, "na podstawie")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?])(?=\S)/g, "$1 ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function ensurePreserveSpace(attrs: string) {
  return /\bxml:space=/.test(attrs) ? attrs : `${attrs} xml:space="preserve"`;
}

function clearParagraphText(paragraph: string) {
  let clearedFirstText = false;
  return paragraph.replace(/<w:t\b([^>]*)>[\s\S]*?<\/w:t>/g, (_match, attrs: string) => {
    if (clearedFirstText) return "";
    clearedFirstText = true;
    return `<w:t${ensurePreserveSpace(attrs)}></w:t>`;
  });
}

function extractTechnicalPlaceholderKeys(text: string) {
  return [...text.matchAll(/\{\{\s*([a-zA-Z0-9_ąćęłńóśźżĄĆĘŁŃÓŚŹŻ-]+)\s*\}\}/g)]
    .map((match) => match[1])
    .filter(Boolean);
}

function normalizeTechnicalKey(key: string) {
  return key.trim().toLowerCase().replace(/-/g, "_");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitReplacementBlocks(replacement: string, preferList: boolean) {
  return replacement
    .replace(/\r/g, "")
    .replace(/\n+/g, "\n\n")
    .split(/\n{2,}|\n(?=\s*(?:[-•*]|\d+[\).])\s+)/)
    .map((block) => {
      const cleaned = block.replace(/\s+/g, " ").trim();
      const listMatch = cleaned.match(/^(?:[-•*]|\d+[\).])\s+(.+)$/);
      return preferList && listMatch ? listMatch[1].trim() : cleaned;
    })
    .filter(Boolean);
}

function isListParagraph(paragraph: string) {
  return /<w:numPr\b[\s\S]*?<\/w:numPr>/.test(paragraph) || /<w:pStyle\b[^>]*w:val="[^"]*(?:List|Lista|Bullet|Punkt)[^"]*"/i.test(paragraph);
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

function validateGeneratedDocxXml(originalXml: string, filledXml: string) {
  const errors: string[] = [];
  const originalParagraphs = countParagraphs(originalXml);
  const filledParagraphs = countParagraphs(filledXml);
  const paragraphTexts = extractParagraphTexts(filledXml);
  const originalHeadings = extractHeadingLikeParagraphTexts(originalXml);
  const filledHeadings = extractHeadingLikeParagraphTexts(filledXml);
  const originalNumberedParagraphs = countNumberedParagraphs(originalXml);
  const filledNumberedParagraphs = countNumberedParagraphs(filledXml);
  const originalText = extractParagraphTexts(originalXml).join("\n");
  const text = paragraphTexts.join("\n");

  if (paragraphTexts.some((paragraph) => isTextMarker(paragraph))) {
    errors.push("W wygenerowanym DOCX nadal występuje placeholder Tekst/tekst.");
  }

  if (text.includes("{{") || text.includes("}}")) {
    errors.push("W wygenerowanym DOCX nadal występują techniczne placeholdery {{ }}.");
  }

  for (const phrase of forbiddenGluedPhrases()) {
    if (text.toLowerCase().includes(phrase.toLowerCase())) {
      errors.push(`W DOCX wykryto sklejoną frazę: ${phrase}.`);
    }
  }

  for (const forbiddenPhrase of forbiddenAiCommentPhrases()) {
    if (text.toLowerCase().includes(forbiddenPhrase.toLowerCase())) {
      errors.push(`W DOCX wykryto niedozwolony komentarz techniczny: ${forbiddenPhrase}.`);
    }
  }

  for (const requiredSection of ["Diagnoza", "Zalecenia", "Dodatkowe informacje", "Podpisy członków zespołu orzekającego", "Otrzymuje"]) {
    if (originalText.toLowerCase().includes(requiredSection.toLowerCase()) && !text.toLowerCase().includes(requiredSection.toLowerCase())) {
      errors.push(`Brakuje sekcji wzoru: ${requiredSection}.`);
    }
  }

  if (filledParagraphs < Math.floor(originalParagraphs * 0.9)) {
    errors.push("Liczba akapitów w DOCX jest znacząco mniejsza niż we wzorze.");
  }

  if (originalHeadings.length && filledHeadings.length < originalHeadings.length) {
    errors.push("Liczba nagłówków w DOCX jest mniejsza niż we wzorze.");
  }

  if (originalNumberedParagraphs && filledNumberedParagraphs < originalNumberedParagraphs) {
    errors.push("Liczba akapitów numerowanych w DOCX jest mniejsza niż we wzorze.");
  }

  if (hasVisibleNumbering(originalXml) && !hasVisibleNumbering(filledXml)) {
    errors.push("W DOCX zniknęła widoczna numeracja punktów lub podpunktów.");
  }

  if (paragraphTexts.some((paragraph) => paragraph.length > 2500)) {
    errors.push("W DOCX wykryto akapit dłuższy niż 2500 znaków, co sugeruje sklejenie tekstu.");
  }

  return errors;
}

function countParagraphs(xml: string) {
  return (xml.match(/<w:p\b/g) ?? []).length;
}

function countNumberedParagraphs(xml: string) {
  return (xml.match(/<w:numPr\b/g) ?? []).length;
}

function hasVisibleNumbering(xml: string) {
  const text = extractParagraphTexts(xml).join("\n");
  return /(?:^|\n)\s*(?:\d+[\).]|[a-z]\))\s+/i.test(text);
}

function forbiddenGluedPhrases() {
  return [
    "poziomfunkcjonowania",
    "potencjalerozwojowym",
    "usuwaniabarier",
    "Dzieckoposługuje",
    "należywskazać",
    "zespołuorzekającego",
    "zespoluorzekajacego",
    "innaformawychowania"
  ];
}

function forbiddenAiCommentPhrases() {
  return [
    "Dokument wymaga weryfikacji",
    "Treść wymaga uzupełnienia",
    "Materiał źródłowy",
    "Brak przykładów wzorcowych"
  ];
}

function extractParagraphTexts(xml: string) {
  return [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
    .map((match) => extractParagraphText(match[0]))
    .filter(Boolean);
}

function extractHeadingLikeParagraphTexts(xml: string) {
  return [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
    .filter((match) => /<w:pStyle\b[^>]*w:val="[^"]*(?:Heading|Naglowek|Nagłówek|Tytul|Tytuł)[^"]*"/i.test(match[0]))
    .map((match) => extractParagraphText(match[0]))
    .filter(Boolean);
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
