import type { Pos } from "@/lib/fantasy/config";
import { emptyStats, type MatchStats } from "@/lib/fantasy/scoring";
import { cached, NonRetryableError } from "./cache";
import type {
  ClubData, FixtureData, FixtureDetail, FixtureStatusKey, FootballProvider, InjuryData, MatchEvent, PlayerData, RoundData, SeasonBundle, StageKey,
} from "./types";

/**
 * Adaptador API-Football v3 (api-sports.io).
 * Documentação: https://www.api-football.com/documentation-v3
 * A chave é lida apenas no servidor (process.env.API_FOOTBALL_KEY).
 */

export const API_FOOTBALL_CAPABILITIES: ReadonlySet<keyof MatchStats> = new Set<keyof MatchStats>([
  "minutes", "started", "goals", "assists", "shotsTotal", "shotsOnTarget", "dribblesSuccess", "penaltiesWon",
  "penaltiesMissed", "offsides", "interceptions", "tackles", "blockedShots", "duelsWon", "saves", "penaltiesSaved",
  "keyPasses", "yellowCards", "redCards", "ownGoals", "penaltiesCommitted", "goalsConcededOnPitch", "rating",
]);

// ───────────── tipos mínimos das respostas ─────────────
type Num = number | null;
interface AFFixture {
  fixture: { id: number; date: string; status: { short: string; long: string; elapsed: Num } };
  league: { round: string };
  teams: { home: { id: number; name: string; logo: string }; away: { id: number; name: string; logo: string } };
  goals: { home: Num; away: Num };
  events?: AFEvent[];
  players?: { team: { id: number }; players: AFPlayerStats[] }[];
}
interface AFEvent {
  time: { elapsed: number; extra: Num };
  team: { id: number };
  player: { id: Num; name: string | null };
  assist: { id: Num; name: string | null };
  type: string;
  detail: string;
}
interface AFPlayerStats {
  player: { id: number; name: string; photo: string | null };
  statistics: {
    games: { minutes: Num; position: string | null; rating: string | null; substitute: boolean | null };
    offsides: Num;
    shots: { total: Num; on: Num };
    goals: { total: Num; conceded: Num; assists: Num; saves: Num };
    passes: { key: Num };
    tackles: { total: Num; blocks: Num; interceptions: Num };
    duels: { won: Num };
    dribbles: { success: Num };
    cards: { yellow: Num; red: Num };
    penalty: { won: Num; commited: Num; scored: Num; missed: Num; saved: Num };
  }[];
}

// ───────────── mapeamentos puros (testáveis) ─────────────

export function mapStatus(short: string): FixtureStatusKey {
  if (["NS", "TBD"].includes(short)) return "SCHEDULED";
  if (["FT", "AET", "PEN"].includes(short)) return "FINISHED";
  if (short === "PST") return "POSTPONED";
  if (["CANC", "ABD", "AWD", "WO"].includes(short)) return "CANCELLED";
  return "LIVE"; // 1H, HT, 2H, ET, BT, P, SUSP, INT, LIVE
}

/** Mapeia o nome de ronda da API para a fase da UCL. Rondas de qualificação são ignoradas (null). */
export function mapRound(round: string): { stage: StageKey; matchday: number | null } | null {
  const ls = round.match(/^(?:League Stage|Group Stage|League Phase)\s*-\s*(\d+)/i);
  if (ls) return { stage: "LEAGUE_PHASE", matchday: Number(ls[1]) };
  if (/knockout round play-?offs/i.test(round)) return { stage: "PLAYOFF", matchday: null };
  if (/round of 16|8th finals/i.test(round)) return { stage: "R16", matchday: null };
  if (/quarter-?finals/i.test(round)) return { stage: "QF", matchday: null };
  if (/semi-?finals/i.test(round)) return { stage: "SF", matchday: null };
  if (/^final$/i.test(round.trim())) return { stage: "FINAL", matchday: null };
  return null;
}

const STAGE_PT: Record<StageKey, string> = {
  LEAGUE_PHASE: "Fase de Liga", PLAYOFF: "Play-off KO", R16: "Oitavos", QF: "Quartos", SF: "Meias-finais", FINAL: "Final",
};

/**
 * Constrói jornadas fantasy a partir das rondas da API. Eliminatórias a duas mãos são divididas
 * em duas jornadas (1.ª/2.ª mão) agrupando jogos separados por mais de 4 dias.
 */
