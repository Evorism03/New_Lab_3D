import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

import { PrismaClient } from "../lib/generated/prisma/client.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const COLOR_HEX: Record<string, string> = {
  Black: "#1a1a1a",
  White: "#f2f2f2",
  Grey: "#9a9a9a",
  Natural: "#e8dcc8",
  Clear: "#dfe8e3",
};

async function main() {
  // Superseded by the real FDM lineup below — kept (deactivated, not deleted) so
  // existing orders that reference them by id still resolve.
  const legacyMaterials = [
    { slug: "standard-resin" },
    { slug: "tough-2000-resin" },
    { slug: "nylon-12-sls" },
  ];
  for (const m of legacyMaterials) {
    await prisma.material.updateMany({ where: { slug: m.slug }, data: { active: false } });
  }

  const standardFinishes = [
    { name: "Standard", multiplier: 1 },
    { name: "Sanded", multiplier: 1.15 },
  ];
  const commonColors = ["Black", "White", "Grey"];

  const materials = [
    {
      slug: "pla",
      name: "PLA",
      description: "Biodegradable plastic for prototypes. Easy to print, low heat resistance.",
      pricePerCm3: 0.08,
      setupFeeCents: 200,
      minPriceCents: 500,
      leadTimeDays: 1,
      colors: commonColors,
      finishes: standardFinishes,
      strength: 55,
      flexibility: 25,
      heatResistance: 35,
      bestFor: "Prototypes, decorative models",
    },
    {
      slug: "petg",
      name: "PETG",
      description: "A balance of strength and flexibility. Moisture and chemical resistant.",
      pricePerCm3: 0.1,
      setupFeeCents: 250,
      minPriceCents: 600,
      leadTimeDays: 1,
      colors: commonColors,
      finishes: standardFinishes,
      strength: 75,
      flexibility: 55,
      heatResistance: 65,
      bestFor: "Functional parts, moisture-resistant enclosures",
    },
    {
      slug: "abs",
      name: "ABS",
      description: "Strong, heat-resistant plastic for mechanically loaded parts.",
      pricePerCm3: 0.1,
      setupFeeCents: 250,
      minPriceCents: 600,
      leadTimeDays: 1,
      colors: commonColors,
      finishes: standardFinishes,
      strength: 70,
      flexibility: 50,
      heatResistance: 75,
      bestFor: "Enclosures and mechanically loaded parts",
    },
    {
      slug: "pet",
      name: "PET",
      description: "Reliable, general-purpose material for stable functional components.",
      pricePerCm3: 0.1,
      setupFeeCents: 250,
      minPriceCents: 600,
      leadTimeDays: 1,
      colors: commonColors,
      finishes: standardFinishes,
      strength: 68,
      flexibility: 45,
      heatResistance: 60,
      bestFor: "Stable functional components",
    },
    {
      slug: "tpu",
      name: "TPU",
      description: "Flexible and elastic. Highly resistant to deformation and wear.",
      pricePerCm3: 0.14,
      setupFeeCents: 300,
      minPriceCents: 700,
      leadTimeDays: 2,
      colors: ["Black", "White"],
      finishes: [{ name: "Standard", multiplier: 1 }],
      strength: 35,
      flexibility: 100,
      heatResistance: 50,
      bestFor: "Hinges, gaskets, flexible covers",
    },
    {
      slug: "pa",
      name: "PA (Nylon)",
      description: "Engineering-grade polyamide with high wear and chemical resistance.",
      pricePerCm3: 0.18,
      setupFeeCents: 350,
      minPriceCents: 800,
      leadTimeDays: 2,
      colors: ["Black", "Natural"],
      finishes: [{ name: "Standard", multiplier: 1 }],
      strength: 80,
      flexibility: 75,
      heatResistance: 70,
      bestFor: "Gears, wear-resistant assemblies",
    },
    {
      slug: "pc",
      name: "PC",
      description: "Polycarbonate — maximum strength for heavily loaded, high-temperature parts.",
      pricePerCm3: 0.2,
      setupFeeCents: 400,
      minPriceCents: 900,
      leadTimeDays: 2,
      colors: ["Black", "Clear"],
      finishes: standardFinishes,
      strength: 95,
      flexibility: 40,
      heatResistance: 95,
      bestFor: "High-load, high-temperature parts",
    },
    {
      slug: "pp",
      name: "PP",
      description: "Lightweight and chemical-resistant. Durable for long-lasting parts.",
      pricePerCm3: 0.12,
      setupFeeCents: 300,
      minPriceCents: 700,
      leadTimeDays: 2,
      colors: ["Black", "White"],
      finishes: [{ name: "Standard", multiplier: 1 }],
      strength: 45,
      flexibility: 85,
      heatResistance: 55,
      bestFor: "Living hinges, chemical-resistant containers",
    },
  ];

  for (const m of materials) {
    const material = await prisma.material.upsert({
      where: { slug: m.slug },
      update: {
        name: m.name,
        description: m.description,
        pricePerCm3: m.pricePerCm3,
        setupFeeCents: m.setupFeeCents,
        minPriceCents: m.minPriceCents,
        leadTimeDays: m.leadTimeDays,
        active: true,
        strength: m.strength,
        flexibility: m.flexibility,
        heatResistance: m.heatResistance,
        bestFor: m.bestFor,
      },
      create: {
        slug: m.slug,
        name: m.name,
        description: m.description,
        pricePerCm3: m.pricePerCm3,
        setupFeeCents: m.setupFeeCents,
        minPriceCents: m.minPriceCents,
        leadTimeDays: m.leadTimeDays,
        strength: m.strength,
        flexibility: m.flexibility,
        heatResistance: m.heatResistance,
        bestFor: m.bestFor,
      },
    });

    for (const colorName of m.colors) {
      await prisma.color.upsert({
        where: { materialId_name: { materialId: material.id, name: colorName } },
        update: {},
        create: { materialId: material.id, name: colorName, hex: COLOR_HEX[colorName] ?? "#888888" },
      });
    }

    for (const finish of m.finishes) {
      await prisma.finish.upsert({
        where: { materialId_name: { materialId: material.id, name: finish.name } },
        update: { multiplier: finish.multiplier },
        create: { materialId: material.id, name: finish.name, multiplier: finish.multiplier },
      });
    }
  }

  const adminEmail = "admin";
  const adminPasswordHash = await bcrypt.hash("admin", 10);
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { passwordHash: adminPasswordHash },
    create: { email: adminEmail, passwordHash: adminPasswordHash, role: "ADMIN", name: "Admin" },
  });
  await prisma.user.deleteMany({ where: { email: "admin@formnow.local" } });

  console.log("Seed complete.");
  console.log(`Admin login: ${adminEmail} / admin`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
