import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { readOrCreateExtractedText } from "@/lib/extracted-text";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const file = await prisma.uploadedFile.findFirst({ where: { id, userId: user.id } });
  if (!file) return NextResponse.json({ error: "Nie znaleziono pliku." }, { status: 404 });

  const extractedText = await readOrCreateExtractedText(file);
  const text = extractedText.trim()
    ? extractedText
    : "Nie udało się odczytać tekstu z tego pliku. Jeżeli to skan lub zdjęcie, sprawdź jakość obrazu i czy tekst jest czytelny.";

  return new NextResponse(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `inline; filename="${file.originalName.replace(/[^a-z0-9._-]+/gi, "_")}.txt"`
    }
  });
}
