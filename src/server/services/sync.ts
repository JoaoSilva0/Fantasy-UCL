import { prisma } from "../db";
import { UserError } from "../errors";
import { hashObject } from "@/lib/fantasy/scoring";
import { ApiFootballProvider } from "../providers/api-football";
import {
  DEMO_SEASON_ID, demoClubs, demoLeaguePhaseFixtures, demoPlayers, demoRoundDate, demoRounds, simulateDemoFixture,
} from "../providers/demo";
import type { FixtureData, FixtureDetail, FootballProvider, PlayerData, SeasonBundle } from "../providers/types";
import { finalizeRounds, recomputeFixtures } from "./scoring";
import { ensureSchedule } from "./matchups";

export function getProvider(): FootballProvider | null {
  const key = process.env.API_FOOTBALL_KEY;
  if ((process.env.FOOTBALL_PROVIDER ?? "api-football") === "api-football" && key) return new ApiFootballProvider(key);
  return null;
}

async function logged<T>(provider: string, job: string, fn: () => Promise<T>, requests: () => number): Promise<T> {
  const log = await prisma.syncLog.create({ data: { provider, job, status: "running" } });
  try {
    const out = await fn();
    await prisma.syncLog.update({ where: { id: log.id }, data: { status: "ok", finishedAt: new Date(), requests: requests(), message: JSON.stringify(out).slice(0, 500) } });
    return out;
  } catch (e) {
    await prisma.syncLog.update({ where: { id: log.id }, data: { status: "error", finishedAt: new Date(), requests: requests(), message: (e as Error).message.slice(0, 500) } });
    throw e;
  }
}

// ───────────── ingestão (comum a todos os providers) ─────────────

export async function upsertSeason(provider: string, bundle: SeasonBundle, isDemo = false) {
  const season = await prisma.season.upsert({
    where: { provider_externalId: { provider, externalId: bundle.externalId } },
    create: { provider, externalId: bundle.externalId, name: bundle.name, year: bundle.year, isDemo },
    update: { name: bundle.name },
  });
  for (const c of bundle.clubs) {
    await prisma.club.upsert({
      where: { seasonId_externalId: { seasonId: season.id, externalId: c.externalId } },
      create: { seasonId: season.id, ...c },
      update: { name: c.name, shortName: c.shortName, code: c.code, logoUrl: c.logoUrl, country: c.country },
    });
  }
  for (const r of bundle.rounds) {
    await prisma.round.upsert({
      where: { seasonId_key: { seasonId: season.id, key: r.key } },
      create: { seasonId: season.id, key: r.key, name: r.name, stage: r.stage, order: r.order },
      update: { name: r.name, stage: r.stage, order: r.order },
    });
  }
  await upsertFixtures(season.id, bundle.fixtures);
  return season;
}

async function upsertFixtures(seasonId: string, fixtures: FixtureData[]) {
  const clubs = new Map((await prisma.club.findMany({ where: { seasonId } })).map((c) => [c.externalId, c.id]));
  const rounds = new Map((await prisma.round.findMany({ where: { seasonId } })).map((r) => [r.key, r.id]));
  for (const f of fixtures) {
    const roundId = rounds.get(f.roundKey);
    const home = clubs.get(f.homeExternalId);
    const away = clubs.get(f.awayExternalId);
    if (!roundId || !home || !away) continue;
    const data = { roundId, homeClubId: home, awayClubId: away, kickoff: f.kickoff, status: f.status, statusDetail: f.statusDetail, minute: f.minute, homeGoals: f.homeGoals, awayGoals: f.awayGoals };
    await prisma.fixture.upsert({
      where: { seasonId_externalId: { seasonId, externalId: f.externalId } },
      create: { seasonId, externalId: f.externalId, ...data },
      update: data,
    });
  }
  // Datas de início/fim por jornada
  for (const roundId of rounds.values()) {
    const agg = await prisma.fixture.aggregate({ where: { roundId }, _min: { kickoff: true }, _max: { kickoff: true } });
    await prisma.round.update({ where: { id: roundId }, data: { startsAt: agg._min.kickoff, endsAt: agg._max.kickoff } });
  }
}

