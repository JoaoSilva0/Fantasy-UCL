import { createHash } from "crypto";
import { type Pos, type ScoringRules, SCORING_LABELS } from "./config";

/**
 * Estatísticas normalizadas de um jogador num jogo.
 * `null` = o provider não fornece esta métrica (nunca é inventada nem pontuada).
 */
export interface MatchStats {
  minutes: number;
  started: boolean;
  goals: number;
  assists: number;
  secondaryAssists: number | null;
  bigChancesCreated: number | null;
  shotsTotal: number | null;
  shotsOnTarget: number | null;
  hitWoodwork: number | null;
  dribblesSuccess: number | null;
  penaltiesWon: number | null;
  penaltiesMissed: number | null;
  offsides: number | null;
  interceptions: number | null;
  tackles: number | null;
  clearances: number | null;
  blockedShots: number | null;
  recoveries: number | null;
  duelsWon: number | null;
  saves: number | null;
  penaltiesSaved: number | null;
  keyPasses: number | null;
  yellowCards: number;
  redCards: number;
  ownGoals: number | null;
  errorsLeadingToGoal: number | null;
  errorsLeadingToShot: number | null;
  penaltiesCommitted: number | null;
  /** Golos sofridos pela equipa enquanto o jogador esteve em campo. */
  goalsConcededOnPitch: number | null;
  rating: number | null;
  isMvp: boolean | null;
}

export const STAT_KEYS: (keyof MatchStats)[] = [
  "minutes", "started", "goals", "assists", "secondaryAssists", "bigChancesCreated", "shotsTotal",
  "shotsOnTarget", "hitWoodwork", "dribblesSuccess", "penaltiesWon", "penaltiesMissed", "offsides",
  "interceptions", "tackles", "clearances", "blockedShots", "recoveries", "duelsWon", "saves",
  "penaltiesSaved", "keyPasses", "yellowCards", "redCards", "ownGoals", "errorsLeadingToGoal",
  "errorsLeadingToShot", "penaltiesCommitted", "goalsConcededOnPitch", "rating", "isMvp",
];

export interface BreakdownLine {
  key: string;
  label: string;
  count: number;
  points: number;
  group?: "defensive" | "creative";
}

