import { prisma } from "@/server/db";
import { getUser } from "@/server/auth";
import { tickDraft } from "@/server/services/draft";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Tempo real via Server-Sent Events. Lê novos ActivityEvent da liga (cursor incremental).
 * A ligação fecha ao fim de ~55 s (compatível com funções serverless); o EventSource reconecta
 * com Last-Event-ID, sem perder eventos. Enquanto há clientes ligados, o relógio do draft é aplicado.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = await params;
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const member = await prisma.team.findUnique({ where: { leagueId_userId: { leagueId, userId: user.id } } });
  if (!member) return new Response("Not found", { status: 404 });

  const lastHeader = req.headers.get("last-event-id") ?? new URL(req.url).searchParams.get("after");
  let cursor = lastHeader ? Number(lastHeader) : (await prisma.activityEvent.findFirst({ where: { leagueId }, orderBy: { id: "desc" }, select: { id: true } }))?.id ?? 0;
  const enc = new TextEncoder();
  const started = Date.now();
  let closed = false;
  req.signal.addEventListener("abort", () => (closed = true));

  const stream = new ReadableStream({
    async start(controller) {
      const send = (s: string) => controller.enqueue(enc.encode(s));
      send(`retry: 2000\n\n`);
      while (!closed && Date.now() - started < 55_000) {
        try {
          await tickDraft(leagueId);
          const events = await prisma.activityEvent.findMany({ where: { leagueId, id: { gt: cursor } }, orderBy: { id: "asc" }, take: 50 });
          for (const e of events) {
            send(`id: ${e.id}\nevent: activity\ndata: ${JSON.stringify({ type: e.type, payload: e.payload, at: e.createdAt })}\n\n`);
            cursor = e.id;
          }
          if (!events.length) send(`: ping\n\n`);
        } catch {
          break;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
