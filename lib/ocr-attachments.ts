import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { UploadedFile } from "../generated/prisma/client";
import { extractImageText } from "@/lib/ocr";
import { prisma } from "@/lib/prisma";
import { fileHasExtension } from "@/lib/document-knowledge";

export function isOcrSourceFile(file: Pick<UploadedFile, "mimeType" | "originalName">) {
  return (
    (file.mimeType?.startsWith("image/") || fileHasExtension(file.originalName, [".png", ".jpg", ".jpeg"])) &&
    !isOcrTextAttachment(file)
  );
}

export function isOcrTextAttachment(file: Pick<UploadedFile, "mimeType" | "originalName"> & { storedName?: string }) {
  return file.mimeType === "text/plain" && (file.storedName?.endsWith(".ocr.txt") || file.originalName.endsWith(".ocr.txt"));
}

export async function materializeOcrTextAttachment(sourceFile: UploadedFile) {
  if (!isOcrSourceFile(sourceFile)) return null;

  const storedName = `${sourceFile.id}.ocr.txt`;
  const existing = await prisma.uploadedFile.findFirst({
    where: {
      documentId: sourceFile.documentId,
      userId: sourceFile.userId,
      storedName
    }
  });
  if (existing) return existing;

  try {
    const text = normalizeOcrText(await extractImageText(sourceFile.storagePath));
    if (!text) return null;

    const originalName = `OCR - ${sourceFile.originalName}.txt`;
    const content = [
      `Zrodlo OCR: ${sourceFile.originalName}`,
      "",
      text
    ].join("\n");
    const directory = path.dirname(sourceFile.storagePath);
    const storagePath = path.join(directory, storedName);
    await mkdir(directory, { recursive: true });
    await writeFile(storagePath, content, "utf8");

    return prisma.uploadedFile.create({
      data: {
        originalName,
        storedName,
        mimeType: "text/plain",
        size: Buffer.byteLength(content, "utf8"),
        storagePath,
        documentId: sourceFile.documentId,
        userId: sourceFile.userId
      }
    });
  } catch (error) {
    console.warn("[OCR] Failed to create OCR text attachment", {
      sourceFileId: sourceFile.id,
      storagePath: sourceFile.storagePath,
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR"
    });
    return null;
  }
}

export async function materializeDocumentOcrTextAttachments(files: UploadedFile[]) {
  await Promise.all(files.map((file) => materializeOcrTextAttachment(file)));
}

function normalizeOcrText(text: string) {
  return text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
}