export function buildRounds(fixtures: { round: string; kickoff: Date; externalId: string }[]) {
  const groups = new Map<string, typeof fixtures>();
  for (const f of fixtures) {
    if (!mapRound(f.round)) continue;
    groups.set(f.round, [...(groups.get(f.round) ?? []), f]);
  }
  const rounds: (RoundData & { start: number })[] = [];
  const fixtureRound = new Map<string, string>();
  for (const [name, list] of groups) {
    const m = mapRound(name)!;
    list.sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime());
    const legs: (typeof list)[] = [];
    for (const f of list) {
      const cur = legs[legs.length - 1];
      if (cur && f.kickoff.getTime() - cur[cur.length - 1].kickoff.getTime() <= 4 * 864e5) cur.push(f);
      else legs.push([f]);
    }
    legs.forEach((leg, i) => {
      const twoLegs = legs.length > 1;
      const key = twoLegs ? `${name}#${i + 1}` : name;
      const label = m.stage === "LEAGUE_PHASE"
        ? `Fase de Liga · Jornada ${m.matchday}`
        : `${STAGE_PT[m.stage]}${twoLegs ? ` · ${i + 1}.ª mão` : ""}`;
      rounds.push({ key, name: label, stage: m.stage, order: 0, start: leg[0].kickoff.getTime() });
      for (const f of leg) fixtureRound.set(f.externalId, key);
    });
  }
  rounds.sort((a, b) => a.start - b.start);
  return {
    rounds: rounds.map(({ start: _s, ...r }, i) => ({ ...r, order: i + 1 })),
    fixtureRound,
  };
}

const POS_MAP: Record<string, Pos> = { G: "GK", D: "DEF", M: "MID", F: "FWD", Goalkeeper: "GK", Defender: "DEF", Midfielder: "MID", Attacker: "FWD" };

function eventType(e: AFEvent): MatchEvent["type"] | null {
  const d = e.detail ?? "";
  if (e.type === "Goal") {
    if (/own goal/i.test(d)) return "OWN_GOAL";
    if (/missed penalty/i.test(d)) return "MISSED_PENALTY";
    if (/penalty/i.test(d)) return "PENALTY_GOAL";
    return "GOAL";
  }
  if (e.type === "Card") return /red/i.test(d) || /second yellow/i.test(d) ? "RED" : "YELLOW";
  if (e.type === "subst") return "SUB";
  return null;
}

