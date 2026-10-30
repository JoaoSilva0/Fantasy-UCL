"use server";
import { z } from "zod";
import { prisma } from "../db";
import { requireUser } from "../auth";
import { run, UserError } from "../errors";
import { requireCommissioner, requireMember } from "../services/access";
import { createLeague, joinLeague, postMessage, react, updateScoring, updateSettings } from "../services/leagues";
import { pauseDraft, randomizeOrder, startDraft } from "../services/draft";
import { recomputeLeague, finalizeRounds } from "../services/scoring";
import { createDemoSeason, simulateDemoRound, syncSeason, syncPostMatch, syncLive } from "../services/sync";
import { ensureSchedule } from "../services/matchups";
import { DEFAULT_SETTINGS, leagueSettingsSchema, scoringRulesSchema } from "@/lib/fantasy/config";

const name = z.string().trim().min(2, "Nome demasiado curto.").max(40, "Nome demasiado longo.");

export async function createLeagueAction(input: { name: string; teamName: string; seasonId: string; maxTeams: number; format: string; pickSeconds: number; tradeApproval: string }) {
  return run(async () => {
    const u = await requireUser();
    const p = z.object({
      name, teamName: name, seasonId: z.string().min(1, "Escolhe uma época."), maxTeams: z.number().int().min(4).max(12),
      format: z.enum(["POINTS", "H2H", "HYBRID"]), pickSeconds: z.number().int().min(15).max(600), tradeApproval: z.enum(["FREE", "COMMISSIONER", "VOTE"]),
    }).safeParse(input);
    if (!p.success) throw new UserError(p.error.issues[0].message);
    let seasonId = p.data.seasonId;
    if (seasonId === "demo") seasonId = (await createDemoSeason()).id;
    const league = await createLeague({
      userId: u.id, name: p.data.name, teamName: p.data.teamName, seasonId, maxTeams: p.data.maxTeams,
      settings: { format: p.data.format, draft: { pickSeconds: p.data.pickSeconds }, trades: { ...DEFAULT_SETTINGS.trades, approval: p.data.tradeApproval } },
    });
    return league.id;
  });
}

export async function joinLeagueAction(input: { code: string; teamName: string }) {
  return run(async () => {
    const u = await requireUser();
    const t = name.safeParse(input.teamName);
    if (!t.success) throw new UserError(t.error.issues[0].message);
    const league = await joinLeague({ userId: u.id, code: input.code, teamName: t.data });
    return league.id;
  });
}

export async function updateSettingsAction(leagueId: string, patch: unknown, maxTeams?: number) {
  return run(async () => {
    const { user } = await requireCommissioner(leagueId);
    const p = leagueSettingsSchema.partial().safeParse(patch);
    if (!p.success) throw new UserError("Definições inválidas.");
    await updateSettings(leagueId, user.id, p.data, maxTeams);
  });
}

export async function updateScoringAction(leagueId: string, rules: unknown) {
  return run(async () => {
    const { user } = await requireCommissioner(leagueId);
    const p = scoringRulesSchema.safeParse(rules);
    if (!p.success) throw new UserError("Regras de pontuação inválidas: " + p.error.issues[0].path.join("."));
    await updateScoring(leagueId, user.id, p.data);
  });
}

export async function randomizeOrderAction(leagueId: string) {
  return run(async () => randomizeOrder(leagueId, (await requireCommissioner(leagueId)).user.id));
}
export async function startDraftAction(leagueId: string) {
  return run(async () => startDraft(leagueId, (await requireCommissioner(leagueId)).user.id));
}
export async function pauseDraftAction(leagueId: string, pause: boolean) {
  return run(async () => pauseDraft(leagueId, (await requireCommissioner(leagueId)).user.id, pause));
}
export async function recomputeAction(leagueId: string) {
  return run(async () => {
    const { user } = await requireCommissioner(leagueId);
    const r = await recomputeLeague(leagueId, user.id);
    return r.updated;
  });
}

/** Sincronização manual com a API real (apenas comissários; a API key nunca sai do servidor). */
export async function syncAction(leagueId: string, job: "season" | "live" | "post") {
  return run(async () => {
    const { league } = await requireCommissioner(leagueId);
    if (league.season.isDemo) throw new UserError("Esta liga usa a época DEMO: usa a simulação.");
    const out = job === "season" ? await syncSeason() : job === "live" ? await syncLive() : await syncPostMatch();
    await ensureSchedule(leagueId);
    return JSON.stringify(out);
  });
}

/** Primeira importação da época real (antes de existir qualquer liga). Depois disso, só comissários sincronizam. */
export async function importRealSeasonAction() {
  return run(async () => {
    await requireUser();
    if (await prisma.season.findFirst({ where: { isDemo: false } })) throw new UserError("A época real já foi importada. A sincronização é automática (cron) ou feita por um comissário.");
    return JSON.stringify(await syncSeason());
  });
}

export async function simulateDemoAction(leagueId: string, phase: "HALF" | "FULL") {
  return run(async () => {
    const { league } = await requireCommissioner(leagueId);
    if (league.status !== "ACTIVE") throw new UserError("Termina primeiro o draft.");
    const name = await simulateDemoRound(league.seasonId, phase);
    return name;
  });
}

export async function forceFinalizeAction(leagueId: string) {
  return run(async () => {
    const { league } = await requireCommissioner(leagueId);
    if (!league.season.isDemo) throw new UserError("Em épocas reais as jornadas fecham automaticamente após o período de correções.");
    await finalizeRounds(league.seasonId, 0, true);
  });
}

export async function postMessageAction(leagueId: string, body: string) {
  return run(async () => postMessage(leagueId, (await requireMember(leagueId)).user.id, body));
}

export async function reactAction(leagueId: string, messageId: string, emoji: string) {
  return run(async () => react(leagueId, (await requireMember(leagueId)).user.id, messageId, emoji));
}

export async function renameTeamAction(leagueId: string, teamName: string) {
  return run(async () => {
    const { team } = await requireMember(leagueId);
    const t = name.safeParse(teamName);
    if (!t.success) throw new UserError(t.error.issues[0].message);
    await prisma.team.update({ where: { id: team.id }, data: { name: t.data } });
  });
}
