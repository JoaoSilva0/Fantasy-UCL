import { Prisma } from "@prisma/client";
import { prisma, type Tx } from "../db";
import { UserError } from "../errors";
import { newSeed, seedHash, seededShuffle, teamForPick } from "@/lib/fantasy/snake";
import { POS_LABEL, rosterSize, type LeagueSettings, type Pos } from "@/lib/fantasy/config";
import { parseSettings } from "./settings";
import { emit, audit } from "./activity";
import { playerForm } from "./form";
import { ensureSchedule } from "./matchups";

/** Cria o draft da liga com a semente já comprometida (commit) — revelada no sorteio. */
export async function createDraft(leagueId: string, settings: LeagueSettings, db: Tx = prisma) {
  const seed = newSeed();
  return db.draft.create({
    data: { leagueId, rounds: rosterSize(settings), pickSeconds: settings.draft.pickSeconds, seed, seedHash: seedHash(seed) },
  });
}

/** Sorteio da ordem: Fisher–Yates determinístico a partir da semente comprometida. */
export async function randomizeOrder(leagueId: string, actorId: string) {
  const draft = await prisma.draft.findUniqueOrThrow({ where: { leagueId } });
  if (draft.status !== "PENDING") throw new UserError("O draft já começou.");
  if (draft.order) throw new UserError("A ordem já foi sorteada e é definitiva.");
  const teams = await prisma.team.findMany({ where: { leagueId } });
  if (teams.length < 2) throw new UserError("São precisos pelo menos 2 participantes.");
  const order = seededShuffle(teams.map((t) => t.id), draft.seed!);
  await prisma.$transaction(async (tx) => {
    await tx.draft.update({ where: { id: draft.id }, data: { order } });
    await tx.league.update({ where: { id: leagueId }, data: { maxTeams: Math.max(teams.length, 2) } });
    // Prioridade de waivers inicial = inverso da ordem do draft.
    for (const [i, id] of [...order].reverse().entries()) await tx.team.update({ where: { id }, data: { waiverPriority: i + 1 } });
    const names = new Map(teams.map((t) => [t.id, t.name]));
    await emit(leagueId, "DRAFT_ORDER", { order: order.map((id) => names.get(id)), seed: draft.seed, seedHash: draft.seedHash }, {
      notify: { userIds: teams.map((t) => t.userId), title: "Ordem do draft sorteada", href: `/leagues/${leagueId}/draft` },
    }, tx);
    await audit(leagueId, "DRAFT_ORDER", { order, seed: draft.seed, seedHash: draft.seedHash }, { userId: actorId }, tx);
  });
}

export async function startDraft(leagueId: string, actorId: string) {
  const draft = await prisma.draft.findUniqueOrThrow({ where: { leagueId } });
  if (draft.status !== "PENDING") throw new UserError("O draft já foi iniciado.");
  if (!draft.order) throw new UserError("Faz primeiro o sorteio da ordem.");
  const teams = await prisma.team.count({ where: { leagueId } });
  if (teams !== (draft.order as string[]).length) throw new UserError("Entrou um novo participante depois do sorteio.");
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const s = parseSettings(league.settings);
  const players = await prisma.player.groupBy({ by: ["position"], where: { seasonId: league.seasonId, active: true }, _count: true });
  for (const pos of ["GK", "DEF", "MID", "FWD"] as Pos[]) {
    const have = players.find((p) => p.position === pos)?._count ?? 0;
    if (have < s.roster[pos] * teams) throw new UserError(`Não há jogadores suficientes (${POS_LABEL[pos]}) para este número de equipas. Sincroniza os plantéis.`);
  }
  await prisma.$transaction(async (tx) => {
    await tx.draft.update({
      where: { id: draft.id },
      data: { status: "RUNNING", startedAt: new Date(), currentPick: 1, rounds: rosterSize(s), pickSeconds: s.draft.pickSeconds, pickDeadline: new Date(Date.now() + s.draft.pickSeconds * 1000) },
    });
    await tx.league.update({ where: { id: leagueId }, data: { status: "DRAFTING" } });
    const all = await tx.team.findMany({ where: { leagueId } });
    await emit(leagueId, "DRAFT_STARTED", {}, { notify: { userIds: all.map((t) => t.userId), title: "O draft começou!", href: `/leagues/${leagueId}/draft` } }, tx);
    await audit(leagueId, "DRAFT_STARTED", {}, { userId: actorId }, tx);
  });
}