/** Normaliza a resposta de GET /fixtures?id= (eventos + estatísticas por jogador). */
export function normalizeFixture(f: AFFixture, roundKey: string): FixtureDetail {
  const homeId = String(f.teams.home.id);
  const awayId = String(f.teams.away.id);
  const status = mapStatus(f.fixture.status.short);
  const fixture: FixtureData = {
    externalId: String(f.fixture.id), roundKey, homeExternalId: homeId, awayExternalId: awayId,
    kickoff: new Date(f.fixture.date), status, statusDetail: f.fixture.status.long, minute: f.fixture.status.elapsed,
    homeGoals: f.goals.home, awayGoals: f.goals.away,
  };
  const events: MatchEvent[] = [];
  for (const e of f.events ?? []) {
    const type = eventType(e);
    if (!type) continue;
    events.push({
      minute: e.time.elapsed + (e.time.extra ?? 0), type, clubExternalId: String(e.team.id),
      playerExternalId: e.player.id ? String(e.player.id) : null, playerName: e.player.name,
      assistExternalId: e.assist.id ? String(e.assist.id) : null, assistName: e.assist.name,
    });
  }

  // Golos sofridos por equipa, com minuto. A atribuição de autogolos é validada contra o resultado final.
  const goalsAgainst = (club: string, ogBeneficiary: boolean) =>
    events.filter((e) => {
      if (e.type === "GOAL" || e.type === "PENALTY_GOAL") return e.clubExternalId !== club;
      if (e.type === "OWN_GOAL") return ogBeneficiary ? e.clubExternalId !== club : e.clubExternalId === club;
      return false;
    }).map((e) => e.minute);
  let ogBeneficiary = true;
  if (f.goals.home !== null && goalsAgainst(awayId, true).length !== f.goals.home && goalsAgainst(awayId, false).length === f.goals.home)
    ogBeneficiary = false;
  const concededMinutes = { [homeId]: goalsAgainst(homeId, ogBeneficiary), [awayId]: goalsAgainst(awayId, ogBeneficiary) };
  const ownGoalScorer = (club: string) => (ogBeneficiary ? (club === homeId ? awayId : homeId) : club);
  const matchEnd = Math.max(90, f.fixture.status.elapsed ?? 90);

  const n = (v: Num) => v ?? 0; // A API devolve null quando o valor é 0 (métricas suportadas).
  const players: FixtureDetail["players"] = [];
  for (const team of f.players ?? []) {
    const club = String(team.team.id);
    for (const p of team.players) {
      const s = p.statistics[0];
      if (!s) continue;
      const minutes = n(s.games.minutes);
      const started = s.games.substitute === false;
      const pid = String(p.player.id);
      // Intervalo em campo derivado dos minutos jogados (titular: início; suplente: fim do jogo).
      const from = started ? 0 : matchEnd - minutes;
      const to = started ? minutes : matchEnd;
      const conceded = minutes > 0 ? concededMinutes[club].filter((m) => m >= from && m <= to).length : 0;
      const ownGoals = events.filter((e) => e.type === "OWN_GOAL" && e.playerExternalId === pid && ownGoalScorer(e.clubExternalId) === club).length;
      const rating = s.games.rating ? Number(s.games.rating) : null;
      const stats: MatchStats = {
        ...emptyStats(),
        minutes, started, goals: n(s.goals.total), assists: n(s.goals.assists),
        shotsTotal: n(s.shots.total), shotsOnTarget: n(s.shots.on), dribblesSuccess: n(s.dribbles.success),
        penaltiesWon: n(s.penalty.won), penaltiesMissed: n(s.penalty.missed), offsides: n(s.offsides),
        interceptions: n(s.tackles.interceptions), tackles: n(s.tackles.total), blockedShots: n(s.tackles.blocks),
        duelsWon: n(s.duels.won), saves: n(s.goals.saves), penaltiesSaved: n(s.penalty.saved), keyPasses: n(s.passes.key),
        yellowCards: n(s.cards.yellow), redCards: n(s.cards.red), ownGoals, penaltiesCommitted: n(s.penalty.commited),
        goalsConcededOnPitch: minutes > 0 ? conceded : null,
        rating: rating !== null && Number.isFinite(rating) ? rating : null,
      };
      players.push({
        playerExternalId: pid, clubExternalId: club, name: p.player.name, photoUrl: p.player.photo,
        position: POS_MAP[s.games.position ?? ""] ?? "MID", stats, raw: s,
      });
    }
  }
  return { fixture, events, players };
}

// ───────────── cliente HTTP ─────────────

export class ApiFootballProvider implements FootballProvider {
  id = "api-football";
  capabilities = API_FOOTBALL_CAPABILITIES;
  private requests = 0;
  private roundOf = new Map<string, string>();

  constructor(
    private key: string,
    private leagueId = Number(process.env.UCL_LEAGUE_ID ?? 2),
    private season = Number(process.env.UCL_SEASON ?? new Date().getFullYear()),
    private baseUrl = process.env.API_FOOTBALL_BASE_URL ?? "https://v3.football.api-sports.io",
  ) {}

  requestCount() {
    return this.requests;
  }

  private async get<T>(path: string, params: Record<string, string | number>, ttl: number): Promise<T> {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
    const key = `af:${path}?${qs}`;
    const { value } = await cached<T>(key, ttl, async () => {
      this.requests++;
      const res = await fetch(`${this.baseUrl}/${path}?${qs}`, { headers: { "x-apisports-key": this.key }, cache: "no-store" });
      if (res.status === 401 || res.status === 403) throw new NonRetryableError(`API-Football: chave inválida (${res.status})`);
      if (!res.ok) throw new Error(`API-Football ${path}: HTTP ${res.status}`);
      const json = (await res.json()) as { errors?: unknown; response: unknown; paging?: unknown };
      const errs = json.errors && (Array.isArray(json.errors) ? json.errors.length : Object.keys(json.errors as object).length);
      if (errs) throw new NonRetryableError(`API-Football: ${JSON.stringify(json.errors)}`);
      return json as T;
    });
    return value;
  }

