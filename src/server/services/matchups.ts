import { prisma } from "../db";
import { roundRobin, sortStandings, type StandingRow } from "@/lib/fantasy/schedule";
import { parseSettings } from "./settings";

const REGULAR_WITH_PLAYOFFS = ["LEAGUE_PHASE", "PLAYOFF", "R16"];

async function orderedTeamIds(leagueId: string) {
  const draft = await prisma.draft.findUnique({ where: { leagueId } });
  if (Array.isArray(draft?.order)) return draft.order as string[];
  const teams = await prisma.team.findMany({ where: { leagueId }, orderBy: { createdAt: "asc" } });
  return teams.map((t) => t.id);
}

/** Cria (de forma incremental) o calendário H2H e o quadro de playoffs à medida que as jornadas existem. */
export async function ensureSchedule(leagueId: string) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const s = parseSettings(league.settings);
  if (s.format === "POINTS" || league.status === "SETUP" || league.status === "DRAFTING") return;
  const teamIds = await orderedTeamIds(leagueId);
  const rounds = await prisma.round.findMany({ where: { seasonId: league.seasonId }, orderBy: { order: "asc" } });
  const existing = await prisma.matchup.findMany({ where: { leagueId } });
  const regular = s.playoffs.enabled ? rounds.filter((r) => REGULAR_WITH_PLAYOFFS.includes(r.stage)) : rounds;
  const pairings = roundRobin(teamIds, regular.length);

  for (const [i, r] of regular.entries()) {
    if (existing.some((m) => !m.isPlayoff && m.roundIds.length === 1 && m.roundIds[0] === r.id)) continue;
    const pairs = pairings[i].filter(([a, b]) => a && b) as [string, string][];
    await prisma.matchup.createMany({
      data: pairs.map(([home, away]) => ({ leagueId, roundIds: [r.id], label: r.name, homeTeamId: home, awayTeamId: away })),
    });
  }

  if (!s.playoffs.enabled) return;
  const qf = rounds.filter((r) => r.stage === "QF").map((r) => r.id);
  const sf = rounds.filter((r) => r.stage === "SF").map((r) => r.id);
  const slots: [string, string, string[]][] = [
    ["SF1", "Playoffs · Meia-final 1 (1º vs 4º)", qf],
    ["SF2", "Playoffs · Meia-final 2 (2º vs 3º)", qf],
    ["F", "Playoffs · Final", sf],
  ];
  for (const [slot, label, ids] of slots) {
    if (!ids.length) continue;
    const m = existing.find((x) => x.bracketSlot === slot);
    if (!m) await prisma.matchup.create({ data: { leagueId, roundIds: ids, label, isPlayoff: true, bracketSlot: slot } });
    else if (m.roundIds.length !== ids.length && !m.final) await prisma.matchup.update({ where: { id: m.id }, data: { roundIds: ids } });
  }
}

