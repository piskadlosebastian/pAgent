import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function extractImageText(storagePath: string) {
  try {
    const { stdout } = await execFileAsync(
      "tesseract",
      [storagePath, "stdout", "-l", "pol+eng", "--psm", "6"],
      { timeout: 90_000, maxBuffer: 8 * 1024 * 1024 }
    );
    return stdout.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  } catch (error) {
    console.warn("[OCR] Failed to read image text", {
      storagePath,
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR"
    });
    return "";
  }
}
