import { describe, expect, it } from "vitest";
import { DEFAULT_SCORING } from "@/lib/fantasy/config";
import { emptyStats, scorePlayer, type MatchStats } from "@/lib/fantasy/scoring";
import { seededShuffle, snakeSchedule, teamForPick } from "@/lib/fantasy/snake";
import { bestLineup, computeTeamScore, validateLineup } from "@/lib/fantasy/lineup";
import { analyzeTrade } from "@/lib/fantasy/trade-analyzer";
import { roundRobin } from "@/lib/fantasy/schedule";

/** Estatísticas completas (todas as métricas disponíveis, a zero). */
const full = (o: Partial<MatchStats>): MatchStats => ({
  ...emptyStats(),
  secondaryAssists: 0, bigChancesCreated: 0, shotsTotal: 0, shotsOnTarget: 0, hitWoodwork: 0,
  dribblesSuccess: 0, penaltiesWon: 0, penaltiesMissed: 0, offsides: 0, interceptions: 0, tackles: 0,
  clearances: 0, blockedShots: 0, recoveries: 0, duelsWon: 0, saves: 0, penaltiesSaved: 0, keyPasses: 0,
  ownGoals: 0, errorsLeadingToGoal: 0, errorsLeadingToShot: 0, penaltiesCommitted: 0,
  goalsConcededOnPitch: 0, rating: 7, isMvp: false, ...o,
});

describe("motor de pontuação", () => {
  it("defesa central dominante compete com avançado que marca 1 golo", () => {
    const cb = scorePlayer(full({ minutes: 90, clearances: 10, interceptions: 8, recoveries: 5 }), "DEF", DEFAULT_SCORING);
    const st = scorePlayer(full({ minutes: 90, goals: 1, shotsOnTarget: 1, goalsConcededOnPitch: 1 }), "FWD", DEFAULT_SCORING);
    // CB: 2 (60') + 4 (CS) + 2.5 + 4 + 1 + 2 (duplo-duplo) = 15.5 ; AV: 2 + 4 (golo) = 6 (remate enquadrado do golo não conta 2x)
    expect(cb.total).toBe(15.5);
    expect(st.total).toBe(6);
    expect(cb.total).toBeGreaterThan(st.total);
  });

  it("não duplica: remate do golo, assistência como passe decisivo, 2º amarelo", () => {
    const s = scorePlayer(
      full({ minutes: 90, goals: 1, shotsOnTarget: 3, assists: 1, keyPasses: 2, yellowCards: 1, redCards: 1, goalsConcededOnPitch: 2 }),
      "MID", DEFAULT_SCORING,
    );
    const by = Object.fromEntries(s.lines.map((l) => [l.key, l]));
    expect(by.shotOnTarget.count).toBe(2);
    expect(by.keyPass.count).toBe(1);
    expect(by.yellowCard).toBeUndefined();
    expect(by.redCard.points).toBe(-3);
  });

  it("notas 8 e 9 não acumulam; hat-trick dá bónus; GR pontua defesas sem contar penálti 2x", () => {
    const s = scorePlayer(full({ minutes: 90, goals: 3, rating: 9.4 }), "FWD", DEFAULT_SCORING);
    const keys = s.lines.map((l) => l.key);
    expect(keys).toContain("rating9");
    expect(keys).not.toContain("rating8");
    expect(keys).toContain("hatTrick");
    const gk = scorePlayer(full({ minutes: 90, saves: 6, penaltiesSaved: 1 }), "GK", DEFAULT_SCORING);
    const g = Object.fromEntries(gk.lines.map((l) => [l.key, l]));
    expect(g.save.count).toBe(5);
    expect(g.penaltySaved.points).toBe(5);
  });

  it("aplica teto às ações defensivas", () => {
    const s = scorePlayer(full({ minutes: 90, tackles: 15, interceptions: 15, goalsConcededOnPitch: 3 }), "DEF", DEFAULT_SCORING);
    const def = s.lines.filter((l) => l.group === "defensive").reduce((a, l) => a + l.points, 0);
    expect(def).toBeCloseTo(10);
  });

  it("métricas não fornecidas ficam n/d e não pontuam", () => {
    const s = scorePlayer({ ...emptyStats(), minutes: 70, goals: 1 }, "FWD", DEFAULT_SCORING);
    expect(s.total).toBe(6);
    expect(s.unavailable).toContain("clearance");
    expect(s.unavailable).toContain("cleanSheet");
  });

  it("0 minutos = 0 pontos", () => {
    expect(scorePlayer(full({ minutes: 0, goals: 0 }), "MID", DEFAULT_SCORING).total).toBe(0);
  });
});

