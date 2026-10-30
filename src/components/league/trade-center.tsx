"use client";
import { useEffect, useState } from "react";
import { ArrowLeftRight, Scale, ShieldAlert, Tag } from "lucide-react";
import {
  analyzeTradeAction, cancelTradeAction, commissionerTradeAction, proposeTradeAction, respondTradeAction, voteTradeAction,
} from "@/server/actions/game";
import { POS_LABEL, POSITIONS, type Pos } from "@/lib/fantasy/config";
import type { TradeAnalysis } from "@/lib/fantasy/trade-analyzer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, Textarea } from "@/components/ui/input";
import { PosBadge, TeamMark } from "@/components/ui/misc";
import { Countdown } from "@/components/ui/countdown";
import { useAction } from "@/components/ui/use-action";
import { cn, fmtPts, timeAgo } from "@/lib/utils";

interface RP { id: string; name: string; pos: Pos; club: string; block: boolean; total: number; proj: number | null }
interface T { id: string; name: string; owner: string; color: string; userId: string; roster: RP[] }
interface Trade {
  id: string; status: string; proposerTeamId: string; receiverTeamId: string; message: string | null; flagged: boolean; failReason: string | null;
  createdAt: string; expiresAt: string; reviewUntil: string | null; parentId: string | null; analysis: { proposerShare: number; fairness: string } | null;
  items: { playerId: string; name: string; pos: string; fromTeamId: string }[]; vetoes: number; myVote: boolean | null;
}

const STATUS: Record<string, [string, "neutral" | "accent" | "win" | "loss" | "warn"]> = {
  PENDING: ["Pendente", "accent"], IN_REVIEW: ["Em revisão", "warn"], COMPLETED: ["Concluída", "win"], REJECTED: ["Rejeitada", "loss"],
  CANCELLED: ["Cancelada", "neutral"], EXPIRED: ["Expirada", "neutral"], COUNTERED: ["Contraproposta", "neutral"], VETOED: ["Vetada", "loss"], FAILED: ["Falhou", "loss"],
};
const FAIR: Record<string, [string, string]> = {
  EQUILIBRADA: ["Equilibrada", "text-win"], LIGEIRAMENTE_DESEQUILIBRADA: ["Ligeiramente desequilibrada", "text-warn"], DESEQUILIBRADA: ["Desequilibrada", "text-loss"],
};

