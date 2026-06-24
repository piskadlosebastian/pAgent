import { NextResponse } from "next/server";
import { getGenerationJob } from "@/lib/generation-jobs";
import { requireUser } from "@/lib/session";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const job = getGenerationJob(user.id, id);

  if (!job) {
    return NextResponse.json({ error: "Nie znaleziono zadania generowania." }, { status: 404 });
  }

  return NextResponse.json(job);
}
