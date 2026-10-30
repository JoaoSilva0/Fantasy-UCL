import type { MatchStats } from "@/lib/fantasy/scoring";
import type { Pos } from "@/lib/fantasy/config";

export type StageKey = "LEAGUE_PHASE" | "PLAYOFF" | "R16" | "QF" | "SF" | "FINAL";
export type FixtureStatusKey = "SCHEDULED" | "LIVE" | "FINISHED" | "POSTPONED" | "CANCELLED";

export interface ClubData {
  externalId: string;
  name: string;
  shortName: string;
  code: string | null;
  logoUrl: string | null;
  country: string | null;
}

export interface RoundData {
  key: string;
  name: string;
  stage: StageKey;
  order: number;
}

export interface FixtureData {
  externalId: string;
  roundKey: string;
  homeExternalId: string;
  awayExternalId: string;
  kickoff: Date;
  status: FixtureStatusKey;
  statusDetail: string | null;
  minute: number | null;
  homeGoals: number | null;
  awayGoals: number | null;
}

export interface PlayerData {
  externalId: string;
  clubExternalId: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
  nationality: string | null;
  position: Pos;
  age: number | null;
  birthDate: Date | null;
  shirtNumber: number | null;
}

export interface InjuryData {
  playerExternalId: string;
  status: "INJURED" | "SUSPENDED" | "DOUBTFUL";
  note: string;
}

export interface MatchEvent {
  minute: number;
  type: "GOAL" | "OWN_GOAL" | "PENALTY_GOAL" | "MISSED_PENALTY" | "YELLOW" | "RED" | "SUB";
  clubExternalId: string;
  playerExternalId: string | null;
  playerName: string | null;
  assistExternalId: string | null;
  assistName: string | null;
}

export interface FixtureDetail {
  fixture: FixtureData;
  events: MatchEvent[];
  players: {
    playerExternalId: string;
    clubExternalId: string;
    name: string;
    photoUrl: string | null;
    position: Pos;
    stats: MatchStats;
    raw: unknown;
  }[];
}

export interface SeasonBundle {
  externalId: string;
  name: string;
  year: number;
  clubs: ClubData[];
  rounds: RoundData[];
  fixtures: FixtureData[];
}

export interface FootballProvider {
  id: string;
  /** Métricas de MatchStats que este provider fornece. As restantes ficam `null` (n/d). */
  capabilities: ReadonlySet<keyof MatchStats>;
  fetchSeason(): Promise<SeasonBundle>;
  fetchPlayers(clubExternalIds: string[]): Promise<PlayerData[]>;
  fetchInjuries(): Promise<InjuryData[]>;
  fetchFixture(externalId: string, opts?: { live?: boolean }): Promise<FixtureDetail | null>;
  requestCount(): number;
}
