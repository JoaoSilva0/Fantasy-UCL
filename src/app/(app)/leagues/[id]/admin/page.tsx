import { prisma } from "@/server/db";
import { requireMember } from "@/server/services/access";
import { currentRound } from "@/server/services/rounds";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/misc";
import { AdminPanel } from "@/components/league/admin-panel";

export const metadata = { title: "Administração" };

export default async function AdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { league, settings, scoring, isCommissioner } = await requireMember(id);
  if (!isCommissioner) return <Card><Empty title="Apenas o comissário tem acesso a esta área." /></Card>;
  const [logs, audit, teams, round] = await Promise.all([
    prisma.syncLog.findMany({ orderBy: { startedAt: "desc" }, take: 8 }),
    prisma.transaction.findMany({ where: { leagueId: id }, orderBy: { createdAt: "desc" }, take: 60 }),
    prisma.team.findMany({ where: { leagueId: id } }),
    currentRound(league.seasonId),
  ]);
  const tn = new Map(teams.map((t) => [t.id, t.name]));
  return (
    <AdminPanel
      leagueId={id} status={league.status} isDemo={league.season.isDemo} inviteCode={league.inviteCode} maxTeams={league.maxTeams} teamCount={teams.length}
      settings={settings} scoring={scoring} hasApiKey={!!process.env.API_FOOTBALL_KEY} currentRound={round?.name ?? null}
      seasonSync={{ lastSyncedAt: league.season.lastSyncedAt?.toISOString() ?? null }}
      logs={logs.map((l) => ({ id: l.id, job: l.job, status: l.status, message: l.message, requests: l.requests, at: l.startedAt.toISOString() }))}
      audit={audit.map((a) => ({ id: a.id, type: a.type, team: a.teamId ? tn.get(a.teamId) ?? null : null, at: a.createdAt.toISOString(), payload: JSON.stringify(a.payload).slice(0, 160) }))}
    />
  );
}
