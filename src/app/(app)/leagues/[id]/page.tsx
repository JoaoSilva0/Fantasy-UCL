import Link from "next/link";
import { ArrowRight, Crown, Fingerprint, Newspaper, Repeat } from "lucide-react";
import { prisma } from "@/server/db";
import { requireMember } from "@/server/services/access";
import { leagueTable, nextMatchup } from "@/server/queries";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { PlayerAvatar, StatusDot, Stat, TeamMark } from "@/components/ui/misc";
import { Feed } from "@/components/league/feed";
import { Chat } from "@/components/league/chat";
import { CopyInvite, DraftControls } from "@/components/league/lobby-actions";
import { fmtPts, timeAgo } from "@/lib/utils";
import { POS_LABEL, rosterSize, type Pos } from "@/lib/fantasy/config";

export default async function LeagueHome({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireMember(id);
  const { league, team, user, isCommissioner, settings } = ctx;
  const [events, messages] = await Promise.all([
    prisma.activityEvent.findMany({ where: { leagueId: id, feed: true }, orderBy: { id: "desc" }, take: 25 }),
    prisma.chatMessage.findMany({ where: { leagueId: id }, orderBy: { createdAt: "desc" }, take: 40, include: { user: { select: { id: true, displayName: true, avatarColor: true } } } }),
  ]);
  const chat = (
    <Card>
      <CardHeader eyebrow="Trash talk" title="Balneário" />
      <CardBody>
        <Chat leagueId={id} meId={user.id} messages={messages.reverse().map((m) => ({ id: m.id, body: m.body, createdAt: m.createdAt.toISOString(), reactions: m.reactions as Record<string, string[]>, user: m.user }))} />
      </CardBody>
    </Card>
  );
  const feed = <Card><CardHeader eyebrow="Liga" title="Atividade" /><CardBody><Feed events={events} /></CardBody></Card>;

  // ───────── Lobby (antes do draft) ─────────
  if (league.status === "SETUP" || league.status === "DRAFTING") {
    const draft = await prisma.draft.findUniqueOrThrow({ where: { leagueId: id } });
    const teams = await prisma.team.findMany({ where: { leagueId: id }, include: { user: true }, orderBy: { createdAt: "asc" } });
    const order = (draft.order as string[] | null) ?? null;
    const ordered = order ? order.map((tid) => teams.find((t) => t.id === tid)!) : teams;
    return (
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <div className="relative p-6">
              <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-accent/15 blur-3xl" />
              <div className="eyebrow mb-2">Lobby da liga</div>
              <h2 className="text-xl font-semibold tracking-tight">{league.status === "DRAFTING" ? "O draft está a decorrer!" : order ? "Ordem sorteada — prontos para o draft" : `À espera de participantes (${teams.length}/${league.maxTeams})`}</h2>
              <p className="mt-1 max-w-lg text-sm text-muted">
                Snake draft de {rosterSize(settings)} rondas · {settings.draft.pickSeconds}s por escolha · {(Object.keys(settings.roster) as Pos[]).map((p) => `${settings.roster[p]} ${POS_LABEL[p]}`).join(" · ")}
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                {league.status === "DRAFTING" ? (
                  <Link href={`/leagues/${id}/draft`} className={buttonVariants({ size: "lg" })}>Entrar na sala de draft <ArrowRight size={16} /></Link>
                ) : isCommissioner ? (
                  <DraftControls leagueId={id} hasOrder={!!order} teams={teams.length} />
                ) : (
                  <span className="text-sm text-muted">O comissário vai {order ? "iniciar o draft" : "sortear a ordem"} quando todos estiverem prontos.</span>
                )}
                {!order && <Link href={`/leagues/${id}/draft`} className={buttonVariants({ variant: "ghost" })}>Preparar a fila de draft</Link>}
              </div>
            </div>
            {!order && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-ink/30 px-6 py-4">
                <div><div className="eyebrow">Código de convite</div><div className="num mt-1 font-mono text-2xl font-semibold tracking-[0.3em] text-glow">{league.inviteCode}</div></div>
                <CopyInvite code={league.inviteCode} />
              </div>
            )}
          </Card>
          <Card>
            <CardHeader eyebrow={order ? "Ordem da 1.ª ronda (snake)" : "Participantes"} title={order ? "Ordem do draft" : `${teams.length} equipas`} />
            <CardBody>
              <ol className="grid gap-2 sm:grid-cols-2">
                {ordered.map((t, i) => (
                  <li key={t.id} className="flex items-center gap-3 rounded-xl border border-line bg-ink/30 px-3 py-2.5">
                    {order && <span className="num w-5 text-center text-sm font-bold text-glow">{i + 1}</span>}
                    <TeamMark name={t.name} color={t.user.avatarColor} size={32} />
                    <div className="min-w-0"><div className="truncate text-sm font-semibold">{t.name}</div><div className="truncate text-xs text-muted">{t.user.displayName}</div></div>
                    {t.userId === league.commissionerId && <Crown size={14} className="ml-auto text-warn" />}
                  </li>
                ))}
              </ol>
              <div className="mt-4 flex items-start gap-2 rounded-xl bg-ink/40 p-3 text-xs text-muted">
                <Fingerprint size={16} className="mt-0.5 shrink-0 text-glow" />
                <div className="min-w-0">
                  <b className="text-silver">Sorteio verificável.</b> Compromisso publicado antes do sorteio: <code className="break-all text-silver">SHA-256 = {draft.seedHash}</code>
                  {order && <> · Semente revelada: <code className="break-all text-silver">{draft.seed}</code>. A ordem resulta de um Fisher–Yates determinístico sobre os IDs das equipas (ver <code>src/lib/fantasy/snake.ts</code>).</>}
                </div>
              </div>
            </CardBody>
          </Card>
          {feed}
        </div>
        {chat}
      </div>
    );
  }

  // ───────── Dashboard da época ─────────
  const [table, next, pending, roster] = await Promise.all([
    leagueTable(id),
    nextMatchup(id, team.id),
    prisma.trade.findMany({ where: { leagueId: id, OR: [{ receiverTeamId: team.id, status: "PENDING" }, { status: "IN_REVIEW" }] }, include: { proposer: true, receiver: true } }),
    prisma.rosterEntry.findMany({ where: { teamId: team.id }, include: { player: { include: { club: true } } } }),
  ]);
  const me = table.rows.find((r) => r.teamId === team.id)!;
  const pts = await prisma.leaguePlayerPoints.groupBy({ by: ["playerId"], where: { leagueId: id, playerId: { in: roster.map((r) => r.playerId) } }, _sum: { points: true }, orderBy: { _sum: { points: "desc" } }, take: 5 });
  const leaguePlayers = await prisma.rosterEntry.findMany({ where: { leagueId: id, player: { status: { not: "AVAILABLE" } } }, include: { player: { include: { club: true } }, team: true }, orderBy: { player: { statusUpdatedAt: "desc" } }, take: 8 });
  const isH2H = settings.format !== "POINTS";

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <Card className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
          <Stat label="Posição" value={<>{me.rank}<span className="text-base text-muted">/{table.rows.length}</span></>} sub={isH2H ? `${me.w}V ${me.d}E ${me.l}D · ${me.tablePoints} pts` : undefined} />
          <Stat label="Pontos totais" value={fmtPts(me.points)} />
          <Stat label={table.lastRound?.name ? "Última jornada" : "Última jornada"} value={fmtPts(me.lastPoints)} sub={table.lastRound?.name} />
          <Stat label="Jornada atual" value={fmtPts(me.currentPoints)} sub={table.currentRound?.name} />
        </Card>

        {isH2H && next?.opponent && (
          <Card className="overflow-hidden">
            <div className="eyebrow px-5 pt-5">{next.matchup.label} · confronto direto</div>
            <div className="flex items-center justify-between gap-4 px-5 py-5">
              <div className="flex min-w-0 items-center gap-3"><TeamMark name={team.name} color={user.avatarColor} size={44} /><div className="min-w-0"><div className="truncate font-semibold">{team.name}</div><div className="text-xs text-muted">Tu</div></div></div>
              <div className="num shrink-0 text-center text-3xl font-semibold tracking-tight">{fmtPts(next.mine ?? 0)}<span className="mx-2 text-faint">–</span>{fmtPts(next.theirs ?? 0)}</div>
              <div className="flex min-w-0 items-center justify-end gap-3 text-right"><div className="min-w-0"><div className="truncate font-semibold">{next.opponent.name}</div><div className="truncate text-xs text-muted">{next.opponent.user.displayName}</div></div><TeamMark name={next.opponent.name} color={next.opponent.user.avatarColor} size={44} /></div>
            </div>
            <Link href={`/leagues/${id}/live`} className="flex items-center justify-center gap-1 border-t border-line py-3 text-sm text-glow hover:bg-white/3">Acompanhar ao vivo <ArrowRight size={14} /></Link>
          </Card>
        )}

        {pending.length > 0 && (
          <Card>
            <CardHeader eyebrow="Mercado" title="Trocas a precisar de ti" action={<Repeat size={18} className="text-faint" />} />
            <CardBody className="space-y-2">
              {pending.map((t) => (
                <Link key={t.id} href={`/leagues/${id}/trades?t=${t.id}`} className="flex items-center justify-between rounded-xl border border-line bg-ink/30 px-3 py-2.5 text-sm hover:border-accent/40">
                  <span><b>{t.proposer.name}</b> ↔ <b>{t.receiver.name}</b></span>
                  <Badge tone={t.status === "PENDING" ? "accent" : "warn"}>{t.status === "PENDING" ? "Proposta para ti" : "Em revisão"}</Badge>
                </Link>
              ))}
            </CardBody>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader eyebrow="Classificação" title="Top da liga" action={<Link href={`/leagues/${id}/standings`} className="text-xs text-glow">Ver tudo</Link>} />
            <CardBody className="space-y-1">
              {table.rows.slice(0, 6).map((r) => (
                <div key={r.teamId} className={`flex items-center gap-3 rounded-lg px-2 py-1.5 ${r.teamId === team.id ? "bg-accent-soft" : ""}`}>
                  <span className="num w-5 text-center text-sm text-muted">{r.rank}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.team.name}</span>
                  {isH2H && <span className="num text-xs text-muted">{r.tablePoints} pts</span>}
                  <span className="num w-14 text-right text-sm font-semibold">{fmtPts(r.points)}</span>
                </div>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader eyebrow="O teu plantel" title="Melhores jogadores" action={<Link href={`/leagues/${id}/team`} className="text-xs text-glow">Plantel</Link>} />
            <CardBody className="space-y-3">
              {pts.length === 0 && <p className="text-sm text-muted">Ainda sem pontos registados.</p>}
              {pts.map((p) => {
                const r = roster.find((x) => x.playerId === p.playerId)!;
                return (
                  <Link href={`/leagues/${id}/players/${r.playerId}`} key={p.playerId} className="flex items-center gap-3">
                    <PlayerAvatar name={r.player.name} photoUrl={r.player.photoUrl} pos={r.player.position} size={32} />
                    <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{r.player.name}</div><div className="text-xs text-muted">{r.player.club.shortName}</div></div>
                    <span className="num text-sm font-semibold">{fmtPts(p._sum.points)}</span>
                  </Link>
                );
              })}
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader eyebrow="Fantasy News" title="Lesões e suspensões na liga" action={<Newspaper size={18} className="text-faint" />} />
          <CardBody className="space-y-2.5">
            {leaguePlayers.length === 0 && <p className="text-sm text-muted">Sem lesões ou suspensões reportadas pela fonte de dados.</p>}
            {leaguePlayers.map((r) => (
              <div key={r.id} className="flex items-center gap-3 text-sm">
                <StatusDot status={r.player.status} />
                <span className="font-medium">{r.player.name}</span>
                <span className="truncate text-muted">{r.player.statusNote} · {r.team.name}</span>
                {r.player.statusUpdatedAt && <span className="ml-auto shrink-0 text-[11px] text-faint">{timeAgo(r.player.statusUpdatedAt)}</span>}
              </div>
            ))}
          </CardBody>
        </Card>
        {feed}
      </div>
      {chat}
    </div>
  );
}
