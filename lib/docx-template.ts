import AdmZip from "adm-zip";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DocumentTemplate } from "../generated/prisma/client";
import { asTemplateSections, isTextMarker, type TemplateSection } from "@/lib/document-knowledge";

type GeneratedDocxInput = {
  documentId: string;
  template: Pick<DocumentTemplate, "storagePath" | "mimeType" | "originalName" | "sections">;
  aiSections: Record<string, string>;
};

export async function buildDocxFromTemplate(input: GeneratedDocxInput) {
  if (!isDocxTemplate(input.template)) return null;

  const sections = asTemplateSections(input.template.sections);
  const zip = new AdmZip(input.template.storagePath);
  const documentEntry = zip.getEntry("word/document.xml");
  if (!documentEntry) return null;

  const originalXml = documentEntry.getData().toString("utf8");
  const filledXml = fillDocumentXml(originalXml, sections, input.aiSections);
  zip.updateFile("word/document.xml", Buffer.from(filledXml, "utf8"));

  const outputDirectory = path.join(process.cwd(), "storage", "generated");
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, `${input.documentId}.docx`);
  await writeFile(outputPath, zip.toBuffer());
  return outputPath;
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
      return replaceParagraphText(paragraph, "");
    }
    if (signature) lastSignature = signature;

    const content = section ? aiSections[section.title] : "";
    return replaceParagraphText(paragraph, content || "Brak danych w załączonych materiałach.");
  });
}

function extractParagraphText(paragraph: string) {
  return [...paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
    .map((match) => decodeXml(match[1]))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function replaceParagraphText(paragraph: string, replacement: string) {
  const textMatches = [...paragraph.matchAll(/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g)];
  if (!textMatches.length) return paragraph;

  let replacedFirstText = false;
  return paragraph.replace(/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g, (_match, attrs: string) => {
    if (replacedFirstText) return `<w:t${attrs}></w:t>`;
    replacedFirstText = true;
    return buildTextRuns(attrs, replacement);
  });
}

function buildTextRuns(attrs: string, replacement: string) {
  const lines = replacement.split(/\n+/).map((line) => escapeXml(line.trim())).filter(Boolean);
  if (!lines.length) return `<w:t${attrs}></w:t>`;
  return lines
    .map((line, index) => `${index > 0 ? "<w:br/>" : ""}<w:t${attrs}>${line}</w:t>`)
    .join("");
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
