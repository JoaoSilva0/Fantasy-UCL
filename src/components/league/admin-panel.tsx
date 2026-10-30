"use client";
import { useState } from "react";
import { Calculator, Database, FlaskConical, History, RefreshCw, Settings2, SlidersHorizontal } from "lucide-react";
import {
  forceFinalizeAction, recomputeAction, simulateDemoAction, syncAction, updateScoringAction, updateSettingsAction,
} from "@/server/actions/league";
import { DEFAULT_SCORING, POS_LABEL, POSITIONS, SCORING_LABELS, type LeagueSettings, type Pos, type ScoringRules } from "@/lib/fantasy/config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { cn, fmtDateTime, timeAgo } from "@/lib/utils";

type PosRec = Record<Pos, number>;

export function AdminPanel(props: {
  leagueId: string; status: string; isDemo: boolean; inviteCode: string; maxTeams: number; teamCount: number; settings: LeagueSettings; scoring: ScoringRules;
  hasApiKey: boolean; currentRound: string | null; seasonSync: { lastSyncedAt: string | null };
  logs: { id: string; job: string; status: string; message: string | null; requests: number; at: string }[];
  audit: { id: string; type: string; team: string | null; at: string; payload: string }[];
}) {
  const { pending, run } = useAction();
  const [tab, setTab] = useState<"rules" | "scoring" | "data" | "audit">("rules");
  const [s, setS] = useState(props.settings);
  const [maxTeams, setMaxTeams] = useState(props.maxTeams);
  const [rules, setRules] = useState(props.scoring);
  const pre = props.status === "SETUP";
  const num = (v: string) => (v === "" ? 0 : Number(v));

  const scalarKeys = (Object.keys(DEFAULT_SCORING) as (keyof ScoringRules)[]).filter((k) => typeof DEFAULT_SCORING[k] === "number" && k !== "doubleDoubleThreshold");
  const posKeys = (Object.keys(DEFAULT_SCORING) as (keyof ScoringRules)[]).filter((k) => typeof DEFAULT_SCORING[k] === "object" && "GK" in (DEFAULT_SCORING[k] as object));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {([["rules", "Regras da liga", Settings2], ["scoring", "Pontuação", SlidersHorizontal], ["data", "Dados & jornadas", Database], ["audit", "Auditoria", History]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)} className={cn("flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium", tab === k ? "bg-white/8 text-fg" : "text-muted hover:text-fg")}><Icon size={15} />{label}</button>
        ))}
      </div>

      {tab === "rules" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader eyebrow={pre ? "Editável até ao draft" : "Bloqueado após o draft"} title="Plantel e draft" />
            <CardBody className="space-y-4">
              <div className="grid grid-cols-4 gap-2">
                {POSITIONS.map((p) => <Field key={p} label={POS_LABEL[p]}><Input type="number" min={p === "GK" ? 1 : p === "FWD" ? 3 : 5} max={10} disabled={!pre} value={s.roster[p]} onChange={(e) => setS({ ...s, roster: { ...s.roster, [p]: num(e.target.value) } })} /></Field>)}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Segundos por escolha"><Input type="number" min={15} max={600} value={s.draft.pickSeconds} onChange={(e) => setS({ ...s, draft: { pickSeconds: num(e.target.value) } })} /></Field>
                <Field label="Máx. participantes"><Input type="number" min={Math.max(2, props.teamCount)} max={12} disabled={!pre} value={maxTeams} onChange={(e) => setMaxTeams(num(e.target.value))} /></Field>
              </div>
              <Field label="Formato">
                <Select disabled={!pre} value={s.format} onChange={(e) => setS({ ...s, format: e.target.value as LeagueSettings["format"] })}>
                  <option value="HYBRID">Híbrido</option><option value="H2H">Head-to-head</option><option value="POINTS">Pontos acumulados</option>
                </Select>
              </Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.playoffs.enabled} onChange={(e) => setS({ ...s, playoffs: { ...s.playoffs, enabled: e.target.checked } })} /> Playoffs fantasy (top 4)</label>
              <div className="rounded-lg bg-ink/40 px-3 py-2 text-xs text-muted">Código de convite: <span className="font-mono text-silver">{props.inviteCode}</span></div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Onze, trocas e waivers" />
            <CardBody className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Bloqueio do onze"><Select value={s.lineupLock} onChange={(e) => setS({ ...s, lineupLock: e.target.value as LeagueSettings["lineupLock"] })}><option value="PER_FIXTURE">Por jogo do jogador</option><option value="ROUND">No início da jornada</option></Select></Field>
                <Field label="Substituições automáticas"><Select value={String(s.autoSubs)} onChange={(e) => setS({ ...s, autoSubs: e.target.value === "true" })}><option value="true">Ativas</option><option value="false">Desativadas</option></Select></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Aprovação de trocas"><Select value={s.trades.approval} onChange={(e) => setS({ ...s, trades: { ...s.trades, approval: e.target.value as LeagueSettings["trades"]["approval"] } })}><option value="VOTE">Votação da liga</option><option value="COMMISSIONER">Comissário</option><option value="FREE">Livres</option></Select></Field>
                <Field label="Expiração da proposta (h)"><Input type="number" min={1} max={168} value={s.trades.expiryHours} onChange={(e) => setS({ ...s, trades: { ...s.trades, expiryHours: num(e.target.value) } })} /></Field>
                <Field label="Período de votação (h)"><Input type="number" min={1} max={96} value={s.trades.reviewHours} onChange={(e) => setS({ ...s, trades: { ...s.trades, reviewHours: num(e.target.value) } })} /></Field>
                <Field label="Vetos necessários (%)"><Input type="number" min={10} max={100} value={Math.round(s.trades.vetoThreshold * 100)} onChange={(e) => setS({ ...s, trades: { ...s.trades, vetoThreshold: num(e.target.value) / 100 } })} /></Field>
                <Field label="Cooldown anti-colusão (dias)"><Input type="number" min={0} max={30} value={s.trades.cooldownDays} onChange={(e) => setS({ ...s, trades: { ...s.trades, cooldownDays: num(e.target.value) } })} /></Field>
                <Field label="Prazo de trocas (nº jornada)" hint="Vazio = sem prazo"><Input type="number" min={1} value={s.trades.deadlineRoundOrder ?? ""} onChange={(e) => setS({ ...s, trades: { ...s.trades, deadlineRoundOrder: e.target.value ? num(e.target.value) : null } })} /></Field>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.trades.flagImbalanced} onChange={(e) => setS({ ...s, trades: { ...s.trades, flagImbalanced: e.target.checked } })} /> Sinalizar trocas desequilibradas (forçam revisão)</label>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Waivers"><Select value={String(s.waivers.enabled)} onChange={(e) => setS({ ...s, waivers: { ...s.waivers, enabled: e.target.value === "true" } })}><option value="true">Ativos (prioridade rotativa)</option><option value="false">Desativados</option></Select></Field>
                <Field label="Duração dos waivers (h)"><Input type="number" min={0} max={120} value={s.waivers.waiverHours} onChange={(e) => setS({ ...s, waivers: { ...s.waivers, waiverHours: num(e.target.value) } })} /></Field>
              </div>
            </CardBody>
          </Card>
          <div className="lg:col-span-2"><Button disabled={pending} onClick={() => run(() => updateSettingsAction(props.leagueId, s, pre ? maxTeams : undefined), { success: "Regras atualizadas" })}>Guardar regras</Button></div>
        </div>
      )}

      {tab === "scoring" && (
        <Card>
          <CardHeader eyebrow="Ao guardar, todas as pontuações da liga são recalculadas" title="Sistema de pontuação" action={<Button variant="ghost" size="sm" onClick={() => setRules(DEFAULT_SCORING)}>Repor padrão</Button>} />
          <CardBody className="space-y-6">
            <div>
              <div className="eyebrow mb-2">Por posição</div>
              <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-sm"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Ação</th>{POSITIONS.map((p) => <th key={p} className="w-20 py-1">{POS_LABEL[p]}</th>)}</tr></thead>
                <tbody>{posKeys.map((k) => <tr key={k}><td className="py-1 pr-2 text-silver">{SCORING_LABELS[k] ?? k}</td>{POSITIONS.map((p) => <td key={p} className="py-1 pr-2"><Input type="number" step="0.05" className="h-9" value={(rules[k] as PosRec)[p]} onChange={(e) => setRules({ ...rules, [k]: { ...(rules[k] as PosRec), [p]: num(e.target.value) } })} /></td>)}</tr>)}</tbody>
              </table></div>
            </div>
            <div>
              <div className="eyebrow mb-2">Ações</div>
              <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                {scalarKeys.map((k) => <label key={k} className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1 truncate text-silver">{SCORING_LABELS[k] ?? k}</span><Input type="number" step="0.05" className="h-9 w-24" value={rules[k] as number} onChange={(e) => setRules({ ...rules, [k]: num(e.target.value) })} /></label>)}
                <label className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1 truncate text-silver">Limiar do duplo-duplo</span><Input type="number" className="h-9 w-24" value={rules.doubleDoubleThreshold} onChange={(e) => setRules({ ...rules, doubleDoubleThreshold: num(e.target.value) })} /></label>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="eyebrow mb-2">Tetos por jogo (anti-inflação)</div>
                <div className="flex gap-3">
                  <Field label="Ações defensivas"><Input type="number" value={rules.caps.defensive} onChange={(e) => setRules({ ...rules, caps: { ...rules.caps, defensive: num(e.target.value) } })} /></Field>
                  <Field label="Ações criativas"><Input type="number" value={rules.caps.creative} onChange={(e) => setRules({ ...rules, caps: { ...rules.caps, creative: num(e.target.value) } })} /></Field>
                </div>
              </div>
              <div>
                <div className="eyebrow mb-2">Normalização por posição (multiplicadores)</div>
                {(["defensive", "creative"] as const).map((g) => (
                  <div key={g} className="mb-2 flex items-center gap-2 text-sm"><span className="w-20 text-silver">{g === "defensive" ? "Defensivas" : "Criativas"}</span>
                    {POSITIONS.map((p) => <Input key={p} aria-label={`${g} ${p}`} title={POS_LABEL[p]} type="number" step="0.1" className="h-9 w-16" value={rules.positionMultipliers[g][p]} onChange={(e) => setRules({ ...rules, positionMultipliers: { ...rules.positionMultipliers, [g]: { ...rules.positionMultipliers[g], [p]: num(e.target.value) } } })} />)}
                  </div>
                ))}
              </div>
            </div>
            <Button disabled={pending} onClick={() => run(() => updateScoringAction(props.leagueId, rules), { success: "Pontuação atualizada e recalculada" })}><Calculator size={16} /> Guardar e recalcular</Button>
          </CardBody>
        </Card>
      )}

      {tab === "data" && (
        <div className="grid gap-4 lg:grid-cols-2">
          {props.isDemo ? (
            <Card>
              <CardHeader eyebrow="Apenas época DEMO · dados fictícios" title="Simulação de jornadas" action={<FlaskConical size={18} className="text-warn" />} />
              <CardBody className="space-y-3">
                <p className="text-sm text-muted">Gera resultados e estatísticas <b>simulados</b> para a jornada atual ({props.currentRound ?? "—"}). Útil para testar o onze, pontuação, ao vivo e classificações.</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" disabled={pending || props.status !== "ACTIVE"} onClick={() => run(() => simulateDemoAction(props.leagueId, "HALF"), { success: "Jogos ao intervalo (simulado)" })}>Simular 1.ª parte (ao vivo)</Button>
                  <Button disabled={pending || props.status !== "ACTIVE"} onClick={() => run(() => simulateDemoAction(props.leagueId, "FULL"), { success: "Jornada simulada e fechada" })}>Simular jornada completa</Button>
                  <Button variant="ghost" disabled={pending} onClick={() => run(() => forceFinalizeAction(props.leagueId), { success: "Jornadas terminadas fechadas" })}>Fechar jornadas terminadas</Button>
                </div>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHeader eyebrow={props.hasApiKey ? "API-Football ligada" : "Sem API key"} title="Sincronização de dados reais" action={<Database size={18} className="text-faint" />} />
              <CardBody className="space-y-3">
                {!props.hasApiKey && <p className="rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">Define API_FOOTBALL_KEY no servidor para ativar a sincronização.</p>}
                <p className="text-sm text-muted">Automática via cron (ao vivo a cada minuto em dias de jogo; correções de hora a hora). Última sincronização da época: {props.seasonSync.lastSyncedAt ? fmtDateTime(props.seasonSync.lastSyncedAt) : "nunca"}.</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" disabled={pending || !props.hasApiKey} onClick={() => run(() => syncAction(props.leagueId, "season"), { success: "Época, plantéis e lesões sincronizados" })}><RefreshCw size={15} /> Plantéis & calendário</Button>
                  <Button variant="secondary" disabled={pending || !props.hasApiKey} onClick={() => run(() => syncAction(props.leagueId, "live"), { success: "Jogos ao vivo sincronizados" })}>Jogos ao vivo</Button>
                  <Button variant="secondary" disabled={pending || !props.hasApiKey} onClick={() => run(() => syncAction(props.leagueId, "post"), { success: "Pós-jogo sincronizado" })}>Pós-jogo & fecho</Button>
                </div>
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Recalcular pontuações" action={<Calculator size={18} className="text-faint" />} />
            <CardBody className="space-y-3">
              <p className="text-sm text-muted">Reaplica o motor de pontuação a todas as estatísticas guardadas. Feito automaticamente quando a fonte corrige estatísticas ou quando mudas as regras. Fica registado na auditoria.</p>
              <Button variant="secondary" disabled={pending} onClick={() => run(() => recomputeAction(props.leagueId), { success: "Pontuações recalculadas" })}>Recalcular agora</Button>
            </CardBody>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader eyebrow="Global" title="Registos de sincronização" />
            <CardBody className="space-y-1.5">
              {props.logs.length === 0 && <p className="text-sm text-muted">Sem registos.</p>}
              {props.logs.map((l) => <div key={l.id} className="flex items-center gap-3 text-sm"><Badge tone={l.status === "ok" ? "win" : l.status === "error" ? "loss" : "neutral"}>{l.status}</Badge><span className="w-14 font-mono text-xs">{l.job}</span><span className="min-w-0 flex-1 truncate text-xs text-muted">{l.message}</span><span className="text-xs text-faint" suppressHydrationWarning>{l.requests} req · {timeAgo(l.at)}</span></div>)}
            </CardBody>
          </Card>
        </div>
      )}

      {tab === "audit" && (
        <Card>
          <CardHeader eyebrow="Append-only" title="Histórico auditável de transações" />
          <div className="divide-y divide-line">
            {props.audit.map((a) => (
              <div key={a.id} className="grid gap-1 px-5 py-2 text-xs sm:grid-cols-[150px_180px_1fr]">
                <span className="text-faint">{fmtDateTime(a.at)}</span>
                <span className="font-mono text-silver">{a.type}{a.team && <span className="text-muted"> · {a.team}</span>}</span>
                <span className="truncate font-mono text-faint">{a.payload}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
