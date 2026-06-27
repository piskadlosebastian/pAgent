import type { Prisma } from "@/generated/prisma/client";
import path from "node:path";
import { generateOpinionDraft, type GenerationProgressEvent } from "@/lib/ai";
import { getAiAgent } from "@/lib/ai-agents";
import { buildDocxFromTemplate } from "@/lib/docx-template";
import { buildKnowledgeQuery, extractPlainText, findSimilarExamples, inferPppType } from "@/lib/document-knowledge";
import { isOcrSourceFile, materializeDocumentOcrTextAttachments } from "@/lib/ocr-attachments";
import { saveExtractedText } from "@/lib/extracted-text";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { removeGeneratedDocxFromReport } from "@/lib/storage-cleanup";

type GenerationUser = {
  id: string;
  organizationId?: string | null;
};

export type DocumentGenerationProgress = {
  step: string;
  message: string;
  percent: number;
};

export async function generateDocumentForUser(input: {
  user: GenerationUser;
  documentId: string;
  onProgress?: (progress: DocumentGenerationProgress) => void;
}) {
  const { user, documentId, onProgress } = input;
  const progress = (step: string, message: string, percent: number) => {
    onProgress?.({ step, message, percent: Math.max(0, Math.min(100, Math.round(percent))) });
  };

  progress("Odczytywanie dokumentów", "Sprawdzam dokument i aktywny wzór.", 5);
  const document = await prisma.document.findFirst({
    where: { id: documentId, userId: user.id },
    include: { child: true, files: true, template: true }
  });
  if (!document) throw new Error("Nie znaleziono dokumentu.");

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
    throw new Error("Brak aktywnego wzoru dla wybranego typu dokumentu. Dodaj i aktywuj wzór przed generowaniem.");
  }

  if (!document.files.length) {
    throw new Error("Dodaj co najmniej jeden plik źródłowy przed generowaniem dokumentu.");
  }

  progress("Odczytywanie dokumentów", "Odczytuję tekst z załączonych plików.", 10);
  await materializeDocumentOcrTextAttachments(document.files);
  const sourceFiles = await prisma.uploadedFile.findMany({
    where: { documentId, userId: user.id },
    orderBy: { createdAt: "asc" }
  });
  const ocrAttachmentNames = new Set(sourceFiles.map((file) => file.storedName).filter((name) => name.endsWith(".ocr.txt")));
  const filesToRead = sourceFiles.filter((file) => !(isOcrSourceFile(file) && ocrAttachmentNames.has(`${file.id}.ocr.txt`)));
  const perFileTextLimit = filesToRead.length > 6 ? 3200 : filesToRead.length > 4 ? 4200 : 6000;
  const sourceTexts = (
    await Promise.all(
      filesToRead.map(async (file, index) => {
        progress("Odczytywanie dokumentów", `Odczytuję plik ${index + 1} z ${filesToRead.length}: ${file.originalName}`, 10 + ((index + 1) / filesToRead.length) * 12);
        const text = await extractPlainText(file.storagePath, file.mimeType, file.originalName);
        await saveExtractedText(file, text);
        if (!text) return "";
        return `Plik ${file.originalName}:\n${text.slice(0, perFileTextLimit)}`;
      })
    )
  ).filter(Boolean);

  if (!sourceTexts.length && !document.specialistNotes?.trim()) {
    throw new Error("Nie udało się odczytać tekstu z załączonych plików. Dodaj plik DOC, DOCX, PDF z warstwą tekstową albo wpisz najważniejsze dane w uwagach specjalisty.");
  }

  progress("Analiza bazy wiedzy", "Szukam podobnych przykładów wzorcowych.", 24);
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
  const selectedAgent = getAiAgent(organization?.aiProvider);

  progress("Tworzenie profilu dziecka", "Tworzę profil dziecka z materiałów źródłowych.", 28);
  const generated = await generateOpinionDraft({
    child: document.child,
    documentType: document.type,
    specialistNotes: document.specialistNotes,
    uploadedFiles: sourceFiles,
    sourceTexts,
    template,
    similarExamples,
    agentId: organization?.aiProvider,
    onProgress: (event) => progressFromAiEvent(event, progress)
  });

  progress("Składanie dokumentu", "Wstawiam wygenerowane treści do wzoru DOCX.", 84);
  await removeGeneratedDocxFromReport(document.validationReport, generatedExpectedDocxPath(documentId));
  const generatedDocx = generated.aiSections
    ? await buildDocxFromTemplate({
        documentId,
        template,
        aiSections: generated.aiSections
      })
    : null;
  const generatedDocxPath = generatedDocx?.path ?? null;
  const docxValidationErrors = generatedDocx?.validationErrors ?? [];
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
    generatedDocxPath,
    docxValidationErrors,
    aiSections: generated.aiSections ?? null,
    aiAgent: {
      id: selectedAgent.id,
      name: selectedAgent.name,
      provider: selectedAgent.provider,
      model: selectedAgent.model ?? null
    }
  };
  const isValid = Boolean(generated.validationReport?.valid) && docxValidationErrors.length === 0;

  progress("Kontrola jakości", "Waliduję zgodność dokumentu ze wzorem.", 92);
  const updated = await prisma.document.update({
    where: { id: documentId },
    data: {
      generatedContent: generated.content,
      templateId: template.id,
      templateVersion: template.version,
      pppType,
      validationStatus: isValid ? "VALID" : "NEEDS_FIX",
      validationReport: validationReport as Prisma.InputJsonValue
    },
    include: { child: true, files: true, template: true }
  });

  await writeAuditLog({
    userId: user.id,
    action: "generate-from-sources",
    entity: "Document",
    entityId: documentId,
    metadata: { files: sourceFiles.length, templateId: template.id }
  });

  progress("Gotowe", "Dokument został wygenerowany i jest gotowy do weryfikacji.", 100);
  return updated;
}

function generatedExpectedDocxPath(documentId: string) {
  return path.join(process.cwd(), "storage", "generated", `${documentId}.docx`);
}

function progressFromAiEvent(
  event: GenerationProgressEvent,
  progress: (step: string, message: string, percent: number) => void
) {
  if (event.phase === "profile-start") {
    progress("Tworzenie profilu dziecka", "AI tworzy profil dziecka.", 30);
    return;
  }
  if (event.phase === "profile-complete") {
    progress("Analiza wzoru", "Profil dziecka jest gotowy. Analizuję pola wzoru.", 40);
    return;
  }
  if (event.phase === "field-start") {
    const percent = 40 + ((event.current - 1) / Math.max(event.total, 1)) * 38;
    progress("Generowanie treści", `AI wypełnia pole ${event.current} z ${event.total}.`, percent);
    return;
  }
  if (event.phase === "field-complete") {
    const percent = 40 + (event.current / Math.max(event.total, 1)) * 38;
    progress("Generowanie treści", `Uzupełniono pole ${event.current} z ${event.total}.`, percent);
  }
}
