import { z } from "zod";

export type Pos = "GK" | "DEF" | "MID" | "FWD";
export const POSITIONS: Pos[] = ["GK", "DEF", "MID", "FWD"];
export const POS_LABEL: Record<Pos, string> = { GK: "GR", DEF: "DEF", MID: "MED", FWD: "AV" };
export const POS_NAME: Record<Pos, string> = {
  GK: "Guarda-redes",
  DEF: "Defesa",
  MID: "Médio",
  FWD: "Avançado",
};

/** Formações: número de DEF/MID/FWD no onze (o GR é sempre 1). */
export const FORMATIONS: Record<string, { DEF: number; MID: number; FWD: number }> = {
  "4-3-3": { DEF: 4, MID: 3, FWD: 3 },
  "4-4-2": { DEF: 4, MID: 4, FWD: 2 },
  "3-5-2": { DEF: 3, MID: 5, FWD: 2 },
  "3-4-3": { DEF: 3, MID: 4, FWD: 3 },
  "4-2-3-1": { DEF: 4, MID: 5, FWD: 1 },
  "5-3-2": { DEF: 5, MID: 3, FWD: 2 },
};
export const FORMATION_KEYS = Object.keys(FORMATIONS);

const posRecord = (n: z.ZodNumber) => z.object({ GK: n, DEF: n, MID: n, FWD: n });

// ─────────────────────────── Definições da liga ───────────────────────────

export const leagueSettingsSchema = z.object({
  roster: posRecord(z.number().int().min(0).max(10)),
  draft: z.object({
    pickSeconds: z.number().int().min(15).max(600),
  }),
  lineupLock: z.enum(["ROUND", "PER_FIXTURE"]),
  autoSubs: z.boolean(),
  format: z.enum(["POINTS", "H2H", "HYBRID"]),
  playoffs: z.object({ enabled: z.boolean(), teams: z.literal(4) }),
  trades: z.object({
    approval: z.enum(["FREE", "COMMISSIONER", "VOTE"]),
    expiryHours: z.number().int().min(1).max(168),
    reviewHours: z.number().int().min(1).max(96),
    vetoThreshold: z.number().min(0.1).max(1),
    flagImbalanced: z.boolean(),
    imbalanceThreshold: z.number().min(0.1).max(0.9),
    cooldownDays: z.number().int().min(0).max(30),
    deadlineRoundOrder: z.number().int().nullable(),
  }),
  waivers: z.object({
    enabled: z.boolean(),
    waiverHours: z.number().int().min(0).max(120),
  }),
});
export type LeagueSettings = z.infer<typeof leagueSettingsSchema>;

export const DEFAULT_SETTINGS: LeagueSettings = {
  roster: { GK: 2, DEF: 5, MID: 5, FWD: 3 },
  draft: { pickSeconds: 90 },
  lineupLock: "PER_FIXTURE",
  autoSubs: true,
  format: "HYBRID",
  playoffs: { enabled: true, teams: 4 },
  trades: {
    approval: "VOTE",
    expiryHours: 48,
    reviewHours: 24,
    vetoThreshold: 0.5,
    flagImbalanced: true,
    imbalanceThreshold: 0.35,
    cooldownDays: 7,
    deadlineRoundOrder: null,
  },
  waivers: { enabled: true, waiverHours: 48 },
};

export function rosterSize(s: LeagueSettings) {
  return s.roster.GK + s.roster.DEF + s.roster.MID + s.roster.FWD;
}

// ─────────────────────────── Regras de pontuação ───────────────────────────