export async function upsertPlayers(seasonId: string, players: PlayerData[], deactivateMissing = true) {
  const clubs = new Map((await prisma.club.findMany({ where: { seasonId } })).map((c) => [c.externalId, c.id]));
  const seen = new Set<string>();
  for (const p of players) {
    const clubId = clubs.get(p.clubExternalId);
    if (!clubId || seen.has(p.externalId)) continue;
    seen.add(p.externalId);
    const { clubExternalId: _, externalId, ...rest } = p;
    await prisma.player.upsert({
      where: { seasonId_externalId: { seasonId, externalId } },
      create: { seasonId, externalId, clubId, ...rest },
      update: { clubId, ...rest, active: true },
    });
  }
  // Jogadores que saíram dos plantéis: inativos (não desaparecem de plantéis fantasy, mas não são escolhíveis).
  if (deactivateMissing && seen.size) await prisma.player.updateMany({ where: { seasonId, externalId: { notIn: [...seen] } }, data: { active: false } });
  return seen.size;
}

/**
 * Ingestão de um jogo: estado, eventos e estatísticas por jogador.
 * Deduplicação por (jogo, jogador) + hash; alterações ficam registadas em StatRevision.
 */
export async function ingestFixtureDetail(seasonId: string, d: FixtureDetail, source: string) {
  const fx = await prisma.fixture.findUnique({ where: { seasonId_externalId: { seasonId, externalId: d.fixture.externalId } } });
  if (!fx) return { fixtureId: null, changed: 0 };
  await prisma.fixture.update({
    where: { id: fx.id },
    data: {
      status: d.fixture.status, statusDetail: d.fixture.statusDetail, minute: d.fixture.minute, homeGoals: d.fixture.homeGoals,
      awayGoals: d.fixture.awayGoals, kickoff: d.fixture.kickoff, events: d.events as object, lastSyncedAt: new Date(),
      ...(d.players.length ? { statsSyncedAt: new Date() } : {}),
    },
  });
  const clubs = new Map((await prisma.club.findMany({ where: { seasonId } })).map((c) => [c.externalId, c.id]));
  let changed = 0;
  for (const p of d.players) {
    const clubId = clubs.get(p.clubExternalId);
    if (!clubId) continue;
    let player = await prisma.player.findUnique({ where: { seasonId_externalId: { seasonId, externalId: p.playerExternalId } } });
    // Jogador ainda não sincronizado (ex: inscrito recentemente): criado com os dados reais do jogo.
    player ??= await prisma.player.create({ data: { seasonId, externalId: p.playerExternalId, clubId, name: p.name, photoUrl: p.photoUrl, position: p.position } });
    const hash = hashObject(p.stats);
    const existing = await prisma.playerMatchStat.findUnique({ where: { fixtureId_playerId: { fixtureId: fx.id, playerId: player.id } } });
    if (existing?.hash === hash) continue;
    const data = {
      clubId, minutes: p.stats.minutes, started: p.stats.started, goals: p.stats.goals, assists: p.stats.assists,
      rating: p.stats.rating, stats: p.stats as object, raw: p.raw as object, hash, source,
    };
    if (existing) {
      await prisma.statRevision.create({ data: { statId: existing.id, previous: existing.stats as object, next: p.stats as object } });
      await prisma.playerMatchStat.update({ where: { id: existing.id }, data });
    } else {
      await prisma.playerMatchStat.create({ data: { fixtureId: fx.id, playerId: player.id, ...data } });
    }
    changed++;
  }
  if (changed) await recomputeFixtures([fx.id]);
  return { fixtureId: fx.id, changed };
}

// ───────────── jobs com provider real ─────────────

export async function syncSeason() {
  const provider = getProvider();
  if (!provider) throw new UserError("API_FOOTBALL_KEY não configurada. Define-a no .env do servidor.");
  return logged(provider.id, "season", async () => {
    const bundle = await provider.fetchSeason();
    const season = await upsertSeason(provider.id, bundle);
    const players = await provider.fetchPlayers(bundle.clubs.map((c) => c.externalId));
    const count = await upsertPlayers(season.id, players);
    await syncInjuries(provider, season.id);
    await prisma.season.update({ where: { id: season.id }, data: { lastSyncedAt: new Date(), syncError: null } });
    return { season: season.name, clubs: bundle.clubs.length, rounds: bundle.rounds.length, fixtures: bundle.fixtures.length, players: count };
  }, () => provider.requestCount());
}

async function syncInjuries(provider: FootballProvider, seasonId: string) {
  const injuries = await provider.fetchInjuries();
  await prisma.player.updateMany({ where: { seasonId, status: { not: "AVAILABLE" } }, data: { status: "AVAILABLE", statusNote: null, statusUpdatedAt: new Date() } });
  for (const i of injuries) {
    await prisma.player.updateMany({ where: { seasonId, externalId: i.playerExternalId }, data: { status: i.status, statusNote: i.note, statusUpdatedAt: new Date() } });
  }
  return injuries.length;
}

