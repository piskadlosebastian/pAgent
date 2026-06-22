import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { childSchema } from "@/lib/validators";
import { writeAuditLog } from "@/lib/audit";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const parsed = childSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Nieprawidłowe dane formularza." }, { status: 400 });

  const existing = await prisma.child.findFirst({ where: { id, userId: user.id } });
  if (!existing) return NextResponse.json({ error: "Nie znaleziono dziecka." }, { status: 404 });

  const child = await prisma.child.update({
    where: { id },
    data: { ...parsed.data, birthDate: new Date(parsed.data.birthDate) }
  });
  await writeAuditLog({ userId: user.id, action: "update", entity: "Child", entityId: id });
  return NextResponse.json(child);
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const existing = await prisma.child.findFirst({ where: { id, userId: user.id } });
  if (!existing) return NextResponse.json({ error: "Nie znaleziono dziecka." }, { status: 404 });

  await prisma.child.delete({ where: { id } });
  await writeAuditLog({ userId: user.id, action: "delete", entity: "Child", entityId: id });
  return NextResponse.json({ ok: true });
}
