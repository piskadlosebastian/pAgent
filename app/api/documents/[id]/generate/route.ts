import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { generateOpinionDraft } from "@/lib/ai";
import { buildKnowledgeQuery, extractPlainText, findSimilarExamples, normalizePppType } from "@/lib/document-knowledge";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;

  const document = await prisma.document.findFirst({
    where: { id, userId: user.id },
    include: { child: true, files: true, template: true }
  });
  if (!document) return NextResponse.json({ error: "Nie znaleziono dokumentu." }, { status: 404 });

  const pppType = document.pppType ?? normalizePppType(document.type);
  const template =
    document.template ??
    (await prisma.documentTemplate.findFirst({
      where: { organizationId: user.organizationId, type: pppType, status: "ACTIVE" },
      orderBy: { createdAt: "desc" }
    }));

  if (!template) {
    return NextResponse.json(
      { error: "Brak aktywnego wzoru dla wybranego typu dokumentu. Dodaj i aktywuj wzór przed generowaniem." },
      { status: 400 }
    );
  }

  const sourceTexts = (
    await Promise.all(
      document.files.map(async (file) => {
        const text = await extractPlainText(file.storagePath, file.mimeType, file.originalName);
        if (!text) return `Plik ${file.originalName}: nie udało się odczytać tekstu automatycznie.`;
        return `Plik ${file.originalName}:\n${text.slice(0, 6000)}`;
      })
    )
  ).filter(Boolean);

  const examples = await prisma.knowledgeExample.findMany({
    where: { organizationId: user.organizationId, type: pppType, status: "MODEL" },
    orderBy: { createdAt: "desc" },
    take: 25
  });
  const similarExamples = findSimilarExamples({
    query: buildKnowledgeQuery({ child: document.child, specialistNotes: document.specialistNotes, sourceTexts }),
    examples,
    limit: 3
  });
  const organization = user.organizationId
    ? await prisma.organization.findUnique({ where: { id: user.organizationId }, select: { aiProvider: true } })
    : null;

  const generated = await generateOpinionDraft({
    child: document.child,
    documentType: document.type,
    specialistNotes: document.specialistNotes,
    uploadedFiles: document.files,
    sourceTexts,
    template,
    similarExamples,
    agentId: organization?.aiProvider
  });

  const updated = await prisma.document.update({
    where: { id },
    data: {
      generatedContent: generated.content,
      templateId: template.id,
      templateVersion: template.version,
      validationStatus: generated.validationReport?.valid ? "VALID" : "NEEDS_FIX",
      validationReport: generated.validationReport as Prisma.InputJsonValue | undefined
    },
    include: { child: true, files: true, template: true }
  });

  await writeAuditLog({
    userId: user.id,
    action: "generate-from-sources",
    entity: "Document",
    entityId: id,
    metadata: { files: document.files.length, templateId: template.id }
  });

  return NextResponse.json(updated);
}
