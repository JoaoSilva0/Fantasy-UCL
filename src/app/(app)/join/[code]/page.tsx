import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/misc";
import { JoinForm } from "./form";

export const metadata = { title: "Convite" };

export default async function Join({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const user = await requireUser();
  const league = await prisma.league.findUnique({ where: { inviteCode: code.toUpperCase() }, include: { teams: true, commissioner: true, season: true } });
  if (league?.teams.some((t) => t.userId === user.id)) redirect(`/leagues/${league.id}`);
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <Card className="p-6">
        {!league ? <Empty title="Convite inválido" body="Confirma o código com o comissário da liga." /> : (
          <>
            <div className="eyebrow mb-1">Convite para</div>
            <h1 className="text-2xl font-semibold tracking-tight">{league.name}</h1>
            <p className="mt-1 text-sm text-muted">Comissário: {league.commissioner.displayName} · {league.teams.length}/{league.maxTeams} participantes · {league.season.name}</p>
            <div className="mt-6"><JoinForm code={league.inviteCode} closed={league.status !== "SETUP" || league.teams.length >= league.maxTeams} /></div>
          </>
        )}
      </Card>
    </main>
  );
}
