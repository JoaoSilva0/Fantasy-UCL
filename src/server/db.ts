import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";

/**
 * Prisma sobre node-postgres (driver recomendado pela Neon para a Vercel com Fluid compute).
 * DATABASE_URL = ligação pooled da Neon (-pooler). Em local, qualquer PostgreSQL serve.
 * attachDatabasePool fecha ligações inativas antes de a função ser suspensa.
 */
function createClient() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10, idleTimeoutMillis: 5_000 });
  attachDatabasePool(pool);
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

const g = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = g.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") g.prisma = prisma;

export type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;
