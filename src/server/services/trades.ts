import { prisma, type Tx } from "../db";
import { UserError } from "../errors";
import { analyzeTrade, type TradeAnalysis } from "@/lib/fantasy/trade-analyzer";
import type { Pos } from "@/lib/fantasy/config";
import { parseSettings } from "./settings";
import { emit, audit } from "./activity";
import { playerForm } from "./form";
import { repairTeamLineups } from "./lineups";
import { assertRosterFits } from "./roster";
import { currentRound, playerLockedNow, roundLockState } from "./rounds";

export async function analyze(leagueId: string, giveIds: string[], getIds: string[], threshold: number, db: Tx = prisma) {
  const players = await db.player.findMany({ where: { id: { in: [...giveIds, ...getIds] } } });
  const form = await playerForm(leagueId, players.map((p) => p.id), db);
  const v = (id: string) => {
    const p = players.find((x) => x.id === id)!;
    const f = form.get(id);
    return { playerId: id, name: p.name, seasonAvg: f.seasonAvg, last5Avg: f.last5Avg, games: f.games };
  };
  return analyzeTrade(giveIds.map(v), getIds.map(v), threshold);
}

async function assertTradeWindow(tx: Tx, leagueId: string) {
  const league = await tx.league.findUniqueOrThrow({ where: { id: leagueId } });
  if (league.status !== "ACTIVE") throw new UserError("As trocas só abrem depois do draft.");
  const s = parseSettings(league.settings);
  if (s.trades.deadlineRoundOrder !== null) {
    const r = await currentRound(league.seasonId, tx);
    if (r && (r.order > s.trades.deadlineRoundOrder || (r.order === s.trades.deadlineRoundOrder && (await roundLockState(r.id, tx)).started)))
      throw new UserError("O prazo de trocas desta liga já terminou.");
  }
  return { league, s };
}

export async function proposeTrade(args: {
  leagueId: string; proposerTeamId: string; receiverTeamId: string; give: string[]; get: string[];
  message?: string; parentId?: string; userId: string;
}) {
  if (args.proposerTeamId === args.receiverTeamId) throw new UserError("Não podes trocar contigo próprio.");
  if (!args.give.length || !args.get.length) throw new UserError("Escolhe jogadores dos dois lados.");
  if (args.give.length > 5 || args.get.length > 5) throw new UserError("Máximo de 5 jogadores por lado.");
  return prisma.$transaction(async (tx) => {
    const { s } = await assertTradeWindow(tx, args.leagueId);
    const entries = await tx.rosterEntry.findMany({ where: { leagueId: args.leagueId, playerId: { in: [...args.give, ...args.get] } }, include: { player: true } });
    for (const id of args.give) if (entries.find((e) => e.playerId === id)?.teamId !== args.proposerTeamId) throw new UserError("Só podes oferecer jogadores do teu plantel.");
    for (const id of args.get) if (entries.find((e) => e.playerId === id)?.teamId !== args.receiverTeamId) throw new UserError("Jogador pedido não pertence ao outro participante.");
    await assertCooldown(tx, args.leagueId, args.proposerTeamId, args.receiverTeamId, args.give, s.trades.cooldownDays);
    const analysis = await analyze(args.leagueId, args.give, args.get, s.trades.imbalanceThreshold, tx);
    const trade = await tx.trade.create({
      data: {
        leagueId: args.leagueId, proposerTeamId: args.proposerTeamId, receiverTeamId: args.receiverTeamId,
        message: args.message?.slice(0, 280) || null, parentId: args.parentId ?? null,
        expiresAt: new Date(Date.now() + s.trades.expiryHours * 3600e3),
        analysis: analysis as object, flagged: s.trades.flagImbalanced && analysis.flagged,
        items: { create: [...args.give.map((playerId) => ({ playerId, fromTeamId: args.proposerTeamId })), ...args.get.map((playerId) => ({ playerId, fromTeamId: args.receiverTeamId }))] },
      },
    });
    const [p, r] = await Promise.all([tx.team.findUniqueOrThrow({ where: { id: args.proposerTeamId } }), tx.team.findUniqueOrThrow({ where: { id: args.receiverTeamId } })]);
    await emit(args.leagueId, "TRADE_PROPOSED", { from: p.name, to: r.name, tradeId: trade.id }, {
      feed: false,
      notify: { userIds: [r.userId], title: `${p.name} enviou-te uma proposta de troca`, href: `/leagues/${args.leagueId}/trades?t=${trade.id}` },
    }, tx);
    await audit(args.leagueId, "TRADE_PROPOSED", { tradeId: trade.id, give: args.give, get: args.get, parentId: args.parentId ?? null }, { userId: args.userId, teamId: args.proposerTeamId }, tx);
    return trade;
  });
}

