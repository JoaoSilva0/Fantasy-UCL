"use client";
import { useState } from "react";
import { Check, Copy, Shuffle, Play } from "lucide-react";
import { randomizeOrderAction, startDraftAction } from "@/server/actions/league";
import { Button } from "@/components/ui/button";
import { useAction } from "@/components/ui/use-action";

export function CopyInvite({ code }: { code: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/join/${code}`);
    setDone(true);
    setTimeout(() => setDone(false), 1800);
  };
  return <Button variant="secondary" size="sm" onClick={copy}>{done ? <Check size={14} /> : <Copy size={14} />} {done ? "Link copiado" : "Copiar link"}</Button>;
}

export function DraftControls({ leagueId, hasOrder, teams }: { leagueId: string; hasOrder: boolean; teams: number }) {
  const { pending, run } = useAction();
  return hasOrder ? (
    <Button size="lg" disabled={pending} onClick={() => run(() => startDraftAction(leagueId), { success: "Draft iniciado!" })}><Play size={16} /> Iniciar draft</Button>
  ) : (
    <Button size="lg" disabled={pending || teams < 2} onClick={() => { if (confirm("O sorteio é definitivo e fecha a liga a novos participantes. Continuar?")) run(() => randomizeOrderAction(leagueId), { success: "Ordem sorteada" }); }}>
      <Shuffle size={16} /> Sortear ordem do draft
    </Button>
  );
}
