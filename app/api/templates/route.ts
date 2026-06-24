import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { documentTemplateSchema } from "@/lib/validators";
import { extractDocxTemplateSections, extractPlainText, extractTemplateSections, fileHasExtension } from "@/lib/document-knowledge";
import { writeAuditLog } from "@/lib/audit";
import { convertDocToDocx } from "@/lib/office-convert";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOC_MIME = "application/msword";
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
  if (!(file instanceof File)) return NextResponse.json({ error: "Brak pliku DOC lub DOCX." }, { status: 400 });
  if (![DOCX_MIME, DOC_MIME].includes(file.type) && !fileHasExtension(file.name, [".doc", ".docx"])) {
    return NextResponse.json({ error: "Wzór musi być plikiem DOC lub DOCX." }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "Plik przekracza limit 12 MB." }, { status: 400 });

  let storedName = `${randomUUID()}-${file.name.replace(/[^a-z0-9._-]+/gi, "_")}`;
  const directory = path.join(process.cwd(), "storage", "templates", user.organizationId ?? user.id);
  await mkdir(directory, { recursive: true });
  let storagePath = path.join(directory, storedName);
  await writeFile(storagePath, Buffer.from(await file.arrayBuffer()));
  let mimeType = file.type || "application/octet-stream";
  let size = file.size;

  if (fileHasExtension(file.name, [".doc"]) || file.type === DOC_MIME) {
    let converted: Awaited<ReturnType<typeof convertDocToDocx>>;
    try {
      converted = await convertDocToDocx(storagePath, directory);
    } catch (error) {
      return NextResponse.json(
        {
          error: error instanceof Error
            ? error.message
            : "Nie udało się przekonwertować wzoru DOC do DOCX."
        },
        { status: 422 }
      );
    }
    storagePath = converted.path;
    storedName = converted.storedName;
    mimeType = DOCX_MIME;
    size = converted.size;
  }

  const extractedText = await extractPlainText(storagePath, mimeType, storedName);
  const docxSections = extractDocxTemplateSections(storagePath);
  const sections = docxSections.length ? docxSections : extractTemplateSections(extractedText);

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
      mimeType,
      size,
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