async function realSeason(provider: FootballProvider) {
  return prisma.season.findFirst({ where: { provider: provider.id, isDemo: false }, orderBy: { year: "desc" } });
}

/** Jogos em janela ativa (−15 min a +3 h do pontapé de saída) ou ainda marcados como ao vivo. */
export async function syncLive() {
  const provider = getProvider();
  if (!provider) return { skipped: "sem API key" };
  const season = await realSeason(provider);
  if (!season) return { skipped: "época não sincronizada" };
  return logged(provider.id, "live", async () => {
    const now = Date.now();
    const fixtures = await prisma.fixture.findMany({
      where: { seasonId: season.id, OR: [{ status: "LIVE" }, { status: "SCHEDULED", kickoff: { gte: new Date(now - 3 * 3600e3), lte: new Date(now + 15 * 60e3) } }] },
    });
    let changed = 0;
    for (const f of fixtures) {
      const d = await provider.fetchFixture(f.externalId, { live: true });
      if (d) changed += (await ingestFixtureDetail(season.id, d, provider.id)).changed;
    }
    return { fixtures: fixtures.length, changed };
  }, () => provider.requestCount());
}

/** Re-sincroniza jogos terminados nas últimas 48 h (correções) e fecha jornadas. */
export async function syncPostMatch() {
  const provider = getProvider();
  if (!provider) return { skipped: "sem API key" };
  const season = await realSeason(provider);
  if (!season) return { skipped: "época não sincronizada" };
  return logged(provider.id, "post", async () => {
    const fixtures = await prisma.fixture.findMany({
      where: { seasonId: season.id, kickoff: { gte: new Date(Date.now() - 48 * 3600e3), lte: new Date(Date.now() - 100 * 60e3) }, status: { in: ["LIVE", "FINISHED", "SCHEDULED"] } },
    });
    let changed = 0;
    for (const f of fixtures) {
      const d = await provider.fetchFixture(f.externalId);
      if (d) changed += (await ingestFixtureDetail(season.id, d, provider.id)).changed;
    }
    const finalized = await finalizeRounds(season.id);
    for (const l of await prisma.league.findMany({ where: { seasonId: season.id } })) await ensureSchedule(l.id);
    return { fixtures: fixtures.length, changed, finalized: finalized.length };
  }, () => provider.requestCount());
}

export async function syncDaily() {
  const provider = getProvider();
  if (!provider) return { skipped: "sem API key" };
  return syncSeason();
}

// ───────────── modo DEMO (fictício) ─────────────

/**
 * Cria uma época DEMO isolada (uma por liga): a simulação de jornadas numa liga nunca afeta outra.
 */
