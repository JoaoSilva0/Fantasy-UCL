"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Lock, RotateCcw, Save, Tag } from "lucide-react";
import { saveLineupAction, tradeBlockAction } from "@/server/actions/game";
import { FORMATIONS, FORMATION_KEYS, POSITIONS, type Pos } from "@/lib/fantasy/config";
import { detectFormation, validateLineup } from "@/lib/fantasy/lineup";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Countdown } from "@/components/ui/countdown";
import { PlayerAvatar, PosBadge, StatusDot } from "@/components/ui/misc";
import { useAction } from "@/components/ui/use-action";
import { useToast } from "@/components/ui/toast";
import { cn, fmtPts } from "@/lib/utils";

export interface RosterRow {
  id: string; name: string; pos: Pos; photo: string | null; club: string; status: string; statusNote: string | null; onTradeBlock: boolean;
  opponent: string | null; fixtureStatus: string | null; locked: boolean; roundPoints: number; played: boolean;
  total: number; games: number; last5: number[]; proj: number | null;
}
interface L { formation: string; starters: string[]; bench: string[]; captainId: string | null; viceCaptainId: string | null }

export function LineupEditor(props: {
  leagueId: string; roundId: string; roundName: string; teamName: string; editable: boolean; readOnlyTeam: boolean; lockMode: string;
  roundStarted: boolean; firstKickoff: string | null; finalized: boolean; rows: RosterRow[]; lineup: L;
  score: { points: number; details: { captainApplied: string | null; autoSubs: { out: string; in: string }[] } } | null;
}) {
  const { rows, editable } = props;
  const toast = useToast();
  const { pending, run } = useAction();
  const [l, setL] = useState<L>(props.lineup);
  const [sel, setSel] = useState<string | null>(null);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const dirty = JSON.stringify(l) !== JSON.stringify(props.lineup);
  const errors = validateLineup(l, rows.map((r) => ({ id: r.id, position: r.pos })));
  const counts = (ids: string[]) => {
    const c: Record<Pos, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    ids.forEach((id) => { const r = byId.get(id); if (r) c[r.pos]++; });
    return c;
  };
  const canMove = (id: string) => editable && !byId.get(id)?.locked;

  /** Troca dois jogadores (titular↔suplente ou ordem no banco). A formação ajusta-se automaticamente se possível. */
  const tap = (id: string) => {
    if (!editable) return setSel(sel === id ? null : id);
    if (!sel) return setSel(id);
    if (sel === id) return setSel(null);
    const a = sel, b = id;
    setSel(null);
    if (!canMove(a) || !canMove(b)) return toast({ tone: "error", title: "Jogador bloqueado: o jogo já começou." });
    const aS = l.starters.includes(a), bS = l.starters.includes(b);
    if (aS === bS) {
      if (aS) return; // dois titulares: nada a trocar
      const bench = [...l.bench];
      const i = bench.indexOf(a), j = bench.indexOf(b);
      [bench[i], bench[j]] = [bench[j], bench[i]];
      return setL({ ...l, bench });
    }
    const [st, bn] = aS ? [a, b] : [b, a];
    const starters = l.starters.map((x) => (x === st ? bn : x));
    const bench = l.bench.map((x) => (x === bn ? st : x));
    const f = detectFormation(counts(starters));
    if (!f) return toast({ tone: "error", title: "Essa troca não resulta numa formação válida." });
    const fix = (c: string | null) => (c === st ? bn : c);
    setL({ formation: f, starters, bench, captainId: fix(l.captainId), viceCaptainId: fix(l.viceCaptainId) === fix(l.captainId) ? null : fix(l.viceCaptainId) });
  };

  const changeFormation = (f: string) => {
    const need = FORMATIONS[f];
    const all = [...l.starters, ...l.bench];
    const val = (id: string) => (l.starters.includes(id) ? 1000 : 0) + (byId.get(id)?.proj ?? 0) - (byId.get(id)?.locked ? 0 : 0);
    const pick = (pos: Pos, n: number) => all.filter((id) => byId.get(id)?.pos === pos).sort((x, y) => val(y) - val(x)).slice(0, n);
    const starters = [...pick("GK", 1), ...pick("DEF", need.DEF), ...pick("MID", need.MID), ...pick("FWD", need.FWD)];
    if (starters.length !== 11) return toast({ tone: "error", title: "Não tens jogadores suficientes para essa formação." });
    const lockedChanged = all.some((id) => byId.get(id)?.locked && l.starters.includes(id) !== starters.includes(id));
    if (lockedChanged) return toast({ tone: "error", title: "Mudar para essa formação mexeria em jogadores bloqueados." });
    const bench = l.bench.filter((id) => !starters.includes(id)).concat(l.starters.filter((id) => !starters.includes(id)));
    setL({ formation: f, starters, bench, captainId: starters.includes(l.captainId ?? "") ? l.captainId : null, viceCaptainId: starters.includes(l.viceCaptainId ?? "") ? l.viceCaptainId : null });
  };

  const setCaptain = (id: string, kind: "C" | "V") => {
    if (kind === "C") setL({ ...l, captainId: id, viceCaptainId: l.viceCaptainId === id ? l.captainId : l.viceCaptainId });
    else setL({ ...l, viceCaptainId: id, captainId: l.captainId === id ? l.viceCaptainId : l.captainId });
    setSel(null);
  };

  const lines: Pos[] = ["FWD", "MID", "DEF", "GK"];
  const selRow = sel ? byId.get(sel) : null;
  const subsIn = new Set(props.score?.details.autoSubs.map((s) => s.in) ?? []);
  const subsOut = new Set(props.score?.details.autoSubs.map((s) => s.out) ?? []);

  const slot = (id: string) => {
    const r = byId.get(id);
    if (!r) return null;
    const isC = l.captainId === id, isV = l.viceCaptainId === id;
    return (
      <motion.button key={id} layout type="button" onClick={() => tap(id)}
        className={cn("group relative flex w-[76px] flex-col items-center rounded-xl px-1 pb-1.5 pt-2 transition sm:w-24", sel === id ? "bg-accent/25 ring-2 ring-accent" : "hover:bg-white/5", subsOut.has(id) && "opacity-45")}>
        <div className="relative">
          <PlayerAvatar name={r.name} photoUrl={r.photo} pos={r.pos} size={44} />
          {(isC || isV) && <span className={cn("absolute -right-1.5 -top-1 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black", isC ? "bg-fg text-ink" : "bg-surface-3 text-fg ring-1 ring-line-strong")}>{isC ? "C" : "V"}</span>}
          {r.locked && <span className="absolute -bottom-0.5 -left-1 rounded-full bg-ink p-0.5 text-muted"><Lock size={10} /></span>}
          {r.status !== "AVAILABLE" && <span className="absolute -bottom-0.5 -right-1 h-2.5 w-2.5 rounded-full bg-loss ring-2 ring-ink" />}
        </div>
        <span className="mt-1 w-full truncate rounded bg-ink/70 px-1 text-center text-[11px] font-semibold">{r.name.split(" ").slice(-1)[0]}</span>
        <span className="num text-[10px] text-silver">{r.played || props.roundStarted ? `${fmtPts(r.roundPoints * (props.score?.details.captainApplied === id ? 2 : 1))} pts` : r.opponent ?? "sem jogo"}</span>
      </motion.button>
    );
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="eyebrow">{props.roundName}</div>
            <div className="font-semibold">{props.teamName}</div>
          </div>
          {props.score && <div className="ml-2"><div className="eyebrow">Pontos</div><div className="num text-xl font-semibold">{fmtPts(props.score.points)}</div></div>}
          <div className="ml-auto flex items-center gap-2">
            {props.finalized ? <Badge>Jornada fechada</Badge> : props.roundStarted ? <Badge tone="live">Jornada a decorrer</Badge>
              : props.firstKickoff && <Badge tone="accent">Bloqueia em <Countdown to={props.firstKickoff} className="num" /></Badge>}
            <select disabled={!editable} value={l.formation} onChange={(e) => changeFormation(e.target.value)} className="h-9 rounded-lg border border-line-strong bg-ink/60 px-2 text-sm font-semibold" aria-label="Formação">
              {FORMATION_KEYS.map((f) => <option key={f}>{f}</option>)}
            </select>
          </div>
        </div>
        <div className="pitch m-3 rounded-2xl px-1 py-4 sm:m-4 sm:px-4">
          {lines.map((p) => (
            <div key={p} className="flex justify-center gap-0.5 py-2 sm:gap-3">
              {l.starters.filter((id) => byId.get(id)?.pos === p).map((id) => slot(id))}
            </div>
          ))}
        </div>
        <div className="border-t border-line px-4 py-3">
          <div className="eyebrow mb-2">Banco (ordem de substituição automática)</div>
          <div className="flex flex-wrap gap-1">{l.bench.map((id, i) => <div key={id} className="relative"><span className="num absolute left-1 top-1 z-10 text-[10px] text-faint">{i + 1}</span>{slot(id)}</div>)}</div>
        </div>
        {editable && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line bg-ink/30 px-4 py-3">
            {selRow ? (
              <>
                <span className="text-sm"><b>{selRow.name}</b> selecionado — toca noutro jogador para trocar.</span>
                {l.starters.includes(selRow.id) && (
                  <div className="ml-auto flex gap-1">
                    <Button size="sm" variant="secondary" onClick={() => setCaptain(selRow.id, "C")}>Capitão</Button>
                    <Button size="sm" variant="secondary" onClick={() => setCaptain(selRow.id, "V")}>Vice</Button>
                  </div>
                )}
              </>
            ) : <span className="text-sm text-muted">Toca num jogador para o selecionar.</span>}
          </div>
        )}
        {editable && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
            {errors.length > 0 ? <span className="text-xs text-loss">{errors[0]}</span> : <span className="text-xs text-muted">{props.lockMode === "PER_FIXTURE" ? "Cada jogador bloqueia no início do seu jogo." : "O onze bloqueia no primeiro jogo da jornada."}</span>}
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" size="sm" disabled={!dirty} onClick={() => setL(props.lineup)}><RotateCcw size={14} /> Repor</Button>
              <Button size="sm" disabled={!dirty || errors.length > 0 || pending} onClick={() => run(() => saveLineupAction(props.leagueId, props.roundId, l), { success: "Onze guardado" })}><Save size={14} /> Guardar onze</Button>
            </div>
          </div>
        )}
        {props.score && props.score.details.autoSubs.length > 0 && (
          <div className="border-t border-line px-4 py-3 text-xs text-muted">Substituições automáticas: {props.score.details.autoSubs.map((s) => `${byId.get(s.in)?.name ?? "?"} por ${byId.get(s.out)?.name ?? "?"}`).join(" · ")}</div>
        )}
      </div>

      <div className="card">
        <div className="eyebrow px-5 pt-5">Plantel completo</div>
        <div className="divide-y divide-line">
          {POSITIONS.map((p) => (
            <div key={p} className="px-5 py-3">
              <PosBadge pos={p} />
              <div className="mt-2 space-y-2">
                {rows.filter((r) => r.pos === p).map((r) => (
                  <div key={r.id} className="flex items-center gap-2.5">
                    <PlayerAvatar name={r.name} photoUrl={r.photo} pos={r.pos} size={30} />
                    <Link href={`/leagues/${props.leagueId}/players/${r.id}`} className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5"><span className="truncate text-sm font-medium hover:text-glow">{r.name}</span><StatusDot status={r.status} note={r.statusNote} />{r.onTradeBlock && <Tag size={12} className="text-warn" aria-label="Na lista de negociação" />}</div>
                      <div className="flex gap-1 text-[11px] text-muted"><span>{r.club}</span><span>·</span><span>{r.opponent ?? "sem jogo"}</span>{subsIn.has(r.id) && <span className="text-win">· entrou (auto)</span>}</div>
                    </Link>
                    <div className="text-right">
                      <div className="num text-sm font-semibold">{fmtPts(r.total)}</div>
                      <div className="flex justify-end gap-0.5">{r.last5.slice(0, 5).reverse().map((x, i) => <span key={i} className="h-3 w-1 rounded-full" style={{ background: x >= 10 ? "var(--color-win)" : x >= 5 ? "var(--color-accent)" : "var(--color-faint)", opacity: 0.4 + Math.min(1, x / 12) * 0.6 }} title={`${x} pts`} />)}</div>
                    </div>
                    {!props.readOnlyTeam && (
                      <button title={r.onTradeBlock ? "Retirar da lista de negociação" : "Colocar na lista de negociação"} onClick={() => run(() => tradeBlockAction(props.leagueId, r.id, !r.onTradeBlock), { success: r.onTradeBlock ? "Retirado da lista" : "Na lista de negociação" })} className={cn("rounded-md p-1", r.onTradeBlock ? "text-warn" : "text-faint hover:text-fg")} aria-label="Lista de negociação"><Tag size={14} /></button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {!props.readOnlyTeam && <div className="border-t border-line px-5 py-3 text-xs text-muted">Para libertar jogadores ou contratar, vai ao <Link className="text-glow" href={`/leagues/${props.leagueId}/market`}>Mercado</Link>.</div>}
      </div>
    </div>
  );
}

