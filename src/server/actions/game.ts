"use server";
import { z } from "zod";
import { run, UserError } from "../errors";
import { requireMember } from "../services/access";
import { makePick, setQueue, tickDraft } from "../services/draft";
import { saveLineup } from "../services/lineups";
import { addFreeAgent, cancelClaim, claimWaiver, dropPlayer, setTradeBlock } from "../services/roster";
import { analyze, cancelTrade, commissionerDecision, counterTrade, proposeTrade, respondTrade, voteTrade } from "../services/trades";
import { prisma } from "../db";

const id = z.string().min(1).max(64);
const ids = z.array(id).max(20);

export async function pickAction(leagueId: string, playerId: string, expectedPick: number) {
  return run(async () => {
    const { team, user } = await requireMember(leagueId);
    await makePick({ leagueId, teamId: team.id, playerId: id.parse(playerId), actorId: user.id, expectedPick });
  });
}

export async function tickDraftAction(leagueId: string) {
  return run(async () => {
    await requireMember(leagueId);
    await tickDraft(leagueId);
  });
}

export async function setQueueAction(leagueId: string, playerIds: string[]) {
  return run(async () => {
    const { team } = await requireMember(leagueId);
    await setQueue(team.id, z.array(id).max(50).parse(playerIds));
  });
}

export async function saveLineupAction(leagueId: string, roundId: string, input: { formation: string; starters: string[]; bench: string[]; captainId: string | null; viceCaptainId: string | null }) {
  return run(async () => {
    const { team, settings } = await requireMember(leagueId);
    const p = z.object({ formation: z.string(), starters: ids, bench: ids, captainId: id.nullable(), viceCaptainId: id.nullable() }).safeParse(input);
    if (!p.success) throw new UserError("Onze inválido.");
    const round = await prisma.round.findUnique({ where: { id: roundId } });
    const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
    if (!round || round.seasonId !== league.seasonId) throw new UserError("Jornada inválida.");
    await saveLineup({ teamId: team.id, roundId, leagueId, settings, input: p.data });
  });
}

export async function addFreeAgentAction(leagueId: string, playerId: string, dropPlayerId: string | null) {
  return run(async () => {
    const { team, user } = await requireMember(leagueId);
    await addFreeAgent({ leagueId, teamId: team.id, playerId: id.parse(playerId), dropPlayerId, userId: user.id });
  });
}

export async function claimWaiverAction(leagueId: string, playerId: string, dropPlayerId: string | null) {
  return run(async () => {
    const { team, user } = await requireMember(leagueId);
    await claimWaiver({ leagueId, teamId: team.id, playerId: id.parse(playerId), dropPlayerId, userId: user.id });
  });
}

export async function cancelClaimAction(leagueId: string, claimId: string) {
  return run(async () => cancelClaim(claimId, (await requireMember(leagueId)).team.id));
}

export async function dropPlayerAction(leagueId: string, playerId: string) {
  return run(async () => {
    const { team, user } = await requireMember(leagueId);
    await dropPlayer({ leagueId, teamId: team.id, playerId: id.parse(playerId), userId: user.id });
  });
}

export async function tradeBlockAction(leagueId: string, playerId: string, on: boolean) {
  return run(async () => setTradeBlock(leagueId, (await requireMember(leagueId)).team.id, playerId, on));
}

export async function analyzeTradeAction(leagueId: string, give: string[], get: string[]) {
  return run(async () => {
    const { settings } = await requireMember(leagueId);
    return analyze(leagueId, ids.parse(give), ids.parse(get), settings.trades.imbalanceThreshold);
  });
}

export async function proposeTradeAction(leagueId: string, input: { receiverTeamId: string; give: string[]; get: string[]; message?: string; counterOf?: string }) {
  return run(async () => {
    const { team, user } = await requireMember(leagueId);
    const p = z.object({ receiverTeamId: id, give: ids, get: ids, message: z.string().max(280).optional(), counterOf: id.optional() }).parse(input);
    if (p.counterOf) await counterTrade({ leagueId, tradeId: p.counterOf, teamId: team.id, give: p.give, get: p.get, message: p.message, userId: user.id });
    else await proposeTrade({ leagueId, proposerTeamId: team.id, receiverTeamId: p.receiverTeamId, give: p.give, get: p.get, message: p.message, userId: user.id });
  });
}

export async function respondTradeAction(leagueId: string, tradeId: string, accept: boolean) {
  return run(async () => {
    const { team, user } = await requireMember(leagueId);
    return respondTrade({ leagueId, tradeId, teamId: team.id, accept, userId: user.id });
  });
}

export async function cancelTradeAction(leagueId: string, tradeId: string) {
  return run(async () => {
    const { team, user } = await requireMember(leagueId);
    await cancelTrade({ leagueId, tradeId, teamId: team.id, userId: user.id });
  });
}

export async function voteTradeAction(leagueId: string, tradeId: string, veto: boolean) {
  return run(async () => voteTrade({ leagueId, tradeId, teamId: (await requireMember(leagueId)).team.id, veto }));
}

export async function commissionerTradeAction(leagueId: string, tradeId: string, approve: boolean) {
  return run(async () => {
    const { isCommissioner, user } = await requireMember(leagueId);
    if (!isCommissioner) throw new UserError("Apenas o comissário.");
    await commissionerDecision({ leagueId, tradeId, approve, userId: user.id });
  });
}
