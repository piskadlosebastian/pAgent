import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { normalizePppType } from "@/lib/document-knowledge";
import { writeAuditLog } from "@/lib/audit";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const { decision } = await request.json();
  if (!["MODEL", "SUPPORTING", "DO_NOT_USE"].includes(decision)) {
    return NextResponse.json({ error: "Nieprawidłowa decyzja." }, { status: 400 });
  }

  const document = await prisma.document.findFirst({ where: { id, userId: user.id }, include: { child: true } });
  if (!document) return NextResponse.json({ error: "Nie znaleziono dokumentu." }, { status: 404 });

  await prisma.document.update({ where: { id }, data: { learningDecision: decision } });

  if (decision === "MODEL") {
    await prisma.knowledgeExample.create({
      data: {
        title: document.title,
        type: document.pppType ?? normalizePppType(document.type),
        status: "MODEL",
        sourceDocumentId: document.id,
        extractedText: document.generatedContent ?? "",
        organizationId: user.organizationId,
        userId: user.id
      }
    });
  }

  await writeAuditLog({ userId: user.id, action: "learning-decision", entity: "Document", entityId: id, metadata: { decision } });
  return NextResponse.json({ ok: true });
}
