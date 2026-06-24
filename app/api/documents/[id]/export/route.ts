import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { buildOpinionDocx } from "@/lib/docx";
import { buildDocxFromTemplate } from "@/lib/docx-template";
import { writeAuditLog } from "@/lib/audit";

type ExportDocument = Prisma.DocumentGetPayload<{ include: { child: true; template: true } }>;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const document = await prisma.document.findFirst({
    where: { id, userId: user.id },
    include: { child: true, template: true }
  });
  if (!document) return NextResponse.json({ error: "Nie znaleziono dokumentu." }, { status: 404 });

  const buffer = await getTemplateBasedDocx(document) ?? await buildOpinionDocx(document.title, document.generatedContent ?? "");
  await writeAuditLog({ userId: user.id, action: "export-docx", entity: "Document", entityId: id });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${document.title.replace(/[^a-z0-9-_]+/gi, "_")}.docx"`
    }
  });
}

async function getTemplateBasedDocx(document: ExportDocument) {
  const generatedDocxPath = getGeneratedDocxPath(document.validationReport);
  if (generatedDocxPath) {
    const existingBuffer = await readFile(generatedDocxPath).catch(() => null);
    if (existingBuffer) return existingBuffer;
  }

  const aiSections = getAiSections(document.validationReport);
  if (!document.template || !aiSections) return null;

  const rebuilt = await buildDocxFromTemplate({
    documentId: document.id,
    template: document.template,
    aiSections
  });
  if (!rebuilt) return null;

  await prisma.document.update({
    where: { id: document.id },
    data: {
      validationReport: {
        ...normalizeReport(document.validationReport),
        generatedDocxPath: rebuilt.path,
        docxValidationErrors: rebuilt.validationErrors,
        aiSections
      } as Prisma.InputJsonValue
    }
  });

  return readFile(rebuilt.path);
}

function getGeneratedDocxPath(report: unknown) {
  if (!report || typeof report !== "object" || !("generatedDocxPath" in report)) return null;
  const value = (report as { generatedDocxPath?: unknown }).generatedDocxPath;
  if (typeof value !== "string" || !value) return null;

  const generatedDirectory = path.resolve(/* turbopackIgnore: true */ process.cwd(), "storage", "generated");
  const resolved = path.resolve(/* turbopackIgnore: true */ value);
  if (!resolved.startsWith(generatedDirectory + path.sep)) return null;
  return resolved;
}

function getAiSections(report: unknown) {
  if (!report || typeof report !== "object" || !("aiSections" in report)) return null;
  const value = (report as { aiSections?: unknown }).aiSections;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.every(([key, sectionValue]) => typeof key === "string" && typeof sectionValue === "string")) return null;
  return Object.fromEntries(entries) as Record<string, string>;
}

function normalizeReport(report: unknown) {
  return report && typeof report === "object" && !Array.isArray(report)
    ? report as Record<string, unknown>
    : {};
}
