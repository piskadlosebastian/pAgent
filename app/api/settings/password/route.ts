import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { passwordChangeSchema } from "@/lib/validators";
import { writeAuditLog } from "@/lib/audit";

export async function POST(request: Request) {
  const user = await requireUser();
  const parsed = passwordChangeSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Hasło musi mieć co najmniej 10 znaków." }, { status: 400 });

  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser) return NextResponse.json({ error: "Nie znaleziono użytkownika." }, { status: 404 });

  const currentValid = await bcrypt.compare(parsed.data.currentPassword, dbUser.passwordHash);
  if (!currentValid) return NextResponse.json({ error: "Aktualne hasło jest nieprawidłowe." }, { status: 400 });

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, 12) }
  });
  await writeAuditLog({ userId: user.id, action: "change-password", entity: "User", entityId: user.id });
  return NextResponse.json({ ok: true });
}
