import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { documentTemplateSchema } from "@/lib/validators";
import { extractDocxText, extractTemplateSections } from "@/lib/document-knowledge";
import { writeAuditLog } from "@/lib/audit";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_FILE_SIZE = 12 * 1024 * 1024;

export async function GET() {
  const user = await requireUser();
  const templates = await prisma.documentTemplate.findMany({
    where: { organizationId: user.organizationId },
    orderBy: [{ type: "asc" }, { createdAt: "desc" }]
  });
  return NextResponse.json(templates);
}

export async function POST(request: Request) {
  const user = await requireUser();
  const formData = await request.formData();
  const file = formData.get("file");
  const parsed = documentTemplateSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    type: String(formData.get("type") ?? ""),
    version: String(formData.get("version") ?? ""),
    active: String(formData.get("active") ?? "") === "true"
  });

  if (!parsed.success) return NextResponse.json({ error: "Nieprawidłowe dane wzoru." }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "Brak pliku DOCX." }, { status: 400 });
  if (file.type !== DOCX_MIME) return NextResponse.json({ error: "Wzór musi być plikiem DOCX." }, { status: 400 });
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "Plik przekracza limit 12 MB." }, { status: 400 });

  const storedName = `${randomUUID()}-${file.name.replace(/[^a-z0-9._-]+/gi, "_")}`;
  const directory = path.join(process.cwd(), "storage", "templates", user.organizationId ?? user.id);
  await mkdir(directory, { recursive: true });
  const storagePath = path.join(directory, storedName);
  await writeFile(storagePath, Buffer.from(await file.arrayBuffer()));

  const extractedText = await extractDocxText(storagePath);
  const sections = extractTemplateSections(extractedText);

  if (parsed.data.active) {
    await prisma.documentTemplate.updateMany({
      where: { organizationId: user.organizationId, type: parsed.data.type, status: "ACTIVE" },
      data: { status: "ARCHIVED" }
    });
  }

  const template = await prisma.documentTemplate.create({
    data: {
      name: parsed.data.name,
      type: parsed.data.type,
      version: parsed.data.version,
      status: parsed.data.active ? "ACTIVE" : "ARCHIVED",
      originalName: file.name,
      storedName,
      mimeType: file.type,
      size: file.size,
      storagePath,
      extractedText,
      sections,
      organizationId: user.organizationId,
      userId: user.id
    }
  });

  await writeAuditLog({ userId: user.id, action: "create-template", entity: "DocumentTemplate", entityId: template.id });
  return NextResponse.json(template, { status: 201 });
}
