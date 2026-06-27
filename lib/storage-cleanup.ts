import { rm, unlink } from "node:fs/promises";
import path from "node:path";
import type { UploadedFile } from "@/generated/prisma/client";
import { extractedTextPath } from "@/lib/extracted-text";

export async function removeUploadedFileArtifacts(file: Pick<UploadedFile, "id" | "documentId" | "storagePath">) {
  await Promise.all([
    removeFileIfSafe(file.storagePath, storageRoot("uploads")),
    removeFileIfSafe(extractedTextPath(file), storageRoot("extracted"))
  ]);
}

export async function removeDocumentArtifacts(input: {
  documentId: string;
  files: Pick<UploadedFile, "id" | "documentId" | "storagePath">[];
  validationReport?: unknown;
}) {
  await Promise.all(input.files.map((file) => removeUploadedFileArtifacts(file)));
  await Promise.all([
    removeGeneratedDocxFromReport(input.validationReport),
    removeFileIfSafe(path.join(storageRoot("generated"), `${input.documentId}.docx`), storageRoot("generated")),
    removeDirectoryIfSafe(path.join(storageRoot("extracted"), input.documentId), storageRoot("extracted"))
  ]);
}

export async function removeGeneratedDocxFromReport(report: unknown, exceptPath?: string | null) {
  const generatedPath = getGeneratedDocxPath(report);
  if (!generatedPath) return;
  if (exceptPath && path.resolve(generatedPath) === path.resolve(exceptPath)) return;
  await removeFileIfSafe(generatedPath, storageRoot("generated"));
}

function getGeneratedDocxPath(report: unknown) {
  if (!report || typeof report !== "object" || !("generatedDocxPath" in report)) return null;
  const value = (report as { generatedDocxPath?: unknown }).generatedDocxPath;
  return typeof value === "string" && value ? value : null;
}

async function removeFileIfSafe(filePath: string | null | undefined, root: string) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  const resolvedRoot = path.resolve(root);
  if (!isInside(resolved, resolvedRoot)) return;
  await unlink(resolved).catch(() => undefined);
}

async function removeDirectoryIfSafe(directoryPath: string, root: string) {
  const resolved = path.resolve(directoryPath);
  const resolvedRoot = path.resolve(root);
  if (!isInside(resolved, resolvedRoot)) return;
  await rm(resolved, { recursive: true, force: true }).catch(() => undefined);
}

function storageRoot(name: "uploads" | "generated" | "extracted") {
  return path.join(process.cwd(), "storage", name);
}

function isInside(resolvedPath: string, resolvedRoot: string) {
  return resolvedPath === resolvedRoot || resolvedPath.startsWith(resolvedRoot + path.sep);
}
