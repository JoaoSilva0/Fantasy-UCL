import { createHash } from "crypto";
import type { Pos } from "@/lib/fantasy/config";
import { emptyStats, type MatchStats } from "@/lib/fantasy/scoring";
import { roundRobin } from "@/lib/fantasy/schedule";
import type { ClubData, FixtureData, FixtureDetail, MatchEvent, PlayerData, RoundData } from "./types";

/**
 * MODO DEMO — dados 100% FICTÍCIOS.
 * Clubes e jogadores inventados (nenhum corresponde a um clube/jogador real) para permitir testar
 * draft, plantéis, trades e pontuação sem API key. Tudo é rotulado "DEMO" / "SIMULADO" na interface.
 */

const CLUBS: [string, string, string][] = [
  ["Aurora FC", "Aurora", "AUR"], ["Montalto CF", "Montalto", "MON"], ["Vale Azul SC", "Vale Azul", "VAZ"],
  ["Nordheim 1899", "Nordheim", "NOR"], ["Real Castelar", "Castelar", "CAS"], ["Lucerna Nova AC", "Lucerna", "LUC"],
  ["Olympique Varenne", "Varenne", "VAR"], ["Kestrel Athletic", "Kestrel", "KES"], ["Silberbach SV", "Silberbach", "SIL"],
  ["Marinha Atlético", "Marinha", "MAR"], ["Harrowgate Rovers", "Harrowgate", "HAR"], ["Valdoria Calcio", "Valdoria", "VAL"],
];
const FIRST = ["Tiago", "Lukas", "Mateo", "Noah", "Elias", "Rafael", "Jonas", "Iker", "Milan", "Oscar", "Leon", "Ivo", "Hugo", "Tomás", "Emil", "Bruno", "Kenan", "Aleix", "Sander", "Nuno", "Dario", "Felix", "Yanis", "Marek", "Otto", "Caio", "Teo", "Viktor", "Enzo", "Pavel", "Samir", "Gael"];
const LAST = ["Varela", "Brandt", "Okafor", "Lindqvist", "Moreau", "Castañeda", "Duarte", "Novak", "Halvorsen", "Ferrand", "Akintola", "Rossetti", "Kowalczyk", "Vasconcelos", "Thorsen", "Belmonte", "Ibarra", "Kranjc", "Delacroix", "Montiel", "Sørli", "Abernethy", "Quaresmo", "Valente", "Strand", "Mbeki", "Oliveto", "Grünfeld", "Tavernier", "Arrieta", "Lindahl", "Paixão"];
const NATIONS = ["Portugal", "Espanha", "França", "Alemanha", "Itália", "Inglaterra", "Países Baixos", "Brasil", "Argentina", "Bélgica", "Croácia", "Noruega", "Dinamarca", "Nigéria", "Senegal", "Uruguai"];
const SQUAD: [Pos, number][] = [["GK", 3], ["DEF", 8], ["MID", 8], ["FWD", 5]];

export const DEMO_SEASON_ID = "demo:2026";

function rng(seed: string) {
  let a = createHash("sha256").update(seed).digest().readUInt32BE(0);
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const poisson = (r: () => number, l: number) => { let k = 0, p = 1; const L = Math.exp(-l); do { k++; p *= r(); } while (p > L); return k - 1; };
const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];
const weighted = <T,>(r: () => number, items: T[], w: (x: T) => number) => {
  const total = items.reduce((s, x) => s + w(x), 0);
  let v = r() * total;
  for (const x of items) { v -= w(x); if (v <= 0) return x; }
  return items[items.length - 1];
};

export function demoClubs(): ClubData[] {
  return CLUBS.map(([name, short, code], i) => ({ externalId: `demo-club-${i + 1}`, name: `${name}`, shortName: short, code, logoUrl: null, country: "DEMO" }));
}

export function demoPlayers(): PlayerData[] {
  const r = rng("demo-players");
  const used = new Set<string>();
  const out: PlayerData[] = [];
  demoClubs().forEach((club, ci) => {
    let shirt = 1;
    for (const [pos, n] of SQUAD) {
      for (let k = 0; k < n; k++) {
        let first = "", last = "";
        do { first = pick(r, FIRST); last = pick(r, LAST); } while (used.has(first + last));
        used.add(first + last);
        const age = 18 + Math.floor(r() * 17);
        out.push({
          externalId: `demo-p-${ci + 1}-${out.length + 1}`, clubExternalId: club.externalId, name: `${first} ${last}`,
          firstName: first, lastName: last, photoUrl: null, nationality: pick(r, NATIONS), position: pos, age,
          birthDate: null, shirtNumber: shirt++,
        });
      }
    }
  });
  return out;
}

