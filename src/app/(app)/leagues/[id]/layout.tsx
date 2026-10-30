import { prisma } from "@/server/db";
import { requireMember } from "@/server/services/access";
import { LeagueNav } from "@/components/app/league-nav";
import { LiveRefresher } from "@/components/app/live-refresher";
import { Badge } from "@/components/ui/badge";
import { DemoBanner } from "@/components/ui/misc";

const STATUS: Record<string, [string, "neutral" | "accent" | "win" | "warn"]> = {
  SETUP: ["À espera do draft", "warn"],
  DRAFTING: ["Draft a decorrer", "accent"],
  ACTIVE: ["Época em curso", "win"],
  COMPLETED: ["Terminada", "neutral"],
};

export default async function LeagueLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { league, isCommissioner } = await requireMember(id);
  const [label, tone] = STATUS[league.status];
  // Cursor do tempo real = último evento conhecido neste render (não se perdem eventos entre render e ligação SSE).
  const lastEvent = await prisma.activityEvent.findFirst({ where: { leagueId: id }, orderBy: { id: "desc" }, select: { id: true } });
  return (
    <div className="mx-auto max-w-7xl px-4 pb-24 pt-6 sm:px-6">
      <LiveRefresher leagueId={league.id} after={lastEvent?.id ?? 0} />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="eyebrow mb-1.5 flex items-center gap-2">{league.season.name}</div>
          <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">{league.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={tone}>{label}</Badge>
          {isCommissioner && <Badge tone="accent">Comissário</Badge>}
        </div>
      </div>
      {league.season.isDemo && <DemoBanner className="mb-4" />}
      <div className="mb-6"><LeagueNav leagueId={league.id} isCommissioner={isCommissioner} drafting={league.status === "DRAFTING"} /></div>
      {children}
    </div>
  );
}
