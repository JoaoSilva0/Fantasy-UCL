import { prisma } from "@/server/db";
import { requireMember } from "@/server/services/access";
import { playerForm, estimate } from "@/server/services/form";
import { tickDraft } from "@/server/services/draft";
import { DraftRoom, type DraftPlayer } from "@/components/league/draft-room";

export const metadata = { title: "Sala de draft" };

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { league, team, isCommissioner, settings, user } = await requireMember(id);
  await tickDraft(id);
  const [draft, teams, players, queue, form] = await Promise.all([
    prisma.draft.findUniqueOrThrow({ where: { leagueId: id }, include: { picks: { orderBy: { overall: "asc" } } } }),
    prisma.team.findMany({ where: { leagueId: id }, include: { user: { select: { displayName: true, avatarColor: true } } } }),
    prisma.player.findMany({ where: { seasonId: league.seasonId, active: true }, include: { club: { select: { shortName: true, code: true, logoUrl: true } } }, orderBy: { name: "asc" } }),
    prisma.draftQueue.findMany({ where: { teamId: team.id }, orderBy: { rank: "asc" } }),
    playerForm(id),
  ]);
  const data: DraftPlayer[] = players.map((p) => {
    const f = form.get(p.id);
    return {
      id: p.id, name: p.name, pos: p.position, club: p.club.shortName, clubCode: p.club.code, clubLogo: p.club.logoUrl,
      nat: p.nationality, photo: p.photoUrl, age: p.age, status: p.status, total: f.total, games: f.games, proj: estimate(f),
    };
  });
  return (
    <DraftRoom
      leagueId={id}
      meTeamId={team.id}
      isCommissioner={isCommissioner}
      userColor={user.avatarColor}
      limits={settings.roster}
      draft={{
        status: draft.status, order: (draft.order as string[] | null) ?? [], rounds: draft.rounds, currentPick: draft.currentPick,
        deadline: draft.pickDeadline?.toISOString() ?? null, pausedRemainingMs: draft.pausedRemainingMs, pickSeconds: draft.pickSeconds,
      }}
      picks={draft.picks.map((p) => ({ overall: p.overall, round: p.round, teamId: p.teamId, playerId: p.playerId, auto: p.auto }))}
      teams={teams.map((t) => ({ id: t.id, name: t.name, owner: t.user.displayName, color: t.user.avatarColor }))}
      players={data}
      queue={queue.map((q) => q.playerId)}
    />
  );
}
