import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { ensureDemoSeason, simulateDemoRound } from "@/server/services/sync";
import { createLeague, joinLeague, updateSettings } from "@/server/services/leagues";
import { makePick, randomizeOrder, startDraft, tickDraft } from "@/server/services/draft";
import { saveLineup, getOrCreateLineup } from "@/server/services/lineups";
import { proposeTrade, respondTrade, voteTrade } from "@/server/services/trades";
import { addFreeAgent, claimWaiver, dropPlayer, processWaivers } from "@/server/services/roster";
import { standings } from "@/server/services/matchups";
import { parseScoring, parseSettings } from "@/server/services/access";
import { seededShuffle, seedHash, teamForPick } from "@/lib/fantasy/snake";
import { scorePlayer, type MatchStats } from "@/lib/fantasy/scoring";
import type { Pos } from "@/lib/fantasy/config";

let leagueId = "";
let seasonId = "";
const users: string[] = [];

async function reset() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

async function teams() {
  return prisma.team.findMany({ where: { leagueId }, include: { roster: { include: { player: true } } }, orderBy: { createdAt: "asc" } });
}

beforeAll(async () => {
  await reset();
  seasonId = (await ensureDemoSeason()).id;
  for (let i = 1; i <= 8; i++) {
    const u = await prisma.user.create({ data: { email: `u${i}@test.pt`, passwordHash: "x", displayName: `Amigo ${i}` } });
    users.push(u.id);
  }
});

