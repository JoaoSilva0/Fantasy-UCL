import { prisma } from "@/server/db";
import { requireMember } from "@/server/services/access";
import { STAGE_LABEL } from "@/server/services/rounds";
import { ensureSchedule } from "@/server/services/matchups";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClubCrest, Empty } from "@/components/ui/misc";
import { cn, fmtDate, fmtDateTime, fmtPts } from "@/lib/utils";

export const metadata = { title: "Calendário" };

export default async function CalendarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { league, team: me, settings } = await requireMember(id);
  await ensureSchedule(id);
  const [rounds, matchups, teams, myRoster] = await Promise.all([
    prisma.round.findMany({ where: { seasonId: league.seasonId }, orderBy: { order: "asc" }, include: { fixtures: { include: { homeClub: true, awayClub: true }, orderBy: { kickoff: "asc" } } } }),
    prisma.matchup.findMany({ where: { leagueId: id } }),
    prisma.team.findMany({ where: { leagueId: id } }),
    prisma.rosterEntry.findMany({ where: { teamId: me.id }, include: { player: true } }),
  ]);
  if (!rounds.length) return <Card><Empty title="Calendário ainda não sincronizado" body="As jornadas aparecem quando a época é importada da API." /></Card>;
  const tn = new Map(teams.map((t) => [t.id, t.name]));
  const myClubs = new Map<string, number>();
  for (const r of myRoster) myClubs.set(r.player.clubId, (myClubs.get(r.player.clubId) ?? 0) + 1);
  let lastStage = "";
  return (
    <div className="space-y-3">
      {rounds.map((r) => {
        const header = r.stage !== lastStage ? STAGE_LABEL[r.stage] : null;
        lastStage = r.stage;
        const mine = matchups.find((m) => m.roundIds.includes(r.id) && (m.homeTeamId === me.id || m.awayTeamId === me.id));
        return (
          <div key={r.id}>
            {header && <div className="eyebrow mb-2 mt-6 first:mt-0">{header}</div>}
            <Card className={cn("p-4", !r.finalizedAt && r.fixtures.some((f) => f.status !== "FINISHED") && r.fixtures.some((f) => f.status !== "SCHEDULED") && "ring-1 ring-loss/40")}>
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-semibold">{r.name}</div>
                {r.startsAt && <span className="text-xs text-muted">{fmtDate(r.startsAt)}{r.endsAt && r.endsAt.toDateString() !== r.startsAt.toDateString() ? ` – ${fmtDate(r.endsAt)}` : ""}</span>}
                {r.finalizedAt && <Badge>Fechada</Badge>}
                {settings.format !== "POINTS" && mine && (
                  <span className="ml-auto text-sm">
                    {mine.isPlayoff && <Badge tone="accent" className="mr-2">Playoff</Badge>}
                    vs <b>{tn.get(mine.homeTeamId === me.id ? mine.awayTeamId! : mine.homeTeamId!) ?? "a definir"}</b>
                    {mine.final && <span className={cn("ml-2 num", mine.winnerTeamId === me.id ? "text-win" : mine.winnerTeamId ? "text-loss" : "text-muted")}>{fmtPts(mine.homeTeamId === me.id ? mine.homePoints : mine.awayPoints)}–{fmtPts(mine.homeTeamId === me.id ? mine.awayPoints : mine.homePoints)}</span>}
                  </span>
                )}
              </div>
              {r.fixtures.length === 0 ? <p className="mt-2 text-sm text-muted">Jogos ainda por definir (sorteio).</p> : (
                <div className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {r.fixtures.map((f) => {
                    const n = (myClubs.get(f.homeClubId) ?? 0) + (myClubs.get(f.awayClubId) ?? 0);
                    return (
                      <div key={f.id} className="flex items-center gap-2 text-sm">
                        <ClubCrest name={f.homeClub.name} logoUrl={f.homeClub.logoUrl} code={f.homeClub.code} size={16} />
                        <span className="min-w-0 truncate">{f.homeClub.shortName}</span>
                        <span className="num shrink-0 text-xs text-muted">{f.status === "FINISHED" || f.status === "LIVE" ? `${f.homeGoals}–${f.awayGoals}` : "vs"}</span>
                        <span className="min-w-0 truncate">{f.awayClub.shortName}</span>
                        <ClubCrest name={f.awayClub.name} logoUrl={f.awayClub.logoUrl} code={f.awayClub.code} size={16} />
                        {n > 0 && <span className="shrink-0 rounded bg-accent-soft px-1 text-[10px] text-glow" title="Jogadores teus neste jogo">{n}</span>}
                        <span className="ml-auto shrink-0 text-[11px] text-faint">{f.status === "SCHEDULED" ? fmtDateTime(f.kickoff) : f.status === "LIVE" ? <span className="text-loss">ao vivo</span> : ""}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        );
      })}
    </div>
  );
}
