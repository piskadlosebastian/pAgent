import { execFile } from "node:child_process";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function convertDocToDocx(inputPath: string, outputDirectory: string) {
  const converter = await findOfficeConverter();
  if (!converter) {
    throw new Error("Nie znaleziono LibreOffice/soffice do konwersji DOC na DOCX. Zainstaluj LibreOffice albo wgraj wzór od razu jako DOCX.");
  }

  await execFileAsync(
    converter,
    ["--headless", "--convert-to", "docx", "--outdir", outputDirectory, inputPath],
    { timeout: 60_000 }
  );

  const outputPath = path.join(outputDirectory, `${path.basename(inputPath, path.extname(inputPath))}.docx`);
  await access(outputPath);
  const outputStat = await stat(outputPath);
  return {
    path: outputPath,
    size: outputStat.size,
    storedName: path.basename(outputPath)
  };
}

async function findOfficeConverter() {
  for (const candidate of ["soffice", "libreoffice"]) {
    try {
      await execFileAsync(candidate, ["--version"], { timeout: 10_000 });
      return candidate;
    } catch {
      // Try next candidate.
    }
  }
  return null;
}
