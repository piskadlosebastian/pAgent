import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { documentSchema } from "@/lib/validators";
import { writeAuditLog } from "@/lib/audit";
import { validateAgainstTemplate } from "@/lib/document-knowledge";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const document = await prisma.document.findFirst({
    where: { id, userId: user.id },
    include: { child: true, files: true, template: true }
  });
  if (!document) return NextResponse.json({ error: "Nie znaleziono dokumentu." }, { status: 404 });
  return NextResponse.json(document);
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const parsed = documentSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Nieprawidłowe dane formularza." }, { status: 400 });

  const existing = await prisma.document.findFirst({ where: { id, userId: user.id }, include: { template: true } });
  if (!existing) return NextResponse.json({ error: "Nie znaleziono dokumentu." }, { status: 404 });
  const validationReport = existing.template && parsed.data.generatedContent
    ? validateAgainstTemplate(parsed.data.generatedContent, existing.template)
    : null;

  const document = await prisma.document.update({
    where: { id },
    data: {
      ...parsed.data,
      validationStatus: validationReport?.valid ? "VALID" : validationReport ? "NEEDS_FIX" : existing.validationStatus,
      ...(validationReport ? { validationReport: validationReport as Prisma.InputJsonValue } : {})
    },
    include: { child: true, files: true, template: true }
  });
  await writeAuditLog({ userId: user.id, action: "update", entity: "Document", entityId: id });
  return NextResponse.json(document);
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const existing = await prisma.document.findFirst({ where: { id, userId: user.id } });
  if (!existing) return NextResponse.json({ error: "Nie znaleziono dokumentu." }, { status: 404 });

  await prisma.document.delete({ where: { id } });
  await writeAuditLog({ userId: user.id, action: "delete", entity: "Document", entityId: id });
  return NextResponse.json({ ok: true });
}
