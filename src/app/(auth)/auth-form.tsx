"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { login, register } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/dashboard";
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    start(async () => {
      const r = mode === "login"
        ? await login({ email: String(f.get("email")), password: String(f.get("password")) })
        : await register({ displayName: String(f.get("displayName")), email: String(f.get("email")), password: String(f.get("password")) });
      if (!r.ok) setError(r.error);
      else router.replace(next.startsWith("/") ? next : "/dashboard");
    });
  };
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{mode === "login" ? "Bem-vindo de volta" : "Criar conta"}</h1>
        <p className="mt-1 text-sm text-muted">{mode === "login" ? "Entra para gerir o teu plantel." : "Junta-te à liga dos teus amigos."}</p>
      </div>
      {mode === "register" && <Field label="Nome"><Input name="displayName" required minLength={2} maxLength={40} autoComplete="nickname" /></Field>}
      <Field label="Email"><Input name="email" type="email" required autoComplete="email" /></Field>
      <Field label="Palavra-passe" hint={mode === "register" ? "Mínimo 8 caracteres." : undefined}>
        <Input name="password" type="password" required minLength={mode === "register" ? 8 : 1} autoComplete={mode === "login" ? "current-password" : "new-password"} />
      </Field>
      {error && <p className="rounded-lg bg-loss/10 px-3 py-2 text-sm text-loss">{error}</p>}
      <Button className="w-full" size="lg" disabled={pending}>{pending ? "Aguarda…" : mode === "login" ? "Entrar" : "Criar conta"}</Button>
      <p className="text-center text-sm text-muted">
        {mode === "login" ? <>Ainda não tens conta? <Link className="text-glow hover:underline" href={`/register?next=${encodeURIComponent(next)}`}>Regista-te</Link></>
          : <>Já tens conta? <Link className="text-glow hover:underline" href={`/login?next=${encodeURIComponent(next)}`}>Entrar</Link></>}
      </p>
    </form>
  );
}
