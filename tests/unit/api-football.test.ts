import { describe, expect, it } from "vitest";
import { buildRounds, mapRound, mapStatus, normalizeFixture } from "@/server/providers/api-football";

/**
 * Fixture de TESTE no formato documentado de GET /fixtures?id= (API-Football v3).
 * IDs e nomes são sintéticos — servem apenas para validar a normalização, não são dados reais.
 */
const stat = (o: Record<string, unknown> = {}) => ({
  games: { minutes: 90, position: "D", rating: "7.1", substitute: false },
  offsides: null, shots: { total: null, on: null }, goals: { total: null, conceded: 0, assists: null, saves: null },
  passes: { key: null }, tackles: { total: null, blocks: null, interceptions: null }, duels: { won: null },
  dribbles: { success: null }, cards: { yellow: 0, red: 0 }, penalty: { won: null, commited: null, scored: 0, missed: 0, saved: null },
  ...o,
});
const fixture = {
  fixture: { id: 9001, date: "2026-10-21T19:00:00+00:00", status: { short: "FT", long: "Match Finished", elapsed: 90 } },
  league: { round: "League Stage - 3" },
  teams: { home: { id: 1, name: "Home Test", logo: "" }, away: { id: 2, name: "Away Test", logo: "" } },
  goals: { home: 2, away: 1 },
  events: [
    { time: { elapsed: 10, extra: null }, team: { id: 1 }, player: { id: 101, name: "H Striker" }, assist: { id: 102, name: "H Mid" }, type: "Goal", detail: "Normal Goal" },
    { time: { elapsed: 70, extra: null }, team: { id: 1 }, player: { id: 201, name: "A Defender" }, assist: { id: null, name: null }, type: "Goal", detail: "Own Goal" },
    { time: { elapsed: 80, extra: null }, team: { id: 2 }, player: { id: 202, name: "A Striker" }, assist: { id: null, name: null }, type: "Goal", detail: "Normal Goal" },
    { time: { elapsed: 85, extra: null }, team: { id: 1 }, player: { id: 103, name: "H Def" }, assist: { id: null, name: null }, type: "Card", detail: "Yellow Card" },
  ],
  players: [
    { team: { id: 1 }, players: [
      { player: { id: 101, name: "H Striker", photo: null }, statistics: [stat({ games: { minutes: 90, position: "F", rating: "8.4", substitute: false }, goals: { total: 1, conceded: 0, assists: null, saves: null }, shots: { total: 3, on: 2 } })] },
      { player: { id: 103, name: "H Def", photo: null }, statistics: [stat({ games: { minutes: 75, position: "D", rating: "7.0", substitute: false }, tackles: { total: 4, blocks: 1, interceptions: 3 }, cards: { yellow: 1, red: 0 } })] },
      { player: { id: 104, name: "H Sub", photo: null }, statistics: [stat({ games: { minutes: 15, position: "D", rating: null, substitute: true } })] },
    ] },
    { team: { id: 2 }, players: [
      { player: { id: 201, name: "A Defender", photo: null }, statistics: [stat({ games: { minutes: 90, position: "D", rating: "6.0", substitute: false } })] },
      { player: { id: 299, name: "A Unused", photo: null }, statistics: [stat({ games: { minutes: null, position: "G", rating: null, substitute: true } })] },
    ] },
  ],
};

describe("adaptador API-Football", () => {
  const d = normalizeFixture(fixture as never, "League Stage - 3");
  const p = (id: string) => d.players.find((x) => x.playerExternalId === id)!;

  it("estado, resultado e eventos", () => {
    expect(d.fixture.status).toBe("FINISHED");
    expect(d.fixture.homeGoals).toBe(2);
    expect(d.events.map((e) => e.type)).toEqual(["GOAL", "OWN_GOAL", "GOAL", "YELLOW"]);
  });

  it("null da API → 0 para métricas suportadas; não suportadas ficam n/d", () => {
    expect(p("101").stats.goals).toBe(1);
    expect(p("101").stats.keyPasses).toBe(0);
    expect(p("101").stats.clearances).toBeNull();
    expect(p("101").stats.recoveries).toBeNull();
    expect(p("101").stats.rating).toBe(8.4);
    expect(p("103").stats.interceptions).toBe(3);
    expect(p("103").stats.blockedShots).toBe(1);
  });

  it("autogolo atribuído ao jogador certo (validado contra o resultado)", () => {
    expect(p("201").stats.ownGoals).toBe(1);
    expect(p("101").stats.ownGoals).toBe(0);
  });

  it("golos sofridos só enquanto o jogador esteve em campo", () => {
    expect(p("101").stats.goalsConcededOnPitch).toBe(1); // golo aos 80'
    expect(p("103").stats.goalsConcededOnPitch).toBe(0); // saiu aos 75' → clean sheet
    expect(p("104").stats.goalsConcededOnPitch).toBe(1); // entrou aos 75'
    expect(p("201").stats.goalsConcededOnPitch).toBe(2);
    expect(p("299").stats.minutes).toBe(0);
  });

  it("mapeamento de rondas e estados", () => {
    expect(mapRound("League Stage - 8")).toEqual({ stage: "LEAGUE_PHASE", matchday: 8 });
    expect(mapRound("Knockout Round Play-offs")?.stage).toBe("PLAYOFF");
    expect(mapRound("Round of 16")?.stage).toBe("R16");
    expect(mapRound("3rd Qualifying Round")).toBeNull();
    expect(mapRound("Play-offs")).toBeNull(); // play-off de qualificação (antes da fase de liga)
    expect(mapStatus("HT")).toBe("LIVE");
    expect(mapStatus("PEN")).toBe("FINISHED");
    expect(mapStatus("PST")).toBe("POSTPONED");
  });

  it("eliminatórias a duas mãos viram duas jornadas", () => {
    const f = (id: string, round: string, date: string) => ({ externalId: id, round, kickoff: new Date(date) });
    const { rounds, fixtureRound } = buildRounds([
      f("1", "League Stage - 1", "2026-09-16T19:00Z"), f("2", "League Stage - 1", "2026-09-17T19:00Z"),
      f("3", "Round of 16", "2027-03-03T20:00Z"), f("4", "Round of 16", "2027-03-04T20:00Z"),
      f("5", "Round of 16", "2027-03-10T20:00Z"), f("6", "Round of 16", "2027-03-11T20:00Z"),
      f("7", "1st Qualifying Round", "2026-07-08T19:00Z"),
    ]);
    expect(rounds.map((r) => r.name)).toEqual(["Fase de Liga · Jornada 1", "Oitavos · 1.ª mão", "Oitavos · 2.ª mão"]);
    expect(fixtureRound.get("5")).toBe("Round of 16#2");
    expect(fixtureRound.has("7")).toBe(false);
  });
});
