import { FORMATIONS, type Pos } from "./config";

export interface LineupInput {
  formation: string;
  starters: string[];
  bench: string[];
  captainId: string | null;
  viceCaptainId: string | null;
}

export interface RosterPlayer {
  id: string;
  position: Pos;
}

function countPositions(ids: string[], pos: Map<string, Pos>) {
  const c: Record<Pos, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const id of ids) {
    const p = pos.get(id);
    if (p) c[p]++;
  }
  return c;
}

export function formationMatches(formation: string, c: Record<Pos, number>) {
  const f = FORMATIONS[formation];
  return !!f && c.GK === 1 && c.DEF === f.DEF && c.MID === f.MID && c.FWD === f.FWD;
}

/** Devolve a formação compatível com uma composição, se existir. */
export function detectFormation(c: Record<Pos, number>): string | null {
  return Object.keys(FORMATIONS).find((f) => formationMatches(f, c)) ?? null;
}

/** Validação completa do onze. Devolve lista de erros (vazia = válido). */
export function validateLineup(l: LineupInput, roster: RosterPlayer[]): string[] {
  const errors: string[] = [];
  const pos = new Map(roster.map((p) => [p.id, p.position]));
  if (!FORMATIONS[l.formation]) errors.push("Formação inválida.");
  if (l.starters.length !== 11) errors.push("O onze tem de ter exatamente 11 jogadores.");
  const all = [...l.starters, ...l.bench];
  if (new Set(all).size !== all.length) errors.push("Jogador repetido no onze/banco.");
  for (const id of all) if (!pos.has(id)) errors.push("Jogador que não pertence ao plantel.");
  const c = countPositions(l.starters, pos);
  if (FORMATIONS[l.formation] && l.starters.length === 11 && !formationMatches(l.formation, c)) {
    const f = FORMATIONS[l.formation];
    errors.push(
      `A formação ${l.formation} exige 1 GR, ${f.DEF} DEF, ${f.MID} MED e ${f.FWD} AV (tens ${c.GK}/${c.DEF}/${c.MID}/${c.FWD}).`,
    );
  }
  if (!l.captainId || !l.starters.includes(l.captainId)) errors.push("O capitão tem de ser titular.");
  if (!l.viceCaptainId || !l.starters.includes(l.viceCaptainId))
    errors.push("O vice-capitão tem de ser titular.");
  if (l.captainId && l.captainId === l.viceCaptainId) errors.push("Capitão e vice têm de ser diferentes.");
  return [...new Set(errors)];
}

/**
 * Onze automático: escolhe a formação que maximiza o valor (ex: média de pontos).
 * Usado após o draft e quando um participante não definiu onze.
 */
export function bestLineup(roster: RosterPlayer[], value: (id: string) => number): LineupInput | null {
  const byPos: Record<Pos, RosterPlayer[]> = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const p of roster) byPos[p.position].push(p);
  for (const k of Object.keys(byPos) as Pos[]) byPos[k].sort((a, b) => value(b.id) - value(a.id));
  let best: { score: number; l: LineupInput } | null = null;
  for (const [formation, f] of Object.entries(FORMATIONS)) {
    if (byPos.GK.length < 1 || byPos.DEF.length < f.DEF || byPos.MID.length < f.MID || byPos.FWD.length < f.FWD)
      continue;
    const starters = [
      byPos.GK[0], ...byPos.DEF.slice(0, f.DEF), ...byPos.MID.slice(0, f.MID), ...byPos.FWD.slice(0, f.FWD),
    ];
    const score = starters.reduce((s, p) => s + value(p.id), 0);
    if (!best || score > best.score) {
      const ids = new Set(starters.map((p) => p.id));
      // Capitão: mais valor; em empate (ex: sem dados), prefere avançados > médios > defesas > GR.
      const rank = { FWD: 0, MID: 1, DEF: 2, GK: 3 };
      const sorted = [...starters].sort((a, b) => value(b.id) - value(a.id) || rank[a.position] - rank[b.position]);
      const benchPlayers = roster.filter((p) => !ids.has(p.id));
      // Banco: GR suplente no fim; restantes por valor.
      benchPlayers.sort((a, b) =>
        a.position === "GK" ? 1 : b.position === "GK" ? -1 : value(b.id) - value(a.id),
      );
      best = {
        score,
        l: {
          formation,
          starters: starters.map((p) => p.id),
          bench: benchPlayers.map((p) => p.id),
          captainId: sorted[0]?.id ?? null,
          viceCaptainId: sorted[1]?.id ?? null,
        },
      };
    }
  }
  return best?.l ?? null;
}

export interface PlayerRoundResult {
  points: number;
  minutes: number;
  /** true quando todos os jogos do jogador nesta jornada terminaram (ou não tem jogo). */
  done: boolean;
}

export interface TeamScoreDetail {
  points: number;
  players: { playerId: string; points: number; multiplier: number; subbedIn: boolean }[];
  autoSubs: { out: string; in: string }[];
  captainApplied: string | null;
}

/** Pontuação de uma equipa numa jornada: substituições automáticas + capitão/vice. */
export function computeTeamScore(
  l: LineupInput,
  positions: Map<string, Pos>,
  results: Map<string, PlayerRoundResult>,
  autoSubs: boolean,
): TeamScoreDetail {
  const r = (id: string) => results.get(id) ?? { points: 0, minutes: 0, done: false };
  let starters = [...l.starters];
  const subs: { out: string; in: string }[] = [];

  if (autoSubs) {
    const used = new Set<string>();
    for (const out of l.starters) {
      const ro = r(out);
      if (ro.minutes > 0 || !ro.done) continue;
      for (const cand of l.bench) {
        if (used.has(cand) || r(cand).minutes <= 0) continue;
        const outPos = positions.get(out);
        const candPos = positions.get(cand);
        if ((outPos === "GK") !== (candPos === "GK")) continue;
        const next = starters.map((s) => (s === out ? cand : s));
        if (!detectFormation(countPositions(next, positions))) continue;
        starters = next;
        used.add(cand);
        subs.push({ out, in: cand });
        break;
      }
    }
  }

  let captainApplied: string | null = null;
  const cap = l.captainId;
  const vice = l.viceCaptainId;
  if (cap && starters.includes(cap) && r(cap).minutes > 0) captainApplied = cap;
  else if (cap && r(cap).done && vice && starters.includes(vice) && r(vice).minutes > 0) captainApplied = vice;

  const subbedIn = new Set(subs.map((s) => s.in));
  const players = starters.map((id) => {
    const multiplier = id === captainApplied ? 2 : 1;
    return { playerId: id, points: Math.round(r(id).points * multiplier * 100) / 100, multiplier, subbedIn: subbedIn.has(id) };
  });
  const points = Math.round(players.reduce((s, p) => s + p.points, 0) * 100) / 100;
  return { points, players, autoSubs: subs, captainApplied };
}
