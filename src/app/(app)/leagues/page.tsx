import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Empty } from "@/components/ui/misc";
import { JoinByCode } from "./join-by-code";

export const metadata = { title: "As minhas ligas" };

export default async function Leagues() {
  const user = await requireUser();
  const teams = await prisma.team.findMany({ where: { userId: user.id }, include: { league: { include: { season: true, _count: { select: { teams: true } } } } }, orderBy: { createdAt: "desc" } });
  return (
    <main className="mx-auto max-w-5xl px-4 pb-24 pt-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div><div className="eyebrow mb-1">Ligas privadas</div><h1 className="text-3xl font-semibold tracking-tight">As minhas ligas</h1></div>
        <Link href="/leagues/new" className={buttonVariants({})}><Plus size={16} /> Criar liga</Link>
      </div>
      <div className="grid gap-4 md:grid-cols-[1fr_340px]">
        <Card>
          {teams.length === 0 ? <Empty icon={<Users size={32} />} title="Sem ligas" body="Cria a tua liga ou usa um código de convite." /> : (
            <ul className="divide-y divide-line">
              {teams.map((t) => (
                <li key={t.id}>
                  <Link href={`/leagues/${t.leagueId}`} className="flex items-center gap-4 px-5 py-4 hover:bg-white/3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{t.league.name}</div>
                      <div className="truncate text-sm text-muted">{t.name} · {t.league.season.name}</div>
                    </div>
                    {t.league.season.isDemo && <Badge tone="warn">DEMO</Badge>}
                    <Badge>{t.league._count.teams}/{t.league.maxTeams}</Badge>
                    {t.league.commissionerId === user.id && <Badge tone="accent">Comissário</Badge>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="h-fit">
          <CardHeader eyebrow="Convite" title="Entrar com código" />
          <CardBody><JoinByCode /></CardBody>
        </Card>
      </div>
    </main>
  );
}
