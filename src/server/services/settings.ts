import {
  DEFAULT_SCORING,
  DEFAULT_SETTINGS,
  leagueSettingsSchema,
  scoringRulesSchema,
  type LeagueSettings,
  type ScoringRules,
} from "@/lib/fantasy/config";

export function parseSettings(json: unknown): LeagueSettings {
  const r = leagueSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...(json as object) });
  return r.success ? r.data : DEFAULT_SETTINGS;
}

export function parseScoring(json: unknown): ScoringRules {
  const r = scoringRulesSchema.safeParse({ ...DEFAULT_SCORING, ...(json as object) });
  return r.success ? r.data : DEFAULT_SCORING;
}
