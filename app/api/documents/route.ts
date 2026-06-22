import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { documentSchema } from "@/lib/validators";
import { generateOpinionDraft } from "@/lib/ai";
import { writeAuditLog } from "@/lib/audit";
import { buildKnowledgeQuery, findSimilarExamples, inferPppType } from "@/lib/document-knowledge";

export async function GET(request: Request) {
  const user = await requireUser();
  const { searchParams } = new URL(request.url);
  const childId = searchParams.get("childId") || undefined;
  const status = searchParams.get("status") || undefined;

  const documents = await prisma.document.findMany({
    where: {
      userId: user.id,
      ...(childId ? { childId } : {}),
      ...(status ? { status: status as never } : {})
    },
    include: { child: true, files: true, template: true },
    orderBy: { createdAt: "desc" }
  });
  return NextResponse.json(documents);
}

export async function POST(request: Request) {
  const user = await requireUser();
  const payload = await request.json();
  const parsed = documentSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Nieprawidłowe dane formularza." }, { status: 400 });

  const child = await prisma.child.findFirst({ where: { id: parsed.data.childId, userId: user.id } });
  if (!child) return NextResponse.json({ error: "Wybrane dziecko nie istnieje." }, { status: 404 });
  const organization = user.organizationId
    ? await prisma.organization.findUnique({
        where: { id: user.organizationId },
        select: { aiProvider: true }
      })
    : null;

  const shouldGenerate = Boolean(payload.generateDraft);
  const pppType = inferPppType({
    explicitType: parsed.data.pppType,
    title: parsed.data.title,
    documentType: parsed.data.type,
    notes: parsed.data.specialistNotes
  });
  const template = await prisma.documentTemplate.findFirst({
    where: { organizationId: user.organizationId, type: pppType, status: "ACTIVE" },
    orderBy: { createdAt: "desc" }
  });
  const examples = await prisma.knowledgeExample.findMany({
    where: { organizationId: user.organizationId, type: pppType, status: "MODEL" },
    orderBy: { createdAt: "desc" },
    take: 25
  });
  const similarExamples = findSimilarExamples({
    query: buildKnowledgeQuery({ child, specialistNotes: parsed.data.specialistNotes }),
    examples,
    limit: 3
  });
  const generatedResult =
    shouldGenerate && !parsed.data.generatedContent
      ? await generateOpinionDraft({
          child,
          documentType: parsed.data.type,
          specialistNotes: parsed.data.specialistNotes,
          template,
          similarExamples,
          agentId: organization?.aiProvider
        })
      : null;
  const generatedContent =
    parsed.data.generatedContent ||
    generatedResult?.content ||
    null;

  const document = await prisma.document.create({
    data: {
      ...parsed.data,
      pppType,
      generatedContent,
      templateId: template?.id,
      templateVersion: template?.version,
      validationStatus: generatedResult ? (generatedResult.validationReport?.valid ? "VALID" : "NEEDS_FIX") : "NOT_VALIDATED",
      validationReport: generatedResult?.validationReport as Prisma.InputJsonValue | undefined,
      userId: user.id,
      organizationId: user.organizationId
    },
    include: { child: true, files: true, template: true }
  });
  await writeAuditLog({ userId: user.id, action: "create", entity: "Document", entityId: document.id });
  return NextResponse.json(document, { status: 201 });
}
