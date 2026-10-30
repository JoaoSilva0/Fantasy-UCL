import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { CreateLeagueForm } from "./form";

export const metadata = { title: "Criar liga" };

export default async function NewLeague() {
  await requireUser();
  const seasons = await prisma.season.findMany({ where: { isDemo: false }, orderBy: { year: "desc" }, include: { _count: { select: { players: true, fixtures: true } } } });
  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-8 sm:px-6">
      <div className="eyebrow mb-1">Nova liga</div>
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">Criar liga privada</h1>
      <CreateLeagueForm
        seasons={seasons.map((s) => ({ id: s.id, name: s.name, players: s._count.players, fixtures: s._count.fixtures }))}
        hasApiKey={!!process.env.API_FOOTBALL_KEY}
      />
    </main>
  );
}
