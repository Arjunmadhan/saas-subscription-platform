import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl) {
  const db = new URL(databaseUrl);

  console.log("[Prisma] Database target:", {
    host: db.hostname,
    port: db.port,
    database: db.pathname,
    username: db.username,
  });
}

export const prisma = new PrismaClient();