/**
 * Analisador de trades. O "valor" de um jogador baseia-se exclusivamente em pontos reais:
 *   valor = 0.6 × média das últimas 5 jornadas + 0.4 × média da época (por jogo disputado).
 * Não é uma previsão: é uma medida de forma recente + consistência, sempre rotulada como estimativa.
 */
export interface PlayerValueInput {
  playerId: string;
  name: string;
  seasonAvg: number;
  last5Avg: number;
  games: number;
}

export function playerValue(p: PlayerValueInput) {
  if (p.games === 0) return 0;
  return Math.round((0.6 * p.last5Avg + 0.4 * p.seasonAvg) * 100) / 100;
}

export interface TradeAnalysis {
  proposerGives: number;
  receiverGives: number;
  /** Fração do valor total que cada lado recebe (0–1). */
  proposerShare: number;
  receiverShare: number;
  fairness: "EQUILIBRADA" | "LIGEIRAMENTE_DESEQUILIBRADA" | "DESEQUILIBRADA";
  winner: "PROPOSER" | "RECEIVER" | null;
  flagged: boolean;
  notes: string[];
}

export function analyzeTrade(
  proposerGives: PlayerValueInput[],
  receiverGives: PlayerValueInput[],
  imbalanceThreshold: number,
): TradeAnalysis {
  const a = proposerGives.reduce((s, p) => s + playerValue(p), 0);
  const b = receiverGives.reduce((s, p) => s + playerValue(p), 0);
  const total = a + b;
  // O proponente recebe o que o recetor dá.
  const proposerShare = total > 0 ? b / total : 0.5;
  const receiverShare = 1 - proposerShare;
  const minShare = Math.min(proposerShare, receiverShare);
  const notes: string[] = [];
  const fairness =
    minShare >= 0.42 ? "EQUILIBRADA" : minShare >= imbalanceThreshold ? "LIGEIRAMENTE_DESEQUILIBRADA" : "DESEQUILIBRADA";
  const winner = Math.abs(a - b) < 0.5 ? null : b > a ? "PROPOSER" : "RECEIVER";
  const noData = [...proposerGives, ...receiverGives].filter((p) => p.games === 0);
  if (noData.length)
    notes.push(`Sem jogos disputados para: ${noData.map((p) => p.name).join(", ")} — valor 0 por falta de dados.`);
  if (proposerGives.length !== receiverGives.length)
    notes.push(`Troca ${proposerGives.length}×${receiverGives.length}: verifica o impacto na profundidade do plantel.`);
  return {
    proposerGives: Math.round(a * 100) / 100,
    receiverGives: Math.round(b * 100) / 100,
    proposerShare: Math.round(proposerShare * 1000) / 1000,
    receiverShare: Math.round(receiverShare * 1000) / 1000,
    fairness,
    winner,
    flagged: fairness === "DESEQUILIBRADA" && total > 0,
    notes,
  };
}
