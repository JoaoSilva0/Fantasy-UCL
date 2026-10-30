import { prisma, type Tx } from "../db";
import { UserError } from "../errors";
import { bestLineup, validateLineup, type LineupInput, type RosterPlayer } from "@/lib/fantasy/lineup";
import type { LeagueSettings } from "@/lib/fantasy/config";
import { playerForm } from "./form";
import { isClubLocked, roundLockState } from "./rounds";

async function rosterOf(teamId: string, db: Tx) {
  const entries = await db.rosterEntry.findMany({
    where: { teamId },
    include: { player: { select: { id: true, position: true, clubId: true } } },
  });
  return entries.map((e) => e.player);
}

/**
 * Onze para (equipa, jornada). Se não existir: herda o da jornada anterior (reparado) ou
 * gera o melhor onze possível pela forma real dos jogadores.
 */
export async function getOrCreateLineup(teamId: string, roundId: string, leagueId: string, db: Tx = prisma) {
  const existing = await db.lineup.findUnique({ where: { teamId_roundId: { teamId, roundId } } });
  if (existing) return existing;
  const roster = await rosterOf(teamId, db);
  if (roster.length === 0) return null;
  const prev = await db.lineup.findFirst({ where: { teamId }, orderBy: { round: { order: "desc" } } });
  const form = await playerForm(leagueId, roster.map((p) => p.id), db);
  const base = prev
    ? repair(prev, roster, (id) => form.get(id).seasonAvg)
    : bestLineup(roster, (id) => form.get(id).seasonAvg);
  if (!base) return null;
  try {
    return await db.lineup.create({ data: { teamId, roundId, ...base } });
  } catch {
    // Criado em paralelo por outro pedido.
    return db.lineup.findUnique({ where: { teamId_roundId: { teamId, roundId } } });
  }
}

/** Mantém as escolhas do utilizador sempre que possível e corrige o que deixou de ser válido. */
function repair(l: LineupInput, roster: RosterPlayer[], value: (id: string) => number): LineupInput | null {
  if (validateLineup(l, roster).length === 0) {
    const ids = new Set([...l.starters, ...l.bench]);
    const extra = roster.filter((p) => !ids.has(p.id)).map((p) => p.id);
    return { ...l, bench: [...l.bench, ...extra] };
  }
  const starters = new Set(l.starters);
  const next = bestLineup(roster, (id) => (starters.has(id) ? 1000 : 0) + value(id));
  if (!next) return null;
  const capOk = l.captainId && next.starters.includes(l.captainId);
  const viceOk = l.viceCaptainId && next.starters.includes(l.viceCaptainId) && l.viceCaptainId !== l.captainId;
  return {
    ...next,
    captainId: capOk ? l.captainId : next.captainId,
    viceCaptainId: viceOk ? l.viceCaptainId : next.starters.find((s) => s !== (capOk ? l.captainId : next.captainId)) ?? null,
  };
}

/** Após mudanças no plantel: corrige onzes de jornadas ainda não iniciadas. */
export async function repairTeamLineups(teamId: string, leagueId: string, db: Tx = prisma) {
  const roster = await rosterOf(teamId, db);
  const lineups = await db.lineup.findMany({ where: { teamId, round: { finalizedAt: null } } });
  const form = await playerForm(leagueId, roster.map((p) => p.id), db);
  const rosterIds = new Set(roster.map((p) => p.id));
  for (const l of lineups) {
    const lock = await roundLockState(l.roundId, db);
    if (lock.started) {
      // Jornada a decorrer: apenas remove quem saiu do plantel (substituído por suplentes na pontuação).
      // Jogadores adicionados não entram, para não aproveitar pontos de jogos já realizados.
      await db.lineup.update({
        where: { id: l.id },
        data: {
          starters: l.starters.filter((id) => rosterIds.has(id)),
          bench: l.bench.filter((id) => rosterIds.has(id)),
        },
      });
      continue;
    }
    const fixed = repair(l, roster, (id) => form.get(id).seasonAvg);
    if (fixed) await db.lineup.update({ where: { id: l.id }, data: fixed });
  }
}

/** Gravar onze com validação de regras e de bloqueios (deadline). */
export async function saveLineup(
  args: { teamId: string; roundId: string; leagueId: string; settings: LeagueSettings; input: LineupInput },
  db: Tx = prisma,
) {
  const { teamId, roundId, leagueId, settings, input } = args;
  const round = await db.round.findUnique({ where: { id: roundId } });
  if (!round || round.finalizedAt) throw new UserError("Esta jornada já foi fechada.");
  const current = await getOrCreateLineup(teamId, roundId, leagueId, db);
  const roster = await rosterOf(teamId, db);
  const errors = validateLineup(input, roster);
  if (errors.length) throw new UserError(errors.join(" "));

  const lock = await roundLockState(roundId, db);
  if (settings.lineupLock === "ROUND" && lock.started)
    throw new UserError("A jornada já começou: o onze está bloqueado.");
  if (current && settings.lineupLock === "PER_FIXTURE" && lock.started) {
    const club = new Map(roster.map((p) => [p.id, p.clubId]));
    const locked = (id: string | null) => !!id && isClubLocked(lock, club.get(id) ?? "", "PER_FIXTURE");
    const wasStarter = new Set(current.starters);
    const isStarter = new Set(input.starters);
    for (const p of roster) {
      if (locked(p.id) && wasStarter.has(p.id) !== isStarter.has(p.id))
        throw new UserError("Não podes mexer em jogadores cujo jogo já começou.");
    }
    if (current.captainId !== input.captainId && (locked(current.captainId) || locked(input.captainId)))
      throw new UserError("A capitania está bloqueada: o jogo do capitão já começou.");
    if (current.viceCaptainId !== input.viceCaptainId && (locked(current.viceCaptainId) || locked(input.viceCaptainId)))
      throw new UserError("O vice-capitão está bloqueado: o jogo já começou.");
  }
  return db.lineup.upsert({
    where: { teamId_roundId: { teamId, roundId } },
    create: { teamId, roundId, ...input },
    update: input,
  });
}
