import { prisma, type Tx } from "../db";

export interface PlayerForm {
  total: number;
  games: number;
  seasonAvg: number;
  last5Avg: number;
  last5: number[];
  minutes: number;
}

const EMPTY: PlayerForm = { total: 0, games: 0, seasonAvg: 0, last5Avg: 0, last5: [], minutes: 0 };
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Forma dos jogadores numa liga, calculada apenas a partir de pontos reais já processados.
 * `playerIds` omitido = todos os jogadores com pontos na liga.
 */
export async function playerForm(leagueId: string, playerIds?: string[], db: Tx = prisma) {
  const rows = await db.leaguePlayerPoints.findMany({
    where: { leagueId, ...(playerIds ? { playerId: { in: playerIds } } : {}), minutes: { gt: 0 } },
    select: { playerId: true, points: true, minutes: true, fixture: { select: { kickoff: true } } },
  });
  const by = new Map<string, { points: number; minutes: number; at: number }[]>();
  for (const r of rows) {
    const list = by.get(r.playerId) ?? [];
    list.push({ points: r.points, minutes: r.minutes, at: r.fixture.kickoff.getTime() });
    by.set(r.playerId, list);
  }
  const out = new Map<string, PlayerForm>();
  for (const [id, list] of by) {
    list.sort((a, b) => b.at - a.at);
    const total = list.reduce((s, x) => s + x.points, 0);
    const last5 = list.slice(0, 5).map((x) => x.points);
    out.set(id, {
      total: r2(total),
      games: list.length,
      seasonAvg: r2(total / list.length),
      last5Avg: r2(last5.reduce((s, x) => s + x, 0) / last5.length),
      last5,
      minutes: list.reduce((s, x) => s + x.minutes, 0),
    });
  }
  return { get: (id: string) => out.get(id) ?? EMPTY, map: out };
}

/** Estimativa (não previsão oficial): média ponderada da forma recente e da época. */
export function estimate(f: PlayerForm) {
  return f.games ? r2(0.6 * f.last5Avg + 0.4 * f.seasonAvg) : null;
}
