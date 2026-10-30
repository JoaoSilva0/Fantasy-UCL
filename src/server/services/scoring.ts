import { prisma } from "../db";
import { scorePlayer, hashObject, type MatchStats } from "@/lib/fantasy/scoring";
import { computeTeamScore, type PlayerRoundResult } from "@/lib/fantasy/lineup";
import type { Pos } from "@/lib/fantasy/config";
import { parseScoring, parseSettings } from "./settings";
import { getOrCreateLineup } from "./lineups";
import { roundLockState } from "./rounds";
import { emit, audit } from "./activity";
import { resolveMatchups } from "./matchups";

const ACTIVE = ["DRAFTING", "ACTIVE", "COMPLETED"] as const;

/**
 * Recalcula os pontos (por liga) de todas as estatísticas de um conjunto de jogos.
 * Idempotente: só escreve quando o hash das estatísticas ou das regras mudou.
 */
export async function recomputeFixtures(fixtureIds: string[], opts: { leagueId?: string } = {}) {
  if (!fixtureIds.length) return { updated: 0 };
  const fixtures = await prisma.fixture.findMany({ where: { id: { in: fixtureIds } }, select: { id: true, seasonId: true, roundId: true } });
  const seasonIds = [...new Set(fixtures.map((f) => f.seasonId))];
  const leagues = await prisma.league.findMany({
    where: { seasonId: { in: seasonIds }, status: { in: [...ACTIVE] }, ...(opts.leagueId ? { id: opts.leagueId } : {}) },
  });
  const stats = await prisma.playerMatchStat.findMany({
    where: { fixtureId: { in: fixtureIds } },
    include: { player: { select: { position: true } } },
  });
  const roundOf = new Map(fixtures.map((f) => [f.id, f.roundId]));
  let updated = 0;
  for (const league of leagues) {
    const rules = parseScoring(league.scoring);
    const rulesHash = hashObject(rules);
    const existing = await prisma.leaguePlayerPoints.findMany({
      where: { leagueId: league.id, fixtureId: { in: fixtureIds } },
      select: { playerId: true, fixtureId: true, statHash: true, rulesHash: true },
    });
    const known = new Map(existing.map((e) => [`${e.playerId}:${e.fixtureId}`, e]));
    for (const s of stats) {
      const k = known.get(`${s.playerId}:${s.fixtureId}`);
      if (k && k.statHash === s.hash && k.rulesHash === rulesHash) continue;
      const res = scorePlayer(s.stats as unknown as MatchStats, s.player.position as Pos, rules);
      const data = {
        points: res.total,
        breakdown: { lines: res.lines, unavailable: res.unavailable } as object,
        minutes: s.minutes,
        statHash: s.hash,
        rulesHash,
        roundId: roundOf.get(s.fixtureId)!,
        computedAt: new Date(),
      };
      await prisma.leaguePlayerPoints.upsert({
        where: { leagueId_playerId_fixtureId: { leagueId: league.id, playerId: s.playerId, fixtureId: s.fixtureId } },
        create: { leagueId: league.id, playerId: s.playerId, fixtureId: s.fixtureId, ...data },
        update: data,
      });
      updated++;
    }
    const rounds = [...new Set(fixtures.map((f) => f.roundId))];
    for (const roundId of rounds) await computeTeamRoundScores(league.id, roundId);
    if (updated) await emit(league.id, "SCORES_UPDATED", { rounds }, { feed: false });
  }
  return { updated };
}

