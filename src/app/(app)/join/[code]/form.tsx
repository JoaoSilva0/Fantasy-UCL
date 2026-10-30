"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { joinLeagueAction } from "@/server/actions/league";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";

export function JoinForm({ code, closed }: { code: string; closed: boolean }) {
  const router = useRouter();
  const { pending, run } = useAction();
  const [name, setName] = useState("");
  if (closed) return <p className="text-sm text-warn">Esta liga já não aceita novos participantes.</p>;
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => joinLeagueAction({ code, teamName: name }), { onSuccess: (id) => router.push(`/leagues/${id}`), refresh: false }); }}>
      <Field label="Nome da tua equipa"><Input required minLength={2} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Button className="w-full" size="lg" disabled={pending}>Entrar na liga</Button>
    </form>
  );
}
