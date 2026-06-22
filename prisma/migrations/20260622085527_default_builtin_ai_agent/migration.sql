-- AlterTable
ALTER TABLE "Organization" ALTER COLUMN "aiModel" DROP DEFAULT,
ALTER COLUMN "aiProvider" SET DEFAULT 'pagent_builtin';