  async fetchSeason(): Promise<SeasonBundle> {
    const r = await this.get<{ response: AFFixture[] }>("fixtures", { league: this.leagueId, season: this.season }, 3600);
    const valid = r.response.filter((f) => mapRound(f.league.round));
    const { rounds, fixtureRound } = buildRounds(valid.map((f) => ({ round: f.league.round, kickoff: new Date(f.fixture.date), externalId: String(f.fixture.id) })));
    this.roundOf = fixtureRound;
    const clubMap = new Map<string, ClubData>();
    const teams = await this.get<{ response: { team: { id: number; name: string; code: string | null; country: string | null; logo: string } }[] }>(
      "teams", { league: this.leagueId, season: this.season }, 86400,
    );
    const meta = new Map(teams.response.map((t) => [String(t.team.id), t.team]));
    // Só clubes que disputam a fase de liga/eliminatórias (exclui eliminados na qualificação).
    for (const f of valid) {
      for (const t of [f.teams.home, f.teams.away]) {
        const m = meta.get(String(t.id));
        clubMap.set(String(t.id), {
          externalId: String(t.id), name: t.name, shortName: t.name.replace(/^(FC|AFC|SL|SC|AC|AS|RB|SSC|PSV)\s+/i, "").slice(0, 16),
          code: m?.code ?? null, logoUrl: t.logo, country: m?.country ?? null,
        });
      }
    }
    return {
      externalId: `${this.leagueId}:${this.season}`,
      name: `UEFA Champions League ${this.season}/${String(this.season + 1).slice(2)}`,
      year: this.season,
      clubs: [...clubMap.values()],
      rounds,
      fixtures: valid.map((f) => normalizeFixture({ ...f, events: [], players: [] }, fixtureRound.get(String(f.fixture.id))!).fixture),
    };
  }

  async fetchPlayers(clubExternalIds: string[]): Promise<PlayerData[]> {
    // Nacionalidade/data de nascimento: endpoint de jogadores da competição (paginado).
    const meta = new Map<string, { nationality: string | null; birth: string | null; firstname: string | null; lastname: string | null }>();
    for (let page = 1, total = 1; page <= total && page <= 80; page++) {
      const r = await this.get<{ paging: { total: number }; response: { player: { id: number; firstname: string | null; lastname: string | null; nationality: string | null; birth: { date: string | null } } }[] }>(
        "players", { league: this.leagueId, season: this.season, page }, 86400,
      );
      total = r.paging.total;
      for (const p of r.response) meta.set(String(p.player.id), { nationality: p.player.nationality, birth: p.player.birth.date, firstname: p.player.firstname, lastname: p.player.lastname });
    }
    const out: PlayerData[] = [];
    for (const club of clubExternalIds) {
      const r = await this.get<{ response: { players: { id: number; name: string; age: Num; number: Num; position: string; photo: string | null }[] }[] }>(
        "players/squads", { team: club }, 86400,
      );
      for (const p of r.response[0]?.players ?? []) {
        const m = meta.get(String(p.id));
        out.push({
          externalId: String(p.id), clubExternalId: club, name: p.name, firstName: m?.firstname ?? null, lastName: m?.lastname ?? null,
          photoUrl: p.photo, nationality: m?.nationality ?? null, position: POS_MAP[p.position] ?? "MID", age: p.age,
          birthDate: m?.birth ? new Date(m.birth) : null, shirtNumber: p.number,
        });
      }
    }
    return out;
  }

  async fetchInjuries(): Promise<InjuryData[]> {
    const r = await this.get<{ response: { player: { id: number; type: string; reason: string }; fixture: { date: string } }[] }>(
      "injuries", { league: this.leagueId, season: this.season }, 6 * 3600,
    );
    const since = Date.now() - 864e5;
    const latest = new Map<string, InjuryData>();
    for (const i of r.response.filter((x) => new Date(x.fixture.date).getTime() >= since)) {
      const status: InjuryData["status"] = /suspen|red card|yellow cards/i.test(i.player.reason)
        ? "SUSPENDED" : /questionable/i.test(i.player.type) ? "DOUBTFUL" : "INJURED";
      if (!latest.has(String(i.player.id))) latest.set(String(i.player.id), { playerExternalId: String(i.player.id), status, note: i.player.reason });
    }
    return [...latest.values()];
  }

  async fetchFixture(externalId: string, opts: { live?: boolean } = {}): Promise<FixtureDetail | null> {
    const r = await this.get<{ response: AFFixture[] }>("fixtures", { id: externalId }, opts.live ? 45 : 1800);
    const f = r.response[0];
    if (!f) return null;
    const key = this.roundOf.get(externalId) ?? f.league.round;
    return normalizeFixture(f, key);
  }
}