/** Anti "empréstimo": um jogador recebido numa troca não pode voltar à equipa de origem durante o cooldown. */
async function assertCooldown(tx: Tx, leagueId: string, fromTeam: string, toTeam: string, give: string[], days: number) {
  if (!days) return;
  const since = new Date(Date.now() - days * 864e5);
  const recent = await tx.trade.findMany({
    where: { leagueId, status: "COMPLETED", resolvedAt: { gte: since }, items: { some: { playerId: { in: give }, fromTeamId: toTeam } } },
    include: { items: true },
  });
  for (const t of recent) {
    const involved = [t.proposerTeamId, t.receiverTeamId];
    if (involved.includes(fromTeam) && involved.includes(toTeam))
      throw new UserError(`Um dos jogadores veio desta equipa há menos de ${days} dias (proteção contra colusão).`);
  }
}

async function loadTrade(tx: Tx, tradeId: string, leagueId: string) {
  const t = await tx.trade.findUnique({ where: { id: tradeId }, include: { items: true, proposer: true, receiver: true } });
  if (!t || t.leagueId !== leagueId) throw new UserError("Proposta inexistente.");
  return t;
}

export async function respondTrade(args: { leagueId: string; tradeId: string; teamId: string; accept: boolean; userId: string }) {
  const res = await prisma.$transaction(async (tx) => {
    const t = await loadTrade(tx, args.tradeId, args.leagueId);
    if (t.receiverTeamId !== args.teamId) throw new UserError("Esta proposta não é para ti.");
    if (t.status !== "PENDING") throw new UserError("Esta proposta já não está pendente.");
    if (t.expiresAt < new Date()) {
      await tx.trade.update({ where: { id: t.id }, data: { status: "EXPIRED", resolvedAt: new Date() } });
      throw new UserError("A proposta expirou.");
    }
    if (!args.accept) {
      await tx.trade.update({ where: { id: t.id }, data: { status: "REJECTED", resolvedAt: new Date() } });
      await emit(args.leagueId, "TRADE_REJECTED", { tradeId: t.id }, { feed: false, notify: { userIds: [t.proposer.userId], title: `${t.receiver.name} rejeitou a tua proposta`, href: `/leagues/${args.leagueId}/trades` } }, tx);
      await audit(args.leagueId, "TRADE_REJECTED", { tradeId: t.id }, { userId: args.userId, teamId: args.teamId }, tx);
      return "rejected" as const;
    }
    const { league, s } = await assertTradeWindow(tx, args.leagueId);
    const commissionerInvolved = [t.proposer.userId, t.receiver.userId].includes(league.commissionerId);
    let mode = s.trades.approval;
    if (mode === "FREE" && t.flagged) mode = commissionerInvolved ? "VOTE" : "COMMISSIONER";
    if (mode === "COMMISSIONER" && commissionerInvolved) mode = "VOTE"; // o comissário não aprova trocas próprias
    if (mode === "FREE") return "execute" as const;
    await tx.trade.update({
      where: { id: t.id },
      data: { status: "IN_REVIEW", reviewUntil: mode === "VOTE" ? new Date(Date.now() + s.trades.reviewHours * 3600e3) : null },
    });
    const others = await tx.team.findMany({ where: { leagueId: args.leagueId, id: { notIn: [t.proposerTeamId, t.receiverTeamId] } } });
    await emit(args.leagueId, "TRADE_IN_REVIEW", { tradeId: t.id, from: t.proposer.name, to: t.receiver.name, mode, flagged: t.flagged }, {
      notify: {
        userIds: mode === "VOTE" ? others.map((o) => o.userId) : [league.commissionerId],
        title: mode === "VOTE" ? `Troca em votação: ${t.proposer.name} ↔ ${t.receiver.name}` : "Troca aguarda a tua aprovação",
        href: `/leagues/${args.leagueId}/trades?t=${t.id}`,
      },
    }, tx);
    await audit(args.leagueId, "TRADE_ACCEPTED", { tradeId: t.id, review: mode }, { userId: args.userId, teamId: args.teamId }, tx);
    return "review" as const;
  });
  if (res === "execute") await executeTrade(args.tradeId, args.userId);
  return res;
}

