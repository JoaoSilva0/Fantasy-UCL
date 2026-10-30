"use client";
import { useState } from "react";
import { changePassword, updateProfile } from "@/server/actions/auth";
import { renameTeamAction } from "@/server/actions/league";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { cn } from "@/lib/utils";

const COLORS = ["#2F6BFF", "#7C5CFF", "#00B8D9", "#3DDC97", "#FF7A8A", "#F5B942", "#E05DD1", "#8494B8"];

export function SettingsForms({ user, teams }: { user: { displayName: string; avatarColor: string; email: string }; teams: { leagueId: string; league: string; name: string }[] }) {
  const { pending, run } = useAction();
  const [p, setP] = useState(user);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [names, setNames] = useState(Object.fromEntries(teams.map((t) => [t.leagueId, t.name])));
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Perfil" eyebrow={user.email} />
        <CardBody className="space-y-4">
          <Field label="Nome"><Input value={p.displayName} onChange={(e) => setP({ ...p, displayName: e.target.value })} /></Field>
          <div>
            <div className="mb-1.5 text-xs font-medium text-silver">Cor</div>
            <div className="flex flex-wrap gap-2">{COLORS.map((c) => <button key={c} type="button" aria-label={c} onClick={() => setP({ ...p, avatarColor: c })} className={cn("h-8 w-8 rounded-full ring-2 ring-offset-2 ring-offset-surface", p.avatarColor === c ? "ring-fg" : "ring-transparent")} style={{ background: c }} />)}</div>
          </div>
          <Button disabled={pending} onClick={() => run(() => updateProfile(p), { success: "Perfil atualizado" })}>Guardar</Button>
        </CardBody>
      </Card>
      {teams.length > 0 && (
        <Card>
          <CardHeader title="As minhas equipas" />
          <CardBody className="space-y-3">
            {teams.map((t) => (
              <div key={t.leagueId} className="flex items-end gap-2">
                <div className="flex-1"><Field label={t.league}><Input value={names[t.leagueId]} onChange={(e) => setNames({ ...names, [t.leagueId]: e.target.value })} /></Field></div>
                <Button variant="secondary" disabled={pending} onClick={() => run(() => renameTeamAction(t.leagueId, names[t.leagueId]), { success: "Nome atualizado" })}>Guardar</Button>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader title="Palavra-passe" />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Field label="Atual"><Input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" /></Field>
          <Field label="Nova"><Input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" /></Field>
          <div className="sm:col-span-2"><Button variant="secondary" disabled={pending || !pw.current || pw.next.length < 8} onClick={() => run(() => changePassword(pw), { success: "Palavra-passe alterada. Outras sessões terminadas.", onSuccess: () => setPw({ current: "", next: "" }) })}>Alterar</Button></div>
        </CardBody>
      </Card>
    </div>
  );
}
