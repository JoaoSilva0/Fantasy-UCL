import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const [db, lastSync] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    prisma.syncLog.findFirst({ orderBy: { startedAt: "desc" }, select: { job: true, status: true, startedAt: true } }),
  ]);
  return Response.json({ ok: db, db, provider: process.env.API_FOOTBALL_KEY ? "api-football" : "none", lastSync });
}
