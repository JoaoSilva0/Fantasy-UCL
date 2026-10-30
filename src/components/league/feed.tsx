import { ArrowLeftRight, Gavel, Megaphone, ShieldAlert, Trophy, UserMinus, UserPlus, Users } from "lucide-react";
import { timeAgo } from "@/lib/utils";

type P = Record<string, unknown>;
const RENDER: Record<string, (p: P) => { icon: React.ElementType; text: React.ReactNode }> = {
  LEAGUE_CREATED: () => ({ icon: Megaphone, text: "Liga criada" }),
  TEAM_JOINED: (p) => ({ icon: Users, text: <><b>{String(p.user)}</b> entrou com a equipa <b>{String(p.team)}</b></> }),
  DRAFT_ORDER: () => ({ icon: Gavel, text: "Ordem do draft sorteada" }),
  DRAFT_STARTED: () => ({ icon: Gavel, text: "O draft começou" }),
  DRAFT_PAUSED: () => ({ icon: Gavel, text: "Draft em pausa" }),
  DRAFT_RESUMED: () => ({ icon: Gavel, text: "Draft retomado" }),
  DRAFT_PICK: (p) => ({ icon: Gavel, text: <><b>{String(p.team)}</b> escolheu <b>{String(p.player)}</b> (pick {String(p.overall)}{p.auto ? ", auto" : ""})</> }),
  DRAFT_COMPLETED: () => ({ icon: Trophy, text: "Draft concluído — que comece a época!" }),
  TRADE_COMPLETED: (p) => ({ icon: ArrowLeftRight, text: <><b>{String(p.from)}</b> ↔ <b>{String(p.to)}</b>: {(p.fromGives as string[]).join(", ")} por {(p.toGives as string[]).join(", ")}</> }),
  TRADE_IN_REVIEW: (p) => ({ icon: ShieldAlert, text: <>Troca <b>{String(p.from)}</b> ↔ <b>{String(p.to)}</b> em {p.mode === "VOTE" ? "votação" : "revisão do comissário"}{p.flagged ? " (sinalizada como desequilibrada)" : ""}</> }),
  TRADE_VETOED: (p) => ({ icon: ShieldAlert, text: <>Troca <b>{String(p.from)}</b> ↔ <b>{String(p.to)}</b> vetada pel{p.by === "liga" ? "a liga" : "o comissário"}</> }),
  FREE_AGENT_ADD: (p) => ({ icon: UserPlus, text: <><b>{String(p.team)}</b> contratou <b>{String(p.player)}</b>{p.dropped ? <> e libertou {String(p.dropped)}</> : null}</> }),
  WAIVER_CLAIM_WON: (p) => ({ icon: UserPlus, text: <><b>{String(p.team)}</b> ganhou <b>{String(p.player)}</b> nos waivers</> }),
  PLAYER_DROP: (p) => ({ icon: UserMinus, text: <><b>{String(p.team)}</b> libertou {String(p.player)}</> }),
  ROUND_FINALIZED: (p) => ({ icon: Trophy, text: <>{String(p.roundName)} fechada{p.topTeam ? <> — <b>{String(p.topTeam)}</b> venceu com {String(p.topPoints)} pts</> : null}</> }),
  SETTINGS_UPDATED: (p) => ({ icon: Megaphone, text: <>O comissário atualizou {String(p.what)}</> }),
};

export function Feed({ events }: { events: { id: number; type: string; payload: unknown; createdAt: Date }[] }) {
  const items = events.filter((e) => RENDER[e.type]);
  if (!items.length) return <p className="text-sm text-muted">Sem atividade ainda.</p>;
  return (
    <ol className="space-y-3.5">
      {items.map((e) => {
        const { icon: Icon, text } = RENDER[e.type](e.payload as P);
        return (
          <li key={e.id} className="flex gap-3 text-sm">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-glow ring-1 ring-line"><Icon size={14} /></span>
            <div className="min-w-0"><div className="text-silver [&_b]:font-semibold [&_b]:text-fg">{text}</div><div className="text-[11px] text-faint">{timeAgo(e.createdAt)}</div></div>
          </li>
        );
      })}
    </ol>
  );
}
