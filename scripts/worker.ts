/**
 * Worker local (alternativa ao Vercel Cron): chama os mesmos jobs que /api/cron/*.
 *   npm run worker
 */
import { prisma } from "../src/server/db";
import { tickAllDrafts } from "../src/server/services/draft";
import { processTrades } from "../src/server/services/trades";
import { processWaivers } from "../src/server/services/roster";
import { syncDaily, syncLive, syncPostMatch } from "../src/server/services/sync";

const every = (ms: number, name: string, fn: () => Promise<unknown>) => {
  let busy = false;
  const go = async () => {
    if (busy) return;
    busy = true;
    try {
      const r = await fn();
      if (r && JSON.stringify(r) !== "{}") console.log(new Date().toISOString(), name, JSON.stringify(r));
    } catch (e) {
      console.error(new Date().toISOString(), name, (e as Error).message);
    } finally {
      busy = false;
    }
  };
  go();
  setInterval(go, ms);
};

every(15_000, "tick", async () => {
  const drafts = await tickAllDrafts();
  for (const l of await prisma.league.findMany({ where: { status: "ACTIVE" }, select: { id: true } })) {
    await processTrades(l.id);
    await processWaivers(l.id);
  }
  return drafts ? { drafts } : {};
});
every(60_000, "live", syncLive);
every(30 * 60_000, "post", syncPostMatch);
every(24 * 3600_000, "daily", syncDaily);
console.log("Worker iniciado. Provider:", process.env.API_FOOTBALL_KEY ? "api-football" : "nenhum (só tick)");