describe("snake draft", () => {
  const order = ["A", "B", "C", "D", "E", "F"];
  it("inverte em rondas pares", () => {
    expect(snakeSchedule(order, 2).map((p) => p.teamId).join("")).toBe("ABCDEFFEDCBA");
    expect(teamForPick(order, 13)).toMatchObject({ round: 3, pickInRound: 1, teamId: "A" });
  });
  it("sorteio é determinístico para a mesma semente e é uma permutação", () => {
    const a = seededShuffle(order, "seed-1");
    expect(seededShuffle([...order].reverse(), "seed-1")).toEqual(a);
    expect([...a].sort()).toEqual(order);
  });
});

describe("onze e pontuação de equipa", () => {
  const roster = [
    { id: "gk1", position: "GK" as const }, { id: "gk2", position: "GK" as const },
    ...[1, 2, 3, 4, 5].map((i) => ({ id: `d${i}`, position: "DEF" as const })),
    ...[1, 2, 3, 4, 5].map((i) => ({ id: `m${i}`, position: "MID" as const })),
    ...[1, 2, 3].map((i) => ({ id: `f${i}`, position: "FWD" as const })),
  ];
  const lineup = {
    formation: "4-3-3",
    starters: ["gk1", "d1", "d2", "d3", "d4", "m1", "m2", "m3", "f1", "f2", "f3"],
    bench: ["m4", "d5", "m5", "gk2"],
    captainId: "f1",
    viceCaptainId: "m1",
  };

  it("valida formação", () => {
    expect(validateLineup(lineup, roster)).toEqual([]);
    expect(validateLineup({ ...lineup, formation: "4-4-2" }, roster).length).toBeGreaterThan(0);
  });

  it("substituição automática mantém formação válida e vice herda capitania", () => {
    const positions = new Map(roster.map((p) => [p.id, p.position]));
    const results = new Map(roster.map((p) => [p.id, { points: 5, minutes: 90, done: true }]));
    results.set("f1", { points: 0, minutes: 0, done: true });
    const s = computeTeamScore(lineup, positions, results, true);
    // f1 sai, entra m4 (4-4-2 válido). Vice (m1) ×2.
    expect(s.autoSubs).toEqual([{ out: "f1", in: "m4" }]);
    expect(s.captainApplied).toBe("m1");
    expect(s.points).toBe(60);
  });

  it("onze automático gera um onze válido", () => {
    const l = bestLineup(roster, () => 1)!;
    expect(validateLineup(l, roster)).toEqual([]);
  });
});

describe("trade analyzer e calendário", () => {
  it("sinaliza trade desequilibrada", () => {
    const star = { playerId: "s", name: "S", seasonAvg: 12, last5Avg: 14, games: 5 };
    const bench = { playerId: "b", name: "B", seasonAvg: 2, last5Avg: 1, games: 5 };
    const a = analyzeTrade([star], [bench], 0.35);
    expect(a.flagged).toBe(true);
    expect(a.winner).toBe("RECEIVER");
  });
  it("round robin: cada equipa joga com todas", () => {
    const rr = roundRobin(["A", "B", "C", "D"], 3);
    const seen = new Set(rr.flat().map(([a, b]) => [a, b].sort().join("")));
    expect(seen.size).toBe(6);
  });
});
