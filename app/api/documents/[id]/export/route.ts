import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { buildOpinionDocx } from "@/lib/docx";
import { writeAuditLog } from "@/lib/audit";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const document = await prisma.document.findFirst({
    where: { id, userId: user.id },
    include: { child: true, template: true }
  });
  if (!document) return NextResponse.json({ error: "Nie znaleziono dokumentu." }, { status: 404 });

  const generatedDocxPath = getGeneratedDocxPath(document.validationReport);
  const buffer = generatedDocxPath
    ? await readFile(generatedDocxPath).catch(() => buildOpinionDocx(document.title, document.generatedContent ?? ""))
    : await buildOpinionDocx(document.title, document.generatedContent ?? "");
  await writeAuditLog({ userId: user.id, action: "export-docx", entity: "Document", entityId: id });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${document.title.replace(/[^a-z0-9-_]+/gi, "_")}.docx"`
    }
  });
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