export async function createDemoSeason() {
  const season = await upsertSeason("demo", {
    externalId: `${DEMO_SEASON_ID}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: "DEMO · Liga Fictícia 2026/27", year: 2026,
    clubs: demoClubs(), rounds: demoRounds(), fixtures: demoLeaguePhaseFixtures(),
  }, true);
  await upsertPlayers(season.id, demoPlayers(), false);
  return season;
}

/**
 * Simula a próxima jornada DEMO (apenas épocas DEMO). `phase = "HALF"` deixa os jogos ao vivo ao minuto 45.
 * Os jogos simulados passam a ter pontapé de saída no passado para respeitar os bloqueios de onze.
 */
export async function simulateDemoRound(seasonId: string, phase: "HALF" | "FULL") {
  const season = await prisma.season.findUniqueOrThrow({ where: { id: seasonId } });
  if (!season.isDemo) throw new UserError("A simulação só existe para épocas DEMO. Dados reais vêm da API.");
  const round = await prisma.round.findFirst({ where: { seasonId, finalizedAt: null }, orderBy: { order: "asc" }, include: { fixtures: { include: { homeClub: true, awayClub: true } } } });
  if (!round) throw new UserError("A época DEMO já terminou.");
  if (!round.fixtures.length) throw new UserError("Esta jornada ainda não tem jogos definidos.");
  const players = await prisma.player.findMany({ where: { seasonId }, include: { club: true } });
  const squads = new Map<string, { externalId: string; name: string; position: "GK" | "DEF" | "MID" | "FWD"; clubExternalId: string }[]>();
  for (const p of players) squads.set(p.club.externalId, [...(squads.get(p.club.externalId) ?? []), { externalId: p.externalId, name: p.name, position: p.position, clubExternalId: p.club.externalId }]);
  const kickoff = new Date(Date.now() - (phase === "HALF" ? 50 : 115) * 60e3);
  for (const f of round.fixtures) {
    if (f.status === "FINISHED") continue;
    const fx: FixtureData = { externalId: f.externalId, roundKey: round.key, homeExternalId: f.homeClub.externalId, awayExternalId: f.awayClub.externalId, kickoff, status: "SCHEDULED", statusDetail: null, minute: null, homeGoals: null, awayGoals: null };
    await ingestFixtureDetail(seasonId, simulateDemoFixture(fx, squads, phase === "HALF" ? 45 : 90), "demo-simulated");
  }
  if (phase === "FULL") {
    await finalizeRounds(seasonId, 0, true);
    await createDemoKnockouts(seasonId);
    for (const l of await prisma.league.findMany({ where: { seasonId } })) await ensureSchedule(l.id);
  }
  return round.name;
}

/** Cria os jogos da fase seguinte DEMO a partir dos resultados simulados. */
async function createDemoKnockouts(seasonId: string) {
  const rounds = await prisma.round.findMany({ where: { seasonId }, orderBy: { order: "asc" }, include: { fixtures: { include: { homeClub: true, awayClub: true } } } });
  const clubs = await prisma.club.findMany({ where: { seasonId } });
  const lp = rounds.filter((r) => r.stage === "LEAGUE_PHASE");
  const make = async (key: string, pairs: [string, string][]) => {
    const r = rounds.find((x) => x.key === key)!;
    if (r.fixtures.length) return;
    const fixtures: FixtureData[] = pairs.map(([h, a], i) => {
      const k = demoRoundDate(1, new Date(Date.now() + 864e5 * 0));
      if (i >= 2) k.setUTCDate(k.getUTCDate() + 1);
      return { externalId: `demo-fx-${key}-${i + 1}`, roundKey: key, homeExternalId: h, awayExternalId: a, kickoff: k, status: "SCHEDULED", statusDetail: null, minute: null, homeGoals: null, awayGoals: null };
    });
    await upsertFixtures(seasonId, fixtures);
  };
  const ext = new Map(clubs.map((c) => [c.id, c.externalId]));
  if (lp.every((r) => r.finalizedAt)) {
    const table = new Map(clubs.map((c) => [c.id, { pts: 0, gd: 0 }]));
    for (const f of lp.flatMap((r) => r.fixtures)) {
      const h = table.get(f.homeClubId)!, a = table.get(f.awayClubId)!;
      const hg = f.homeGoals ?? 0, ag = f.awayGoals ?? 0;
      h.gd += hg - ag; a.gd += ag - hg;
      if (hg > ag) h.pts += 3; else if (ag > hg) a.pts += 3; else { h.pts++; a.pts++; }
    }
    const top = [...table.entries()].sort((x, y) => y[1].pts - x[1].pts || y[1].gd - x[1].gd).slice(0, 8).map(([id]) => ext.get(id)!);
    const qf: [string, string][] = [[top[7], top[0]], [top[6], top[1]], [top[5], top[2]], [top[4], top[3]]];
    await make("QF#1", qf);
    await make("QF#2", qf.map(([h, a]) => [a, h]));
  }
  const winners = (legs: string[]) => {
    const fx = rounds.filter((r) => legs.includes(r.key)).flatMap((r) => r.fixtures);
    if (!fx.length || fx.some((f) => f.status !== "FINISHED")) return null;
    const ties = new Map<string, { a: string; b: string; ga: number; gb: number }>();
    for (const f of fx) {
      const key = [f.homeClubId, f.awayClubId].sort().join("|");
      const t = ties.get(key) ?? { a: [f.homeClubId, f.awayClubId].sort()[0], b: [f.homeClubId, f.awayClubId].sort()[1], ga: 0, gb: 0 };
      t.ga += f.homeClubId === t.a ? f.homeGoals ?? 0 : f.awayGoals ?? 0;
      t.gb += f.homeClubId === t.b ? f.homeGoals ?? 0 : f.awayGoals ?? 0;
      ties.set(key, t);
    }
    // Empate na eliminatória: desempate determinístico (simulação de penáltis).
    return [...ties.values()].map((t) => ext.get(t.ga > t.gb ? t.a : t.gb > t.ga ? t.b : (hashObject(t).charCodeAt(0) % 2 ? t.a : t.b))!);
  };
  const qfW = winners(["QF#1", "QF#2"]);
  if (qfW) { const sf: [string, string][] = [[qfW[0], qfW[1]], [qfW[2], qfW[3]]]; await make("SF#1", sf); await make("SF#2", sf.map(([h, a]) => [a, h])); }
  const sfW = winners(["SF#1", "SF#2"]);
  if (sfW) await make("F", [[sfW[0], sfW[1]]]);
}
