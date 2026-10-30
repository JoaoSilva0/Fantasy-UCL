import "server-only";
import { prisma } from "./db";
import { standings } from "./services/matchups";
import { currentRound, lastFinalizedRound } from "./services/rounds";
import { parseSettings } from "./services/access";

/** Classificação + dados das equipas + pontos da última jornada fechada e da atual. */
export async function leagueTable(leagueId: string) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const [rows, teams, last, cur] = await Promise.all([
    standings(leagueId),
    prisma.team.findMany({ where: { leagueId }, include: { user: { select: { displayName: true, avatarColor: true } } } }),
    lastFinalizedRound(league.seasonId),
    currentRound(league.seasonId),
  ]);
  const scores = await prisma.teamRoundScore.findMany({ where: { leagueId, roundId: { in: [last?.id, cur?.id].filter(Boolean) as string[] } } });
  return {
    settings: parseSettings(league.settings),
    lastRound: last,
    currentRound: cur,
    rows: rows.map((r, i) => {
      const t = teams.find((x) => x.id === r.teamId)!;
      return {
        ...r, rank: i + 1, team: t,
        lastPoints: scores.find((s) => s.teamId === r.teamId && s.roundId === last?.id)?.points ?? null,
        currentPoints: scores.find((s) => s.teamId === r.teamId && s.roundId === cur?.id)?.points ?? null,
      };
    }),
  };
}

export async function nextMatchup(leagueId: string, teamId: string) {
  const ms = await prisma.matchup.findMany({ where: { leagueId, final: false, OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }] } });
  if (!ms.length) return null;
  const rounds = await prisma.round.findMany({ where: { id: { in: ms.flatMap((m) => m.roundIds) } } });
  const order = (m: (typeof ms)[number]) => Math.min(...m.roundIds.map((id) => rounds.find((r) => r.id === id)?.order ?? 999));
  const m = ms.sort((a, b) => order(a) - order(b))[0];
  const oppId = m.homeTeamId === teamId ? m.awayTeamId : m.homeTeamId;
  const opp = oppId ? await prisma.team.findUnique({ where: { id: oppId }, include: { user: { select: { displayName: true, avatarColor: true } } } }) : null;
  return { matchup: m, opponent: opp, mine: m.homeTeamId === teamId ? m.homePoints : m.awayPoints, theirs: m.homeTeamId === teamId ? m.awayPoints : m.homePoints };
}

export async function upcomingFixtures(seasonId: string, take = 6) {
  return prisma.fixture.findMany({
    where: { seasonId, status: { in: ["SCHEDULED", "LIVE"] } },
    orderBy: { kickoff: "asc" },
    take,
    include: { homeClub: true, awayClub: true, round: true },
  });
}