/** Jornadas da época DEMO: 8 da fase de liga + quartos (2 mãos) + meias (2 mãos) + final. */
export function demoRounds(): RoundData[] {
  const rounds: RoundData[] = Array.from({ length: 8 }, (_, i) => ({ key: `LP-${i + 1}`, name: `Fase de Liga · Jornada ${i + 1}`, stage: "LEAGUE_PHASE" as const, order: i + 1 }));
  rounds.push(
    { key: "QF#1", name: "Quartos · 1.ª mão", stage: "QF", order: 9 },
    { key: "QF#2", name: "Quartos · 2.ª mão", stage: "QF", order: 10 },
    { key: "SF#1", name: "Meias-finais · 1.ª mão", stage: "SF", order: 11 },
    { key: "SF#2", name: "Meias-finais · 2.ª mão", stage: "SF", order: 12 },
    { key: "F", name: "Final", stage: "FINAL", order: 13 },
  );
  return rounds;
}

/** Data base de cada jornada: semanal, a partir de amanhã às 17:45 UTC. */
export function demoRoundDate(order: number, from = new Date()) {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + 1 + (order - 1) * 7);
  d.setUTCHours(17, 45, 0, 0);
  return d;
}

export function demoLeaguePhaseFixtures(from = new Date()): FixtureData[] {
  const clubs = demoClubs().map((c) => c.externalId);
  const rr = roundRobin(clubs, 8);
  return rr.flatMap((pairs, i) =>
    pairs.map(([h, a], j) => {
      const kickoff = demoRoundDate(i + 1, from);
      if (j >= 3) kickoff.setUTCDate(kickoff.getUTCDate() + 1);
      if (j % 3 === 2) kickoff.setUTCHours(20, 0);
      return {
        externalId: `demo-fx-LP${i + 1}-${j + 1}`, roundKey: `LP-${i + 1}`, homeExternalId: h!, awayExternalId: a!, kickoff,
        status: "SCHEDULED" as const, statusDetail: null, minute: null, homeGoals: null, awayGoals: null,
      };
    }),
  );
}

interface SimPlayer { externalId: string; name: string; position: Pos; clubExternalId: string }

/**
 * Simula um jogo DEMO. A simulação é determinística por jogo (semente = id do jogo) e
 * gera uma linha temporal; `atMinute` permite obter o estado "ao vivo" a meio do jogo.
 */
