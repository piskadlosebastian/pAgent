import { z } from "zod";

export const childSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  birthDate: z.string().min(1),
  school: z.string().max(160).optional().nullable(),
  classGroup: z.string().max(80).optional().nullable(),
  guardians: z.string().max(200).optional().nullable(),
  notes: z.string().max(2000).optional().nullable()
});

export const documentSchema = z.object({
  childId: z.string().min(1),
  title: z.string().min(1).max(180),
  type: z.string().min(1).max(120),
  status: z.enum(["DRAFT", "REVIEW", "APPROVED", "ARCHIVED"]).default("DRAFT"),
  specialistNotes: z.string().max(4000).optional().nullable(),
  generatedContent: z.string().max(30000).optional().nullable()
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(10).max(120)
});
