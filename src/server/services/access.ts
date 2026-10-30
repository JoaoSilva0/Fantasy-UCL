import "server-only";
import { notFound } from "next/navigation";
import { prisma } from "../db";
import { requireUser } from "../auth";
import { UserError } from "../errors";
import {
  DEFAULT_SCORING,
  DEFAULT_SETTINGS,
  leagueSettingsSchema,
  scoringRulesSchema,
  type LeagueSettings,
  type ScoringRules,
} from "@/lib/fantasy/config";

export function parseSettings(json: unknown): LeagueSettings {
  const r = leagueSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...(json as object) });
  return r.success ? r.data : DEFAULT_SETTINGS;
}

export function parseScoring(json: unknown): ScoringRules {
  const r = scoringRulesSchema.safeParse({ ...DEFAULT_SCORING, ...(json as object) });
  return r.success ? r.data : DEFAULT_SCORING;
}

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
