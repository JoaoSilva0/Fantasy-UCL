"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Database, FlaskConical } from "lucide-react";
import { createLeagueAction, importRealSeasonAction } from "@/server/actions/league";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { cn } from "@/lib/utils";

interface S { id: string; name: string; players: number; fixtures: number }

export function CreateLeagueForm({ seasons, hasApiKey }: { seasons: S[]; hasApiKey: boolean }) {
  const router = useRouter();
  const { pending, run } = useAction();
  const [seasonId, setSeasonId] = useState(seasons[0]?.id ?? "demo");
  const [f, setF] = useState({ name: "", teamName: "", maxTeams: 8, format: "HYBRID", pickSeconds: 90, tradeApproval: "VOTE" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.type === "number" || k === "maxTeams" || k === "pickSeconds" ? Number(e.target.value) : e.target.value });

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); run(() => createLeagueAction({ ...f, seasonId }), { onSuccess: (id) => router.push(`/leagues/${id}`), refresh: false }); }}>
      <Card className="space-y-4 p-5">
        <div className="eyebrow">Época / dados</div>
        <div className="grid gap-3 sm:grid-cols-2">
          {seasons.map((s) => (
            <button type="button" key={s.id} onClick={() => setSeasonId(s.id)} className={cn("rounded-xl border p-4 text-left transition", seasonId === s.id ? "border-accent bg-accent-soft" : "border-line-strong hover:border-accent/50")}>
              <Database size={18} className="text-glow" />
              <div className="mt-2 text-sm font-semibold">{s.name}</div>
              <div className="text-xs text-muted">Dados reais · {s.players} jogadores · {s.fixtures} jogos</div>
            </button>
          ))}
          <button type="button" onClick={() => setSeasonId("demo")} className={cn("rounded-xl border p-4 text-left transition", seasonId === "demo" ? "border-warn bg-warn/10" : "border-line-strong hover:border-warn/50")}>
            <FlaskConical size={18} className="text-warn" />
            <div className="mt-2 text-sm font-semibold">Época DEMO</div>
            <div className="text-xs text-muted">Clubes e jogadores fictícios + jornadas simuladas. Para testar o jogo.</div>
          </button>
        </div>
        {seasons.length === 0 && (
          <div className="rounded-xl border border-line-strong bg-ink/40 p-4 text-sm text-muted">
            {hasApiKey ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>A época real ainda não foi importada da API-Football.</span>
                <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => run(() => importRealSeasonAction(), { success: "Época importada" })}>Importar época real</Button>
              </div>
            ) : (
              <>Para usar jogadores e estatísticas reais, configura <code className="text-silver">API_FOOTBALL_KEY</code> no servidor (ver <code className="text-silver">docs/02-APIS.md</code>).</>
            )}
          </div>
        )}
      </Card>
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Nome da liga"><Input required minLength={2} maxLength={40} value={f.name} onChange={set("name")} placeholder="Liga dos Amigos" /></Field>
        <Field label="Nome da tua equipa"><Input required minLength={2} maxLength={40} value={f.teamName} onChange={set("teamName")} placeholder="Galácticos de Alvalade" /></Field>
        <Field label="Participantes (máx.)"><Select value={f.maxTeams} onChange={set("maxTeams")}>{[4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
        <Field label="Formato">
          <Select value={f.format} onChange={set("format")}>
            <option value="HYBRID">Híbrido (H2H + bónus de pontuação)</option>
            <option value="H2H">Head-to-head</option>
            <option value="POINTS">Pontos acumulados</option>
          </Select>
        </Field>
        <Field label="Tempo por escolha no draft"><Select value={f.pickSeconds} onChange={set("pickSeconds")}>{[30, 60, 90, 120, 180, 300].map((n) => <option key={n} value={n}>{n >= 60 ? `${n / 60} min` : `${n} s`}</option>)}</Select></Field>
        <Field label="Aprovação de trocas">
          <Select value={f.tradeApproval} onChange={set("tradeApproval")}>
            <option value="VOTE">Votação da liga (veto)</option>
            <option value="COMMISSIONER">Comissário aprova</option>
            <option value="FREE">Livres</option>
          </Select>
        </Field>
        <p className="text-xs text-muted sm:col-span-2">Plantel: 15 jogadores (2 GR · 5 DEF · 5 MED · 3 AV). Podes ajustar tudo no painel de administração antes do draft.</p>
      </Card>
      <Button size="lg" className="w-full" disabled={pending}>{pending ? "A criar…" : "Criar liga"}</Button>
    </form>
  );
}
