import Link from "next/link";
import { prisma } from "@/server/db";
import { requireMember } from "@/server/services/access";
import { currentRound } from "@/server/services/rounds";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClubCrest, Empty, PosBadge, TeamMark } from "@/components/ui/misc";
import { cn, fmtPts, fmtTime } from "@/lib/utils";

export const metadata = { title: "Ao vivo" };

interface Ev { minute: number; type: string; playerName: string | null; clubExternalId: string }

export default async function LivePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ round?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { league, team: me } = await requireMember(id);
  const rounds = await prisma.round.findMany({ where: { seasonId: league.seasonId }, orderBy: { order: "asc" } });
  const cur = await currentRound(league.seasonId);
  const round = rounds.find((r) => r.id === sp.round) ?? cur;
  if (!round) return <Card><Empty title="Sem jornadas" /></Card>;

  const [fixtures, scores, teams, matchups, pts] = await Promise.all([
    prisma.fixture.findMany({ where: { roundId: round.id }, include: { homeClub: true, awayClub: true }, orderBy: { kickoff: "asc" } }),
    prisma.teamRoundScore.findMany({ where: { leagueId: id, roundId: round.id } }),
    prisma.team.findMany({ where: { leagueId: id }, include: { user: { select: { avatarColor: true, displayName: true } } } }),
    prisma.matchup.findMany({ where: { leagueId: id, roundIds: { has: round.id } } }),
    prisma.leaguePlayerPoints.findMany({ where: { leagueId: id, roundId: round.id }, include: { player: { include: { club: true } } } }),
  ]);
  const lineups = await prisma.lineup.findMany({ where: { roundId: round.id, team: { leagueId: id } } });
  const players = await prisma.player.findMany({ where: { id: { in: lineups.flatMap((l) => l.starters) } }, include: { club: true } });
  const fxByClub = new Map<string, (typeof fixtures)[number]>();
  for (const f of fixtures) { fxByClub.set(f.homeClubId, f); fxByClub.set(f.awayClubId, f); }
  const ranked = teams.map((t) => ({ t, s: scores.find((s) => s.teamId === t.id) })).sort((a, b) => (b.s?.points ?? 0) - (a.s?.points ?? 0));
  const live = fixtures.some((f) => f.status === "LIVE");

  const teamCard = (t: (typeof teams)[number]) => {
    const s = scores.find((x) => x.teamId === t.id);
    const l = lineups.find((x) => x.teamId === t.id);
    const d = s?.details as { players: { playerId: string; points: number; multiplier: number; subbedIn: boolean }[] } | undefined;
    const used = new Map((d?.players ?? []).map((p) => [p.playerId, p]));
    const ids = l ? [...new Set([...l.starters, ...(d?.players ?? []).map((p) => p.playerId)])] : [];
    const remaining = ids.filter((pid) => { const pl = players.find((p) => p.id === pid); const f = pl && fxByClub.get(pl.clubId); return f && f.status === "SCHEDULED"; }).length;
    return (
      <Card key={t.id} className={cn("overflow-hidden", t.id === me.id && "ring-1 ring-accent/50")}>
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <TeamMark name={t.name} color={t.user.avatarColor} size={32} />
          <div className="min-w-0 flex-1"><div className="truncate font-semibold">{t.name}</div><div className="text-xs text-muted">{remaining} por jogar</div></div>
          <div className="num text-2xl font-semibold">{fmtPts(s?.points ?? 0)}</div>
        </div>
        <div className="divide-y divide-line">
          {ids.map((pid) => {
            const pl = players.find((p) => p.id === pid) ?? pts.find((p) => p.playerId === pid)?.player;
            if (!pl) return null;
            const u = used.get(pid);
            const f = fxByClub.get(pl.clubId);
            const mine = pts.filter((p) => p.playerId === pid);
            const st = !f ? "sem jogo" : f.status === "LIVE" ? `${f.minute ?? ""}'` : f.status === "FINISHED" ? "terminado" : fmtTime(f.kickoff);
            return (
              <div key={pid} className={cn("flex items-center gap-2 px-4 py-1.5 text-sm", !u && "opacity-45")}>
                <PosBadge pos={pl.position} className="h-4 min-w-7 text-[9px]" />
                <Link href={`/leagues/${id}/players/${pid}`} className="min-w-0 flex-1 truncate hover:text-glow">{pl.name}{l?.captainId === pid && <b className="ml-1 text-[10px]">(C)</b>}{l?.viceCaptainId === pid && <span className="ml-1 text-[10px] text-muted">(V)</span>}{u?.subbedIn && <span className="ml-1 text-[10px] text-win">↑ auto</span>}</Link>
                <span className={cn("text-[11px]", f?.status === "LIVE" ? "font-semibold text-loss" : "text-faint")}>{st}</span>
                <span className="num w-12 text-right font-semibold">{u ? fmtPts(u.points) : mine.length ? fmtPts(mine.reduce((a, x) => a + x.points, 0)) : "—"}</span>
              </div>
            );
          })}
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto">
          {rounds.filter((r) => r.order <= (cur?.order ?? 1) + 1).slice(-6).map((r) => <Link key={r.id} href={`?round=${r.id}`} className={cn("shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium", r.id === round.id ? "bg-accent text-white" : "bg-white/4 text-muted hover:text-fg")}>{r.name.replace("Fase de Liga · ", "")}</Link>)}
        </div>
        {live ? <Badge tone="live" className="ml-auto animate-pulse">● AO VIVO</Badge> : round.finalizedAt ? <Badge className="ml-auto">Jornada fechada</Badge> : <Badge tone="accent" className="ml-auto">Por começar / a decorrer</Badge>}
      </div>

      <Card className="p-4">
        <div className="eyebrow mb-3">{round.name} · jogos</div>
        {fixtures.length === 0 && <p className="text-sm text-muted">Ainda sem jogos definidos para esta jornada.</p>}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {fixtures.map((f) => {
            const ev = ((f.events ?? []) as unknown as Ev[]).filter((e) => ["GOAL", "PENALTY_GOAL", "OWN_GOAL", "RED"].includes(e.type));
            return (
              <div key={f.id} className={cn("rounded-xl border bg-ink/30 px-3 py-2.5", f.status === "LIVE" ? "border-loss/40" : "border-line")}>
                <div className="flex items-center gap-2 text-sm">
                  <ClubCrest name={f.homeClub.name} logoUrl={f.homeClub.logoUrl} code={f.homeClub.code} size={18} /><span className="min-w-0 flex-1 truncate">{f.homeClub.shortName}</span>
                  <span className="num font-semibold">{f.homeGoals ?? "-"}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-sm">
                  <ClubCrest name={f.awayClub.name} logoUrl={f.awayClub.logoUrl} code={f.awayClub.code} size={18} /><span className="min-w-0 flex-1 truncate">{f.awayClub.shortName}</span>
                  <span className="num font-semibold">{f.awayGoals ?? "-"}</span>
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[11px]">
                  <span className={f.status === "LIVE" ? "font-semibold text-loss" : "text-faint"}>{f.status === "LIVE" ? `${f.minute ?? ""}' ao vivo` : f.status === "FINISHED" ? "Terminado" : f.status === "SCHEDULED" ? fmtTime(f.kickoff) : f.statusDetail}</span>
                  {ev.length > 0 && <span className="truncate pl-2 text-faint">{ev.slice(-3).map((e) => `${e.type === "RED" ? "🟥" : "⚽"} ${e.playerName?.split(" ").slice(-1)[0]} ${e.minute}'`).join(" · ")}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {matchups.length > 0 ? (
        <div className="space-y-4">
          {matchups.filter((m) => m.homeTeamId && m.awayTeamId).map((m) => {
            const h = teams.find((t) => t.id === m.homeTeamId)!, a = teams.find((t) => t.id === m.awayTeamId)!;
            const hs = scores.find((s) => s.teamId === h.id)?.points ?? 0, as = scores.find((s) => s.teamId === a.id)?.points ?? 0;
            return (
              <div key={m.id}>
                <div className="mb-2 flex items-center gap-3 px-1 text-sm"><span className="eyebrow">{m.isPlayoff ? m.label : "Confronto direto"}</span><span className="num ml-auto font-semibold">{fmtPts(hs)} – {fmtPts(as)}</span></div>
                <div className="grid gap-4 md:grid-cols-2">{teamCard(h)}{teamCard(a)}</div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{ranked.map(({ t }) => teamCard(t))}</div>
      )}
    </div>
  );
}
