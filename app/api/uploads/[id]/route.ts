import { unlink } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;

  const file = await prisma.uploadedFile.findFirst({
    where: { id, userId: user.id }
  });
  if (!file) return NextResponse.json({ error: "Nie znaleziono pliku." }, { status: 404 });

  const ocrFile = await prisma.uploadedFile.findFirst({
    where: { documentId: file.documentId, userId: user.id, storedName: `${file.id}.ocr.txt` }
  });

  if (ocrFile) {
    await prisma.uploadedFile.delete({ where: { id: ocrFile.id } });
    await unlink(ocrFile.storagePath).catch(() => undefined);
    await writeAuditLog({ userId: user.id, action: "delete-ocr-upload", entity: "UploadedFile", entityId: ocrFile.id });
  }

  await prisma.uploadedFile.delete({ where: { id } });
  await unlink(file.storagePath).catch(() => undefined);
  await writeAuditLog({ userId: user.id, action: "delete-upload", entity: "UploadedFile", entityId: id });

  return NextResponse.json({ ok: true });
}
