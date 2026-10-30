import Link from "next/link";
import { prisma } from "@/server/db";
import { requireMember } from "@/server/services/access";
import { currentRound, isClubLocked, roundLockState } from "@/server/services/rounds";
import { getOrCreateLineup } from "@/server/services/lineups";
import { estimate, playerForm } from "@/server/services/form";
import { LineupEditor, type RosterRow } from "@/components/league/lineup-editor";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

export const metadata = { title: "Plantel" };

export default async function TeamPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ round?: string; team?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { league, team: myTeam, settings } = await requireMember(id);
  const viewTeam = sp.team ? await prisma.team.findFirst({ where: { id: sp.team, leagueId: id } }) : null;
  const team = viewTeam ?? myTeam;
  const readOnlyTeam = team.id !== myTeam.id;
  const teams = await prisma.team.findMany({ where: { leagueId: id }, orderBy: { name: "asc" } });

  if (league.status === "SETUP" || league.status === "DRAFTING")
    return <Card><Empty title="O plantel é formado no draft" body="Depois do draft vais poder escolher o onze, capitão e formação para cada jornada." action={<Link className="text-glow" href={`/leagues/${id}/draft`}>Ir para o draft →</Link>} /></Card>;

  const rounds = await prisma.round.findMany({ where: { seasonId: league.seasonId }, orderBy: { order: "asc" } });
  const cur = await currentRound(league.seasonId);
  const round = rounds.find((r) => r.id === sp.round) ?? cur ?? rounds[0];
  if (!round) return <Card><Empty title="Sem jornadas" body="A época ainda não tem jornadas sincronizadas." /></Card>;

  const [roster, lineup, lock, fixtures] = await Promise.all([
    prisma.rosterEntry.findMany({ where: { teamId: team.id }, include: { player: { include: { club: true } } } }),
    getOrCreateLineup(team.id, round.id, id),
    roundLockState(round.id),
    prisma.fixture.findMany({ where: { roundId: round.id }, include: { homeClub: true, awayClub: true } }),
  ]);
  const ids = roster.map((r) => r.playerId);
  const [form, pts] = await Promise.all([
    playerForm(id, ids),
    prisma.leaguePlayerPoints.findMany({ where: { leagueId: id, roundId: round.id, playerId: { in: ids } } }),
  ]);
  // Jogadores que estavam no onze mas já saíram do plantel (jornada a decorrer) também aparecem.
  const rows: RosterRow[] = roster.map((r) => {
    const f = fixtures.find((x) => x.homeClubId === r.player.clubId || x.awayClubId === r.player.clubId);
    const home = f?.homeClubId === r.player.clubId;
    const fm = form.get(r.playerId);
    return {
      id: r.playerId, name: r.player.name, pos: r.player.position, photo: r.player.photoUrl, club: r.player.club.shortName,
      status: r.player.status, statusNote: r.player.statusNote, onTradeBlock: r.onTradeBlock,
      opponent: f ? `${home ? "" : "@"}${(home ? f.awayClub : f.homeClub).code ?? (home ? f.awayClub : f.homeClub).shortName.slice(0, 3).toUpperCase()}` : null,
      fixtureStatus: f?.status ?? null,
      locked: !!round.finalizedAt || isClubLocked(lock, r.player.clubId, settings.lineupLock),
      roundPoints: pts.filter((p) => p.playerId === r.playerId).reduce((s, p) => s + p.points, 0),
      played: pts.some((p) => p.playerId === r.playerId && p.minutes > 0),
      total: fm.total, games: fm.games, last5: fm.last5, proj: estimate(fm),
    };
  });
  const score = await prisma.teamRoundScore.findUnique({ where: { teamId_roundId: { teamId: team.id, roundId: round.id } } });
  const editable = !readOnlyTeam && !round.finalizedAt && !(settings.lineupLock === "ROUND" && lock.started);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto">
          {rounds.filter((r) => r.order >= (cur?.order ?? 1) - 3 && r.order <= (cur?.order ?? 1) + 2).map((r) => (
            <Link key={r.id} href={`?round=${r.id}${readOnlyTeam ? `&team=${team.id}` : ""}`} className={cn("shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium", r.id === round.id ? "bg-accent text-white" : "bg-white/4 text-muted hover:text-fg")}>{r.name.replace("Fase de Liga · ", "")}</Link>
          ))}
        </div>
        <form className="ml-auto">
          <input type="hidden" name="round" value={round.id} />
          <select name="team" defaultValue={team.id} className="h-9 rounded-lg border border-line-strong bg-ink/60 px-2 text-sm" aria-label="Ver plantel de">
            {teams.map((t) => <option key={t.id} value={t.id}>{t.id === myTeam.id ? `${t.name} (tu)` : t.name}</option>)}
          </select>
          <button className="ml-1 h-9 rounded-lg bg-white/6 px-3 text-sm">Ver</button>
        </form>
      </div>
      {lineup ? (
        <LineupEditor
          key={`${team.id}:${round.id}:${lineup.updatedAt.toISOString()}`}
          leagueId={id} roundId={round.id} roundName={round.name} teamName={team.name}
          editable={editable} readOnlyTeam={readOnlyTeam} lockMode={settings.lineupLock} roundStarted={lock.started}
          firstKickoff={lock.firstKickoff?.toISOString() ?? null} finalized={!!round.finalizedAt}
          rows={rows} lineup={{ formation: lineup.formation, starters: lineup.starters, bench: lineup.bench, captainId: lineup.captainId, viceCaptainId: lineup.viceCaptainId }}
          score={score ? { points: score.points, details: score.details as { captainApplied: string | null; autoSubs: { out: string; in: string }[] } } : null}
        />
      ) : <Card><Empty title="Plantel vazio" /></Card>}
    </div>
  );
}
