import Link from "next/link";
import { ArrowRight, CalendarDays, HeartPulse, Plus, Repeat, Trophy } from "lucide-react";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { leagueTable, nextMatchup, upcomingFixtures } from "@/server/queries";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ClubCrest, Empty, PlayerAvatar, PosBadge, StatusDot, TeamMark } from "@/components/ui/misc";
import { fmtDateTime, fmtPts } from "@/lib/utils";

export const metadata = { title: "Painel" };

export default async function Dashboard() {
  const user = await requireUser();
  const teams = await prisma.team.findMany({ where: { userId: user.id }, include: { league: { include: { season: true } } }, orderBy: { createdAt: "desc" } });

  if (!teams.length)
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <Card>
          <Empty icon={<Trophy size={36} />} title={`Olá, ${user.displayName}!`} body="Ainda não estás em nenhuma liga. Cria uma e convida os teus amigos, ou entra com um código de convite."
            action={<div className="flex flex-wrap justify-center gap-2"><Link href="/leagues/new" className={buttonVariants({})}><Plus size={16} /> Criar liga</Link><Link href="/leagues" className={buttonVariants({ variant: "secondary" })}>Tenho um código</Link></div>} />
        </Card>
      </main>
    );

  const summaries = await Promise.all(teams.map(async (t) => {
    const table = await leagueTable(t.leagueId);
    const me = table.rows.find((r) => r.teamId === t.id)!;
    const [next, pending] = await Promise.all([
      nextMatchup(t.leagueId, t.id),
      prisma.trade.count({ where: { leagueId: t.leagueId, OR: [{ receiverTeamId: t.id, status: "PENDING" }, { status: "IN_REVIEW", reviewUntil: { not: null }, proposerTeamId: { not: t.id }, receiverTeamId: { not: t.id } }] } }),
    ]);
    return { t, table, me, next, pending };
  }));

  const myPlayers = await prisma.rosterEntry.findMany({ where: { team: { userId: user.id } }, include: { player: { include: { club: true } }, team: true } });
  const injured = myPlayers.filter((r) => r.player.status !== "AVAILABLE");
  const top = await prisma.leaguePlayerPoints.groupBy({ by: ["playerId"], where: { playerId: { in: myPlayers.map((r) => r.playerId) }, leagueId: { in: teams.map((t) => t.leagueId) } }, _sum: { points: true }, orderBy: { _sum: { points: "desc" } }, take: 5 });
  const seasons = [...new Map(teams.map((t) => [t.league.seasonId, t.league.season])).values()];
  const fixtures = (await Promise.all(seasons.map(async (s) => ({ s, f: await upcomingFixtures(s.id, 6) }))));

  return (
    <main className="mx-auto max-w-7xl px-4 pb-24 pt-8 sm:px-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-1">Painel</div>
          <h1 className="text-3xl font-semibold tracking-tight">Olá, {user.displayName}</h1>
        </div>
        <Link href="/leagues/new" className={buttonVariants({ variant: "secondary" })}><Plus size={16} /> Nova liga</Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {summaries.map(({ t, table, me, next, pending }) => (
          <Link key={t.id} href={`/leagues/${t.leagueId}`} className="card group block p-5 transition hover:border-accent/40">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <TeamMark name={t.name} color={user.avatarColor} size={44} />
                <div className="min-w-0">
                  <div className="truncate font-semibold">{t.league.name}</div>
                  <div className="truncate text-sm text-muted">{t.name}{t.league.season.isDemo && <Badge tone="warn" className="ml-2">DEMO</Badge>}</div>
                </div>
              </div>
              <ArrowRight className="text-faint transition group-hover:translate-x-0.5 group-hover:text-glow" size={18} />
            </div>
            <div className="mt-5 grid grid-cols-3 gap-4">
              <div><div className="eyebrow">Posição</div><div className="num mt-1 text-2xl font-semibold">{me.rank}<span className="text-sm text-muted">/{table.rows.length}</span></div></div>
              <div><div className="eyebrow">Pontos</div><div className="num mt-1 text-2xl font-semibold">{fmtPts(me.points)}</div></div>
              <div><div className="eyebrow">Última jornada</div><div className="num mt-1 text-2xl font-semibold">{fmtPts(me.lastPoints)}</div></div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4 text-sm">
              {t.league.status === "SETUP" && <Badge tone="warn">À espera do draft</Badge>}
              {t.league.status === "DRAFTING" && <Badge tone="live">Draft a decorrer</Badge>}
              {next?.opponent && <span className="text-muted">Próximo: <span className="text-fg">vs {next.opponent.name}</span> · {next.matchup.label}</span>}
              {pending > 0 && <Badge tone="accent" className="ml-auto"><Repeat size={12} /> {pending} troca(s) a decidir</Badge>}
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader eyebrow="Os teus jogadores" title="Em destaque" />
          <CardBody className="space-y-3">
            {top.length === 0 && <p className="text-sm text-muted">Sem pontuações ainda. Aparecem após a primeira jornada.</p>}
            {top.map((x) => {
              const r = myPlayers.find((p) => p.playerId === x.playerId)!;
              return (
                <div key={x.playerId} className="flex items-center gap-3">
                  <PlayerAvatar name={r.player.name} photoUrl={r.player.photoUrl} pos={r.player.position} size={34} />
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{r.player.name}</div><div className="truncate text-xs text-muted">{r.player.club.shortName} · {r.team.name}</div></div>
                  <div className="num text-sm font-semibold">{fmtPts(x._sum.points)}</div>
                </div>
              );
            })}
          </CardBody>
        </Card>
        <Card>
          <CardHeader eyebrow="Boletim clínico" title="Lesões e suspensões" action={<HeartPulse size={18} className="text-faint" />} />
          <CardBody className="space-y-3">
            {injured.length === 0 && <p className="text-sm text-muted">Nenhum jogador teu está lesionado ou suspenso.</p>}
            {injured.slice(0, 6).map((r) => (
              <div key={r.id} className="flex items-center gap-3">
                <PosBadge pos={r.player.position} />
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{r.player.name}</div><div className="truncate text-xs text-muted">{r.player.statusNote ?? r.player.club.shortName}</div></div>
                <StatusDot status={r.player.status} />
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader eyebrow="Calendário" title="Próximos jogos" action={<CalendarDays size={18} className="text-faint" />} />
          <CardBody className="space-y-4">
            {fixtures.map(({ s, f }) => (
              <div key={s.id}>
                {fixtures.length > 1 && <div className="eyebrow mb-2">{s.name}</div>}
                {f.length === 0 && <p className="text-sm text-muted">Sem jogos agendados.</p>}
                <div className="space-y-2.5">
                  {f.map((x) => (
                    <div key={x.id} className="flex items-center gap-2 text-sm">
                      <ClubCrest name={x.homeClub.name} logoUrl={x.homeClub.logoUrl} code={x.homeClub.code} />
                      <span className="truncate">{x.homeClub.shortName}</span>
                      <span className="text-faint">vs</span>
                      <span className="truncate">{x.awayClub.shortName}</span>
                      <ClubCrest name={x.awayClub.name} logoUrl={x.awayClub.logoUrl} code={x.awayClub.code} />
                      <span className="ml-auto shrink-0 text-xs text-muted">{x.status === "LIVE" ? <Badge tone="live">AO VIVO</Badge> : fmtDateTime(x.kickoff)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </main>
  );
}
