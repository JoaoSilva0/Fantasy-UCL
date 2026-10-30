import { prisma, type Tx } from "../db";

export const STAGE_LABEL: Record<string, string> = {
  LEAGUE_PHASE: "Fase de Liga",
  PLAYOFF: "Play-off de acesso aos oitavos",
  R16: "Oitavos de final",
  QF: "Quartos de final",
  SF: "Meias-finais",
  FINAL: "Final",
};

/** Jornada atual = primeira jornada ainda não fechada (ou a última, se a época terminou). */
export async function currentRound(seasonId: string, db: Tx = prisma) {
  const open = await db.round.findFirst({ where: { seasonId, finalizedAt: null }, orderBy: { order: "asc" } });
  return open ?? (await db.round.findFirst({ where: { seasonId }, orderBy: { order: "desc" } }));
}

export async function lastFinalizedRound(seasonId: string, db: Tx = prisma) {
  return db.round.findFirst({ where: { seasonId, finalizedAt: { not: null } }, orderBy: { order: "desc" } });
}

/** Estado de bloqueio de uma jornada: início e clubes cujo jogo já começou. */
export async function roundLockState(roundId: string, db: Tx = prisma, now = new Date()) {
  const fixtures = await db.fixture.findMany({
    where: { roundId },
    select: { homeClubId: true, awayClubId: true, kickoff: true, status: true },
  });
  const active = fixtures.filter((f) => f.status !== "POSTPONED" && f.status !== "CANCELLED");
  const firstKickoff = active.length ? new Date(Math.min(...active.map((f) => f.kickoff.getTime()))) : null;
  const startedClubs = new Set<string>();
  const finishedClubs = new Set<string>();
  const clubsWithFixture = new Set<string>();
  for (const f of active) {
    clubsWithFixture.add(f.homeClubId).add(f.awayClubId);
    if (f.kickoff <= now || f.status !== "SCHEDULED") startedClubs.add(f.homeClubId).add(f.awayClubId);
    if (f.status === "FINISHED") finishedClubs.add(f.homeClubId).add(f.awayClubId);
  }
  return {
    firstKickoff,
    started: !!firstKickoff && firstKickoff <= now,
    startedClubs,
    finishedClubs,
    clubsWithFixture,
    allFinished: active.length > 0 && active.every((f) => f.status === "FINISHED"),
  };
}

export type LockState = Awaited<ReturnType<typeof roundLockState>>;

/** Um jogador está bloqueado se o jogo do seu clube nesta jornada já começou. */
export function isClubLocked(lock: LockState, clubId: string, mode: "ROUND" | "PER_FIXTURE") {
  return mode === "ROUND" ? lock.started : lock.startedClubs.has(clubId);
}

/** Jornada em curso, se existir (para impedir mover jogadores cujo jogo já começou). */
export async function playerLockedNow(seasonId: string, clubId: string, db: Tx = prisma) {
  const r = await currentRound(seasonId, db);
  if (!r || r.finalizedAt) return false;
  const lock = await roundLockState(r.id, db);
  return lock.startedClubs.has(clubId);
}
