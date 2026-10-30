/** Equipa que escolhe numa escolha global (1-based) num snake draft. */
export function teamForPick(order: string[], overall: number) {
  const n = order.length;
  const round = Math.ceil(overall / n);
  const idx = (overall - 1) % n;
  const pickInRound = idx + 1;
  const teamId = round % 2 === 1 ? order[idx] : order[n - 1 - idx];
  return { round, pickInRound, teamId };
}

/** Todas as escolhas de um snake draft. */
export function snakeSchedule(order: string[], rounds: number) {
  return Array.from({ length: order.length * rounds }, (_, i) => ({
    overall: i + 1,
    ...teamForPick(order, i + 1),
  }));
}
