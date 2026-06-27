import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { UploadedFile } from "../generated/prisma/client";
import { extractPlainText } from "./document-knowledge";

export function extractedTextPath(file: Pick<UploadedFile, "id" | "documentId">) {
  return path.join(process.cwd(), "storage", "extracted", file.documentId, `${file.id}.txt`);
}

export async function saveExtractedText(file: Pick<UploadedFile, "id" | "documentId">, text: string) {
  const outputPath = extractedTextPath(file);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, text, "utf8");
  return outputPath;
}

export async function readOrCreateExtractedText(file: Pick<UploadedFile, "id" | "documentId" | "storagePath" | "mimeType" | "originalName">) {
  const outputPath = extractedTextPath(file);
  const existing = await readFile(outputPath, "utf8").catch(() => null);
  if (existing !== null) return existing;

  const extracted = await extractPlainText(file.storagePath, file.mimeType, file.originalName);
  await saveExtractedText(file, extracted);
  return extracted;
}
