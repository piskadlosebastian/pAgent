import { prisma } from "@/lib/prisma";
import type { Prisma } from "../generated/prisma/client";

export async function writeAuditLog(input: {
  userId?: string;
  action: string;
  entity: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  await prisma.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      metadata: input.metadata
    }
  });
}
