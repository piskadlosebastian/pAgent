import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { Role } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { adminUpdateUserSchema } from "@/lib/validators";
import { writeAuditLog } from "@/lib/audit";

const SUPER_ADMIN_EMAIL = "admin@nexurio.pl";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!isSuperAdmin(user.email)) return NextResponse.json({ error: "Brak uprawnień." }, { status: 403 });

  const { id } = await context.params;
  const parsed = adminUpdateUserSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Nieprawidłowe dane użytkownika." }, { status: 400 });

  const existing = await prisma.user.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!existing) return NextResponse.json({ error: "Nie znaleziono użytkownika." }, { status: 404 });

  const email = parsed.data.email.toLowerCase().trim();
  if (id === user.id && email !== SUPER_ADMIN_EMAIL) {
    return NextResponse.json({ error: "Nie można zmienić adresu głównego administratora." }, { status: 400 });
  }
  const emailOwner = await prisma.user.findUnique({ where: { email } });
  if (emailOwner && emailOwner.id !== id) {
    return NextResponse.json({ error: "Ten adres email jest już przypisany do innego użytkownika." }, { status: 409 });
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      email,
      name: parsed.data.name?.trim() || null,
      role: parsed.data.role as Role,
      ...(parsed.data.password ? { passwordHash: await bcrypt.hash(parsed.data.password, 12) } : {})
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      updatedAt: true
    }
  });

  await writeAuditLog({ userId: user.id, action: "admin-update-user", entity: "User", entityId: id });
  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!isSuperAdmin(user.email)) return NextResponse.json({ error: "Brak uprawnień." }, { status: 403 });

  const { id } = await context.params;
  if (id === user.id) {
    return NextResponse.json({ error: "Nie można usunąć aktualnie zalogowanego administratora." }, { status: 400 });
  }

  const existing = await prisma.user.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!existing) return NextResponse.json({ error: "Nie znaleziono użytkownika." }, { status: 404 });

  await prisma.user.delete({ where: { id } });
  await writeAuditLog({ userId: user.id, action: "admin-delete-user", entity: "User", entityId: id });
  return NextResponse.json({ ok: true });
}

function isSuperAdmin(email?: string | null) {
  return email?.toLowerCase() === SUPER_ADMIN_EMAIL;
}
