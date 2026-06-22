import "dotenv/config";
import { PrismaClient, Role } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL })
});

async function main() {
  const organization = await prisma.organization.upsert({
    where: { id: "seed-org" },
    update: {
      aiProvider: "pagent_builtin",
      aiModel: null,
      aiApiUrl: null,
      aiApiKey: null
    },
    create: {
      id: "seed-org",
      name: "Poradnia demonstracyjna",
      documentFooter: "Dokument wymaga weryfikacji i zatwierdzenia przez uprawnionego specjalistę.",
      aiProvider: "pagent_builtin",
      aiModel: null,
      aiApiUrl: null,
      aiApiKey: null
    }
  });

  const email = process.env.ADMIN_EMAIL ?? "admin@pagent.local";
  const password = process.env.ADMIN_PASSWORD ?? "ChangeMe123!";
  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: Role.ADMIN, organizationId: organization.id },
    create: {
      email,
      name: "Administrator",
      passwordHash,
      role: Role.ADMIN,
      organizationId: organization.id
    }
  });

  console.log(`Seed complete. Admin login: ${email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