describe("simulação de uma liga com 8 participantes", () => {
  it("cria a liga e aceita 7 convidados por código", async () => {
    const league = await createLeague({ userId: users[0], name: "Liga dos Amigos", teamName: "Equipa 1", seasonId, maxTeams: 8 });
    leagueId = league.id;
    for (let i = 1; i < 8; i++) await joinLeague({ userId: users[i], code: league.inviteCode.toLowerCase(), teamName: `Equipa ${i + 1}` });
    const extra = await prisma.user.create({ data: { email: "extra@test.pt", passwordHash: "x", displayName: "Penetra" } });
    await expect(joinLeague({ userId: extra.id, code: league.inviteCode, teamName: "Nope" })).rejects.toThrow(/completa/);
    expect(await prisma.team.count({ where: { leagueId } })).toBe(8);
  });

  it("sorteio é verificável (commit–reveal)", async () => {
    await updateSettings(leagueId, users[0], { draft: { pickSeconds: 30 } });
    await randomizeOrder(leagueId, users[0]);
    const d = await prisma.draft.findUniqueOrThrow({ where: { leagueId } });
    const ids = (await teams()).map((t) => t.id);
    expect(seedHash(d.seed!)).toBe(d.seedHash);
    expect(d.order).toEqual(seededShuffle(ids, d.seed!));
    await expect(randomizeOrder(leagueId, users[0])).rejects.toThrow(/definitiva/);
  });

  it("draft snake completo: 120 escolhas, auto-pick, corrida concorrente e sem duplicados", async () => {
    await startDraft(leagueId, users[0]);
    const all = await prisma.player.findMany({ where: { seasonId } });
    let raceTested = false;
    for (;;) {
      const d = await prisma.draft.findUniqueOrThrow({ where: { leagueId } });
      if (d.status === "COMPLETED") break;
      const slot = teamForPick(d.order as string[], d.currentPick);
      if (slot.teamId !== teamForPick(d.order as string[], d.currentPick).teamId) throw new Error("ordem");
      if (d.currentPick % 5 === 0) {
        // Tempo esgotado → auto-pick
        await prisma.draft.update({ where: { id: d.id }, data: { pickDeadline: new Date(Date.now() - 1000) } });
        await tickDraft(leagueId);
        continue;
      }
      const taken = new Set((await prisma.rosterEntry.findMany({ where: { leagueId } })).map((r) => r.playerId));
      const mine = await prisma.rosterEntry.findMany({ where: { teamId: slot.teamId }, include: { player: true } });
      const limits = { GK: 2, DEF: 5, MID: 5, FWD: 3 } as Record<Pos, number>;
      const count = (p: Pos) => mine.filter((m) => m.player.position === p).length;
      const options = all.filter((p) => !taken.has(p.id) && count(p.position as Pos) < limits[p.position as Pos]);
      if (!raceTested) {
        // Dois pedidos simultâneos para a mesma escolha: só um pode vencer.
        const res = await Promise.allSettled([
          makePick({ leagueId, teamId: slot.teamId, playerId: options[0].id, expectedPick: d.currentPick }),
          makePick({ leagueId, teamId: slot.teamId, playerId: options[1].id, expectedPick: d.currentPick }),
        ]);
        expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        raceTested = true;
        continue;
      }
      const wrongTeam = (d.order as string[]).find((t) => t !== slot.teamId)!;
      if (d.currentPick === 2) await expect(makePick({ leagueId, teamId: wrongTeam, playerId: options[0].id })).rejects.toThrow(/vez/);
      await makePick({ leagueId, teamId: slot.teamId, playerId: options[Math.floor(options.length / 3)].id, expectedPick: d.currentPick });
    }
    const ts = await teams();
    for (const t of ts) {
      expect(t.roster).toHaveLength(15);
      const c = (p: string) => t.roster.filter((r) => r.player.position === p).length;
      expect([c("GK"), c("DEF"), c("MID"), c("FWD")]).toEqual([2, 5, 5, 3]);
    }
    const ids = ts.flatMap((t) => t.roster.map((r) => r.playerId));
    expect(new Set(ids).size).toBe(120);
    expect(await prisma.draftPick.count({ where: { draft: { leagueId }, auto: true } })).toBeGreaterThanOrEqual(23);
    expect((await prisma.league.findUniqueOrThrow({ where: { id: leagueId } })).status).toBe("ACTIVE");
    expect(await prisma.matchup.count({ where: { leagueId, isPlayoff: false } })).toBeGreaterThan(0);
  });

  it("onze: valida formação e capitão", async () => {
    const [t] = await teams();
    const r1 = await prisma.round.findFirstOrThrow({ where: { seasonId }, orderBy: { order: "asc" } });
    const lineup = (await getOrCreateLineup(t.id, r1.id, leagueId))!;
    const settings = parseSettings((await prisma.league.findUniqueOrThrow({ where: { id: leagueId } })).settings);
    await expect(saveLineup({ teamId: t.id, roundId: r1.id, leagueId, settings, input: { ...lineup, formation: "3-5-2" } })).rejects.toThrow(/formação/);
    await expect(saveLineup({ teamId: t.id, roundId: r1.id, leagueId, settings, input: { ...lineup, captainId: lineup.bench[0] } })).rejects.toThrow(/capitão/);
    await saveLineup({ teamId: t.id, roundId: r1.id, leagueId, settings, input: { ...lineup, captainId: lineup.starters[5], viceCaptainId: lineup.starters[6] } });
  });

  it("jornada: ao vivo ao intervalo, depois fechada com pontuações corretas", async () => {
    await simulateDemoRound(seasonId, "HALF");
    const r1 = await prisma.round.findFirstOrThrow({ where: { seasonId }, orderBy: { order: "asc" } });
    expect(await prisma.fixture.count({ where: { roundId: r1.id, status: "LIVE" } })).toBe(6);
    const live = await prisma.teamRoundScore.findMany({ where: { leagueId, roundId: r1.id } });
    expect(live).toHaveLength(8);

    // Bloqueio: com jogos começados, não se pode trocar o onze (modo PER_FIXTURE).
    const [t] = await teams();
    const l = (await getOrCreateLineup(t.id, r1.id, leagueId))!;
    const settings = parseSettings((await prisma.league.findUniqueOrThrow({ where: { id: leagueId } })).settings);
    const swapped = { ...l, starters: [...l.starters], bench: [...l.bench] };
    const benchDef = swapped.bench.findIndex((id) => t.roster.find((r) => r.playerId === id)?.player.position === "DEF");
    const starterDef = swapped.starters.findIndex((id) => t.roster.find((r) => r.playerId === id)?.player.position === "DEF");
    [swapped.starters[starterDef], swapped.bench[benchDef]] = [swapped.bench[benchDef], swapped.starters[starterDef]];
    await expect(saveLineup({ teamId: t.id, roundId: r1.id, leagueId, settings, input: swapped })).rejects.toThrow(/começou/);

    await simulateDemoRound(seasonId, "FULL");
    const r1b = await prisma.round.findUniqueOrThrow({ where: { id: r1.id } });
    expect(r1b.finalizedAt).not.toBeNull();

    // Validação: pontos guardados = motor de pontuação aplicado às estatísticas.
    const rules = parseScoring((await prisma.league.findUniqueOrThrow({ where: { id: leagueId } })).scoring);
    const pts = await prisma.leaguePlayerPoints.findMany({ where: { leagueId, roundId: r1.id }, include: { player: true } });
    expect(pts.length).toBeGreaterThan(100);
    for (const p of pts.slice(0, 60)) {
      const st = await prisma.playerMatchStat.findUniqueOrThrow({ where: { fixtureId_playerId: { fixtureId: p.fixtureId, playerId: p.playerId } } });
      expect(p.points).toBe(scorePlayer(st.stats as unknown as MatchStats, p.player.position as Pos, rules).total);
    }
    // Pontuação de equipa = soma dos titulares usados (capitão ×2).
    const scores = await prisma.teamRoundScore.findMany({ where: { leagueId, roundId: r1.id } });
    for (const s of scores) {
      const d = s.details as { players: { playerId: string; multiplier: number }[] };
      let expected = 0;
      for (const u of d.players) expected += pts.filter((x) => x.playerId === u.playerId).reduce((a, x) => a + x.points, 0) * u.multiplier;
      expect(s.points).toBeCloseTo(expected, 1);
      expect(s.final).toBe(true);
    }
    const table = await standings(leagueId);
    expect(table).toHaveLength(8);
    expect(table[0].w + table[0].d + table[0].l).toBe(1);
  });

  it("trades: votação com veto e troca livre executada", async () => {
    const [a, b] = await teams();
    const give = a.roster.find((r) => r.player.position === "MID")!.playerId;
    const get = b.roster.find((r) => r.player.position === "MID")!.playerId;
    const t1 = await proposeTrade({ leagueId, proposerTeamId: a.id, receiverTeamId: b.id, give: [give], get: [get], userId: a.userId });
    expect(await respondTrade({ leagueId, tradeId: t1.id, teamId: b.id, accept: true, userId: b.userId })).toBe("review");
    const others = (await teams()).slice(2);
    await expect(voteTrade({ leagueId, tradeId: t1.id, teamId: a.id, veto: true })).rejects.toThrow(/envolvidos/);
    for (const o of others.slice(0, 3)) await voteTrade({ leagueId, tradeId: t1.id, teamId: o.id, veto: true });
    expect((await prisma.trade.findUniqueOrThrow({ where: { id: t1.id } })).status).toBe("VETOED");

    await updateSettings(leagueId, users[0], { trades: { ...parseSettings((await prisma.league.findUniqueOrThrow({ where: { id: leagueId } })).settings).trades, approval: "FREE", flagImbalanced: false } });
    const t2 = await proposeTrade({ leagueId, proposerTeamId: a.id, receiverTeamId: b.id, give: [give], get: [get], userId: a.userId });
    expect(await respondTrade({ leagueId, tradeId: t2.id, teamId: b.id, accept: true, userId: b.userId })).toBe("execute");
    expect((await prisma.rosterEntry.findFirstOrThrow({ where: { leagueId, playerId: give } })).teamId).toBe(b.id);
    expect((await prisma.rosterEntry.findFirstOrThrow({ where: { leagueId, playerId: get } })).teamId).toBe(a.id);
    // Cooldown anti-colusão: não pode devolver já o jogador recebido.
    await expect(proposeTrade({ leagueId, proposerTeamId: a.id, receiverTeamId: b.id, give: [get], get: [give], userId: a.userId })).rejects.toThrow(/colusão/);
  });

  it("waivers: libertado fica em waivers e a prioridade roda", async () => {
    const ts = await teams();
    const [a, b, c] = ts;
    const dropped = a.roster.find((r) => r.player.position === "FWD")!;
    await dropPlayer({ leagueId, teamId: a.id, playerId: dropped.playerId, userId: a.userId });
    const bDrop = b.roster.find((r) => r.player.position === "FWD")!.playerId;
    const cDrop = c.roster.find((r) => r.player.position === "FWD")!.playerId;
    await expect(addFreeAgent({ leagueId, teamId: b.id, playerId: dropped.playerId, dropPlayerId: bDrop, userId: b.userId })).rejects.toThrow(/waivers/);
    await claimWaiver({ leagueId, teamId: b.id, playerId: dropped.playerId, dropPlayerId: bDrop, userId: b.userId });
    await claimWaiver({ leagueId, teamId: c.id, playerId: dropped.playerId, dropPlayerId: cDrop, userId: c.userId });
    await prisma.playerLeagueState.update({ where: { leagueId_playerId: { leagueId, playerId: dropped.playerId } }, data: { waiverUntil: new Date(Date.now() - 1000) } });
    const prio = new Map(ts.map((t) => [t.id, t.waiverPriority]));
    const expectedWinner = prio.get(b.id)! < prio.get(c.id)! ? b : c;
    await processWaivers(leagueId);
    const entry = await prisma.rosterEntry.findFirstOrThrow({ where: { leagueId, playerId: dropped.playerId } });
    expect(entry.teamId).toBe(expectedWinner.id);
    expect((await prisma.team.findUniqueOrThrow({ where: { id: expectedWinner.id } })).waiverPriority).toBe(8);
    const priorities = (await prisma.team.findMany({ where: { leagueId } })).map((t) => t.waiverPriority).sort((x, y) => x - y);
    expect(priorities).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // A equipa A ficou com 14: pode contratar um free agent livre.
    const taken = new Set((await prisma.rosterEntry.findMany({ where: { leagueId } })).map((r) => r.playerId));
    const fa = await prisma.player.findFirstOrThrow({ where: { seasonId, position: "FWD", id: { notIn: [...taken] } } });
    await addFreeAgent({ leagueId, teamId: a.id, playerId: fa.id, userId: a.userId });
    expect(await prisma.rosterEntry.count({ where: { teamId: a.id } })).toBe(15);
  });

  it("auditoria regista todas as operações", async () => {
    const types = (await prisma.transaction.findMany({ where: { leagueId } })).map((t) => t.type);
    for (const t of ["LEAGUE_CREATED", "DRAFT_ORDER", "DRAFT_PICK", "TRADE_COMPLETED", "TRADE_VETOED", "PLAYER_DROP", "WAIVER_SUCCESS", "FREE_AGENT_ADD"]) expect(types).toContain(t);
  });
});
