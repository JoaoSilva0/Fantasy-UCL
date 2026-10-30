/**
 * Calendário head-to-head (método do círculo). Com número ímpar de equipas é adicionado um "bye".
 * Devolve, para cada jornada, a lista de pares. Repete o ciclo se houver mais jornadas do que n-1.
 */
export function roundRobin(teamIds: string[], rounds: number): [string | null, string | null][][] {
  const ids: (string | null)[] = [...teamIds];
  if (ids.length % 2 === 1) ids.push(null);
  const n = ids.length;
  if (n < 2) return [];
  const out: [string | null, string | null][][] = [];
  let arr = [...ids];
  for (let r = 0; r < rounds; r++) {
    const pairs: [string | null, string | null][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    out.push(pairs);
    arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];
  }
  return out;
}

export interface StandingRow {
  teamId: string;
  points: number; // pontos fantasy totais
  w: number;
  d: number;
  l: number;
  bonus: number;
  tablePoints: number;
}

/** Ordenação: pontos de tabela (H2H/híbrido) e, em empate, pontos fantasy. */
export function sortStandings(rows: StandingRow[], format: "POINTS" | "H2H" | "HYBRID") {
  return [...rows].sort((a, b) =>
    format === "POINTS" ? b.points - a.points : b.tablePoints - a.tablePoints || b.points - a.points,
  );
}
