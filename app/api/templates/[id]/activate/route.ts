import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const template = await prisma.documentTemplate.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!template) return NextResponse.json({ error: "Nie znaleziono wzoru." }, { status: 404 });

  await prisma.$transaction([
    prisma.documentTemplate.updateMany({
      where: { organizationId: user.organizationId, type: template.type, status: "ACTIVE" },
      data: { status: "ARCHIVED" }
    }),
    prisma.documentTemplate.update({ where: { id }, data: { status: "ACTIVE" } })
  ]);

  await writeAuditLog({ userId: user.id, action: "activate-template", entity: "DocumentTemplate", entityId: id });
  return NextResponse.json({ ok: true });
}
