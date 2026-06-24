import { NextResponse } from "next/server";
import { generateDocumentForUser } from "@/lib/document-generation";
import { requireUser } from "@/lib/session";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;

  try {
    const updated = await generateDocumentForUser({ user, documentId: id });
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nie udało się wygenerować dokumentu." },
      { status: 400 }
    );
  }
}