export async function pauseDraft(leagueId: string, actorId: string, pause: boolean) {
  await prisma.$transaction(async (tx) => {
    const d = await lockDraft(tx, leagueId);
    if (pause) {
      if (d.status !== "RUNNING") throw new UserError("O draft não está a decorrer.");
      const remaining = Math.max(5000, (d.pickDeadline?.getTime() ?? Date.now()) - Date.now());
      await tx.draft.update({ where: { id: d.id }, data: { status: "PAUSED", pausedRemainingMs: remaining, pickDeadline: null } });
    } else {
      if (d.status !== "PAUSED") throw new UserError("O draft não está em pausa.");
      await tx.draft.update({ where: { id: d.id }, data: { status: "RUNNING", pickDeadline: new Date(Date.now() + (d.pausedRemainingMs ?? d.pickSeconds * 1000)), pausedRemainingMs: null } });
    }
    await emit(leagueId, pause ? "DRAFT_PAUSED" : "DRAFT_RESUMED", {}, {}, tx);
    await audit(leagueId, pause ? "DRAFT_PAUSED" : "DRAFT_RESUMED", {}, { userId: actorId }, tx);
  });
}

/** SELECT … FOR UPDATE: serializa escolhas concorrentes na mesma liga. */
async function lockDraft(tx: Prisma.TransactionClient, leagueId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Draft" WHERE "leagueId" = ${leagueId} FOR UPDATE`;
  if (!rows.length) throw new UserError("Draft inexistente.");
  return tx.draft.findUniqueOrThrow({ where: { id: rows[0].id } });
}

async function positionCounts(tx: Tx, teamId: string) {
  const entries = await tx.rosterEntry.findMany({ where: { teamId }, include: { player: { select: { position: true } } } });
  const c: Record<Pos, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const e of entries) c[e.player.position as Pos]++;
  return c;
}

/**
 * Faz uma escolha. `expectedPick` protege contra cliques duplicados/atrasados.
 * Com `teamId` = null e auto = true, escolhe pela equipa que está no relógio.
 */
export async function makePick(args: { leagueId: string; teamId: string | null; playerId: string | null; auto?: boolean; actorId?: string; expectedPick?: number }) {
  const result = await prisma.$transaction(async (tx) => {
    const d = await lockDraft(tx, args.leagueId);
    if (d.status !== "RUNNING") throw new UserError(d.status === "PAUSED" ? "O draft está em pausa." : "O draft não está a decorrer.");
    if (args.expectedPick && args.expectedPick !== d.currentPick) throw new UserError("A escolha já avançou. A lista foi atualizada.");
    const order = d.order as string[];
    const slot = teamForPick(order, d.currentPick);
    if (args.teamId && args.teamId !== slot.teamId) throw new UserError("Não é a tua vez.");
    const league = await tx.league.findUniqueOrThrow({ where: { id: args.leagueId } });
    const s = parseSettings(league.settings);
    const counts = await positionCounts(tx, slot.teamId);

    let playerId = args.playerId;
    if (!playerId) playerId = await chooseAutoPick(tx, args.leagueId, league.seasonId, slot.teamId, s, counts);
    if (!playerId) throw new UserError("Nenhum jogador elegível para auto-pick.");

    const player = await tx.player.findUnique({ where: { id: playerId } });
    if (!player || player.seasonId !== league.seasonId || !player.active) throw new UserError("Jogador inválido.");
    if (await tx.rosterEntry.findUnique({ where: { leagueId_playerId: { leagueId: args.leagueId, playerId } } }))
      throw new UserError("Esse jogador já foi escolhido.");
    const pos = player.position as Pos;
    if (counts[pos] >= s.roster[pos]) throw new UserError(`Já tens o máximo de ${POS_LABEL[pos]} (${s.roster[pos]}).`);

    await tx.draftPick.create({
      data: { draftId: d.id, overall: d.currentPick, round: slot.round, pickInRound: slot.pickInRound, teamId: slot.teamId, playerId, auto: !!args.auto },
    });
    await tx.rosterEntry.create({ data: { leagueId: args.leagueId, teamId: slot.teamId, playerId, acquiredVia: "DRAFT" } });
    await tx.draftQueue.deleteMany({ where: { playerId, team: { leagueId: args.leagueId } } });

    const total = order.length * d.rounds;
    const done = d.currentPick >= total;
    await tx.draft.update({
      where: { id: d.id },
      data: done
        ? { status: "COMPLETED", completedAt: new Date(), pickDeadline: null, currentPick: total + 1 }
        : { currentPick: d.currentPick + 1, pickDeadline: new Date(Date.now() + d.pickSeconds * 1000) },
    });
    const team = await tx.team.findUniqueOrThrow({ where: { id: slot.teamId } });
    const next = done ? null : teamForPick(order, d.currentPick + 1).teamId;
    const nextTeam = next ? await tx.team.findUnique({ where: { id: next } }) : null;
    await emit(args.leagueId, "DRAFT_PICK", {
      overall: d.currentPick, round: slot.round, pickInRound: slot.pickInRound, team: team.name, teamId: team.id,
      player: player.name, playerId, position: pos, auto: !!args.auto,
    }, nextTeam ? { notify: { userIds: [nextTeam.userId], title: "É a tua vez no draft!", href: `/leagues/${args.leagueId}/draft` } } : {}, tx);
    if (done) {
      await tx.league.update({ where: { id: args.leagueId }, data: { status: "ACTIVE" } });
      const teams = await tx.team.findMany({ where: { leagueId: args.leagueId } });
      await emit(args.leagueId, "DRAFT_COMPLETED", {}, { notify: { userIds: teams.map((t) => t.userId), title: "Draft concluído — define o teu onze!", href: `/leagues/${args.leagueId}/team` } }, tx);
    }
    await audit(args.leagueId, "DRAFT_PICK", { overall: d.currentPick, teamId: slot.teamId, playerId, auto: !!args.auto }, { userId: args.actorId, teamId: slot.teamId }, tx);
    return { done };
  });
  if (result.done) await ensureSchedule(args.leagueId);
  return result;
}

