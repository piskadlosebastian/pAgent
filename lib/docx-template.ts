import AdmZip from "adm-zip";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DocumentTemplate } from "../generated/prisma/client";
import { asTemplateSections, extractDocxTemplateSections, isTextMarker, type TemplateSection } from "./document-knowledge";

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
  if (!isDocxTemplate(input.template)) return null;

  let sections = asTemplateSections(input.template.sections);
  if (!sections.some((section) => section.marker === "TEKST")) {
    sections = extractDocxTemplateSections(input.template.storagePath);
  }
  const zip = new AdmZip(input.template.storagePath);
  const documentEntry = zip.getEntry("word/document.xml");
  if (!documentEntry) return null;

  const originalXml = documentEntry.getData().toString("utf8");
  const filledXml = fillDocumentXml(originalXml, sections, input.aiSections);
  zip.updateFile("word/document.xml", Buffer.from(filledXml, "utf8"));
  const validationErrors = validateGeneratedDocxXml(originalXml, filledXml);

  const outputDirectory = path.join(process.cwd(), "storage", "generated");
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, `${input.documentId}.docx`);
  await writeFile(outputPath, zip.toBuffer());
  return { path: outputPath, validationErrors } satisfies DocxBuildResult;
}

function isDocxTemplate(template: Pick<DocumentTemplate, "mimeType" | "originalName">) {
  return (
    template.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    template.originalName.toLowerCase().endsWith(".docx")
  );
}

function fillDocumentXml(xml: string, sections: TemplateSection[], aiSections: Record<string, string>) {
  let occurrence = 0;
  let lastSignature = "";

  return xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraph) => {
    const text = extractParagraphText(paragraph);
    if (!isTextMarker(text)) return paragraph;

    occurrence += 1;
    const section = sections.find((item) => item.occurrence === occurrence);
    const signature = sectionSignature(section);
    if (signature && signature === lastSignature) {
      return "";
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
  const blocks = splitReplacementBlocks(replacement, preferList);
  if (!blocks.length) return "";

  return blocks.map((block) => replaceParagraphWithSingleBlock(paragraph, block)).join("");
}

function replaceParagraphWithSingleBlock(paragraph: string, replacement: string) {
  const paragraphOpen = paragraph.match(/^<w:p\b([^>]*)>/)?.[1] ?? "";
  const paragraphProperties = paragraph.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)?.[0] ?? "";
  const runProperties = paragraph.match(/<w:r\b[^>]*>[\s\S]*?(<w:rPr\b[\s\S]*?<\/w:rPr>)/)?.[1] ?? "";

  return [
    `<w:p${paragraphOpen}>`,
    paragraphProperties,
    "<w:r>",
    runProperties,
    `<w:t xml:space="preserve">${escapeXml(replacement)}</w:t>`,
    "</w:r>",
    "</w:p>"
  ].join("");
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
  const text = paragraphTexts.join("\n");

  if (paragraphTexts.some((paragraph) => isTextMarker(paragraph))) {
    errors.push("W wygenerowanym DOCX nadal występuje placeholder Tekst/tekst.");
  }

  for (const requiredSection of ["Diagnoza", "Zalecenia", "Dodatkowe informacje"]) {
    if (!text.toLowerCase().includes(requiredSection.toLowerCase())) {
      errors.push(`Brakuje sekcji wzoru: ${requiredSection}.`);
    }
  }

  if (filledParagraphs < Math.floor(originalParagraphs * 0.9)) {
    errors.push("Liczba akapitów w DOCX jest znacząco mniejsza niż we wzorze.");
  }

  if (originalHeadings.length && filledHeadings.length < originalHeadings.length) {
    errors.push("Liczba nagłówków w DOCX jest mniejsza niż we wzorze.");
  }

  if (paragraphTexts.some((paragraph) => paragraph.length > 2500)) {
    errors.push("W DOCX wykryto akapit dłuższy niż 2500 znaków, co sugeruje sklejenie tekstu.");
  }

  return errors;
}

function countParagraphs(xml: string) {
  return (xml.match(/<w:p\b/g) ?? []).length;
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
