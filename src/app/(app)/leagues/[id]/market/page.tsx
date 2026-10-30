import Link from "next/link";
import { prisma } from "@/server/db";
import { requireMember } from "@/server/services/access";
import { estimate, playerForm } from "@/server/services/form";
import { processWaivers } from "@/server/services/roster";
import { processTrades } from "@/server/services/trades";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/misc";
import { Market } from "@/components/league/market";

export const metadata = { title: "Mercado" };

export default async function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { league, team, settings } = await requireMember(id);
  if (league.status !== "ACTIVE") return <Card><Empty title="O mercado abre depois do draft" action={<Link className="text-glow" href={`/leagues/${id}/draft`}>Ir para o draft →</Link>} /></Card>;
  await processWaivers(id);
  await processTrades(id);

  const owned = await prisma.rosterEntry.findMany({ where: { leagueId: id }, select: { playerId: true, teamId: true } });
  const ownedIds = new Set(owned.map((o) => o.playerId));
  const [players, states, mine, claims, teams, form] = await Promise.all([
    prisma.player.findMany({ where: { seasonId: league.seasonId, active: true }, include: { club: true } }),
    prisma.playerLeagueState.findMany({ where: { leagueId: id, waiverUntil: { gt: new Date() } } }),
    prisma.rosterEntry.findMany({ where: { teamId: team.id }, include: { player: true } }),
    prisma.waiverClaim.findMany({ where: { teamId: team.id }, orderBy: { createdAt: "desc" }, take: 20, include: { team: true } }),
    prisma.team.findMany({ where: { leagueId: id }, orderBy: { waiverPriority: "asc" } }),
    playerForm(id),
  ]);
  const waiver = new Map(states.map((s) => [s.playerId, s.waiverUntil.toISOString()]));
  const names = new Map(players.map((p) => [p.id, p.name]));
  const fa = players.filter((p) => !ownedIds.has(p.id)).map((p) => {
    const f = form.get(p.id);
    return {
      id: p.id, name: p.name, pos: p.position, club: p.club.shortName, clubLogo: p.club.logoUrl, clubCode: p.club.code, photo: p.photoUrl, nat: p.nationality,
      status: p.status, statusNote: p.statusNote, total: f.total, games: f.games, last5Avg: f.last5Avg, seasonAvg: f.seasonAvg, proj: estimate(f),
      waiverUntil: waiver.get(p.id) ?? null,
    };
  });
  return (
    <Market
      leagueId={id}
      players={fa}
      limits={settings.roster}
      waiversEnabled={settings.waivers.enabled}
      roster={mine.map((r) => ({ id: r.playerId, name: r.player.name, pos: r.player.position }))}
      claims={claims.map((c) => ({ id: c.id, status: c.status, player: names.get(c.playerId) ?? "?", drop: c.dropPlayerId ? names.get(c.dropPlayerId) ?? "?" : null, note: c.note, createdAt: c.createdAt.toISOString() }))}
      priority={teams.map((t) => ({ id: t.id, name: t.name, priority: t.waiverPriority, me: t.id === team.id }))}
    />
  );
}
