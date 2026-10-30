import Link from "next/link";
import { prisma } from "@/server/db";
import { requireMember } from "@/server/services/access";
import { estimate, playerForm } from "@/server/services/form";
import { processTrades } from "@/server/services/trades";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/misc";
import { TradeCenter } from "@/components/league/trade-center";

export const metadata = { title: "Trades" };

export default async function TradesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string }> }) {
  const { id } = await params;
  const { t: focus } = await searchParams;
  const { league, team, settings, isCommissioner } = await requireMember(id);
  if (league.status !== "ACTIVE") return <Card><Empty title="As trocas abrem depois do draft" action={<Link className="text-glow" href={`/leagues/${id}/draft`}>Ir para o draft →</Link>} /></Card>;
  await processTrades(id);
  const [teams, trades, form] = await Promise.all([
    prisma.team.findMany({ where: { leagueId: id }, include: { user: { select: { displayName: true, avatarColor: true } }, roster: { include: { player: { include: { club: true } } } } }, orderBy: { name: "asc" } }),
    prisma.trade.findMany({ where: { leagueId: id }, orderBy: { createdAt: "desc" }, take: 60, include: { items: { include: { player: true } }, votes: true } }),
    playerForm(id),
  ]);
  return (
    <TradeCenter
      leagueId={id} meTeamId={team.id} isCommissioner={isCommissioner} commissionerInvolvedIds={[]}
      approval={settings.trades.approval} reviewHours={settings.trades.reviewHours}
      focus={focus ?? null}
      teams={teams.map((t) => ({
        id: t.id, name: t.name, owner: t.user.displayName, color: t.user.avatarColor, userId: t.userId,
        roster: t.roster.map((r) => { const f = form.get(r.playerId); return { id: r.playerId, name: r.player.name, pos: r.player.position, club: r.player.club.shortName, block: r.onTradeBlock, total: f.total, proj: estimate(f) }; }),
      }))}
      commissionerUserId={league.commissionerId}
      trades={trades.map((t) => ({
        id: t.id, status: t.status, proposerTeamId: t.proposerTeamId, receiverTeamId: t.receiverTeamId, message: t.message, flagged: t.flagged,
        failReason: t.failReason, createdAt: t.createdAt.toISOString(), expiresAt: t.expiresAt.toISOString(), reviewUntil: t.reviewUntil?.toISOString() ?? null,
        parentId: t.parentId, analysis: t.analysis as { proposerShare: number; fairness: string } | null,
        items: t.items.map((i) => ({ playerId: i.playerId, name: i.player.name, pos: i.player.position, fromTeamId: i.fromTeamId })),
        vetoes: t.votes.filter((v) => v.veto).length, myVote: t.votes.find((v) => v.teamId === team.id)?.veto ?? null,
      }))}
    />
  );
}
