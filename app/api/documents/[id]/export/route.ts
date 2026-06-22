import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { buildOpinionDocx } from "@/lib/docx";
import { writeAuditLog } from "@/lib/audit";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const document = await prisma.document.findFirst({
    where: { id, userId: user.id },
    include: { child: true }
  });
  if (!document) return NextResponse.json({ error: "Nie znaleziono dokumentu." }, { status: 404 });

  const buffer = await buildOpinionDocx(document.title, document.generatedContent ?? "");
  await writeAuditLog({ userId: user.id, action: "export-docx", entity: "Document", entityId: id });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${document.title.replace(/[^a-z0-9-_]+/gi, "_")}.docx"`
    }
  });
}
