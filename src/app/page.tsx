import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Shuffle, Repeat, Radio, Shield, Trophy, MessageCircle } from "lucide-react";
import { getUser } from "@/server/auth";
import { Logo } from "@/components/ui/misc";
import { buttonVariants } from "@/components/ui/button";

const FEATURES = [
  { icon: Shuffle, title: "Snake draft ao vivo", body: "Sorteio verificável, relógio por escolha, fila de preferências e auto-pick." },
  { icon: Shield, title: "Pontuação que valoriza defesas", body: "Desarmes, interceções, cortes e clean sheets contam tanto como golos." },
  { icon: Repeat, title: "Trades e waivers", body: "Propostas, contrapropostas, votação da liga e prioridade rotativa." },
  { icon: Radio, title: "Jornadas em direto", body: "Pontos atualizados durante os jogos com estatísticas reais via API." },
  { icon: Trophy, title: "H2H e playoffs", body: "Confrontos diretos semanais e playoffs nas eliminatórias da UCL." },
  { icon: MessageCircle, title: "Trash talk", body: "Feed da liga, reações e provocações entre amigos." },
];

export default async function Landing() {
  if (await getUser()) redirect("/dashboard");
  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
      <header className="flex items-center justify-between py-6">
        <Logo />
        <div className="flex gap-2">
          <Link href="/login" className={buttonVariants({ variant: "ghost" })}>Entrar</Link>
          <Link href="/register" className={buttonVariants({})}>Criar conta</Link>
        </div>
      </header>
      <section className="pt-14 pb-16 sm:pt-24">
        <div className="eyebrow mb-5 text-glow">Liga privada · Fase de liga → Final</div>
        <h1 className="max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
          As noites europeias, <span className="bg-gradient-to-r from-glow to-accent bg-clip-text text-transparent">agora com o teu plantel.</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted">
          Fantasy da Champions para grupos de amigos, com draft a sério, mercado entre participantes e um sistema de pontos onde um central dominante vale tanto como um ponta de lança.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <Link href="/register" className={buttonVariants({ size: "lg" })}>Começar uma liga <ArrowRight size={18} /></Link>
          <Link href="/login" className={buttonVariants({ size: "lg", variant: "secondary" })}>Já tenho convite</Link>
        </div>
      </section>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="card p-5">
            <f.icon className="text-accent-strong" size={22} />
            <div className="mt-4 font-semibold">{f.title}</div>
            <p className="mt-1.5 text-sm text-muted">{f.body}</p>
          </div>
        ))}
      </section>
      <p className="mt-16 text-center text-xs text-faint">Projeto independente de fãs. Não afiliado à UEFA. Estatísticas fornecidas pela API configurada.</p>
    </main>
  );
}
