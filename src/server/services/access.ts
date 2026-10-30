import "server-only";
import { notFound } from "next/navigation";
import { prisma } from "../db";
import { requireUser } from "../auth";
import { UserError } from "../errors";
import { parseScoring, parseSettings } from "./settings";

export { parseScoring, parseSettings };

/**
 * Garante que o utilizador autenticado é membro da liga.
 * Ligas são privadas: não-membros recebem 404 (nem se revela que a liga existe).
 */
export async function requireMember(leagueId: string) {
  const user = await requireUser();
  const team = await prisma.team.findUnique({
    where: { leagueId_userId: { leagueId, userId: user.id } },
    include: { league: { include: { season: true } } },
  });
  if (!team) notFound();
  const { league, ...myTeam } = team;
  return {
    user,
    team: myTeam,
    league,
    settings: parseSettings(league.settings),
    scoring: parseScoring(league.scoring),
    isCommissioner: league.commissionerId === user.id,
  };
}

export async function requireCommissioner(leagueId: string) {
  const ctx = await requireMember(leagueId);
  if (!ctx.isCommissioner) throw new UserError("Apenas o comissário da liga pode fazer esta operação.");
  return ctx;
}
