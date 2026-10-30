import { prisma } from "../db";

const OFFENSIVE = new Set(["goal", "assist", "secondaryAssist", "bigChanceCreated", "shotOnTarget", "hitWoodwork", "dribble", "penaltyWon", "keyPass", "hatTrick", "creativeCap", "penaltyMissed", "offside"]);
const DEFENSIVE = new Set(["cleanSheet", "goalsConcededPer2", "interception", "tackle", "clearance", "blockedShot", "recovery", "duelWon", "save", "penaltySaved", "defensiveCap"]);
const r2 = (n: number) => Math.round(n * 100) / 100;

interface Line { key: string; points: number }

/**
 * Todas as classificações secundárias e prémios. Calculadas a partir de dados reais processados
 * (TeamRoundScore + LeaguePlayerPoints + histórico de transações).
 */
export async function leagueAwards(leagueId: string) {
  const [teams, scores, points, rounds, picks, roster, trades] = await Promise.all([
    prisma.team.findMany({ where: { leagueId } }),
    prisma.teamRoundScore.findMany({ where: { leagueId }, include: { round: true } }),
    prisma.leaguePlayerPoints.findMany({ where: { leagueId }, include: { player: { select: { name: true, position: true } }, fixture: { select: { kickoff: true } } } }),
    prisma.round.findMany({ where: { teamScores: { some: { leagueId } } }, orderBy: { order: "asc" } }),
    prisma.draftPick.findMany({ where: { draft: { leagueId } } }),
    prisma.rosterEntry.findMany({ where: { leagueId } }),
    prisma.trade.findMany({ where: { leagueId, status: "COMPLETED" }, include: { items: true } }),
  ]);
  const name = new Map(teams.map((t) => [t.id, t.name]));
  const finalized = rounds.filter((r) => r.finalizedAt);
  const byKey = new Map<string, typeof points>();
  for (const p of points) byKey.set(`${p.playerId}:${p.roundId}`, [...(byKey.get(`${p.playerId}:${p.roundId}`) ?? []), p]);
  const ptsKey = (playerId: string, roundId: string) => byKey.get(`${playerId}:${roundId}`) ?? [];

  // Ofensiva/defensiva: soma das linhas dos jogadores efetivamente usados (com multiplicador de capitão).
  const split = new Map(teams.map((t) => [t.id, { off: 0, def: 0 }]));
  for (const s of scores) {
    const d = s.details as { players: { playerId: string; multiplier: number }[] };
    for (const u of d.players ?? []) {
      for (const p of ptsKey(u.playerId, s.roundId)) {
        for (const l of ((p.breakdown as unknown as { lines?: Line[] }).lines ?? [])) {
          if (OFFENSIVE.has(l.key)) split.get(s.teamId)!.off += l.points * u.multiplier;
          if (DEFENSIVE.has(l.key)) split.get(s.teamId)!.def += l.points * u.multiplier;
        }
      }
    }
  }

  // Últimas 5 jornadas fechadas
  const last5 = new Set(finalized.slice(-5).map((r) => r.id));
  const last5Rows = teams.map((t) => ({ teamId: t.id, points: r2(scores.filter((s) => s.teamId === t.id && last5.has(s.roundId)).reduce((a, s) => a + s.points, 0)) })).sort((a, b) => b.points - a.points);

  // Power rankings: forma recente (últimas 3) 60% + média da época 40%, normalizado a 100.
  const last3 = new Set(finalized.slice(-3).map((r) => r.id));
  const power = teams.map((t) => {
    const mine = scores.filter((s) => s.teamId === t.id && s.round.finalizedAt);
    const avg = mine.length ? mine.reduce((a, s) => a + s.points, 0) / mine.length : 0;
    const rec = mine.filter((s) => last3.has(s.roundId));
    const recAvg = rec.length ? rec.reduce((a, s) => a + s.points, 0) / rec.length : 0;
    return { teamId: t.id, score: 0.6 * recAvg + 0.4 * avg };
  });
  const maxPower = Math.max(1, ...power.map((p) => p.score));
  power.forEach((p) => (p.score = Math.round((p.score / maxPower) * 100)));
  power.sort((a, b) => b.score - a.score);

  // Pontos de um jogador a partir de uma data (contratações/trocas).
  const playerPtsSince = (playerId: string, since: Date, until?: Date) =>
    r2(points.filter((p) => p.playerId === playerId && p.fixture.kickoff >= since && (!until || p.fixture.kickoff < until)).reduce((a, p) => a + p.points, 0));

  const bestDraft = teams.map((t) => ({
    teamId: t.id,
    points: r2(picks.filter((p) => p.teamId === t.id).reduce((a, p) => a + points.filter((x) => x.playerId === p.playerId).reduce((s, x) => s + x.points, 0), 0)),
  })).sort((a, b) => b.points - a.points);

  const pickups = roster.filter((r) => r.acquiredVia === "FREE_AGENT" || r.acquiredVia === "WAIVER")
    .map((r) => ({ teamId: r.teamId, playerId: r.playerId, name: points.find((p) => p.playerId === r.playerId)?.player.name ?? null, via: r.acquiredVia, points: playerPtsSince(r.playerId, r.acquiredAt) }))
    .sort((a, b) => b.points - a.points);

  const tradeValue = trades.map((t) => {
    const at = t.resolvedAt ?? t.createdAt;
    const got = (team: string) => r2(t.items.filter((i) => i.fromTeamId !== team).reduce((a, i) => a + playerPtsSince(i.playerId, at), 0));
    const a = got(t.proposerTeamId), b = got(t.receiverTeamId);
    return { tradeId: t.id, winner: a >= b ? t.proposerTeamId : t.receiverTeamId, loser: a >= b ? t.receiverTeamId : t.proposerTeamId, margin: r2(Math.abs(a - b)), a, b };
  }).sort((x, y) => y.margin - x.margin);

  // Recordes e prémios semanais
  const bestRoundScore = [...scores].sort((a, b) => b.points - a.points)[0] ?? null;
  const roundAwards = finalized.slice().reverse().map((r) => {
    const rs = scores.filter((s) => s.roundId === r.id).sort((a, b) => b.points - a.points);
    const rp = points.filter((p) => p.roundId === r.id).sort((a, b) => b.points - a.points);
    const mvp = rp[0];
    const owner = mvp ? roster.find((x) => x.playerId === mvp.playerId)?.teamId : null;
    return {
      roundId: r.id, roundName: r.name,
      winner: rs[0] ? { teamId: rs[0].teamId, points: rs[0].points } : null,
      last: rs.length > 1 ? { teamId: rs[rs.length - 1].teamId, points: rs[rs.length - 1].points } : null,
      mvp: mvp ? { name: mvp.player.name, points: mvp.points, playerId: mvp.playerId, ownerTeamId: owner ?? null } : null,
    };
  });
  // Maior surpresa: jogador livre (não escolhido no draft) com mais pontos.
  const drafted = new Set(picks.map((p) => p.playerId));
  const byPlayer = new Map<string, { name: string; points: number }>();
  for (const p of points) {
    if (drafted.has(p.playerId)) continue;
    const e = byPlayer.get(p.playerId) ?? { name: p.player.name, points: 0 };
    e.points += p.points;
    byPlayer.set(p.playerId, e);
  }
  const surprise = [...byPlayer.entries()].sort((a, b) => b[1].points - a[1].points)[0];
  const bestPlayerGame = [...points].sort((a, b) => b.points - a.points)[0];

  return {
    name,
    split: teams.map((t) => ({ teamId: t.id, off: r2(split.get(t.id)!.off), def: r2(split.get(t.id)!.def) })),
    last5Rows, power, bestDraft, pickups, tradeValue, roundAwards,
    records: {
      bestRoundScore: bestRoundScore ? { teamId: bestRoundScore.teamId, points: bestRoundScore.points, round: bestRoundScore.round.name } : null,
      bestPlayerGame: bestPlayerGame ? { name: bestPlayerGame.player.name, points: bestPlayerGame.points, playerId: bestPlayerGame.playerId } : null,
      surprise: surprise ? { playerId: surprise[0], name: surprise[1].name, points: r2(surprise[1].points) } : null,
      bestCoach: [...scores.filter((s) => s.round.finalizedAt)].reduce((m, s) => { m.set(s.teamId, (m.get(s.teamId) ?? 0) + 1 * (s.points === Math.max(...scores.filter((x) => x.roundId === s.roundId).map((x) => x.points)) ? 1 : 0)); return m; }, new Map<string, number>()),
    },
  };
}