/** Executa a troca: revalida posse, bloqueios e limites de plantel no momento da execução. */
export async function executeTrade(tradeId: string, actorId?: string) {
  let teams: string[] = [];
  let leagueId = "";
  try {
    await prisma.$transaction(async (tx) => {
      const t = await tx.trade.findUniqueOrThrow({ where: { id: tradeId }, include: { items: { include: { player: true } }, proposer: true, receiver: true } });
      leagueId = t.leagueId;
      if (!["PENDING", "IN_REVIEW"].includes(t.status)) throw new UserError("A troca já não está ativa.");
      const { league, s } = await assertTradeWindow(tx, t.leagueId);
      for (const it of t.items) {
        const e = await tx.rosterEntry.findUnique({ where: { leagueId_playerId: { leagueId: t.leagueId, playerId: it.playerId } } });
        if (!e || e.teamId !== it.fromTeamId) throw new UserError(`${it.player.name} já não está no plantel de origem.`);
        if (await playerLockedNow(league.seasonId, it.player.clubId, tx)) throw new UserError(`${it.player.name} está bloqueado (jogo em curso).`);
      }
      const pos = (from: string) => t.items.filter((i) => i.fromTeamId === from).map((i) => i.player.position as Pos);
      await assertRosterFits(tx, t.proposerTeamId, s, pos(t.receiverTeamId), pos(t.proposerTeamId));
      await assertRosterFits(tx, t.receiverTeamId, s, pos(t.proposerTeamId), pos(t.receiverTeamId));
      for (const it of t.items) {
        const to = it.fromTeamId === t.proposerTeamId ? t.receiverTeamId : t.proposerTeamId;
        await tx.rosterEntry.update({
          where: { leagueId_playerId: { leagueId: t.leagueId, playerId: it.playerId } },
          data: { teamId: to, acquiredVia: "TRADE", acquiredAt: new Date(), onTradeBlock: false },
        });
      }
      await tx.trade.update({ where: { id: t.id }, data: { status: "COMPLETED", resolvedAt: new Date() } });
      // Outras propostas com estes jogadores deixam de ser válidas.
      await tx.trade.updateMany({
        where: { leagueId: t.leagueId, id: { not: t.id }, status: { in: ["PENDING", "IN_REVIEW"] }, items: { some: { playerId: { in: t.items.map((i) => i.playerId) } } } },
        data: { status: "FAILED", failReason: "Um dos jogadores já foi trocado.", resolvedAt: new Date() },
      });
      teams = [t.proposerTeamId, t.receiverTeamId];
      const names = (from: string) => t.items.filter((i) => i.fromTeamId === from).map((i) => i.player.name);
      await emit(t.leagueId, "TRADE_COMPLETED", {
        tradeId: t.id, from: t.proposer.name, to: t.receiver.name, fromGives: names(t.proposerTeamId), toGives: names(t.receiverTeamId),
      }, { notify: { userIds: [t.proposer.userId, t.receiver.userId], title: "Troca concluída", href: `/leagues/${t.leagueId}/trades` } }, tx);
      await audit(t.leagueId, "TRADE_COMPLETED", { tradeId: t.id }, { userId: actorId }, tx);
    });
  } catch (e) {
    if (e instanceof UserError && leagueId) {
      await prisma.trade.update({ where: { id: tradeId }, data: { status: "FAILED", failReason: e.message, resolvedAt: new Date() } });
      await emit(leagueId, "TRADE_UPDATED", { tradeId }, { feed: false });
    }
    throw e;
  }
  for (const id of teams) await repairTeamLineups(id, leagueId);
}

export async function cancelTrade(args: { leagueId: string; tradeId: string; teamId: string; userId: string }) {
  const t = await loadTrade(prisma, args.tradeId, args.leagueId);
  if (t.proposerTeamId !== args.teamId) throw new UserError("Só quem propôs pode cancelar.");
  if (!["PENDING", "IN_REVIEW"].includes(t.status)) throw new UserError("Esta proposta já não pode ser cancelada.");
  await prisma.trade.update({ where: { id: t.id }, data: { status: "CANCELLED", resolvedAt: new Date() } });
  await audit(args.leagueId, "TRADE_CANCELLED", { tradeId: t.id }, { userId: args.userId, teamId: args.teamId });
  await emit(args.leagueId, "TRADE_UPDATED", { tradeId: t.id }, { feed: false });
}

