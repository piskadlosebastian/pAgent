import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { Role } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { adminCreateUserSchema } from "@/lib/validators";
import { writeAuditLog } from "@/lib/audit";

const SUPER_ADMIN_EMAIL = "admin@nexurio.pl";

export async function GET() {
  const user = await requireUser();
  if (!isSuperAdmin(user.email)) return NextResponse.json({ isAdmin: false, users: [] });

  const users = await prisma.user.findMany({
    where: { organizationId: user.organizationId },
    orderBy: [{ role: "desc" }, { email: "asc" }],
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      updatedAt: true
    }
  });

  return NextResponse.json({ isAdmin: true, users, currentUserId: user.id });
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!isSuperAdmin(user.email)) return NextResponse.json({ error: "Brak uprawnień." }, { status: 403 });

  const parsed = adminCreateUserSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Podaj poprawny email i hasło mające co najmniej 10 znaków." }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return NextResponse.json({ error: "Użytkownik z tym adresem email już istnieje." }, { status: 409 });

  const created = await prisma.user.create({
    data: {
      email,
      name: parsed.data.name?.trim() || null,
      role: parsed.data.role as Role,
      passwordHash: await bcrypt.hash(parsed.data.password, 12),
      organizationId: user.organizationId
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

  await writeAuditLog({ userId: user.id, action: "admin-create-user", entity: "User", entityId: created.id });
  return NextResponse.json(created, { status: 201 });
}

function isSuperAdmin(email?: string | null) {
  return email?.toLowerCase() === SUPER_ADMIN_EMAIL;
}
