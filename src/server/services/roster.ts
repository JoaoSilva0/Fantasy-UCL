import { prisma, type Tx } from "../db";
import { UserError } from "../errors";
import { POS_LABEL, rosterSize, type LeagueSettings, type Pos } from "@/lib/fantasy/config";
import { parseSettings } from "./settings";
import { emit, audit } from "./activity";
import { repairTeamLineups } from "./lineups";
import { playerLockedNow } from "./rounds";

/** Verifica limites por posição e tamanho do plantel depois de uma alteração hipotética. */
export async function assertRosterFits(tx: Tx, teamId: string, s: LeagueSettings, add: Pos[], remove: Pos[]) {
  const entries = await tx.rosterEntry.findMany({ where: { teamId }, include: { player: { select: { position: true } } } });
  const c: Record<Pos, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const e of entries) c[e.player.position as Pos]++;
  for (const p of add) c[p]++;
  for (const p of remove) c[p]--;
  for (const p of Object.keys(c) as Pos[])
    if (c[p] > s.roster[p]) throw new UserError(`O plantel excederia o máximo de ${POS_LABEL[p]} (${s.roster[p]}).`);
  if (Object.values(c).reduce((a, b) => a + b, 0) > rosterSize(s)) throw new UserError("O plantel excederia o tamanho máximo.");
}

async function assertNotLocked(tx: Tx, seasonId: string, player: { clubId: string; name: string }) {
  if (await playerLockedNow(seasonId, player.clubId, tx))
    throw new UserError(`${player.name} está bloqueado: o jogo da jornada já começou.`);
}

async function leagueCtx(tx: Tx, leagueId: string) {
  const league = await tx.league.findUniqueOrThrow({ where: { id: leagueId } });
  if (league.status !== "ACTIVE") throw new UserError("O mercado só abre depois do draft.");
  return { league, s: parseSettings(league.settings) };
}

export async function waiverUntil(leagueId: string, playerId: string, db: Tx = prisma) {
  const st = await db.playerLeagueState.findUnique({ where: { leagueId_playerId: { leagueId, playerId } } });
  return st && st.waiverUntil > new Date() ? st.waiverUntil : null;
}

async function dropInTx(tx: Tx, leagueId: string, teamId: string, playerId: string, s: LeagueSettings, seasonId: string) {
  const entry = await tx.rosterEntry.findUnique({ where: { leagueId_playerId: { leagueId, playerId } }, include: { player: true } });
  if (!entry || entry.teamId !== teamId) throw new UserError("Esse jogador não está no teu plantel.");
  await assertNotLocked(tx, seasonId, entry.player);
  await tx.rosterEntry.delete({ where: { id: entry.id } });
  if (s.waivers.enabled && s.waivers.waiverHours > 0) {
    const until = new Date(Date.now() + s.waivers.waiverHours * 3600e3);
    await tx.playerLeagueState.upsert({
      where: { leagueId_playerId: { leagueId, playerId } },
      create: { leagueId, playerId, waiverUntil: until },
      update: { waiverUntil: until },
    });
  }
  // Propostas pendentes que incluíam este jogador deixam de ser válidas.
  await tx.trade.updateMany({
    where: { leagueId, status: { in: ["PENDING", "IN_REVIEW"] }, items: { some: { playerId } } },
    data: { status: "FAILED", failReason: "Um dos jogadores saiu do plantel.", resolvedAt: new Date() },
  });
  return entry.player;
}