export interface ScoreResult {
  total: number;
  lines: BreakdownLine[];
  /** Métricas que existem nas regras mas que o provider não fornece. */
  unavailable: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Motor de pontuação.
 *
 * Regras anti-duplicação (cada ação real só é recompensada uma vez):
 *  - Remates enquadrados excluem os que resultaram em golo (o golo já é pontuado).
 *  - Grandes oportunidades criadas excluem as que resultaram em assistência.
 *  - Passes decisivos excluem assistências e grandes oportunidades já pontuadas.
 *  - Duelos ganhos são contados líquidos de desarmes e dribles (que já são duelos).
 *  - Defesas excluem penáltis defendidos (pontuados à parte).
 *  - Segundo amarelo → apenas o vermelho conta.
 *  - Notas ≥ 8 e ≥ 9 não são cumulativas.
 * Normalização: ações de volume são agrupadas (defensivas / criativas), multiplicadas pelo fator
 * da posição e limitadas por um teto por jogo.
 */
export function scorePlayer(stats: MatchStats, pos: Pos, rules: ScoringRules): ScoreResult {
  const lines: BreakdownLine[] = [];
  const unavailable: string[] = [];
  if (!stats.minutes || stats.minutes <= 0) return { total: 0, lines, unavailable };

  const add = (key: string, count: number, per: number, group?: BreakdownLine["group"]) => {
    if (!count || !per) return;
    lines.push({ key, label: SCORING_LABELS[key] ?? key, count, points: r2(count * per), group });
  };
  const val = (key: string, v: number | null | undefined): number => {
    if (v === null || v === undefined) {
      unavailable.push(key);
      return 0;
    }
    return v;
  };

  // Participação
  if (stats.minutes >= 60) add("played60", 1, rules.played60);
  else add("playedUnder60", 1, rules.playedUnder60);

  // Ofensiva
  add("goal", stats.goals, rules.goal[pos]);
  add("assist", stats.assists, rules.assist);
  add("secondaryAssist", val("secondaryAssist", stats.secondaryAssists), rules.secondaryAssist);
  if (stats.goals >= 3) add("hatTrick", 1, rules.hatTrick);
  add("penaltyWon", val("penaltyWon", stats.penaltiesWon), rules.penaltyWon);
  add("penaltyMissed", val("penaltyMissed", stats.penaltiesMissed), rules.penaltyMissed);
  add("offside", val("offside", stats.offsides), rules.offside);

  // Criativas (volume)
  const bigChancesNet = Math.max(0, val("bigChanceCreated", stats.bigChancesCreated) - stats.assists);
  const shotsOnTargetNet = Math.max(0, val("shotOnTarget", stats.shotsOnTarget) - stats.goals);
  const keyPassesNet = Math.max(0, val("keyPass", stats.keyPasses) - stats.assists - bigChancesNet);
  const cm = rules.positionMultipliers.creative[pos];
  add("shotOnTarget", shotsOnTargetNet, rules.shotOnTarget * cm, "creative");
  add("hitWoodwork", val("hitWoodwork", stats.hitWoodwork), rules.hitWoodwork * cm, "creative");
  add("dribble", val("dribble", stats.dribblesSuccess), rules.dribble * cm, "creative");
  add("bigChanceCreated", bigChancesNet, rules.bigChanceCreated * cm, "creative");
  add("keyPass", keyPassesNet, rules.keyPass * cm, "creative");

  // Defensivas (volume)
  const dm = rules.positionMultipliers.defensive[pos];
  const tackles = val("tackle", stats.tackles);
  const dribbles = stats.dribblesSuccess ?? 0;
  const duelsNet = Math.max(0, val("duelWon", stats.duelsWon) - tackles - dribbles);
  add("interception", val("interception", stats.interceptions), rules.interception * dm, "defensive");
  add("tackle", tackles, rules.tackle * dm, "defensive");
  add("clearance", val("clearance", stats.clearances), rules.clearance * dm, "defensive");
  add("blockedShot", val("blockedShot", stats.blockedShots), rules.blockedShot * dm, "defensive");
  add("recovery", val("recovery", stats.recoveries), rules.recovery * dm, "defensive");
  add("duelWon", duelsNet, rules.duelWon * dm, "defensive");

  applyCap(lines, "defensive", rules.caps.defensive, "defensiveCap");
  applyCap(lines, "creative", rules.caps.creative, "creativeCap");

  // Guarda-redes / baliza
  const penSaved = val("penaltySaved", stats.penaltiesSaved);
  add("penaltySaved", penSaved, rules.penaltySaved);
  if (pos === "GK") add("save", Math.max(0, val("save", stats.saves) - penSaved), rules.save);

  if (stats.goalsConcededOnPitch === null) unavailable.push("cleanSheet");
  else {
    if (stats.minutes >= 60 && stats.goalsConcededOnPitch === 0) add("cleanSheet", 1, rules.cleanSheet[pos]);
    add("goalsConcededPer2", Math.floor(stats.goalsConcededOnPitch / 2), rules.goalsConcededPer2[pos]);
  }

  // Desempenho
  if (stats.isMvp === null) unavailable.push("mvp");
  else if (stats.isMvp) add("mvp", 1, rules.mvp);
  if (stats.rating === null) unavailable.push("rating");
  else if (stats.rating >= 9) add("rating9", 1, rules.rating9);
  else if (stats.rating >= 8) add("rating8", 1, rules.rating8);

  const ddCategories = [
    stats.tackles, stats.interceptions, stats.clearances, stats.recoveries,
    stats.keyPasses, stats.dribblesSuccess, pos === "GK" ? stats.saves : null,
  ].filter((v) => (v ?? 0) >= rules.doubleDoubleThreshold).length;
  if (ddCategories >= 2) add("doubleDouble", 1, rules.doubleDouble);

  // Disciplina e erros
  if (stats.redCards > 0) add("redCard", 1, rules.redCard);
  else add("yellowCard", stats.yellowCards, rules.yellowCard);
  add("ownGoal", val("ownGoal", stats.ownGoals), rules.ownGoal);
  add("errorLeadingToGoal", val("errorLeadingToGoal", stats.errorsLeadingToGoal), rules.errorLeadingToGoal);
  add("errorLeadingToShot", val("errorLeadingToShot", stats.errorsLeadingToShot), rules.errorLeadingToShot);
  add("penaltyCommitted", val("penaltyCommitted", stats.penaltiesCommitted), rules.penaltyCommitted);

  const total = r2(lines.reduce((s, l) => s + l.points, 0));
  return { total, lines, unavailable: [...new Set(unavailable)] };
}

function applyCap(lines: BreakdownLine[], group: "defensive" | "creative", cap: number, key: string) {
  if (!cap) return;
  const sum = lines.filter((l) => l.group === group).reduce((s, l) => s + l.points, 0);
  if (sum > cap) lines.push({ key, label: SCORING_LABELS[key], count: 1, points: r2(cap - sum), group });
}

export function hashObject(o: unknown): string {
  return createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 32);
}

export function emptyStats(): MatchStats {
  return {
    minutes: 0, started: false, goals: 0, assists: 0, secondaryAssists: null, bigChancesCreated: null,
    shotsTotal: null, shotsOnTarget: null, hitWoodwork: null, dribblesSuccess: null, penaltiesWon: null,
    penaltiesMissed: null, offsides: null, interceptions: null, tackles: null, clearances: null,
    blockedShots: null, recoveries: null, duelsWon: null, saves: null, penaltiesSaved: null,
    keyPasses: null, yellowCards: 0, redCards: 0, ownGoals: null, errorsLeadingToGoal: null,
    errorsLeadingToShot: null, penaltiesCommitted: null, goalsConcededOnPitch: null, rating: null,
    isMvp: null,
  };
}