export function simulateDemoFixture(fx: FixtureData, squads: Map<string, SimPlayer[]>, atMinute = 90): FixtureDetail {
  const r = rng(`sim:${fx.externalId}`);
  const strength = (club: string) => 0.75 + rng(`str:${club}`)() * 0.6;
  type Line = { p: SimPlayer; from: number; to: number; started: boolean; acts: Record<string, number[]> };
  const lines: Line[] = [];
  const events: MatchEvent[] = [];
  const minuteIn = (l: Line) => l.from + Math.floor(r() * Math.max(1, l.to - l.from));

  for (const club of [fx.homeExternalId, fx.awayExternalId]) {
    const squad = squads.get(club) ?? [];
    const by = (pos: Pos) => squad.filter((p) => p.position === pos);
    const starters = [...by("GK").slice(0, 1), ...by("DEF").slice(0, 8).sort(() => r() - 0.5).slice(0, 4), ...by("MID").slice(0, 8).sort(() => r() - 0.5).slice(0, 4), ...by("FWD").slice(0, 5).sort(() => r() - 0.5).slice(0, 2)];
    const startLines = starters.map((p) => ({ p, from: 0, to: 90, started: true, acts: {} as Record<string, number[]> }));
    const bench = squad.filter((p) => !starters.includes(p) && p.position !== "GK");
    for (let s = 0; s < 3 && bench.length; s++) {
      const outfield = startLines.filter((l) => l.p.position !== "GK" && l.to === 90);
      const out = pick(r, outfield);
      const sameRole = bench.filter((b) => b.position === out.p.position);
      const inn = (sameRole.length ? sameRole : bench).splice(0, 1)[0];
      bench.splice(bench.indexOf(inn), 1);
      const minute = 58 + Math.floor(r() * 26);
      out.to = minute;
      startLines.push({ p: inn, from: minute, to: 90, started: false, acts: {} });
      events.push({ minute, type: "SUB", clubExternalId: club, playerExternalId: inn.externalId, playerName: inn.name, assistExternalId: out.p.externalId, assistName: out.p.name });
    }
    lines.push(...startLines);
  }
  const ofClub = (c: string) => lines.filter((l) => l.p.clubExternalId === c);
  const act = (l: Line, k: string, m?: number) => (l.acts[k] ??= []).push(m ?? minuteIn(l));
  const W: Record<Pos, Record<string, number>> = {
    GK: { tackles: 0.05, interceptions: 0.3, clearances: 1.5, recoveries: 3, keyPasses: 0.05, dribblesSuccess: 0, blockedShots: 0, duelsWon: 1, offsides: 0, shotsOnTarget: 0 },
    DEF: { tackles: 1.8, interceptions: 1.5, clearances: 4, recoveries: 5, keyPasses: 0.5, dribblesSuccess: 0.4, blockedShots: 0.6, duelsWon: 5, offsides: 0.05, shotsOnTarget: 0.2 },
    MID: { tackles: 1.8, interceptions: 1.1, clearances: 1, recoveries: 6, keyPasses: 1.4, dribblesSuccess: 1.1, blockedShots: 0.3, duelsWon: 6, offsides: 0.15, shotsOnTarget: 0.5 },
    FWD: { tackles: 0.5, interceptions: 0.3, clearances: 0.3, recoveries: 2.5, keyPasses: 1, dribblesSuccess: 1.4, blockedShots: 0.1, duelsWon: 5, offsides: 0.9, shotsOnTarget: 0.9 },
  };
  for (const l of lines) {
    const share = (l.to - l.from) / 90;
    for (const [k, lambda] of Object.entries(W[l.p.position])) for (let i = poisson(r, lambda * share); i > 0; i--) act(l, k);
    if (r() < 0.12) act(l, "yellow");
    if (r() < 0.012) act(l, "red");
    if (r() < 0.02) act(l, "errorShot");
    if (r() < 0.005) act(l, "errorGoal");
  }
  for (const [club, opp] of [[fx.homeExternalId, fx.awayExternalId], [fx.awayExternalId, fx.homeExternalId]]) {
    const goals = poisson(r, 1.35 * (strength(club) / strength(opp)) * (club === fx.homeExternalId ? 1.1 : 0.95));
    const pool = ofClub(club).filter((l) => l.p.position !== "GK");
    for (let g = 0; g < goals; g++) {
      const scorer = weighted(r, pool, (l) => ({ GK: 0, DEF: 1, MID: 3, FWD: 6 })[l.p.position] * (l.to - l.from));
      const m = minuteIn(scorer);
      const pen = r() < 0.1;
      act(scorer, "goals", m); act(scorer, "shotsOnTarget", m);
      events.push({ minute: m, type: pen ? "PENALTY_GOAL" : "GOAL", clubExternalId: club, playerExternalId: scorer.p.externalId, playerName: scorer.p.name, assistExternalId: null, assistName: null });
      if (pen) { const w = pick(r, pool); act(w, "penaltiesWon", m); const c = pick(r, ofClub(opp).filter((l) => l.p.position !== "GK")); act(c, "penaltiesCommitted", m); }
      else if (r() < 0.72) {
        const onPitch = pool.filter((l) => l !== scorer && l.from <= m && l.to >= m);
        if (onPitch.length) {
          const a = weighted(r, onPitch, (l) => ({ GK: 0.1, DEF: 1.5, MID: 4, FWD: 2 })[l.p.position]);
          act(a, "assists", m); act(a, "bigChances", m);
          events[events.length - 1].assistExternalId = a.p.externalId; events[events.length - 1].assistName = a.p.name;
        }
      }
    }
    if (r() < 0.04) { const og = pick(r, ofClub(opp).filter((l) => l.p.position === "DEF")); if (og) { const m = minuteIn(og); act(og, "ownGoals", m); events.push({ minute: m, type: "OWN_GOAL", clubExternalId: opp, playerExternalId: og.p.externalId, playerName: og.p.name, assistExternalId: null, assistName: null }); } }
    for (const l of pool) if (r() < 0.06) act(l, "woodwork");
    for (const l of pool) if (r() < 0.25) act(l, "bigChances");
  }
  // Cartões como eventos
  for (const l of lines) {
    for (const m of l.acts.yellow ?? []) events.push({ minute: m, type: "YELLOW", clubExternalId: l.p.clubExternalId, playerExternalId: l.p.externalId, playerName: l.p.name, assistExternalId: null, assistName: null });
    for (const m of l.acts.red ?? []) events.push({ minute: m, type: "RED", clubExternalId: l.p.clubExternalId, playerExternalId: l.p.externalId, playerName: l.p.name, assistExternalId: null, assistName: null });
  }
  events.sort((a, b) => a.minute - b.minute);
  const visible = events.filter((e) => e.minute <= atMinute);
  const goalsFor = (club: string) => visible.filter((e) => ((e.type === "GOAL" || e.type === "PENALTY_GOAL") && e.clubExternalId === club) || (e.type === "OWN_GOAL" && e.clubExternalId !== club)).length;
  const concededMinutes = (club: string) => visible.filter((e) => ((e.type === "GOAL" || e.type === "PENALTY_GOAL") && e.clubExternalId !== club) || (e.type === "OWN_GOAL" && e.clubExternalId === club)).map((e) => e.minute);

  const players: FixtureDetail["players"] = [];
  for (const l of lines) {
    if (l.from > atMinute) continue;
    const to = Math.min(l.to, atMinute);
    const c = (k: string) => (l.acts[k] ?? []).filter((m) => m <= atMinute).length;
    const opp = l.p.clubExternalId === fx.homeExternalId ? fx.awayExternalId : fx.homeExternalId;
    const conceded = concededMinutes(l.p.clubExternalId).filter((m) => m >= l.from && m <= to).length;
    const oppShots = ofClub(opp).reduce((s, x) => s + (x.acts.shotsOnTarget ?? []).filter((m) => m <= atMinute && m >= l.from && m <= to).length, 0);
    const goals = c("goals");
    const stats: MatchStats = {
      ...emptyStats(),
      minutes: Math.max(1, to - l.from), started: l.started, goals, assists: c("assists"),
      secondaryAssists: null, bigChancesCreated: c("bigChances"), shotsTotal: c("shotsOnTarget") + Math.floor(r() * 2),
      shotsOnTarget: c("shotsOnTarget"), hitWoodwork: c("woodwork"), dribblesSuccess: c("dribblesSuccess"),
      penaltiesWon: c("penaltiesWon"), penaltiesMissed: 0, offsides: c("offsides"), interceptions: c("interceptions"),
      tackles: c("tackles"), clearances: c("clearances"), blockedShots: c("blockedShots"), recoveries: c("recoveries"),
      duelsWon: c("duelsWon") + c("tackles") + c("dribblesSuccess"),
      saves: l.p.position === "GK" ? Math.max(0, oppShots - conceded) : 0, penaltiesSaved: 0, keyPasses: c("keyPasses") + c("assists"),
      yellowCards: c("yellow"), redCards: c("red"), ownGoals: c("ownGoals"), errorsLeadingToGoal: c("errorGoal"),
      errorsLeadingToShot: c("errorShot"), penaltiesCommitted: c("penaltiesCommitted"), goalsConcededOnPitch: conceded, rating: null, isMvp: false,
    };
    const contribution = goals * 1.1 + stats.assists * 0.7 + (stats.tackles! + stats.interceptions!) * 0.08 + (stats.keyPasses! * 0.1) + (conceded === 0 && stats.minutes >= 60 && l.p.position !== "FWD" ? 0.5 : 0) - conceded * 0.15 - stats.redCards * 1.5 + (stats.saves! * 0.12);
    stats.rating = Math.round(Math.min(10, Math.max(4.5, 6.4 + contribution + (r() - 0.5) * 0.6)) * 10) / 10;
    players.push({ playerExternalId: l.p.externalId, clubExternalId: l.p.clubExternalId, name: l.p.name, photoUrl: null, position: l.p.position, stats, raw: { simulated: true } });
  }
  if (atMinute >= 90 && players.length) {
    const mvp = players.reduce((a, b) => ((b.stats.rating ?? 0) > (a.stats.rating ?? 0) ? b : a));
    for (const p of players) p.stats.isMvp = p === mvp;
  }
  const finished = atMinute >= 90;
  return {
    fixture: { ...fx, status: finished ? "FINISHED" : "LIVE", statusDetail: finished ? "Terminado (SIMULADO)" : `${atMinute}' (SIMULADO)`, minute: finished ? 90 : atMinute, homeGoals: goalsFor(fx.homeExternalId), awayGoals: goalsFor(fx.awayExternalId) },
    events: visible,
    players,
  };
}