/** Contratar um free agent (com libertação opcional de outro jogador). */
export async function addFreeAgent(args: { leagueId: string; teamId: string; playerId: string; dropPlayerId?: string | null; userId: string }) {
  await prisma.$transaction(async (tx) => {
    const { league, s } = await leagueCtx(tx, args.leagueId);
    const player = await tx.player.findUnique({ where: { id: args.playerId } });
    if (!player || player.seasonId !== league.seasonId || !player.active) throw new UserError("Jogador inválido.");
    if (await tx.rosterEntry.findUnique({ where: { leagueId_playerId: { leagueId: args.leagueId, playerId: args.playerId } } }))
      throw new UserError("Esse jogador já pertence a um plantel.");
    if (s.waivers.enabled && (await waiverUntil(args.leagueId, args.playerId, tx)))
      throw new UserError("Este jogador está em waivers: faz um pedido de contratação.");
    let dropped: { name: string; position: string } | null = null;
    if (args.dropPlayerId) dropped = await dropInTx(tx, args.leagueId, args.teamId, args.dropPlayerId, s, league.seasonId);
    await assertRosterFits(tx, args.teamId, s, [player.position as Pos], []);
    await tx.rosterEntry.create({ data: { leagueId: args.leagueId, teamId: args.teamId, playerId: player.id, acquiredVia: "FREE_AGENT" } });
    const team = await tx.team.findUniqueOrThrow({ where: { id: args.teamId } });
    await emit(args.leagueId, "FREE_AGENT_ADD", { team: team.name, player: player.name, playerId: player.id, dropped: dropped?.name ?? null }, {}, tx);
    await audit(args.leagueId, "FREE_AGENT_ADD", { playerId: player.id, dropPlayerId: args.dropPlayerId ?? null }, { userId: args.userId, teamId: args.teamId }, tx);
  });
  await repairTeamLineups(args.teamId, args.leagueId);
}

export async function dropPlayer(args: { leagueId: string; teamId: string; playerId: string; userId: string }) {
  await prisma.$transaction(async (tx) => {
    const { league, s } = await leagueCtx(tx, args.leagueId);
    const p = await dropInTx(tx, args.leagueId, args.teamId, args.playerId, s, league.seasonId);
    const team = await tx.team.findUniqueOrThrow({ where: { id: args.teamId } });
    await emit(args.leagueId, "PLAYER_DROP", { team: team.name, player: p.name, playerId: p.id }, {}, tx);
    await audit(args.leagueId, "PLAYER_DROP", { playerId: p.id }, { userId: args.userId, teamId: args.teamId }, tx);
  });
  await repairTeamLineups(args.teamId, args.leagueId);
}

export async function claimWaiver(args: { leagueId: string; teamId: string; playerId: string; dropPlayerId?: string | null; userId: string }) {
  const { league, s } = await leagueCtx(prisma, args.leagueId);
  if (!s.waivers.enabled) throw new UserError("Os waivers estão desativados nesta liga.");
  const player = await prisma.player.findUnique({ where: { id: args.playerId } });
  if (!player || player.seasonId !== league.seasonId) throw new UserError("Jogador inválido.");
  if (await prisma.rosterEntry.findUnique({ where: { leagueId_playerId: { leagueId: args.leagueId, playerId: args.playerId } } }))
    throw new UserError("Esse jogador já pertence a um plantel.");
  const dup = await prisma.waiverClaim.findFirst({ where: { teamId: args.teamId, playerId: args.playerId, status: "PENDING" } });
  if (dup) throw new UserError("Já tens um pedido pendente para este jogador.");
  await prisma.waiverClaim.create({ data: { leagueId: args.leagueId, teamId: args.teamId, playerId: args.playerId, dropPlayerId: args.dropPlayerId ?? null } });
  await audit(args.leagueId, "WAIVER_CLAIM", { playerId: args.playerId, dropPlayerId: args.dropPlayerId ?? null }, { userId: args.userId, teamId: args.teamId });
}

export async function cancelClaim(claimId: string, teamId: string) {
  const c = await prisma.waiverClaim.findUnique({ where: { id: claimId } });
  if (!c || c.teamId !== teamId || c.status !== "PENDING") throw new UserError("Pedido inválido.");
  await prisma.waiverClaim.update({ where: { id: claimId }, data: { status: "CANCELLED", processedAt: new Date() } });
}

/**
 * Processa waivers (prioridade rotativa, estilo NFL): para cada jogador cujo período de waivers terminou,
 * ganha o pedido da equipa com melhor prioridade; essa equipa passa para o fim da fila.
 */
