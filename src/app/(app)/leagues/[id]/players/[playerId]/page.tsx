import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requireMember } from "@/server/services/access";
import { estimate, playerForm } from "@/server/services/form";
import { waiverUntil } from "@/server/services/roster";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ClubCrest, PlayerAvatar, PosBadge, Stat, StatusDot } from "@/components/ui/misc";
import { POS_NAME, type Pos } from "@/lib/fantasy/config";
import type { MatchStats } from "@/lib/fantasy/scoring";
import { cn, fmtDate, fmtDateTime, fmtPts } from "@/lib/utils";

const STAT_ROWS: [keyof MatchStats, string][] = [
  ["minutes", "Minutos"], ["goals", "Golos"], ["assists", "Assistências"], ["shotsOnTarget", "Remates enquadrados"], ["keyPasses", "Passes decisivos"],
  ["bigChancesCreated", "Grandes oportunidades"], ["dribblesSuccess", "Dribles"], ["tackles", "Desarmes"], ["interceptions", "Interceções"],
  ["clearances", "Cortes"], ["blockedShots", "Remates bloqueados"], ["recoveries", "Recuperações"], ["duelsWon", "Duelos ganhos"],
  ["saves", "Defesas"], ["penaltiesSaved", "Penáltis defendidos"], ["yellowCards", "Amarelos"], ["redCards", "Vermelhos"],
];