/** Atualiza resultados dos confrontos a partir das pontuações de jornada; semeia os playoffs. */
export async function resolveMatchups(leagueId: string) {
  const matchups = await prisma.matchup.findMany({ where: { leagueId } });
  if (!matchups.length) return;
  const scores = await prisma.teamRoundScore.findMany({ where: { leagueId } });
  const rounds = await prisma.round.findMany({ where: { id: { in: [...new Set(matchups.flatMap((m) => m.roundIds))] } } });
  const finalized = new Set(rounds.filter((r) => r.finalizedAt).map((r) => r.id));
  const sum = (teamId: string | null, roundIds: string[]) =>
    teamId ? Math.round(scores.filter((s) => s.teamId === teamId && roundIds.includes(s.roundId)).reduce((a, s) => a + s.points, 0) * 100) / 100 : null;

  for (const m of matchups) {
    if (m.final || !m.homeTeamId || !m.awayTeamId) continue;
    const homePoints = sum(m.homeTeamId, m.roundIds);
    const awayPoints = sum(m.awayTeamId, m.roundIds);
    const final = m.roundIds.every((id) => finalized.has(id));
    let winnerTeamId: string | null = null;
    if (final && homePoints !== null && awayPoints !== null) {
      if (homePoints > awayPoints) winnerTeamId = m.homeTeamId;
      else if (awayPoints > homePoints) winnerTeamId = m.awayTeamId;
      else if (m.isPlayoff) winnerTeamId = m.homeTeamId; // empate em playoffs: avança o melhor classificado
    }
    await prisma.matchup.update({ where: { id: m.id }, data: { homePoints, awayPoints, final, winnerTeamId } });
  }

  // Semear playoffs quando a fase regular termina.
  const regular = matchups.filter((m) => !m.isPlayoff);
  const sf1 = matchups.find((m) => m.bracketSlot === "SF1");
  const sf2 = matchups.find((m) => m.bracketSlot === "SF2");
  const regularDone = regular.length > 0 && regular.every((m) => m.roundIds.every((id) => finalized.has(id)));
  if (sf1 && sf2 && !sf1.homeTeamId && regularDone) {
    const table = await standings(leagueId);
    if (table.length >= 4) {
      await prisma.matchup.update({ where: { id: sf1.id }, data: { homeTeamId: table[0].teamId, awayTeamId: table[3].teamId } });
      await prisma.matchup.update({ where: { id: sf2.id }, data: { homeTeamId: table[1].teamId, awayTeamId: table[2].teamId } });
    }
  }
  const fresh = await prisma.matchup.findMany({ where: { leagueId, isPlayoff: true } });
  const [a, b, f] = ["SF1", "SF2", "F"].map((s) => fresh.find((m) => m.bracketSlot === s));
  if (a?.final && b?.final && f && !f.homeTeamId && a.winnerTeamId && b.winnerTeamId) {
    await prisma.matchup.update({ where: { id: f.id }, data: { homeTeamId: a.winnerTeamId, awayTeamId: b.winnerTeamId } });
  }
}

/** Classificação geral (pontos acumulados, H2H ou híbrida). */
export async function standings(leagueId: string, onlyRoundIds?: string[]) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const s = parseSettings(league.settings);
  const teams = await prisma.team.findMany({ where: { leagueId } });
  const scores = await prisma.teamRoundScore.findMany({
    where: { leagueId, ...(onlyRoundIds ? { roundId: { in: onlyRoundIds } } : {}) },
    include: { round: true },
  });
  const rows = new Map<string, StandingRow>(
    teams.map((t) => [t.id, { teamId: t.id, points: 0, w: 0, d: 0, l: 0, bonus: 0, tablePoints: 0 }]),
  );
  for (const sc of scores) rows.get(sc.teamId)!.points += sc.points;

  if (s.format !== "POINTS" && !onlyRoundIds) {
    const regular = await prisma.matchup.findMany({ where: { leagueId, isPlayoff: false, final: true } });
    for (const m of regular) {
      const h = rows.get(m.homeTeamId!);
      const a = rows.get(m.awayTeamId!);
      if (!h || !a) continue;
      if (!m.winnerTeamId) { h.d++; a.d++; }
      else if (m.winnerTeamId === h.teamId) { h.w++; a.l++; }
      else { a.w++; h.l++; }
    }
    if (s.format === "HYBRID") {
      const regularRounds = new Set(regular.flatMap((m) => m.roundIds));
      const byRound = new Map<string, typeof scores>();
      for (const sc of scores) if (sc.round.finalizedAt && regularRounds.has(sc.roundId)) byRound.set(sc.roundId, [...(byRound.get(sc.roundId) ?? []), sc]);
      for (const list of byRound.values()) {
        const sorted = [...list].sort((x, y) => y.points - x.points);
        const half = Math.floor(sorted.length / 2);
        const cutoff = sorted[half - 1]?.points;
        for (const sc of sorted) if (half > 0 && sc.points >= cutoff && sc.points > (sorted[half]?.points ?? -Infinity)) rows.get(sc.teamId)!.bonus++;
      }
    }
  }
  for (const r of rows.values()) {
    r.points = Math.round(r.points * 100) / 100;
    r.tablePoints = r.w * 3 + r.d + r.bonus;
  }
  return sortStandings([...rows.values()], onlyRoundIds ? "POINTS" : s.format);
}
