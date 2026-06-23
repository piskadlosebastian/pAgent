import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { generateOpinionDraft } from "@/lib/ai";
import { buildDocxFromTemplate } from "@/lib/docx-template";
import { buildKnowledgeQuery, extractPlainText, findSimilarExamples, inferPppType } from "@/lib/document-knowledge";
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

  const pppType = inferPppType({
    explicitType: document.pppType,
    title: document.title,
    documentType: document.type,
    notes: document.specialistNotes
  });
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

  if (!document.files.length) {
    return NextResponse.json(
      { error: "Dodaj co najmniej jeden plik źródłowy przed generowaniem dokumentu." },
      { status: 400 }
    );
  }

  const sourceTexts = (
    await Promise.all(
      document.files.map(async (file) => {
        const text = await extractPlainText(file.storagePath, file.mimeType, file.originalName);
        if (!text) return "";
        return `Plik ${file.originalName}:\n${text.slice(0, 6000)}`;
      })
    )
  ).filter(Boolean);

  if (!sourceTexts.length && !document.specialistNotes?.trim()) {
    return NextResponse.json(
      { error: "Nie udało się odczytać tekstu z załączonych plików. Dodaj plik DOC, DOCX, PDF z warstwą tekstową albo wpisz najważniejsze dane w uwagach specjalisty." },
      { status: 400 }
    );
  }

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
  const generatedDocxPath = generated.aiSections
    ? await buildDocxFromTemplate({
        documentId: id,
        template,
        aiSections: generated.aiSections
      })
    : null;
  const validationReport = {
    ...(generated.validationReport ?? {
      valid: false,
      missingSections: [],
      addedSections: [],
      emptyRequiredFields: [],
      remainingPlaceholders: [],
      repeatedParagraphs: [],
      forbiddenPhrases: []
    }),
    generatedDocxPath
  };

  const updated = await prisma.document.update({
    where: { id },
    data: {
      generatedContent: generated.content,
      templateId: template.id,
      templateVersion: template.version,
      pppType,
      validationStatus: generated.validationReport?.valid ? "VALID" : "NEEDS_FIX",
      validationReport: validationReport as Prisma.InputJsonValue
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
