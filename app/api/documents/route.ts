import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { documentSchema } from "@/lib/validators";
import { generateOpinionDraft } from "@/lib/ai";
import { writeAuditLog } from "@/lib/audit";

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
    include: { child: true, files: true },
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
  const generatedContent =
    parsed.data.generatedContent ||
    (shouldGenerate
      ? await generateOpinionDraft({
          child,
          documentType: parsed.data.type,
          specialistNotes: parsed.data.specialistNotes,
          agentId: organization?.aiProvider
        })
      : null);

  const document = await prisma.document.create({
    data: {
      ...parsed.data,
      generatedContent,
      userId: user.id,
      organizationId: user.organizationId
    },
    include: { child: true, files: true }
  });
  await writeAuditLog({ userId: user.id, action: "create", entity: "Document", entityId: document.id });
  return NextResponse.json(document, { status: 201 });
}
