import { NextResponse } from "next/server";
import { startGenerationJob } from "@/lib/generation-jobs";
import { requireUser } from "@/lib/session";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const job = startGenerationJob(user, id);
  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    progress: job.progress
  });
}
