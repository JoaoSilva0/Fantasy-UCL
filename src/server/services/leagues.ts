import { randomBytes } from "crypto";
import { prisma } from "../db";
import { UserError } from "../errors";
import {
  DEFAULT_SCORING, DEFAULT_SETTINGS, leagueSettingsSchema, rosterSize, scoringRulesSchema, type LeagueSettings, type ScoringRules,
} from "@/lib/fantasy/config";
import { createDraft } from "./draft";
import { emit, audit } from "./activity";
import { parseSettings } from "./settings";
import { recomputeLeague } from "./scoring";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem caracteres ambíguos

function inviteCode() {
  const b = randomBytes(8);
  return Array.from(b, (x) => ALPHABET[x % ALPHABET.length]).join("");
}

export function abbrev(name: string) {
  const words = name.trim().split(/\s+/);
  return (words.length > 1 ? words.slice(0, 3).map((w) => w[0]).join("") : name.slice(0, 3)).toUpperCase();
}

export async function createLeague(args: { userId: string; name: string; teamName: string; seasonId: string; maxTeams: number; settings?: Partial<LeagueSettings> }) {
  const season = await prisma.season.findUnique({ where: { id: args.seasonId } });
  if (!season) throw new UserError("Época inválida.");
  const settings = leagueSettingsSchema.parse({ ...DEFAULT_SETTINGS, ...args.settings });
  return prisma.$transaction(async (tx) => {
    const league = await tx.league.create({
      data: {
        name: args.name, seasonId: season.id, commissionerId: args.userId, inviteCode: inviteCode(),
        maxTeams: args.maxTeams, settings: settings as object, scoring: DEFAULT_SCORING as object,
      },
    });
    await tx.team.create({ data: { leagueId: league.id, userId: args.userId, name: args.teamName, abbrev: abbrev(args.teamName), waiverPriority: 1 } });
    await createDraft(league.id, settings, tx);
    await emit(league.id, "LEAGUE_CREATED", { name: league.name }, {}, tx);
    await audit(league.id, "LEAGUE_CREATED", { settings }, { userId: args.userId }, tx);
    return league;
  });
}

export async function joinLeague(args: { userId: string; code: string; teamName: string }) {
  const league = await prisma.league.findUnique({ where: { inviteCode: args.code.trim().toUpperCase() }, include: { teams: true } });
  if (!league) throw new UserError("Código de convite inválido.");
  if (league.teams.some((t) => t.userId === args.userId)) return league;
  if (league.status !== "SETUP") throw new UserError("Esta liga já fez o draft: não aceita novos participantes.");
  if (league.teams.length >= league.maxTeams) throw new UserError("A liga está completa.");
  const draft = await prisma.draft.findUnique({ where: { leagueId: league.id } });
  if (draft?.order) throw new UserError("A ordem do draft já foi sorteada: a liga está fechada.");
  if (league.teams.some((t) => t.name.toLowerCase() === args.teamName.trim().toLowerCase())) throw new UserError("Já existe uma equipa com esse nome.");
  await prisma.$transaction(async (tx) => {
    await tx.team.create({
      data: { leagueId: league.id, userId: args.userId, name: args.teamName.trim(), abbrev: abbrev(args.teamName), waiverPriority: league.teams.length + 1 },
    });
    const user = await tx.user.findUniqueOrThrow({ where: { id: args.userId } });
    await emit(league.id, "TEAM_JOINED", { team: args.teamName, user: user.displayName }, {
      notify: { userIds: [league.commissionerId], title: `${user.displayName} entrou na liga ${league.name}`, href: `/leagues/${league.id}` },
    }, tx);
    await audit(league.id, "TEAM_JOINED", { teamName: args.teamName }, { userId: args.userId }, tx);
  });
  return league;
}

