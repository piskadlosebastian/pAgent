import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { knowledgeExampleSchema } from "@/lib/validators";
import { extractPlainText, fileHasExtension } from "@/lib/document-knowledge";
import { writeAuditLog } from "@/lib/audit";

const MAX_FILE_SIZE = 12 * 1024 * 1024;
const allowedMimeTypes = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain"
]);
const allowedExtensions = [".doc", ".docx", ".txt"];

export async function GET() {
  const user = await requireUser();
  const examples = await prisma.knowledgeExample.findMany({
    where: { organizationId: user.organizationId },
    orderBy: [{ type: "asc" }, { createdAt: "desc" }]
  });
  return NextResponse.json(examples);
}

export async function POST(request: Request) {
  const user = await requireUser();
  const formData = await request.formData();
  const file = formData.get("file");
  const parsed = knowledgeExampleSchema.safeParse({
    title: String(formData.get("title") ?? ""),
    type: String(formData.get("type") ?? ""),
    status: String(formData.get("status") ?? "")
  });

  if (!parsed.success) return NextResponse.json({ error: "Nieprawidłowe dane przykładu." }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "Brak pliku." }, { status: 400 });
  if (!allowedMimeTypes.has(file.type) && !fileHasExtension(file.name, allowedExtensions)) {
    return NextResponse.json({ error: "Do bazy wiedzy dodaj DOC, DOCX lub TXT." }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "Plik przekracza limit 12 MB." }, { status: 400 });

  const storedName = `${randomUUID()}-${file.name.replace(/[^a-z0-9._-]+/gi, "_")}`;
  const directory = path.join(process.cwd(), "storage", "examples", user.organizationId ?? user.id);
  await mkdir(directory, { recursive: true });
  const storagePath = path.join(directory, storedName);
  await writeFile(storagePath, Buffer.from(await file.arrayBuffer()));
  const extractedText = await extractPlainText(storagePath, file.type, file.name);

  const example = await prisma.knowledgeExample.create({
    data: {
      ...parsed.data,
      originalName: file.name,
      storedName,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      storagePath,
      extractedText,
      organizationId: user.organizationId,
      userId: user.id
    }
  });

  await writeAuditLog({ userId: user.id, action: "create-example", entity: "KnowledgeExample", entityId: example.id });
  return NextResponse.json(example, { status: 201 });
}
