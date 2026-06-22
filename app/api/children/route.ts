import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { childSchema } from "@/lib/validators";
import { writeAuditLog } from "@/lib/audit";

export async function GET() {
  const user = await requireUser();
  const children = await prisma.child.findMany({
    where: { userId: user.id },
    include: { documents: { orderBy: { createdAt: "desc" }, take: 5 } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }]
  });
  return NextResponse.json(children);
}

export async function POST(request: Request) {
  const user = await requireUser();
  const parsed = childSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Nieprawidłowe dane formularza." }, { status: 400 });

  const child = await prisma.child.create({
    data: {
      ...parsed.data,
      birthDate: new Date(parsed.data.birthDate),
      userId: user.id,
      organizationId: user.organizationId
    }
  });
  await writeAuditLog({ userId: user.id, action: "create", entity: "Child", entityId: child.id });
  return NextResponse.json(child, { status: 201 });
}
