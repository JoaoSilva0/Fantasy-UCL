"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowUp, Pause, Play, Plus, Search, Timer, X, Zap } from "lucide-react";
import { pickAction, setQueueAction, tickDraftAction } from "@/server/actions/game";
import { pauseDraftAction } from "@/server/actions/league";
import { teamForPick } from "@/lib/fantasy/snake-order";
import { POS_LABEL, POSITIONS, type Pos } from "@/lib/fantasy/config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { ClubCrest, PlayerAvatar, PosBadge, StatusDot, TeamMark } from "@/components/ui/misc";
import { useNow } from "@/components/ui/countdown";
import { useAction } from "@/components/ui/use-action";
import { cn, fmtPts } from "@/lib/utils";

export interface DraftPlayer {
  id: string; name: string; pos: Pos; club: string; clubCode: string | null; clubLogo: string | null; nat: string | null;
  photo: string | null; age: number | null; status: string; total: number; games: number; proj: number | null;
}
interface Team { id: string; name: string; owner: string; color: string }
interface Pick { overall: number; round: number; teamId: string; playerId: string; auto: boolean }
interface DraftState { status: string; order: string[]; rounds: number; currentPick: number; deadline: string | null; pausedRemainingMs: number | null; pickSeconds: number }

export function DraftRoom(props: {
  leagueId: string; meTeamId: string; isCommissioner: boolean; userColor: string; limits: Record<Pos, number>;
  draft: DraftState; picks: Pick[]; teams: Team[]; players: DraftPlayer[]; queue: string[];
}) {
  const { leagueId, meTeamId, draft, picks, teams, players, limits } = props;
  const { pending, run } = useAction();
  const now = useNow(250);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<Pos | "ALL">("ALL");
  const [club, setClub] = useState("ALL");
  const [nat, setNat] = useState("ALL");
  const [sort, setSort] = useState<"proj" | "total" | "name">("proj");
  const [tab, setTab] = useState<"board" | "rosters">("board");
  const [rosterTeam, setRosterTeam] = useState(meTeamId);
  const [queue, setQueue] = useState(props.queue);
  useEffect(() => setQueue(props.queue), [props.queue]);

  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const playerById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const taken = useMemo(() => new Set(picks.map((p) => p.playerId)), [picks]);
  const n = draft.order.length;
  const total = n * draft.rounds;
  const running = draft.status === "RUNNING";
  const slot = n && draft.currentPick <= total ? teamForPick(draft.order, draft.currentPick) : null;
  const myTurn = running && slot?.teamId === meTeamId;
  const myCounts = useMemo(() => {
    const c: Record<Pos, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    for (const p of picks) if (p.teamId === meTeamId) c[playerById.get(p.playerId)?.pos ?? "MID"]++;
    return c;
  }, [picks, meTeamId, playerById]);

  // Relógio: autoritativo no servidor; ao chegar a 0 pede ao servidor para aplicar o auto-pick.
  const remaining = draft.status === "PAUSED" ? draft.pausedRemainingMs ?? 0 : draft.deadline ? Math.max(0, new Date(draft.deadline).getTime() - now) : 0;
  const ticked = useRef<number | null>(null);
  useEffect(() => {
    if (running && remaining === 0 && ticked.current !== draft.currentPick) {
      ticked.current = draft.currentPick;
      run(() => tickDraftAction(leagueId));
    }
  }, [running, remaining, draft.currentPick, leagueId, run]);

  // Destaque visual da última escolha
  const last = picks[picks.length - 1];
  const [flash, setFlash] = useState<Pick | null>(null);
  const lastSeen = useRef(last?.overall ?? 0);
  useEffect(() => {
    if (last && last.overall > lastSeen.current) {
      lastSeen.current = last.overall;
      setFlash(last);
      const t = setTimeout(() => setFlash(null), 3500);
      return () => clearTimeout(t);
    }
  }, [last]);

  const clubs = useMemo(() => [...new Set(players.map((p) => p.club))].sort(), [players]);
  const nats = useMemo(() => [...new Set(players.map((p) => p.nat).filter(Boolean) as string[])].sort(), [players]);
  const available = useMemo(() => {
    const term = q.trim().toLowerCase();
    return players
      .filter((p) => !taken.has(p.id))
      .filter((p) => pos === "ALL" || p.pos === pos)
      .filter((p) => club === "ALL" || p.club === club)
      .filter((p) => nat === "ALL" || p.nat === nat)
      .filter((p) => !term || p.name.toLowerCase().includes(term) || p.club.toLowerCase().includes(term))
      .sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : sort === "total" ? b.total - a.total : (b.proj ?? -1) - (a.proj ?? -1) || a.name.localeCompare(b.name)));
  }, [players, taken, pos, club, nat, q, sort]);

  const saveQueue = (next: string[]) => {
    setQueue(next);
    run(() => setQueueAction(leagueId, next), { refresh: false });
  };
  const doPick = (id: string) => run(() => pickAction(leagueId, id, draft.currentPick));
  const canPick = (p: DraftPlayer) => myTurn && myCounts[p.pos] < limits[p.pos];

  const pct = draft.pickSeconds ? remaining / (draft.pickSeconds * 1000) : 0;
  const secs = Math.ceil(remaining / 1000);
  const onClock = slot ? teamById.get(slot.teamId) : null;
  const upcoming = n ? Array.from({ length: Math.min(n * 2, total - draft.currentPick + 1) }, (_, i) => ({ overall: draft.currentPick + i, ...teamForPick(draft.order, draft.currentPick + i) })) : [];


  const playerTable = (
      <div>
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar jogador ou clube" className="pl-9" />
          </div>
          <Select value={club} onChange={(e) => setClub(e.target.value)} className="w-auto min-w-32"><option value="ALL">Todos os clubes</option>{clubs.map((c) => <option key={c}>{c}</option>)}</Select>
          <Select value={nat} onChange={(e) => setNat(e.target.value)} className="w-auto min-w-32"><option value="ALL">Nacionalidade</option>{nats.map((c) => <option key={c}>{c}</option>)}</Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="w-auto"><option value="proj">Estimativa</option><option value="total">Pontos</option><option value="name">Nome</option></Select>
        </div>
        <div className="mt-3 flex gap-1">
          {(["ALL", ...POSITIONS] as const).map((p) => (
            <button key={p} onClick={() => setPos(p)} className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold transition", pos === p ? "bg-accent text-white" : "bg-white/4 text-muted hover:text-fg")}>
              {p === "ALL" ? "Todos" : POS_LABEL[p]}{p !== "ALL" && <span className="ml-1 opacity-70">{myCounts[p]}/{limits[p]}</span>}
            </button>
          ))}
        </div>
        <div className="mt-3 max-h-[560px] overflow-y-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-surface-2 text-left text-[11px] uppercase tracking-wider text-muted">
              <tr><th className="px-3 py-2.5 font-semibold">Jogador</th><th className="hidden px-2 py-2.5 font-semibold sm:table-cell">Nac.</th><th className="px-2 py-2.5 text-right font-semibold">Pts</th><th className="px-2 py-2.5 text-right font-semibold" title="Estimativa: média ponderada dos pontos reais recentes">Est.</th><th className="px-3 py-2.5" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {available.slice(0, 200).map((p) => {
                const inQ = queue.includes(p.id);
                return (
                  <tr key={p.id} className="hover:bg-white/3">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2.5">
                        <PlayerAvatar name={p.name} photoUrl={p.photo} pos={p.pos} size={30} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2"><span className="truncate font-medium">{p.name}</span><StatusDot status={p.status} /></div>
                          <div className="flex items-center gap-1.5 text-xs text-muted"><PosBadge pos={p.pos} className="h-4 min-w-7 text-[9px]" /><ClubCrest name={p.club} logoUrl={p.clubLogo} code={p.clubCode} size={14} />{p.club}</div>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-2 py-2 text-xs text-muted sm:table-cell">{p.nat ?? "—"}</td>
                    <td className="num px-2 py-2 text-right">{p.games ? fmtPts(p.total) : "—"}</td>
                    <td className="num px-2 py-2 text-right text-muted">{p.proj === null ? "—" : fmtPts(p.proj)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => saveQueue(inQ ? queue.filter((x) => x !== p.id) : [...queue, p.id])} className={cn("rounded-lg p-1.5 transition", inQ ? "text-glow" : "text-faint hover:text-fg")} aria-label={inQ ? "Remover da fila" : "Adicionar à fila"} title={inQ ? "Na tua fila" : "Adicionar à fila"}>{inQ ? <X size={15} /> : <Plus size={15} />}</button>
                        {running && <Button size="sm" disabled={!canPick(p) || pending} onClick={() => doPick(p.id)}>Escolher</Button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {available.length === 0 && <p className="p-6 text-center text-sm text-muted">Nenhum jogador com estes filtros.</p>}
        </div>
        <p className="mt-2 text-[11px] text-faint">“Est.” é uma estimativa calculada só com pontos reais já disputados (60% últimas 5 jornadas + 40% média da época). Antes da 1.ª jornada não há dados: “—”.</p>
      </div>
  );

  if (!n)
    return <div className="card p-8 text-center text-muted">A ordem do draft ainda não foi sorteada. Entretanto, podes <b className="text-fg">preparar a tua fila</b> abaixo.<div className="mt-6 text-left">{playerTable}</div></div>;

  return (
    <div className="space-y-4">
      {/* Cabeçalho: relógio + equipa no relógio */}
      <div className={cn("card relative overflow-hidden p-5", myTurn && "ring-2 ring-accent")}>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(600px_200px_at_20%_0%,rgb(47_107_255/0.18),transparent)]" />
        <div className="relative flex flex-wrap items-center gap-6">
          <div className="relative h-24 w-24 shrink-0">
            <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
              <circle cx="50" cy="50" r="44" fill="none" stroke="rgb(148 170 230 / 0.12)" strokeWidth="7" />
              <circle cx="50" cy="50" r="44" fill="none" stroke={secs <= 10 && running ? "var(--color-loss)" : "var(--color-accent)"} strokeWidth="7" strokeLinecap="round" strokeDasharray={276.5} strokeDashoffset={276.5 * (1 - pct)} style={{ transition: "stroke-dashoffset 0.25s linear" }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              {draft.status === "COMPLETED" ? <span className="text-xs font-semibold text-win">FIM</span> : <>
                <span className={cn("num text-2xl font-semibold", secs <= 10 && running && "text-loss")}>{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</span>
                <span className="text-[10px] uppercase tracking-wider text-muted">{draft.status === "PAUSED" ? "Pausa" : draft.status === "PENDING" ? "Por iniciar" : "Relógio"}</span>
              </>}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            {draft.status === "COMPLETED" ? (
              <><div className="eyebrow">Draft concluído</div><div className="mt-1 text-2xl font-semibold tracking-tight">Todos os plantéis estão completos 🎉</div></>
            ) : (
              <>
                <div className="eyebrow">Ronda {slot?.round} · escolha {slot?.pickInRound} · #{draft.currentPick} de {total}</div>
                <div className="mt-1 flex items-center gap-3">
                  {onClock && <TeamMark name={onClock.name} color={onClock.color} size={40} />}
                  <div className="min-w-0">
                    <div className="truncate text-2xl font-semibold tracking-tight">{myTurn ? "É a tua vez!" : onClock?.name}</div>
                    <div className="text-sm text-muted">{myTurn ? "Escolhe um jogador antes do tempo acabar — senão o auto-pick usa a tua fila." : `${onClock?.owner} está a escolher…`}</div>
                  </div>
                </div>
              </>
            )}
          </div>
          {props.isCommissioner && (draft.status === "RUNNING" || draft.status === "PAUSED") && (
            <Button variant="secondary" disabled={pending} onClick={() => run(() => pauseDraftAction(leagueId, draft.status === "RUNNING"))}>
              {draft.status === "RUNNING" ? <><Pause size={16} /> Pausar</> : <><Play size={16} /> Retomar</>}
            </Button>
          )}
        </div>
        {/* Próximas escolhas */}
        {upcoming.length > 0 && (
          <div className="relative mt-5 flex gap-2 overflow-x-auto pb-1">
            {upcoming.map((u, i) => {
              const t = teamById.get(u.teamId)!;
              return (
                <div key={u.overall} className={cn("flex shrink-0 items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs", i === 0 ? "animate-pulse-ring border-accent bg-accent-soft" : "border-line bg-ink/30", u.teamId === meTeamId && i !== 0 && "border-accent/40")}>
                  <span className="num text-faint">#{u.overall}</span>
                  <span className="max-w-28 truncate font-medium">{t.name}</span>
                  {u.pickInRound === 1 && u.overall !== 1 && <Badge tone="neutral" className="text-[9px]">R{u.round}</Badge>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AnimatePresence>
        {flash && (
          <motion.div initial={{ opacity: 0, y: -10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }} className="card flex items-center gap-3 border-accent/40 px-4 py-3">
            <Zap size={18} className="text-glow" />
            <span className="text-sm"><b>{teamById.get(flash.teamId)?.name}</b> escolheu <b>{playerById.get(flash.playerId)?.name}</b> <span className="text-muted">(#{flash.overall}{flash.auto ? " · auto-pick" : ""})</span></span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="card p-4">{playerTable}</div>
        <div className="space-y-4">
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between"><div className="eyebrow">A minha fila</div><span className="text-[11px] text-faint">usada no auto-pick</span></div>
            {queue.length === 0 && <p className="text-sm text-muted">Adiciona jogadores com “+” para definir prioridades.</p>}
            <ol className="space-y-1.5">
              {queue.filter((id) => !taken.has(id)).map((id, i, arr) => {
                const p = playerById.get(id);
                if (!p) return null;
                return (
                  <li key={id} className="flex items-center gap-2 rounded-lg bg-ink/30 px-2 py-1.5 text-sm">
                    <span className="num w-4 text-xs text-faint">{i + 1}</span><PosBadge pos={p.pos} /><span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <button disabled={i === 0} onClick={() => { const a = [...arr]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; saveQueue(a); }} className="p-1 text-faint hover:text-fg disabled:opacity-30" aria-label="Subir"><ArrowUp size={13} /></button>
                    <button disabled={i === arr.length - 1} onClick={() => { const a = [...arr]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; saveQueue(a); }} className="p-1 text-faint hover:text-fg disabled:opacity-30" aria-label="Descer"><ArrowDown size={13} /></button>
                    {myTurn && <Button size="sm" className="h-6 px-2" disabled={!canPick(p) || pending} onClick={() => doPick(p.id)}>Escolher</Button>}
                  </li>
                );
              })}
            </ol>
          </div>
          <div className="card p-4">
            <div className="eyebrow mb-3">O meu plantel</div>
            {POSITIONS.map((p) => (
              <div key={p} className="mb-3 last:mb-0">
                <div className="mb-1 flex items-center justify-between text-xs"><PosBadge pos={p} /><span className="num text-muted">{myCounts[p]}/{limits[p]}</span></div>
                <div className="space-y-1">
                  {picks.filter((x) => x.teamId === meTeamId && playerById.get(x.playerId)?.pos === p).map((x) => (
                    <div key={x.playerId} className="truncate rounded-md bg-ink/30 px-2 py-1 text-sm">{playerById.get(x.playerId)?.name}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="mb-4 flex gap-1">
          {(["board", "rosters"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cn("rounded-lg px-3 py-1.5 text-sm font-medium", tab === t ? "bg-white/8 text-fg" : "text-muted hover:text-fg")}>{t === "board" ? "Quadro de escolhas" : "Plantéis"}</button>
          ))}
          <span className="ml-auto flex items-center gap-1 text-xs text-muted"><Timer size={13} /> {picks.length}/{total} escolhas</span>
        </div>
        {tab === "board" ? (
          <div className="overflow-x-auto">
            <div className="grid min-w-[720px] gap-1.5" style={{ gridTemplateColumns: `40px repeat(${n}, minmax(110px, 1fr))` }}>
              <div />
              {draft.order.map((tid) => <div key={tid} className={cn("truncate px-1 pb-1 text-center text-xs font-semibold", tid === meTeamId ? "text-glow" : "text-silver")}>{teamById.get(tid)?.name}</div>)}
              {Array.from({ length: draft.rounds }, (_, r) => (
                <div key={r} className="contents">
                  <div className="num flex items-center justify-center text-xs text-faint">R{r + 1}</div>
                  {draft.order.map((tid, col) => {
                    const overall = r * n + (r % 2 === 0 ? col : n - 1 - col) + 1;
                    const pk = picks.find((x) => x.overall === overall);
                    const pl = pk ? playerById.get(pk.playerId) : null;
                    const current = overall === draft.currentPick && running;
                    const posBg = pl ? { GK: "border-pos-gk/40 bg-pos-gk/8", DEF: "border-pos-def/40 bg-pos-def/8", MID: "border-pos-mid/40 bg-pos-mid/8", FWD: "border-pos-fwd/40 bg-pos-fwd/8" }[pl.pos] : "";
                    return (
                      <div key={tid} className={cn("min-h-12 rounded-lg border px-2 py-1.5 text-xs", pl ? posBg : "border-line bg-ink/20", current && "animate-pulse-ring border-accent")}>
                        <div className="num text-[10px] text-faint">#{overall}{pk?.auto ? " · auto" : ""}</div>
                        {pl ? <div className="truncate font-semibold">{pl.name}</div> : current ? <div className="font-semibold text-glow">No relógio</div> : null}
                        {pl && <div className="truncate text-[10px] text-muted">{POS_LABEL[pl.pos]} · {pl.club}</div>}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <div className="mb-3 flex flex-wrap gap-1">
              {draft.order.map((tid) => <button key={tid} onClick={() => setRosterTeam(tid)} className={cn("rounded-lg px-2.5 py-1 text-xs font-medium", rosterTeam === tid ? "bg-accent text-white" : "bg-white/4 text-muted")}>{teamById.get(tid)?.name}</button>)}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {POSITIONS.map((p) => (
                <div key={p} className="rounded-xl border border-line bg-ink/20 p-3">
                  <PosBadge pos={p} />
                  <div className="mt-2 space-y-1">
                    {picks.filter((x) => x.teamId === rosterTeam && playerById.get(x.playerId)?.pos === p).map((x) => <div key={x.playerId} className="truncate text-sm">{playerById.get(x.playerId)?.name} <span className="text-xs text-faint">#{x.overall}</span></div>)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