/** Contraproposta: fecha a original como COUNTERED e cria nova proposta no sentido inverso. */
export async function counterTrade(args: { leagueId: string; tradeId: string; teamId: string; give: string[]; get: string[]; message?: string; userId: string }) {
  const t = await loadTrade(prisma, args.tradeId, args.leagueId);
  if (t.receiverTeamId !== args.teamId || t.status !== "PENDING") throw new UserError("Não podes contrapropor esta troca.");
  const created = await proposeTrade({ leagueId: args.leagueId, proposerTeamId: args.teamId, receiverTeamId: t.proposerTeamId, give: args.give, get: args.get, message: args.message, parentId: t.id, userId: args.userId });
  await prisma.trade.update({ where: { id: t.id }, data: { status: "COUNTERED", resolvedAt: new Date() } });
  return created;
}

export async function voteTrade(args: { leagueId: string; tradeId: string; teamId: string; veto: boolean }) {
  const t = await loadTrade(prisma, args.tradeId, args.leagueId);
  if (t.status !== "IN_REVIEW" || !t.reviewUntil) throw new UserError("Esta troca não está em votação.");
  if ([t.proposerTeamId, t.receiverTeamId].includes(args.teamId)) throw new UserError("Os envolvidos não votam.");
  await prisma.tradeVote.upsert({
    where: { tradeId_teamId: { tradeId: t.id, teamId: args.teamId } },
    create: { tradeId: t.id, teamId: args.teamId, veto: args.veto },
    update: { veto: args.veto },
  });
  const league = await prisma.league.findUniqueOrThrow({ where: { id: args.leagueId } });
  const s = parseSettings(league.settings);
  const eligible = (await prisma.team.count({ where: { leagueId: args.leagueId } })) - 2;
  const vetoes = await prisma.tradeVote.count({ where: { tradeId: t.id, veto: true } });
  if (eligible > 0 && vetoes >= Math.ceil(eligible * s.trades.vetoThreshold)) {
    await prisma.trade.update({ where: { id: t.id }, data: { status: "VETOED", resolvedAt: new Date() } });
    await emit(args.leagueId, "TRADE_VETOED", { tradeId: t.id, from: t.proposer.name, to: t.receiver.name, by: "liga" }, {
      notify: { userIds: [t.proposer.userId, t.receiver.userId], title: "A liga vetou a vossa troca", href: `/leagues/${args.leagueId}/trades` },
    });
    await audit(args.leagueId, "TRADE_VETOED", { tradeId: t.id, vetoes, eligible });
  } else await emit(args.leagueId, "TRADE_UPDATED", { tradeId: t.id }, { feed: false });
}

export async function commissionerDecision(args: { leagueId: string; tradeId: string; approve: boolean; userId: string }) {
  const t = await loadTrade(prisma, args.tradeId, args.leagueId);
  if (t.status !== "IN_REVIEW") throw new UserError("Esta troca não está em revisão.");
  const league = await prisma.league.findUniqueOrThrow({ where: { id: args.leagueId } });
  if ([t.proposer.userId, t.receiver.userId].includes(league.commissionerId)) throw new UserError("O comissário não decide trocas em que participa.");
  if (args.approve) return executeTrade(t.id, args.userId);
  await prisma.trade.update({ where: { id: t.id }, data: { status: "VETOED", resolvedAt: new Date() } });
  await emit(args.leagueId, "TRADE_VETOED", { tradeId: t.id, from: t.proposer.name, to: t.receiver.name, by: "comissário" }, {
    notify: { userIds: [t.proposer.userId, t.receiver.userId], title: "O comissário vetou a vossa troca", href: `/leagues/${args.leagueId}/trades` },
  });
  await audit(args.leagueId, "TRADE_VETOED_COMMISSIONER", { tradeId: t.id }, { userId: args.userId });
}

/** Expira propostas e executa trocas cujo período de votação terminou sem veto. */
export async function processTrades(leagueId: string) {
  const now = new Date();
  await prisma.trade.updateMany({ where: { leagueId, status: "PENDING", expiresAt: { lt: now } }, data: { status: "EXPIRED", resolvedAt: now } });
  const due = await prisma.trade.findMany({ where: { leagueId, status: "IN_REVIEW", reviewUntil: { lte: now } } });
  for (const t of due) {
    try {
      await executeTrade(t.id);
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
    }
  }
}

export type { TradeAnalysis };
