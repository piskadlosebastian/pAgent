import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { documentSchema } from "@/lib/validators";
import { writeAuditLog } from "@/lib/audit";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const document = await prisma.document.findFirst({
    where: { id, userId: user.id },
    include: { child: true, files: true }
  });
  if (!document) return NextResponse.json({ error: "Nie znaleziono dokumentu." }, { status: 404 });
  return NextResponse.json(document);
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const parsed = documentSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Nieprawidłowe dane formularza." }, { status: 400 });

  const existing = await prisma.document.findFirst({ where: { id, userId: user.id } });
  if (!existing) return NextResponse.json({ error: "Nie znaleziono dokumentu." }, { status: 404 });

  const document = await prisma.document.update({
    where: { id },
    data: parsed.data,
    include: { child: true, files: true }
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