export async function processWaivers(leagueId: string) {
  const claims = await prisma.waiverClaim.findMany({ where: { leagueId, status: "PENDING" }, include: { team: true } });
  const touched = new Set<string>();
  const players = [...new Set(claims.map((c) => c.playerId))];
  for (const playerId of players) {
    if (await waiverUntil(leagueId, playerId)) continue; // ainda em período de waivers
    await prisma.$transaction(async (tx) => {
      const { league, s } = await leagueCtx(tx, leagueId);
      const teams = await tx.team.findMany({ where: { leagueId } });
      const prio = new Map(teams.map((t) => [t.id, t.waiverPriority]));
      const list = (await tx.waiverClaim.findMany({ where: { leagueId, playerId, status: "PENDING" } }))
        .sort((a, b) => prio.get(a.teamId)! - prio.get(b.teamId)! || a.createdAt.getTime() - b.createdAt.getTime());
      const player = await tx.player.findUniqueOrThrow({ where: { id: playerId } });
      let winner: string | null = null;
      for (const c of list) {
        if (winner) {
          await tx.waiverClaim.update({ where: { id: c.id }, data: { status: "FAILED", note: "Outra equipa tinha prioridade.", processedAt: new Date() } });
          continue;
        }
        try {
          if (await tx.rosterEntry.findUnique({ where: { leagueId_playerId: { leagueId, playerId } } })) throw new UserError("Jogador já contratado.");
          // Validar tudo antes de escrever (um pedido falhado não pode deixar a libertação feita).
          const drop = c.dropPlayerId
            ? await tx.rosterEntry.findUnique({ where: { leagueId_playerId: { leagueId, playerId: c.dropPlayerId } }, include: { player: true } })
            : null;
          if (c.dropPlayerId && (!drop || drop.teamId !== c.teamId)) throw new UserError("O jogador a libertar já não está no plantel.");
          if (drop) await assertNotLocked(tx, league.seasonId, drop.player);
          await assertRosterFits(tx, c.teamId, s, [player.position as Pos], drop ? [drop.player.position as Pos] : []);
          if (c.dropPlayerId) await dropInTx(tx, leagueId, c.teamId, c.dropPlayerId, s, league.seasonId);
          await tx.rosterEntry.create({ data: { leagueId, teamId: c.teamId, playerId, acquiredVia: "WAIVER" } });
          await tx.waiverClaim.update({ where: { id: c.id }, data: { status: "SUCCESS", processedAt: new Date() } });
          winner = c.teamId;
          // Rotação: vencedor vai para o fim; quem estava atrás sobe uma posição.
          const p = prio.get(c.teamId)!;
          for (const t of teams) {
            if (t.id === c.teamId) await tx.team.update({ where: { id: t.id }, data: { waiverPriority: teams.length } });
            else if (t.waiverPriority > p) await tx.team.update({ where: { id: t.id }, data: { waiverPriority: t.waiverPriority - 1 } });
          }
          const team = teams.find((t) => t.id === c.teamId)!;
          await emit(leagueId, "WAIVER_CLAIM_WON", { team: team.name, player: player.name, playerId }, {
            notify: { userIds: [team.userId], title: `Waiver ganho: ${player.name}`, href: `/leagues/${leagueId}/team` },
          }, tx);
          await audit(leagueId, "WAIVER_SUCCESS", { playerId, dropPlayerId: c.dropPlayerId }, { teamId: c.teamId }, tx);
          touched.add(c.teamId);
        } catch (e) {
          const note = e instanceof UserError ? e.message : "Falhou.";
          await tx.waiverClaim.update({ where: { id: c.id }, data: { status: "FAILED", note, processedAt: new Date() } });
        }
      }
    });
  }
  for (const t of touched) await repairTeamLineups(t, leagueId);
  return touched.size;
}

export async function setTradeBlock(leagueId: string, teamId: string, playerId: string, on: boolean) {
  const e = await prisma.rosterEntry.findUnique({ where: { leagueId_playerId: { leagueId, playerId } } });
  if (!e || e.teamId !== teamId) throw new UserError("Esse jogador não está no teu plantel.");
  await prisma.rosterEntry.update({ where: { id: e.id }, data: { onTradeBlock: on } });
}
