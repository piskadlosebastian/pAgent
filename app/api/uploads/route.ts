import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";

const MAX_FILE_SIZE = 12 * 1024 * 1024;
const allowedMimeTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "image/png",
  "image/jpeg"
]);

export async function POST(request: Request) {
  const user = await requireUser();
  const formData = await request.formData();
  const documentId = String(formData.get("documentId") ?? "");
  const file = formData.get("file");

  if (!(file instanceof File)) return NextResponse.json({ error: "Brak pliku." }, { status: 400 });
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "Plik przekracza limit 12 MB." }, { status: 400 });
  if (!allowedMimeTypes.has(file.type)) return NextResponse.json({ error: "Niedozwolony typ pliku." }, { status: 400 });

  const document = await prisma.document.findFirst({ where: { id: documentId, userId: user.id } });
  if (!document) return NextResponse.json({ error: "Nie znaleziono dokumentu." }, { status: 404 });

  const storedName = `${randomUUID()}-${file.name.replace(/[^a-z0-9._-]+/gi, "_")}`;
  const directory = path.join(process.cwd(), "storage", "uploads", user.id, documentId);
  await mkdir(directory, { recursive: true });
  const storagePath = path.join(directory, storedName);
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(storagePath, bytes);

  const uploadedFile = await prisma.uploadedFile.create({
    data: {
      originalName: file.name,
      storedName,
      mimeType: file.type,
      size: file.size,
      storagePath,
      documentId,
      userId: user.id
    }
  });

  await writeAuditLog({ userId: user.id, action: "upload", entity: "UploadedFile", entityId: uploadedFile.id });
  return NextResponse.json(uploadedFile, { status: 201 });
}