/** Pontuação de todas as equipas de uma liga numa jornada. */
export async function computeTeamRoundScores(leagueId: string, roundId: string) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  if (league.status === "SETUP" || league.status === "DRAFTING") return;
  const settings = parseSettings(league.settings);
  const round = await prisma.round.findUniqueOrThrow({ where: { id: roundId } });
  const lock = await roundLockState(roundId);
  const teams = await prisma.team.findMany({ where: { leagueId } });
  const pts = await prisma.leaguePlayerPoints.findMany({ where: { leagueId, roundId } });

  for (const team of teams) {
    const lineup = await getOrCreateLineup(team.id, roundId, leagueId);
    if (!lineup) continue;
    const ids = [...lineup.starters, ...lineup.bench];
    const players = await prisma.player.findMany({ where: { id: { in: ids } }, select: { id: true, position: true, clubId: true } });
    const positions = new Map(players.map((p) => [p.id, p.position as Pos]));
    const results = new Map<string, PlayerRoundResult>();
    for (const p of players) {
      const mine = pts.filter((x) => x.playerId === p.id);
      results.set(p.id, {
        points: mine.reduce((s, x) => s + x.points, 0),
        minutes: mine.reduce((s, x) => s + x.minutes, 0),
        done: !lock.clubsWithFixture.has(p.clubId) ? lock.allFinished : lock.finishedClubs.has(p.clubId),
      });
    }
    const detail = computeTeamScore(lineup, positions, results, settings.autoSubs);
    await prisma.teamRoundScore.upsert({
      where: { teamId_roundId: { teamId: team.id, roundId } },
      create: { leagueId, teamId: team.id, roundId, points: detail.points, details: detail as object, final: !!round.finalizedAt },
      update: { points: detail.points, details: detail as object, final: !!round.finalizedAt },
    });
  }
  await resolveMatchups(leagueId);
}

/** Recalcula tudo numa liga (ex: depois de o comissário mudar as regras). */
export async function recomputeLeague(leagueId: string, actorId?: string) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const fixtures = await prisma.fixture.findMany({ where: { seasonId: league.seasonId, stats: { some: {} } }, select: { id: true } });
  const res = await recomputeFixtures(fixtures.map((f) => f.id), { leagueId });
  await audit(leagueId, "RECOMPUTE", { fixtures: fixtures.length, updated: res.updated }, { userId: actorId });
  return res;
}

/**
 * Fecha jornadas cujos jogos terminaram todos. Período de graça para correções de estatísticas.
 * Depois de fechada, a jornada continua recalculável (as correções ficam em StatRevision + auditoria).
 */
export async function finalizeRounds(seasonId: string, graceMinutes = 120, force = false) {
  const rounds = await prisma.round.findMany({ where: { seasonId, finalizedAt: null }, orderBy: { order: "asc" } });
  const done: string[] = [];
  for (const r of rounds) {
    const fixtures = await prisma.fixture.findMany({ where: { roundId: r.id } });
    if (!fixtures.length) continue;
    const pending = fixtures.filter((f) => f.status !== "FINISHED" && f.status !== "CANCELLED" && f.status !== "POSTPONED");
    if (pending.length) break; // jornadas fecham por ordem
    // ~2h de jogo + período de graça para correções após o último pontapé de saída.
    const lastKick = Math.max(...fixtures.map((f) => f.kickoff.getTime()));
    if (!force && Date.now() < lastKick + (120 + graceMinutes) * 60e3) break;
    await prisma.round.update({ where: { id: r.id }, data: { finalizedAt: new Date() } });
    done.push(r.id);
    const leagues = await prisma.league.findMany({ where: { seasonId, status: { in: ["ACTIVE", "COMPLETED"] } } });
    for (const l of leagues) {
      await computeTeamRoundScores(l.id, r.id);
      const scores = await prisma.teamRoundScore.findMany({
        where: { leagueId: l.id, roundId: r.id },
        include: { team: true },
        orderBy: { points: "desc" },
      });
      const top = scores[0];
      await emit(l.id, "ROUND_FINALIZED", {
        roundId: r.id,
        roundName: r.name,
        topTeam: top?.team.name ?? null,
        topPoints: top?.points ?? null,
      }, {
        notify: { userIds: scores.map((s) => s.team.userId), title: `${r.name} fechada`, body: top ? `${top.team.name} venceu a jornada com ${top.points} pts.` : undefined, href: `/leagues/${l.id}/standings` },
      });
    }
  }
  return done;
}
