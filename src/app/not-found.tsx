import Link from "next/link";
import { Logo } from "@/components/ui/misc";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <Logo />
      <h1 className="text-2xl font-semibold">Página não encontrada</h1>
      <p className="max-w-sm text-sm text-muted">A página não existe ou não tens acesso (as ligas são privadas).</p>
      <Link href="/dashboard" className="text-glow">Voltar ao painel →</Link>
    </main>
  );
}
