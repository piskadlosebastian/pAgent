CREATE TYPE "PppDocumentType" AS ENUM ('KS', 'WWR', 'OPINIA_PPP', 'INNE');

CREATE TYPE "TemplateStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

CREATE TYPE "KnowledgeExampleStatus" AS ENUM ('MODEL', 'SUPPORTING', 'ARCHIVED');

CREATE TYPE "LearningDecision" AS ENUM ('MODEL', 'SUPPORTING', 'DO_NOT_USE');

CREATE TYPE "ValidationStatus" AS ENUM ('NOT_VALIDATED', 'VALID', 'NEEDS_FIX');

ALTER TABLE "Document"
ADD COLUMN "pppType" "PppDocumentType" NOT NULL DEFAULT 'OPINIA_PPP',
ADD COLUMN "templateId" TEXT,
ADD COLUMN "templateVersion" TEXT,
ADD COLUMN "validationStatus" "ValidationStatus" NOT NULL DEFAULT 'NOT_VALIDATED',
ADD COLUMN "validationReport" JSONB,
ADD COLUMN "learningDecision" "LearningDecision";

CREATE TABLE "DocumentTemplate" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "PppDocumentType" NOT NULL,
  "version" TEXT NOT NULL,
  "status" "TemplateStatus" NOT NULL DEFAULT 'ARCHIVED',
  "originalName" TEXT NOT NULL,
  "storedName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "storagePath" TEXT NOT NULL,
  "extractedText" TEXT NOT NULL,
  "sections" JSONB NOT NULL,
  "organizationId" TEXT,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeExample" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "type" "PppDocumentType" NOT NULL,
  "status" "KnowledgeExampleStatus" NOT NULL DEFAULT 'SUPPORTING',
  "sourceDocumentId" TEXT,
  "originalName" TEXT,
  "storedName" TEXT,
  "mimeType" TEXT,
  "size" INTEGER,
  "storagePath" TEXT,
  "extractedText" TEXT NOT NULL,
  "organizationId" TEXT,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeExample_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentTemplate_organizationId_type_version_key" ON "DocumentTemplate"("organizationId", "type", "version");
CREATE INDEX "DocumentTemplate_organizationId_type_status_idx" ON "DocumentTemplate"("organizationId", "type", "status");
CREATE INDEX "DocumentTemplate_userId_idx" ON "DocumentTemplate"("userId");
CREATE INDEX "KnowledgeExample_organizationId_type_status_idx" ON "KnowledgeExample"("organizationId", "type", "status");
CREATE INDEX "KnowledgeExample_sourceDocumentId_idx" ON "KnowledgeExample"("sourceDocumentId");
CREATE INDEX "KnowledgeExample_userId_idx" ON "KnowledgeExample"("userId");
CREATE INDEX "Document_pppType_idx" ON "Document"("pppType");
CREATE INDEX "Document_templateId_idx" ON "Document"("templateId");

ALTER TABLE "Document"
ADD CONSTRAINT "Document_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DocumentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DocumentTemplate"
ADD CONSTRAINT "DocumentTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "DocumentTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeExample"
ADD CONSTRAINT "KnowledgeExample_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "KnowledgeExample_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "KnowledgeExample_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
