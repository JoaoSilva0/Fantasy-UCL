import { createHash, randomBytes } from "crypto";

export { snakeSchedule, teamForPick } from "./snake-order";

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
