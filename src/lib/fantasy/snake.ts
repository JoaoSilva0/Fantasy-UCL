import { createHash, randomBytes } from "crypto";

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

export function newSeed() {
  return randomBytes(32).toString("hex");
}

export function seedHash(seed: string) {
  return createHash("sha256").update(seed).digest("hex");
}

/**
 * Fisher–Yates determinístico a partir de uma semente (commit–reveal):
 * qualquer participante pode verificar que a ordem publicada deriva da semente revelada.
 * O input é ordenado para que o resultado não dependa da ordem de leitura da BD.
 */
export function seededShuffle(ids: string[], seed: string): string[] {
  const out = [...ids].sort();
  let counter = 0;
  const rand = () => {
    const h = createHash("sha256").update(`${seed}:${counter++}`).digest();
    return h.readUInt32BE(0) / 0x1_0000_0000;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
