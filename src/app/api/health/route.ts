import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

/** Limite do health check: responde `db: false` em vez de ficar pendurado quando a BD não responde. */
const TIMEOUT_MS = 5_000;

function withTimeout<T>(p: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), TIMEOUT_MS); });
  return Promise.race([p.catch(() => fallback), timeout]).finally(() => clearTimeout(timer));
}

export async function GET() {
  const [db, lastSync] = await Promise.all([
    withTimeout(prisma.$queryRaw`SELECT 1`.then(() => true), false),
    withTimeout(prisma.syncLog.findFirst({ orderBy: { startedAt: "desc" }, select: { job: true, status: true, startedAt: true } }), null),
  ]);
  return Response.json(
    { ok: db, db, provider: process.env.API_FOOTBALL_KEY ? "api-football" : "none", lastSync },
    { status: db ? 200 : 503 },
  );
}