/** Auto-pick: 1º elegível da fila pessoal; senão o melhor disponível pela forma real, na posição mais carenciada. */
async function chooseAutoPick(tx: Tx, leagueId: string, seasonId: string, teamId: string, s: LeagueSettings, counts: Record<Pos, number>) {
  const taken = new Set((await tx.rosterEntry.findMany({ where: { leagueId }, select: { playerId: true } })).map((r) => r.playerId));
  const open = (pos: Pos) => counts[pos] < s.roster[pos];
  const queue = await tx.draftQueue.findMany({ where: { teamId }, orderBy: { rank: "asc" }, include: { player: true } });
  const q = queue.find((x) => !taken.has(x.playerId) && open(x.player.position as Pos) && x.player.active);
  if (q) return q.playerId;
  const need = (["GK", "DEF", "MID", "FWD"] as Pos[])
    .filter(open)
    .sort((a, b) => (s.roster[b] - counts[b]) / s.roster[b] - (s.roster[a] - counts[a]) / s.roster[a])[0];
  if (!need) return null;
  const candidates = await tx.player.findMany({
    where: { seasonId, position: need, active: true, id: { notIn: [...taken] } },
    select: { id: true, name: true, status: true },
  });
  const form = await playerForm(leagueId, undefined, tx);
  candidates.sort((a, b) =>
    (a.status === "INJURED" || a.status === "SUSPENDED" ? 1 : 0) - (b.status === "INJURED" || b.status === "SUSPENDED" ? 1 : 0) ||
    form.get(b.id).last5Avg - form.get(a.id).last5Avg ||
    form.get(b.id).minutes - form.get(a.id).minutes ||
    a.name.localeCompare(b.name),
  );
  return candidates[0]?.id ?? null;
}

/** Executa auto-picks em atraso. Chamado de forma lazy (pedidos de clientes) e pelo cron. */
export async function tickDraft(leagueId: string) {
  for (let i = 0; i < 3; i++) {
    const d = await prisma.draft.findUnique({ where: { leagueId } });
    if (!d || d.status !== "RUNNING" || !d.pickDeadline || d.pickDeadline > new Date()) return;
    try {
      await makePick({ leagueId, teamId: null, playerId: null, auto: true, expectedPick: d.currentPick });
    } catch (e) {
      if (e instanceof UserError) return; // outro pedido já tratou desta escolha
      throw e;
    }
  }
}

export async function tickAllDrafts() {
  const running = await prisma.draft.findMany({ where: { status: "RUNNING", pickDeadline: { lte: new Date() } }, select: { leagueId: true } });
  for (const d of running) await tickDraft(d.leagueId);
  return running.length;
}

export async function setQueue(teamId: string, playerIds: string[]) {
  await prisma.$transaction([
    prisma.draftQueue.deleteMany({ where: { teamId } }),
    prisma.draftQueue.createMany({ data: playerIds.slice(0, 50).map((playerId, rank) => ({ teamId, playerId, rank })) }),
  ]);
}
