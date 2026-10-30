import Link from "next/link";
import { Award, Crown, Flame, Medal, Sparkles, TrendingUp } from "lucide-react";
import { prisma } from "@/server/db";
import { requireMember } from "@/server/services/access";
import { leagueTable } from "@/server/queries";
import { leagueAwards } from "@/server/services/awards";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Empty, TeamMark } from "@/components/ui/misc";
import { cn, fmtPts } from "@/lib/utils";

export const metadata = { title: "Classificações" };

const VIEWS = [
  ["geral", "Geral"], ["jornada", "Por jornada"], ["forma", "Últimas 5"], ["ataque", "Ofensiva / Defensiva"],
  ["power", "Power rankings"], ["mercado", "Draft & mercado"], ["premios", "Prémios"], ["playoffs", "Playoffs"],
] as const;

export default async function Standings({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string; round?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const view = sp.view ?? "geral";
  const { team: me, settings, league } = await requireMember(id);
  if (league.status === "SETUP" || league.status === "DRAFTING") return <Card><Empty title="As classificações começam depois do draft" /></Card>;
  const [table, awards, teams] = await Promise.all([leagueTable(id), leagueAwards(id), prisma.team.findMany({ where: { leagueId: id }, include: { user: true } })]);
  const color = new Map(teams.map((t) => [t.id, t.user.avatarColor]));
  const nm = awards.name;
  const h2h = settings.format !== "POINTS";
  const row = (teamId: string, right: React.ReactNode, rank: number, sub?: React.ReactNode) => (
    <div key={teamId} className={cn("flex items-center gap-3 px-4 py-2.5", teamId === me.id && "bg-accent-soft")}>
      <span className={cn("num w-6 text-center text-sm font-semibold", rank === 1 ? "text-warn" : "text-muted")}>{rank}</span>
      <TeamMark name={nm.get(teamId) ?? "?"} color={color.get(teamId)} size={30} />
      <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{nm.get(teamId)}</div>{sub && <div className="truncate text-xs text-muted">{sub}</div>}</div>
      {right}
    </div>
  );

  let body: React.ReactNode = null;
  if (view === "geral") {
    body = (
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wider text-muted">
              <tr><th className="px-4 py-3">#</th><th className="py-3">Equipa</th>{h2h && <><th className="px-2 text-center">V</th><th className="px-2 text-center">E</th><th className="px-2 text-center">D</th>{settings.format === "HYBRID" && <th className="px-2 text-center" title="Bónus por ficar na metade superior da jornada">Bónus</th>}<th className="px-2 text-center">Pts</th></>}<th className="px-2 text-right">Pontos fantasy</th><th className="px-4 text-right">Últ. jornada</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {table.rows.map((r) => (
                <tr key={r.teamId} className={cn(r.teamId === me.id && "bg-accent-soft", h2h && settings.playoffs.enabled && r.rank === 4 && "border-b-2 border-b-accent/50")}>
                  <td className="num px-4 py-3 font-semibold text-muted">{r.rank}</td>
                  <td className="py-3"><Link href={`/leagues/${id}/team?team=${r.teamId}`} className="flex items-center gap-2.5 hover:text-glow"><TeamMark name={r.team.name} color={r.team.user.avatarColor} size={28} /><span><span className="block font-semibold">{r.team.name}</span><span className="block text-xs text-muted">{r.team.user.displayName}</span></span></Link></td>
                  {h2h && <><td className="num px-2 text-center">{r.w}</td><td className="num px-2 text-center">{r.d}</td><td className="num px-2 text-center">{r.l}</td>{settings.format === "HYBRID" && <td className="num px-2 text-center">{r.bonus}</td>}<td className="num px-2 text-center font-bold">{r.tablePoints}</td></>}
                  <td className="num px-2 text-right font-semibold">{fmtPts(r.points)}</td>
                  <td className="num px-4 text-right text-muted">{fmtPts(r.lastPoints)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {h2h && settings.playoffs.enabled && <div className="border-t border-line px-4 py-2.5 text-xs text-muted">Os 4 primeiros apuram-se para os playoffs fantasy.</div>}
      </Card>
    );
  } else if (view === "jornada") {
    const rounds = await prisma.round.findMany({ where: { seasonId: league.seasonId, teamScores: { some: { leagueId: id } } }, orderBy: { order: "asc" } });
    const r = rounds.find((x) => x.id === sp.round) ?? rounds[rounds.length - 1];
    const scores = r ? await prisma.teamRoundScore.findMany({ where: { leagueId: id, roundId: r.id }, orderBy: { points: "desc" } }) : [];
    body = (
      <div className="space-y-3">
        <div className="flex gap-1 overflow-x-auto">{rounds.map((x) => <Link key={x.id} href={`?view=jornada&round=${x.id}`} className={cn("shrink-0 rounded-lg px-3 py-1.5 text-xs", x.id === r?.id ? "bg-accent text-white" : "bg-white/4 text-muted")}>{x.name.replace("Fase de Liga · ", "")}</Link>)}</div>
        <Card className="divide-y divide-line overflow-hidden">{scores.length ? scores.map((s, i) => row(s.teamId, <span className="num font-semibold">{fmtPts(s.points)}</span>, i + 1)) : <Empty title="Sem pontuações" />}</Card>
      </div>
    );
  } else if (view === "forma") {
    body = <Card className="divide-y divide-line overflow-hidden">{awards.last5Rows.map((r, i) => row(r.teamId, <span className="num font-semibold">{fmtPts(r.points)}</span>, i + 1))}</Card>;
  } else if (view === "ataque") {
    const off = [...awards.split].sort((a, b) => b.off - a.off), def = [...awards.split].sort((a, b) => b.def - a.def);
    body = (
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="overflow-hidden"><CardHeader eyebrow="Golos, assistências, criação" title="Classificação ofensiva" /><div className="divide-y divide-line">{off.map((r, i) => row(r.teamId, <span className="num font-semibold">{fmtPts(r.off)}</span>, i + 1))}</div></Card>
        <Card className="overflow-hidden"><CardHeader eyebrow="Clean sheets, desarmes, defesas" title="Classificação defensiva" /><div className="divide-y divide-line">{def.map((r, i) => row(r.teamId, <span className="num font-semibold">{fmtPts(r.def)}</span>, i + 1))}</div></Card>
      </div>
    );
  } else if (view === "power") {
    body = (
      <Card className="overflow-hidden">
        <CardHeader eyebrow="60% forma (últimas 3) · 40% média da época" title="Power rankings" action={<TrendingUp size={18} className="text-faint" />} />
        <div className="divide-y divide-line">
          {awards.power.map((p, i) => row(p.teamId, <div className="flex w-40 items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-accent" style={{ width: `${p.score}%` }} /></div><span className="num w-8 text-right text-sm font-semibold">{p.score}</span></div>, i + 1))}
        </div>
      </Card>
    );
  } else if (view === "mercado") {
    body = (
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="overflow-hidden"><CardHeader eyebrow="Pontos dos jogadores escolhidos no draft" title="Melhor draft" /><div className="divide-y divide-line">{awards.bestDraft.map((r, i) => row(r.teamId, <span className="num font-semibold">{fmtPts(r.points)}</span>, i + 1))}</div></Card>
        <Card className="overflow-hidden"><CardHeader eyebrow="Pontos desde a contratação" title="Melhores contratações" />
          <div className="divide-y divide-line">{awards.pickups.length ? awards.pickups.slice(0, 8).map((p, i) => row(p.teamId, <span className="num font-semibold">{fmtPts(p.points)}</span>, i + 1, `${p.name ?? "Jogador"} · ${p.via === "WAIVER" ? "waiver" : "free agent"}`)) : <Empty title="Sem contratações ainda" />}</div>
        </Card>
        <Card className="overflow-hidden"><CardHeader eyebrow="Pontos recebidos após a troca" title="Melhores trocas" />
          <div className="divide-y divide-line">{awards.tradeValue.length ? awards.tradeValue.slice(0, 8).map((t, i) => row(t.winner, <span className="num font-semibold text-win">+{fmtPts(t.margin)}</span>, i + 1, `vs ${nm.get(t.loser)} · ${fmtPts(t.a)} – ${fmtPts(t.b)}`)) : <Empty title="Sem trocas concluídas" />}</div>
        </Card>
      </div>
    );
  } else if (view === "premios") {
    const rec = awards.records;
    const coach = [...rec.bestCoach.entries()].sort((a, b) => b[1] - a[1])[0];
    const tiles = [
      { icon: Crown, label: "Maior pontuação de sempre (jornada)", value: rec.bestRoundScore ? `${fmtPts(rec.bestRoundScore.points)} pts` : "—", sub: rec.bestRoundScore ? `${nm.get(rec.bestRoundScore.teamId)} · ${rec.bestRoundScore.round}` : "" },
      { icon: Flame, label: "Maior pontuação individual", value: rec.bestPlayerGame ? `${fmtPts(rec.bestPlayerGame.points)} pts` : "—", sub: rec.bestPlayerGame?.name ?? "" },
      { icon: Medal, label: "Melhor treinador fantasy", value: coach && coach[1] > 0 ? `${coach[1]} jornada(s) ganha(s)` : "—", sub: coach && coach[1] > 0 ? nm.get(coach[0]) : "" },
      { icon: Sparkles, label: "Maior surpresa (não draftado)", value: rec.surprise ? `${fmtPts(rec.surprise.points)} pts` : "—", sub: rec.surprise?.name ?? "" },
      { icon: Award, label: "Melhor negócio", value: awards.tradeValue[0] ? `+${fmtPts(awards.tradeValue[0].margin)} pts` : awards.pickups[0] ? `${fmtPts(awards.pickups[0].points)} pts` : "—", sub: awards.tradeValue[0] ? `${nm.get(awards.tradeValue[0].winner)} (troca)` : awards.pickups[0] ? `${nm.get(awards.pickups[0].teamId)} · ${awards.pickups[0].name}` : "" },
    ];
    body = (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {tiles.map((t) => <Card key={t.label} className="p-4"><t.icon size={18} className="text-glow" /><div className="eyebrow mt-3 leading-snug">{t.label}</div><div className="num mt-1 text-xl font-semibold">{t.value}</div><div className="truncate text-xs text-muted">{t.sub}</div></Card>)}
        </div>
        <Card className="overflow-hidden">
          <CardHeader eyebrow="Weekly awards" title="Prémios por jornada" />
          <div className="divide-y divide-line">
            {awards.roundAwards.length === 0 && <Empty title="Nenhuma jornada fechada ainda" />}
            {awards.roundAwards.map((r) => (
              <div key={r.roundId} className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[180px_1fr_1fr_1fr]">
                <div className="font-semibold">{r.roundName}</div>
                <div><span className="text-xs text-muted">Treinador da jornada</span><div>{r.winner ? <>{nm.get(r.winner.teamId)} <span className="num text-muted">{fmtPts(r.winner.points)}</span></> : "—"}</div></div>
                <div><span className="text-xs text-muted">MVP da jornada</span><div>{r.mvp ? <Link className="hover:text-glow" href={`/leagues/${id}/players/${r.mvp.playerId}`}>{r.mvp.name} <span className="num text-muted">{fmtPts(r.mvp.points)}</span>{r.mvp.ownerTeamId && <span className="text-xs text-faint"> · {nm.get(r.mvp.ownerTeamId)}</span>}</Link> : "—"}</div></div>
                <div><span className="text-xs text-muted">Lanterna vermelha 🔦</span><div>{r.last ? <>{nm.get(r.last.teamId)} <span className="num text-muted">{fmtPts(r.last.points)}</span></> : "—"}</div></div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    );
  } else if (view === "playoffs") {
    const po = await prisma.matchup.findMany({ where: { leagueId: id, isPlayoff: true } });
    const box = (slot: string) => {
      const m = po.find((x) => x.bracketSlot === slot);
      if (!m) return <Card className="p-4 text-sm text-muted">{slot === "F" ? "Final" : "Meia-final"} — aguarda as jornadas correspondentes da UCL.</Card>;
      const side = (tid: string | null, pts: number | null) => (
        <div className={cn("flex items-center gap-2 px-4 py-2.5", m.winnerTeamId && m.winnerTeamId === tid && "bg-win/10")}>
          {tid ? <TeamMark name={nm.get(tid) ?? "?"} color={color.get(tid)} size={24} /> : <span className="h-6 w-6 rounded-lg bg-surface-3" />}
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{tid ? nm.get(tid) : "A definir"}</span>
          <span className="num font-semibold">{fmtPts(pts)}</span>
        </div>
      );
      return <Card className="overflow-hidden"><div className="eyebrow border-b border-line px-4 py-2">{m.label}{m.final && <Badge className="ml-2">Final</Badge>}</div>{side(m.homeTeamId, m.homePoints)}<div className="border-t border-line" />{side(m.awayTeamId, m.awayPoints)}</Card>;
    };
    body = !h2h || !settings.playoffs.enabled ? <Card><Empty title="Esta liga não tem playoffs" body="Disponível nos formatos H2H e Híbrido." /></Card> : (
      <div className="grid items-center gap-4 md:grid-cols-2">
        <div className="space-y-4">{box("SF1")}{box("SF2")}</div>
        <div>{box("F")}</div>
        <p className="text-xs text-muted md:col-span-2">Meias-finais somam as jornadas dos Quartos de final da UCL; a final soma as das Meias-finais. Em empate avança o melhor classificado.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {VIEWS.filter(([k]) => k !== "playoffs" || h2h).map(([k, label]) => <Link key={k} href={`?view=${k}`} className={cn("shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium", view === k ? "bg-white/8 text-fg" : "text-muted hover:text-fg")}>{label}</Link>)}
      </div>
      {body}
    </div>
  );
}