/** Atualização de regras pelo comissário. Estrutura do plantel só antes do draft. */
export async function updateSettings(leagueId: string, userId: string, patch: Partial<LeagueSettings>, maxTeams?: number) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, include: { teams: true } });
  const current = parseSettings(league.settings);
  const next = leagueSettingsSchema.parse({ ...current, ...patch, trades: { ...current.trades, ...patch.trades }, waivers: { ...current.waivers, ...patch.waivers }, draft: { ...current.draft, ...patch.draft } });
  const rosterChanged = JSON.stringify(next.roster) !== JSON.stringify(current.roster);
  if (rosterChanged && league.status !== "SETUP") throw new UserError("A estrutura do plantel só pode ser alterada antes do draft.");
  if (rosterSize(next) < 11 + 1 || next.roster.GK < 1) throw new UserError("O plantel tem de permitir um onze completo (mín. 1 GR e 12 jogadores).");
  if (next.roster.DEF < 5 || next.roster.MID < 5 || next.roster.FWD < 3) throw new UserError("Mínimos para suportar todas as formações: 5 DEF, 5 MED e 3 AV.");
  if (next.format !== current.format && league.status !== "SETUP") throw new UserError("O formato só pode ser alterado antes do draft.");
  if (maxTeams !== undefined && (maxTeams < league.teams.length || maxTeams < 2 || maxTeams > 12)) throw new UserError("Número de participantes inválido.");
  await prisma.$transaction(async (tx) => {
    await tx.league.update({ where: { id: leagueId }, data: { settings: next as object, ...(maxTeams ? { maxTeams } : {}) } });
    if (league.status === "SETUP") await tx.draft.update({ where: { leagueId }, data: { rounds: rosterSize(next), pickSeconds: next.draft.pickSeconds } });
    await audit(leagueId, "SETTINGS_UPDATED", { before: current, after: next }, { userId }, tx);
    await emit(leagueId, "SETTINGS_UPDATED", { what: "regras da liga" }, {}, tx);
  });
}

export async function updateScoring(leagueId: string, userId: string, rules: ScoringRules) {
  const parsed = scoringRulesSchema.parse(rules);
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  await prisma.league.update({ where: { id: leagueId }, data: { scoring: parsed as object } });
  await audit(leagueId, "SCORING_UPDATED", { before: league.scoring, after: parsed }, { userId });
  await emit(leagueId, "SETTINGS_UPDATED", { what: "sistema de pontuação" });
  // Recalcula todas as pontuações da liga com as novas regras (auditado).
  await recomputeLeague(leagueId, userId);
}

export async function postMessage(leagueId: string, userId: string, body: string) {
  const text = body.trim().slice(0, 500);
  if (!text) throw new UserError("Mensagem vazia.");
  const recent = await prisma.chatMessage.count({ where: { userId, leagueId, createdAt: { gte: new Date(Date.now() - 10_000) } } });
  if (recent >= 5) throw new UserError("Calma! Demasiadas mensagens seguidas.");
  const m = await prisma.chatMessage.create({ data: { leagueId, userId, body: text } });
  await emit(leagueId, "CHAT", { id: m.id }, { feed: false });
}

const REACTIONS = ["🔥", "😂", "👏", "💀", "🤡", "🐐"];
export async function react(leagueId: string, userId: string, messageId: string, emoji: string) {
  if (!REACTIONS.includes(emoji)) throw new UserError("Reação inválida.");
  const m = await prisma.chatMessage.findUnique({ where: { id: messageId } });
  if (!m || m.leagueId !== leagueId) throw new UserError("Mensagem inexistente.");
  const r = (m.reactions ?? {}) as Record<string, string[]>;
  const list = new Set(r[emoji] ?? []);
  if (list.has(userId)) list.delete(userId);
  else list.add(userId);
  r[emoji] = [...list];
  await prisma.chatMessage.update({ where: { id: messageId }, data: { reactions: r } });
  await emit(leagueId, "CHAT", { id: m.id }, { feed: false });
}
export { REACTIONS };
