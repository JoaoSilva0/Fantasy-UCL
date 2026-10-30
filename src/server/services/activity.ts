import { prisma, type Tx } from "../db";

export type ActivityType =
  | "LEAGUE_CREATED" | "TEAM_JOINED" | "DRAFT_ORDER" | "DRAFT_STARTED" | "DRAFT_PAUSED" | "DRAFT_RESUMED"
  | "DRAFT_PICK" | "DRAFT_COMPLETED" | "TRADE_PROPOSED" | "TRADE_COMPLETED" | "TRADE_REJECTED"
  | "TRADE_IN_REVIEW" | "TRADE_VETOED" | "FREE_AGENT_ADD" | "PLAYER_DROP" | "WAIVER_CLAIM_WON"
  | "SCORES_UPDATED" | "ROUND_FINALIZED" | "SETTINGS_UPDATED" | "CHAT" | "LINEUP_SAVED" | "TRADE_UPDATED";

interface EmitOptions {
  /** false = apenas sinal de tempo real (não aparece no feed). */
  feed?: boolean;
  notify?: { userIds: string[]; title: string; body?: string; href?: string };
}

/** Regista um evento no feed da liga e (opcionalmente) cria notificações. O SSE propaga-o em tempo real. */
export async function emit(
  leagueId: string,
  type: ActivityType,
  payload: Record<string, unknown>,
  opts: EmitOptions = {},
  db: Tx = prisma,
) {
  await db.activityEvent.create({ data: { leagueId, type, payload: payload as object, feed: opts.feed ?? true } });
  if (opts.notify?.userIds.length) {
    await db.notification.createMany({
      data: opts.notify.userIds.map((userId) => ({
        userId,
        leagueId,
        type,
        title: opts.notify!.title,
        body: opts.notify!.body,
        href: opts.notify!.href,
      })),
    });
  }
}

/** Log de auditoria append-only de todas as operações sobre plantéis, regras e pontuações. */
export async function audit(
  leagueId: string,
  type: string,
  payload: Record<string, unknown>,
  actor: { userId?: string | null; teamId?: string | null } = {},
  db: Tx = prisma,
) {
  await db.transaction.create({
    data: { leagueId, type, payload: payload as object, actorId: actor.userId ?? null, teamId: actor.teamId ?? null },
  });
}