export default async function PlayerPage({ params }: { params: Promise<{ id: string; playerId: string }> }) {
  const { id, playerId } = await params;
  const { league, team } = await requireMember(id);
  const player = await prisma.player.findUnique({ where: { id: playerId }, include: { club: true } });
  if (!player || player.seasonId !== league.seasonId) notFound();
  const [entry, stats, pts, form, upcoming, wv] = await Promise.all([
    prisma.rosterEntry.findUnique({ where: { leagueId_playerId: { leagueId: id, playerId } }, include: { team: true } }),
    prisma.playerMatchStat.findMany({ where: { playerId }, include: { fixture: { include: { homeClub: true, awayClub: true, round: true } } }, orderBy: { fixture: { kickoff: "desc" } } }),
    prisma.leaguePlayerPoints.findMany({ where: { leagueId: id, playerId } }),
    playerForm(id, [playerId]),
    prisma.fixture.findMany({ where: { seasonId: league.seasonId, status: "SCHEDULED", OR: [{ homeClubId: player.clubId }, { awayClubId: player.clubId }] }, include: { homeClub: true, awayClub: true, round: true }, orderBy: { kickoff: "asc" }, take: 4 }),
    waiverUntil(id, playerId),
  ]);
  const f = form.get(playerId);
  const est = estimate(f);
  const sum = (k: keyof MatchStats) => {
    const vals = stats.map((s) => (s.stats as unknown as MatchStats)[k]);
    if (vals.length && vals.every((v) => v === null)) return null;
    return vals.reduce<number>((a, v) => a + (typeof v === "number" ? v : 0), 0);
  };
  const sources = [...new Set(stats.map((s) => s.source))];

  return (
    <div className="space-y-4">
      <Card className="relative overflow-hidden p-5">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-accent/15 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-5">
          <PlayerAvatar name={player.name} photoUrl={player.photoUrl} pos={player.position} size={84} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><PosBadge pos={player.position} /><StatusDot status={player.status} note={player.statusNote} />{!player.active && <Badge tone="warn">Fora do plantel</Badge>}</div>
            <h2 className="mt-1.5 text-2xl font-semibold tracking-tight">{player.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              <span className="flex items-center gap-1.5"><ClubCrest name={player.club.name} logoUrl={player.club.logoUrl} code={player.club.code} size={16} />{player.club.name}</span>
              <span>{POS_NAME[player.position as Pos]}</span>
              {player.nationality && <span>{player.nationality}</span>}
              {player.age && <span>{player.age} anos</span>}
              {player.shirtNumber && <span>#{player.shirtNumber}</span>}
            </div>
            {player.statusNote && <p className="mt-2 text-sm text-warn">{player.statusNote}</p>}
          </div>
          <div className="text-right">
            {entry ? <><div className="eyebrow">Plantel</div><Link href={`/leagues/${id}/team?team=${entry.teamId}`} className="font-semibold hover:text-glow">{entry.team.name}{entry.teamId === team.id && " (tu)"}</Link>{entry.onTradeBlock && <div><Badge tone="warn">Na lista de negociação</Badge></div>}</>
              : <><Badge tone={wv ? "warn" : "win"}>{wv ? `Waivers até ${fmtDateTime(wv)}` : "Free agent"}</Badge>{league.status === "ACTIVE" && <div className="mt-2"><Link href={`/leagues/${id}/market`} className={buttonVariants({ size: "sm" })}>{wv ? "Fazer pedido" : "Contratar"}</Link></div>}</>}
          </div>
        </div>
        <div className="relative mt-6 grid grid-cols-2 gap-5 border-t border-line pt-5 sm:grid-cols-5">
          <Stat label="Pontos (liga)" value={fmtPts(f.total)} />
          <Stat label="Jogos" value={f.games} />
          <Stat label="Média" value={f.games ? fmtPts(f.seasonAvg) : "—"} />
          <Stat label="Forma (últ. 5)" value={f.games ? fmtPts(f.last5Avg) : "—"} />
          <Stat label="Estimativa" value={est === null ? "—" : fmtPts(est)} sub="baseada em pontos reais" />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader eyebrow="Histórico" title="Pontuação jogo a jogo" />
          <CardBody className="space-y-2">
            {stats.length === 0 && <p className="text-sm text-muted">Ainda sem jogos disputados nesta competição.</p>}
            {stats.map((s) => {
              const p = pts.find((x) => x.fixtureId === s.fixtureId);
              const bd = (p?.breakdown ?? { lines: [], unavailable: [] }) as { lines: { key: string; label: string; count: number; points: number }[]; unavailable: string[] };
              const fx = s.fixture;
              const home = fx.homeClubId === player.clubId;
              const opp = home ? fx.awayClub : fx.homeClub;
              return (
                <details key={s.id} className="group rounded-xl border border-line bg-ink/30">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 text-sm">
                    <span className="w-16 shrink-0 text-xs text-muted">{fmtDate(fx.kickoff)}</span>
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">{home ? "vs" : "@"} <ClubCrest name={opp.name} logoUrl={opp.logoUrl} code={opp.code} size={16} /> {opp.shortName} <span className="num text-muted">{fx.homeGoals}–{fx.awayGoals}</span></span>
                    <span className="hidden text-xs text-muted sm:inline">{s.minutes}&apos;</span>
                    {s.rating !== null && <span className="num hidden text-xs text-muted sm:inline">★ {s.rating.toFixed(1)}</span>}
                    <span className={cn("num w-12 text-right font-semibold", (p?.points ?? 0) >= 10 && "text-win")}>{fmtPts(p?.points ?? 0)}</span>
                  </summary>
                  <div className="border-t border-line px-3 py-2.5">
                    <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                      {bd.lines.map((l, i) => <div key={i} className="flex justify-between text-xs"><span className="text-silver">{l.label}{l.count > 1 && ` ×${l.count}`}</span><span className={cn("num", l.points < 0 ? "text-loss" : "text-fg")}>{l.points > 0 ? "+" : ""}{fmtPts(l.points)}</span></div>)}
                    </div>
                    {bd.unavailable.length > 0 && <p className="mt-2 text-[11px] text-faint">Não fornecido pela fonte de dados (não pontuado): {bd.unavailable.length} métricas.</p>}
                    <p className="mt-1 text-[11px] text-faint">Fonte: {s.source === "demo-simulated" ? "SIMULADO (demo)" : s.source} · {fx.round.name}</p>
                  </div>
                </details>
              );
            })}
          </CardBody>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader eyebrow="Competição" title="Estatísticas acumuladas" />
            <CardBody className="space-y-1.5">
              {STAT_ROWS.map(([k, label]) => { const v = sum(k); return <div key={k} className="flex justify-between text-sm"><span className="text-muted">{label}</span><span className="num">{v === null ? <span className="text-faint" title="Não disponível no provider">n/d</span> : v}</span></div>; })}
              {sources.length > 0 && <p className="pt-2 text-[11px] text-faint">Fonte: {sources.map((s) => (s === "demo-simulated" ? "SIMULADO (demo)" : s)).join(", ")}</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader eyebrow="Calendário" title="Próximos jogos" />
            <CardBody className="space-y-2">
              {upcoming.length === 0 && <p className="text-sm text-muted">Sem jogos agendados.</p>}
              {upcoming.map((fx) => { const home = fx.homeClubId === player.clubId; const opp = home ? fx.awayClub : fx.homeClub; return <div key={fx.id} className="flex items-center gap-2 text-sm"><span>{home ? "vs" : "@"}</span><ClubCrest name={opp.name} logoUrl={opp.logoUrl} code={opp.code} size={16} /><span className="flex-1 truncate">{opp.shortName}</span><span className="text-xs text-muted">{fmtDateTime(fx.kickoff)}</span></div>; })}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