export function TradeCenter(props: {
  leagueId: string; meTeamId: string; isCommissioner: boolean; commissionerInvolvedIds: string[]; commissionerUserId: string;
  approval: string; reviewHours: number; focus: string | null; teams: T[]; trades: Trade[];
}) {
  const { leagueId, meTeamId, teams, trades } = props;
  const { pending, run } = useAction();
  const me = teams.find((t) => t.id === meTeamId)!;
  const others = teams.filter((t) => t.id !== meTeamId);
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const [partner, setPartner] = useState(others[0]?.id ?? "");
  const [give, setGive] = useState<string[]>([]);
  const [get, setGet] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [counterOf, setCounterOf] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<TradeAnalysis | null>(null);
  const them = teamById.get(partner);

  useEffect(() => {
    if (!give.length || !get.length) return setAnalysis(null);
    let alive = true;
    analyzeTradeAction(leagueId, give, get).then((r) => alive && r.ok && setAnalysis(r.data as TradeAnalysis));
    return () => { alive = false; };
  }, [give, get, leagueId]);

  const toggle = (list: string[], set: (x: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id].slice(0, 5));
  const after = (t: T, out: string[], inn: string[]) => {
    const c: Record<Pos, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    t.roster.filter((p) => !out.includes(p.id)).forEach((p) => c[p.pos]++);
    const all = teams.flatMap((x) => x.roster);
    inn.forEach((id) => { const p = all.find((x) => x.id === id); if (p) c[p.pos]++; });
    return c;
  };
  const startCounter = (t: Trade) => {
    setCounterOf(t.id);
    setPartner(t.proposerTeamId);
    setGive(t.items.filter((i) => i.fromTeamId === meTeamId).map((i) => i.playerId));
    setGet(t.items.filter((i) => i.fromTeamId === t.proposerTeamId).map((i) => i.playerId));
    window.scrollTo({ top: document.getElementById("builder")?.offsetTop ?? 0, behavior: "smooth" });
  };
  const submit = () => run(() => proposeTradeAction(leagueId, { receiverTeamId: partner, give, get, message: msg || undefined, counterOf: counterOf ?? undefined }), {
    success: counterOf ? "Contraproposta enviada" : "Proposta enviada", onSuccess: () => { setGive([]); setGet([]); setMsg(""); setCounterOf(null); },
  });

  const inbox = trades.filter((t) => t.status === "PENDING" && t.receiverTeamId === meTeamId);
  const sent = trades.filter((t) => t.status === "PENDING" && t.proposerTeamId === meTeamId);
  const review = trades.filter((t) => t.status === "IN_REVIEW");
  const history = trades.filter((t) => !["PENDING", "IN_REVIEW"].includes(t.status));
  const blockList = others.flatMap((t) => t.roster.filter((p) => p.block).map((p) => ({ ...p, team: t })));

  const TradeCard = ({ t, children }: { t: Trade; children?: React.ReactNode }) => {
    const p = teamById.get(t.proposerTeamId)!, r = teamById.get(t.receiverTeamId)!;
    const side = (tid: string) => t.items.filter((i) => i.fromTeamId === tid);
    return (
      <div className={cn("rounded-2xl border border-line bg-ink/30 p-4", props.focus === t.id && "ring-2 ring-accent")}>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge tone={STATUS[t.status][1]}>{STATUS[t.status][0]}</Badge>
          {t.flagged && <Badge tone="warn"><ShieldAlert size={11} /> Sinalizada</Badge>}
          {t.parentId && <Badge>Contraproposta</Badge>}
          <span className="text-faint" suppressHydrationWarning>{timeAgo(t.createdAt)}</span>
          {t.status === "PENDING" && <span className="ml-auto text-faint">expira em <Countdown to={t.expiresAt} className="num" /></span>}
          {t.status === "IN_REVIEW" && t.reviewUntil && <span className="ml-auto text-faint">votação termina em <Countdown to={t.reviewUntil} className="num" /> · {t.vetoes} veto(s)</span>}
        </div>
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-start gap-3">
          {[p, r].map((team, idx) => (
            <div key={team.id} className={cn("min-w-0", idx === 1 && "order-3 text-right")}>
              <div className={cn("mb-1.5 truncate text-sm font-semibold", idx === 1 && "text-right")}>{team.name} dá</div>
              <div className="space-y-1">{side(team.id).map((i) => <div key={i.playerId} className={cn("flex items-center gap-1.5 text-sm", idx === 1 && "justify-end")}><PosBadge pos={i.pos} /><span className="truncate">{i.name}</span></div>)}</div>
            </div>
          ))}
          <ArrowLeftRight className="order-2 mt-6 text-faint" size={18} />
        </div>
        {t.message && <p className="mt-3 rounded-lg bg-white/3 px-3 py-2 text-sm italic text-silver">“{t.message}”</p>}
        {t.analysis && <div className="mt-2 text-xs text-muted">Analisador: <span className={FAIR[t.analysis.fairness]?.[1]}>{FAIR[t.analysis.fairness]?.[0]}</span> · {p.name} recebe {Math.round(t.analysis.proposerShare * 100)}% do valor</div>}
        {t.failReason && <div className="mt-2 text-xs text-loss">{t.failReason}</div>}
        {children && <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">{children}</div>}
      </div>
    );
  };

  const shareBar = analysis && (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-3">
        <div className="bg-accent" style={{ width: `${analysis.proposerShare * 100}%` }} />
        <div className="bg-silver/40" style={{ width: `${analysis.receiverShare * 100}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-xs"><span>Tu recebes {Math.round(analysis.proposerShare * 100)}%</span><span className="text-muted">{them?.name} {Math.round(analysis.receiverShare * 100)}%</span></div>
    </div>
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
      <div className="space-y-4">
        {inbox.length > 0 && (
          <section className="card p-4">
            <div className="eyebrow mb-3">Propostas para ti</div>
            <div className="space-y-3">
              {inbox.map((t) => (
                <TradeCard key={t.id} t={t}>
                  <Button size="sm" variant="success" disabled={pending} onClick={() => run(() => respondTradeAction(leagueId, t.id, true), { success: props.approval === "FREE" && !t.flagged ? "Troca concluída!" : "Aceite — segue para revisão" })}>Aceitar</Button>
                  <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => respondTradeAction(leagueId, t.id, false), { success: "Proposta rejeitada" })}>Rejeitar</Button>
                  <Button size="sm" variant="secondary" onClick={() => startCounter(t)}>Contrapropor</Button>
                </TradeCard>
              ))}
            </div>
          </section>
        )}
        {review.length > 0 && (
          <section className="card p-4">
            <div className="eyebrow mb-1">Em revisão</div>
            <p className="mb-3 text-xs text-muted">{props.approval === "VOTE" ? `A liga tem ${props.reviewHours} h para vetar. Sem vetos suficientes, a troca é executada.` : "O comissário decide. Trocas sinalizadas como desequilibradas vêm sempre para aqui."}</p>
            <div className="space-y-3">
              {review.map((t) => {
                const involved = [t.proposerTeamId, t.receiverTeamId].includes(meTeamId);
                const commissionerParty = [teamById.get(t.proposerTeamId)?.userId, teamById.get(t.receiverTeamId)?.userId].includes(props.commissionerUserId);
                return (
                  <TradeCard key={t.id} t={t}>
                    {t.reviewUntil && !involved && (
                      <>
                        <Button size="sm" variant={t.myVote === true ? "danger" : "secondary"} disabled={pending} onClick={() => run(() => voteTradeAction(leagueId, t.id, true), { success: "Veto registado" })}>Vetar</Button>
                        <Button size="sm" variant={t.myVote === false ? "success" : "secondary"} disabled={pending} onClick={() => run(() => voteTradeAction(leagueId, t.id, false), { success: "Voto registado" })}>Aprovar</Button>
                      </>
                    )}
                    {props.isCommissioner && !commissionerParty && (
                      <>
                        <Button size="sm" variant="success" disabled={pending} onClick={() => run(() => commissionerTradeAction(leagueId, t.id, true), { success: "Troca aprovada" })}>Aprovar (comissário)</Button>
                        <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => commissionerTradeAction(leagueId, t.id, false), { success: "Troca vetada" })}>Vetar (comissário)</Button>
                      </>
                    )}
                    {t.proposerTeamId === meTeamId && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelTradeAction(leagueId, t.id), { success: "Cancelada" })}>Cancelar</Button>}
                  </TradeCard>
                );
              })}
            </div>
          </section>
        )}
        {sent.length > 0 && (
          <section className="card p-4">
            <div className="eyebrow mb-3">Enviadas</div>
            <div className="space-y-3">{sent.map((t) => <TradeCard key={t.id} t={t}><Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelTradeAction(leagueId, t.id), { success: "Proposta cancelada" })}>Cancelar proposta</Button></TradeCard>)}</div>
          </section>
        )}
        <section className="card p-4">
          <div className="eyebrow mb-3">Histórico de trocas</div>
          {history.length === 0 ? <p className="text-sm text-muted">Ainda não houve trocas.</p> : <div className="space-y-3">{history.map((t) => <TradeCard key={t.id} t={t} />)}</div>}
        </section>
      </div>

      <div className="space-y-4">
        <section id="builder" className="card p-4">
          <div className="mb-3 flex items-center justify-between"><div className="eyebrow">{counterOf ? "Contraproposta" : "Nova proposta"}</div>{counterOf && <button className="text-xs text-muted hover:text-fg" onClick={() => { setCounterOf(null); setGive([]); setGet([]); }}>cancelar</button>}</div>
          <Select value={partner} disabled={!!counterOf} onChange={(e) => { setPartner(e.target.value); setGet([]); }}>{others.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.owner}</option>)}</Select>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {[{ t: me, list: give, set: setGive, title: "Dás" }, { t: them, list: get, set: setGet, title: "Recebes" }].map(({ t, list, set, title }) => t && (
              <div key={title} className="min-w-0">
                <div className="mb-1.5 text-xs font-semibold text-silver">{title} <span className="text-faint">({list.length})</span></div>
                <div className="max-h-72 space-y-0.5 overflow-y-auto rounded-xl border border-line p-1">
                  {POSITIONS.flatMap((pos) => t.roster.filter((p) => p.pos === pos)).map((p) => (
                    <button key={p.id} onClick={() => toggle(list, set, p.id)} className={cn("flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-xs", list.includes(p.id) ? "bg-accent-soft ring-1 ring-accent/50" : "hover:bg-white/4")}>
                      <PosBadge pos={p.pos} className="h-4 min-w-7 text-[9px]" /><span className="min-w-0 flex-1 truncate">{p.name}</span>{p.block && <Tag size={11} className="text-warn" />}<span className="num text-faint">{fmtPts(p.total)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <Textarea className="mt-3" rows={2} maxLength={280} placeholder="Mensagem (opcional) — vende bem o teu peixe" value={msg} onChange={(e) => setMsg(e.target.value)} />
          <Button className="mt-3 w-full" disabled={pending || !give.length || !get.length} onClick={submit}>{counterOf ? "Enviar contraproposta" : "Enviar proposta"}</Button>
        </section>

        <section className="card p-4">
          <div className="mb-3 flex items-center gap-2"><Scale size={16} className="text-glow" /><div className="eyebrow">Trade Analyzer</div></div>
          {!analysis ? <p className="text-sm text-muted">Escolhe jogadores dos dois lados para analisar o valor da troca.</p> : (
            <div className="space-y-4">
              <div className={cn("text-lg font-semibold", FAIR[analysis.fairness][1])}>{FAIR[analysis.fairness][0]}</div>
              {shareBar}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-ink/30 p-3"><div className="eyebrow">Valor que dás</div><div className="num mt-1 text-xl font-semibold">{fmtPts(analysis.proposerGives)}</div></div>
                <div className="rounded-xl bg-ink/30 p-3"><div className="eyebrow">Valor que recebes</div><div className="num mt-1 text-xl font-semibold">{fmtPts(analysis.receiverGives)}</div></div>
              </div>
              {them && (
                <div className="text-xs">
                  <div className="eyebrow mb-2">Impacto nos plantéis</div>
                  {[{ t: me, out: give, inn: get }, { t: them, out: get, inn: give }].map(({ t, out, inn }) => {
                    const c = after(t, out, inn);
                    return <div key={t.id} className="mb-1 flex items-center gap-2"><span className="w-24 truncate text-muted">{t.name}</span>{POSITIONS.map((p) => <span key={p} className="num rounded bg-white/4 px-1.5 py-0.5">{POS_LABEL[p]} {c[p]}</span>)}</div>;
                  })}
                </div>
              )}
              {analysis.flagged && <p className="rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">Esta troca será sinalizada e sujeita a revisão (proteção contra colusão).</p>}
              {analysis.notes.map((n) => <p key={n} className="text-xs text-muted">{n}</p>)}
              <p className="text-[11px] text-faint">Valor = 60% média últimas 5 jornadas + 40% média da época. Baseado só em pontos reais — é uma estimativa, não uma previsão.</p>
            </div>
          )}
        </section>

        <section className="card p-4">
          <div className="eyebrow mb-3">Lista de negociação</div>
          {blockList.length === 0 ? <p className="text-sm text-muted">Ninguém colocou jogadores na lista.</p> : (
            <div className="space-y-1.5">{blockList.map((p) => (
              <button key={p.id} onClick={() => { setCounterOf(null); setPartner(p.team.id); setGet([p.id]); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white/4">
                <PosBadge pos={p.pos} /><span className="min-w-0 flex-1 truncate">{p.name}</span><span className="truncate text-xs text-muted">{p.team.name}</span><TeamMark name={p.team.name} color={p.team.color} size={22} />
              </button>
            ))}</div>
          )}
        </section>
      </div>
    </div>
  );
}
