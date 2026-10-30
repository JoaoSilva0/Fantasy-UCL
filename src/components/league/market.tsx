"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Clock, Flame, Search } from "lucide-react";
import { addFreeAgentAction, cancelClaimAction, claimWaiverAction, dropPlayerAction } from "@/server/actions/game";
import { POS_LABEL, POSITIONS, type Pos } from "@/lib/fantasy/config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { ClubCrest, PlayerAvatar, PosBadge, StatusDot } from "@/components/ui/misc";
import { useAction } from "@/components/ui/use-action";
import { cn, fmtDateTime, fmtPts, timeAgo } from "@/lib/utils";

interface FA { id: string; name: string; pos: Pos; club: string; clubLogo: string | null; clubCode: string | null; photo: string | null; nat: string | null; status: string; statusNote: string | null; total: number; games: number; last5Avg: number; seasonAvg: number; proj: number | null; waiverUntil: string | null }

export function Market(props: {
  leagueId: string; players: FA[]; limits: Record<Pos, number>; waiversEnabled: boolean;
  roster: { id: string; name: string; pos: Pos }[];
  claims: { id: string; status: string; player: string; drop: string | null; note: string | null; createdAt: string }[];
  priority: { id: string; name: string; priority: number; me: boolean }[];
}) {
  const { pending, run } = useAction();
  const [tab, setTab] = useState<"all" | "hot" | "claims" | "roster">("all");
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<Pos | "ALL">("ALL");
  const [club, setClub] = useState("ALL");
  const [sort, setSort] = useState<"proj" | "total" | "last5">("proj");
  const [target, setTarget] = useState<FA | null>(null);
  const [drop, setDrop] = useState<string>("");
  const clubs = useMemo(() => [...new Set(props.players.map((p) => p.club))].sort(), [props.players]);
  const counts = useMemo(() => { const c: Record<Pos, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 }; props.roster.forEach((r) => c[r.pos]++); return c; }, [props.roster]);
  const rosterFull = props.roster.length >= Object.values(props.limits).reduce((a, b) => a + b, 0);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    const base = props.players.filter((p) => (pos === "ALL" || p.pos === pos) && (club === "ALL" || p.club === club) && (!t || p.name.toLowerCase().includes(t)));
    if (tab === "hot") return base.filter((p) => p.games >= 2).sort((a, b) => b.last5Avg - a.last5Avg).slice(0, 40);
    const key = sort === "total" ? "total" : sort === "last5" ? "last5Avg" : "proj";
    return base.sort((a, b) => ((b[key] ?? -1) as number) - ((a[key] ?? -1) as number) || a.name.localeCompare(b.name)).slice(0, 150);
  }, [props.players, pos, club, q, sort, tab]);

  const needsDrop = (p: FA) => rosterFull || counts[p.pos] >= props.limits[p.pos];
  const open = (p: FA) => { setTarget(p); setDrop(""); };
  const confirm = () => {
    if (!target) return;
    const d = drop || null;
    const fn = target.waiverUntil ? () => claimWaiverAction(props.leagueId, target.id, d) : () => addFreeAgentAction(props.leagueId, target.id, d);
    run(fn, { success: target.waiverUntil ? "Pedido de waiver registado" : `${target.name} contratado!`, onSuccess: () => setTarget(null) });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="card p-4">
        <div className="mb-4 flex flex-wrap gap-1">
          {([["all", "Free agents"], ["hot", "Em forma"], ["claims", "Os meus pedidos"], ["roster", "Libertar"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={cn("rounded-lg px-3 py-1.5 text-sm font-medium", tab === k ? "bg-white/8 text-fg" : "text-muted hover:text-fg")}>{k === "hot" && <Flame size={14} className="mr-1 inline text-warn" />}{label}</button>
          ))}
        </div>
        {(tab === "all" || tab === "hot") && (
          <>
            <div className="flex flex-wrap gap-2">
              <div className="relative min-w-[180px] flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar" className="pl-9" /></div>
              <Select value={club} onChange={(e) => setClub(e.target.value)} className="w-auto"><option value="ALL">Todos os clubes</option>{clubs.map((c) => <option key={c}>{c}</option>)}</Select>
              {tab === "all" && <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="w-auto"><option value="proj">Estimativa</option><option value="total">Pontos totais</option><option value="last5">Forma (últ. 5)</option></Select>}
            </div>
            <div className="mt-3 flex gap-1">
              {(["ALL", ...POSITIONS] as const).map((p) => <button key={p} onClick={() => setPos(p)} className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold", pos === p ? "bg-accent text-white" : "bg-white/4 text-muted")}>{p === "ALL" ? "Todos" : POS_LABEL[p]}</button>)}
            </div>
            {tab === "hot" && <p className="mt-3 text-xs text-muted">Jogadores livres com melhor média nas últimas 5 jornadas (mín. 2 jogos). Calculado apenas com pontos reais.</p>}
            <div className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line">
              {list.length === 0 && <p className="p-6 text-center text-sm text-muted">Nenhum jogador.</p>}
              {list.map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-white/3">
                  <PlayerAvatar name={p.name} photoUrl={p.photo} pos={p.pos} size={34} />
                  <Link href={`/leagues/${props.leagueId}/players/${p.id}`} className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><span className="truncate text-sm font-medium hover:text-glow">{p.name}</span><StatusDot status={p.status} note={p.statusNote} /></div>
                    <div className="flex items-center gap-1.5 text-xs text-muted"><PosBadge pos={p.pos} className="h-4 min-w-7 text-[9px]" /><ClubCrest name={p.club} logoUrl={p.clubLogo} code={p.clubCode} size={14} />{p.club}{p.nat && <span className="hidden sm:inline">· {p.nat}</span>}</div>
                  </Link>
                  <div className="hidden w-16 text-right sm:block"><div className="num text-sm font-semibold">{p.games ? fmtPts(p.total) : "—"}</div><div className="text-[10px] text-faint">total</div></div>
                  <div className="w-14 text-right"><div className="num text-sm">{p.games ? fmtPts(p.last5Avg) : "—"}</div><div className="text-[10px] text-faint">forma</div></div>
                  {p.waiverUntil ? (
                    <Button size="sm" variant="secondary" onClick={() => open(p)} title={`Em waivers até ${fmtDateTime(p.waiverUntil)}`}><Clock size={13} /> Pedido</Button>
                  ) : <Button size="sm" onClick={() => open(p)}>Contratar</Button>}
                </div>
              ))}
            </div>
          </>
        )}
        {tab === "claims" && (
          <div className="space-y-2">
            {props.claims.length === 0 && <p className="text-sm text-muted">Sem pedidos de waiver.</p>}
            {props.claims.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1"><b>{c.player}</b>{c.drop && <span className="text-muted"> · liberta {c.drop}</span>}<div className="text-xs text-faint" suppressHydrationWarning>{timeAgo(c.createdAt)}{c.note && ` · ${c.note}`}</div></div>
                <Badge tone={c.status === "SUCCESS" ? "win" : c.status === "PENDING" ? "accent" : "neutral"}>{{ PENDING: "Pendente", SUCCESS: "Ganho", FAILED: "Falhou", CANCELLED: "Cancelado" }[c.status]}</Badge>
                {c.status === "PENDING" && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelClaimAction(props.leagueId, c.id), { success: "Pedido cancelado" })}>Cancelar</Button>}
              </div>
            ))}
          </div>
        )}
        {tab === "roster" && (
          <div className="space-y-1.5">
            <p className="mb-2 text-xs text-muted">{props.waiversEnabled ? "Jogadores libertados ficam em waivers antes de voltarem a ser livres." : "Jogadores libertados ficam imediatamente disponíveis."}</p>
            {props.roster.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm">
                <PosBadge pos={r.pos} /><span className="flex-1 truncate">{r.name}</span>
                <Button size="sm" variant="danger" disabled={pending} onClick={() => { if (window.confirm(`Libertar ${r.name}?`)) run(() => dropPlayerAction(props.leagueId, r.id), { success: `${r.name} libertado` }); }}>Libertar</Button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-4">
        <div className="card p-4">
          <div className="eyebrow mb-3">O meu plantel</div>
          <div className="grid grid-cols-4 gap-2 text-center">{POSITIONS.map((p) => <div key={p} className="rounded-xl bg-ink/30 py-2"><PosBadge pos={p} /><div className="num mt-1 text-sm font-semibold">{counts[p]}/{props.limits[p]}</div></div>)}</div>
        </div>
        {props.waiversEnabled && (
          <div className="card p-4">
            <div className="eyebrow mb-1">Prioridade de waivers</div>
            <p className="mb-3 text-xs text-muted">Rotativa: quem ganha um pedido passa para o fim.</p>
            <ol className="space-y-1">{props.priority.map((t) => <li key={t.id} className={cn("flex items-center gap-2 rounded-lg px-2 py-1 text-sm", t.me && "bg-accent-soft")}><span className="num w-5 text-muted">{t.priority}</span><span className="truncate">{t.name}</span></li>)}</ol>
          </div>
        )}
      </div>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        {target && (
          <DialogContent title={target.waiverUntil ? `Pedido de waiver: ${target.name}` : `Contratar ${target.name}`}
            description={target.waiverUntil ? `Em waivers até ${fmtDateTime(target.waiverUntil)}. Vence o pedido com melhor prioridade.` : `${POS_LABEL[target.pos]} · ${target.club}`}>
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 text-xs font-medium text-silver">{needsDrop(target) ? "Tens de libertar um jogador" : "Libertar um jogador (opcional)"}</div>
                <Select value={drop} onChange={(e) => setDrop(e.target.value)}>
                  <option value="">{needsDrop(target) ? "Escolhe…" : "Nenhum"}</option>
                  {props.roster.filter((r) => !needsDrop(target) || rosterFull || r.pos === target.pos).map((r) => <option key={r.id} value={r.id}>{POS_LABEL[r.pos]} · {r.name}</option>)}
                </Select>
              </div>
              <Button className="w-full" disabled={pending || (needsDrop(target) && !drop)} onClick={confirm}>{target.waiverUntil ? "Fazer pedido" : "Confirmar contratação"}</Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
