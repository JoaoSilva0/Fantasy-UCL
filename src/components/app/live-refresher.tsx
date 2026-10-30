"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

export interface LiveEvent { type: string; payload: Record<string, unknown>; at: string }

const TOASTS: Record<string, (p: Record<string, unknown>) => string | null> = {
  DRAFT_PICK: (p) => `Pick ${p.overall}: ${p.team} escolheu ${p.player}${p.auto ? " (auto)" : ""}`,
  TRADE_COMPLETED: (p) => `Troca concluída: ${p.from} ↔ ${p.to}`,
  FREE_AGENT_ADD: (p) => `${p.team} contratou ${p.player}`,
  DRAFT_STARTED: () => "O draft começou!",
  DRAFT_PAUSED: () => "Draft em pausa",
  DRAFT_RESUMED: () => "Draft retomado",
  ROUND_FINALIZED: (p) => `${p.roundName} fechada`,
};

/**
 * Subscreve o stream SSE da liga e atualiza os Server Components (router.refresh) quando chega um evento.
 * Os refreshes são agrupados (debounce) para não sobrecarregar o servidor durante jogos ao vivo.
 */
export function LiveRefresher({ leagueId, after, onEvent, toasts = true }: { leagueId: string; after: number; onEvent?: (e: LiveEvent) => void; toasts?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cb = useRef(onEvent);
  cb.current = onEvent;
  const cursor = useRef(after);
  cursor.current = Math.max(cursor.current, after);
  useEffect(() => {
    // Reconexões automáticas do EventSource enviam Last-Event-ID; o `after` só serve para a 1.ª ligação.
    const es = new EventSource(`/api/leagues/${leagueId}/stream?after=${cursor.current}`);
    es.addEventListener("activity", (msg) => {
      const e = JSON.parse((msg as MessageEvent).data) as LiveEvent;
      cursor.current = Math.max(cursor.current, Number((msg as MessageEvent).lastEventId) || 0);
      cb.current?.(e);
      const t = toasts && TOASTS[e.type]?.(e.payload);
      if (t) toast({ tone: "info", title: t });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), e.type === "SCORES_UPDATED" ? 1200 : 250);
    });
    return () => {
      es.close();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [leagueId, router, toast, toasts]);
  return null;
}