export const scoringRulesSchema = z.object({
  goal: posRecord(z.number()),
  assist: z.number(),
  secondaryAssist: z.number(),
  bigChanceCreated: z.number(),
  shotOnTarget: z.number(),
  hitWoodwork: z.number(),
  dribble: z.number(),
  penaltyWon: z.number(),
  penaltyMissed: z.number(),
  offside: z.number(),

  cleanSheet: posRecord(z.number()),
  goalsConcededPer2: posRecord(z.number()),
  interception: z.number(),
  tackle: z.number(),
  clearance: z.number(),
  blockedShot: z.number(),
  recovery: z.number(),
  duelWon: z.number(),
  save: z.number(),
  penaltySaved: z.number(),

  played60: z.number(),
  playedUnder60: z.number(),
  mvp: z.number(),
  rating8: z.number(),
  rating9: z.number(),
  hatTrick: z.number(),
  doubleDouble: z.number(),
  doubleDoubleThreshold: z.number().int().min(2).max(20),
  keyPass: z.number(),
  yellowCard: z.number(),
  redCard: z.number(),
  ownGoal: z.number(),
  errorLeadingToGoal: z.number(),
  errorLeadingToShot: z.number(),
  penaltyCommitted: z.number(),

  /** Tetos por jogo para ações de volume (evita inflação por acumulação). 0 = sem teto. */
  caps: z.object({ defensive: z.number().min(0), creative: z.number().min(0) }),
  /** Normalização por posição: multiplicador aplicado aos grupos de ações de volume. */
  positionMultipliers: z.object({
    defensive: posRecord(z.number().min(0).max(3)),
    creative: posRecord(z.number().min(0).max(3)),
  }),
});
export type ScoringRules = z.infer<typeof scoringRulesSchema>;

export const DEFAULT_SCORING: ScoringRules = {
  goal: { GK: 10, DEF: 6, MID: 5, FWD: 4 },
  assist: 3,
  secondaryAssist: 1,
  bigChanceCreated: 1,
  shotOnTarget: 1,
  hitWoodwork: 1,
  dribble: 0.5,
  penaltyWon: 2,
  penaltyMissed: -2,
  offside: -0.25,

  cleanSheet: { GK: 4, DEF: 4, MID: 1, FWD: 0 },
  goalsConcededPer2: { GK: 0, DEF: 0, MID: 0, FWD: 0 },
  interception: 0.5,
  tackle: 0.5,
  clearance: 0.25,
  blockedShot: 0.5,
  recovery: 0.2,
  duelWon: 0.2,
  save: 1,
  penaltySaved: 5,

  played60: 2,
  playedUnder60: 1,
  mvp: 3,
  rating8: 2,
  rating9: 3,
  hatTrick: 3,
  doubleDouble: 2,
  doubleDoubleThreshold: 5,
  keyPass: 0.5,
  yellowCard: -1,
  redCard: -3,
  ownGoal: -2,
  errorLeadingToGoal: -2,
  errorLeadingToShot: -1,
  penaltyCommitted: -2,

  caps: { defensive: 10, creative: 8 },
  positionMultipliers: {
    defensive: { GK: 1, DEF: 1, MID: 1, FWD: 1 },
    creative: { GK: 1, DEF: 1, MID: 1, FWD: 1 },
  },
};

/** Etiquetas para a UI e para o detalhe da pontuação. */
export const SCORING_LABELS: Record<string, string> = {
  goal: "Golo",
  assist: "Assistência",
  secondaryAssist: "Assistência secundária",
  bigChanceCreated: "Grande oportunidade criada",
  shotOnTarget: "Remate enquadrado",
  hitWoodwork: "Bola no poste/trave",
  dribble: "Drible bem-sucedido",
  penaltyWon: "Penálti conquistado",
  penaltyMissed: "Penálti falhado",
  offside: "Fora de jogo",
  cleanSheet: "Clean sheet",
  goalsConcededPer2: "Por cada 2 golos sofridos",
  interception: "Interceção",
  tackle: "Desarme",
  clearance: "Corte",
  blockedShot: "Remate bloqueado",
  recovery: "Recuperação de bola",
  duelWon: "Duelo ganho (líquido)",
  save: "Defesa",
  penaltySaved: "Penálti defendido",
  played60: "60+ minutos",
  playedUnder60: "Menos de 60 minutos",
  mvp: "MVP oficial",
  rating8: "Nota ≥ 8",
  rating9: "Nota ≥ 9",
  hatTrick: "Hat-trick",
  doubleDouble: "Duplo-duplo",
  keyPass: "Passe decisivo",
  yellowCard: "Cartão amarelo",
  redCard: "Cartão vermelho",
  ownGoal: "Autogolo",
  errorLeadingToGoal: "Erro → golo",
  errorLeadingToShot: "Erro → remate",
  penaltyCommitted: "Penálti cometido",
  defensiveCap: "Teto de ações defensivas",
  creativeCap: "Teto de ações criativas",
};
