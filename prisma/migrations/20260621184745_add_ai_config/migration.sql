-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "aiApiKey" TEXT,
ADD COLUMN     "aiApiUrl" TEXT,
ADD COLUMN     "aiModel" TEXT DEFAULT 'llama3.1',
ADD COLUMN     "aiProvider" TEXT DEFAULT 'ollama';
