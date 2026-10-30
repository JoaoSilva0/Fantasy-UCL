import { prisma } from "@/server/db";
import { tickAllDrafts } from "@/server/services/draft";
import { processTrades } from "@/server/services/trades";
import { processWaivers } from "@/server/services/roster";
import { syncDaily, syncLive, syncPostMatch } from "@/server/services/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Jobs agendados. Proteção: Authorization: Bearer <CRON_SECRET> (o Vercel Cron e o workflow cron.yml enviam este header).
 *  tick  — auto-picks em atraso, expiração/execução de trocas, processamento de waivers (GitHub Actions, cada 5 min)
 *  live  — estatísticas dos jogos a decorrer (GitHub Actions, cada 5 min nas noites de jogo)
 *  post  — correções pós-jogo + fecho de jornadas (GitHub Actions, de hora a hora)
 *  daily — plantéis e lesões (Vercel Cron, diário)
 */
export async function GET(req: Request, { params }: { params: Promise<{ job: string }> }) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { job } = await params;
  try {
    switch (job) {
      case "tick": {
        const drafts = await tickAllDrafts();
        const leagues = await prisma.league.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
        for (const l of leagues) {
          await processTrades(l.id);
          await processWaivers(l.id);
        }
        return Response.json({ ok: true, drafts, leagues: leagues.length });
      }
      case "live":
        return Response.json({ ok: true, result: await syncLive() });
      case "post":
        return Response.json({ ok: true, result: await syncPostMatch() });
      case "daily":
        return Response.json({ ok: true, result: await syncDaily() });
      default:
        return Response.json({ error: "job desconhecido" }, { status: 404 });
    }
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
