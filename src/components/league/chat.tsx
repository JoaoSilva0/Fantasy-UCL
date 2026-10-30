"use client";
import { useState } from "react";
import { Send } from "lucide-react";
import { postMessageAction, reactAction } from "@/server/actions/league";
import { useAction } from "@/components/ui/use-action";
import { cn, initials, timeAgo } from "@/lib/utils";

interface Msg { id: string; body: string; createdAt: string; reactions: Record<string, string[]>; user: { id: string; displayName: string; avatarColor: string } }
const REACTIONS = ["🔥", "😂", "👏", "💀", "🤡", "🐐"];

export function Chat({ leagueId, messages, meId }: { leagueId: string; messages: Msg[]; meId: string }) {
  const [text, setText] = useState("");
  const { pending, run } = useAction();
  return (
    <div>
      <div className="max-h-[420px] space-y-4 overflow-y-auto pr-1">
        {messages.length === 0 && <p className="text-sm text-muted">Ninguém provocou ninguém… ainda.</p>}
        {messages.map((m) => (
          <div key={m.id} className="group flex gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: m.user.avatarColor }}>{initials(m.user.displayName)}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2"><span className="text-sm font-semibold">{m.user.displayName}</span><span className="text-[11px] text-faint" suppressHydrationWarning>{timeAgo(m.createdAt)}</span></div>
              <p className="whitespace-pre-wrap break-words text-sm text-silver">{m.body}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {REACTIONS.map((r) => {
                  const who = m.reactions[r] ?? [];
                  const mine = who.includes(meId);
                  if (!who.length) return (
                    <button key={r} onClick={() => run(() => reactAction(leagueId, m.id, r))} className="hidden rounded-full px-1.5 text-xs opacity-60 hover:bg-white/5 hover:opacity-100 group-hover:inline">{r}</button>
                  );
                  return (
                    <button key={r} onClick={() => run(() => reactAction(leagueId, m.id, r))} className={cn("rounded-full px-2 py-0.5 text-xs ring-1", mine ? "bg-accent-soft ring-accent/40" : "bg-white/4 ring-line")}>{r} <span className="num">{who.length}</span></button>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
      <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) run(() => postMessageAction(leagueId, text), { onSuccess: () => setText("") }); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Manda uma boca…" className="h-10 flex-1 rounded-xl border border-line-strong bg-ink/60 px-3 text-sm placeholder:text-faint focus:border-accent focus:outline-none" />
        <button disabled={pending || !text.trim()} className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white disabled:opacity-40" aria-label="Enviar"><Send size={16} /></button>
      </form>
    </div>
  );
}
