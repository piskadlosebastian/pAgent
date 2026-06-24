import { randomUUID } from "node:crypto";
import { generateDocumentForUser, type DocumentGenerationProgress } from "@/lib/document-generation";

type GenerationUser = {
  id: string;
  organizationId?: string | null;
};

export type GenerationJobStatus = "queued" | "running" | "completed" | "failed";

export type GenerationJob = {
  id: string;
  userId: string;
  documentId: string;
  status: GenerationJobStatus;
  progress: DocumentGenerationProgress;
  result?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

const jobs = new Map<string, GenerationJob>();

export function startGenerationJob(user: GenerationUser, documentId: string) {
  pruneOldJobs();
  const now = Date.now();
  const job: GenerationJob = {
    id: randomUUID(),
    userId: user.id,
    documentId,
    status: "queued",
    progress: {
      step: "Kolejka",
      message: "Przygotowuję generowanie dokumentu.",
      percent: 0
    },
    createdAt: now,
    updatedAt: now
  };
  jobs.set(job.id, job);
  void runGenerationJob(job.id, user, documentId);
  return job;
}

export function getGenerationJob(userId: string, jobId: string) {
  const job = jobs.get(jobId);
  if (!job || job.userId !== userId) return null;
  return job;
}

async function runGenerationJob(jobId: string, user: GenerationUser, documentId: string) {
  const job = jobs.get(jobId);
  if (!job) return;

  updateJob(job, {
    status: "running",
    progress: {
      step: "Start",
      message: "Rozpoczynam generowanie dokumentu.",
      percent: 1
    }
  });

  try {
    const result = await generateDocumentForUser({
      user,
      documentId,
      onProgress: (progress) => updateJob(job, { progress })
    });
    updateJob(job, {
      status: "completed",
      result,
      progress: {
        step: "Gotowe",
        message: "Dokument został wygenerowany i jest gotowy do weryfikacji.",
        percent: 100
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udało się wygenerować dokumentu.";
    updateJob(job, {
      status: "failed",
      error: message,
      progress: {
        step: "Błąd",
        message,
        percent: 100
      }
    });
  }
}

function updateJob(job: GenerationJob, patch: Partial<GenerationJob>) {
  Object.assign(job, patch, { updatedAt: Date.now() });
}

function pruneOldJobs() {
  const maxAgeMs = 1000 * 60 * 60;
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.updatedAt > maxAgeMs) jobs.delete(id);
  }
}
