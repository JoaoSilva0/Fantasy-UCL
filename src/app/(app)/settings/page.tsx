import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { SettingsForms } from "./forms";

export const metadata = { title: "Definições" };

export default async function Settings() {
  const user = await requireUser();
  const teams = await prisma.team.findMany({ where: { userId: user.id }, include: { league: true } });
  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-8 sm:px-6">
      <div className="eyebrow mb-1">Conta</div>
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">Definições</h1>
      <SettingsForms user={{ displayName: user.displayName, avatarColor: user.avatarColor, email: user.email }} teams={teams.map((t) => ({ leagueId: t.leagueId, league: t.league.name, name: t.name }))} />
    </main>
  );
}
