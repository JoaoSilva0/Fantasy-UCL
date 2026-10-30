/**
 * Ferramenta de desenvolvimento: completa um draft em curso com auto-picks (fila → melhor disponível).
 *   npm run draft:finish -- <leagueId>
 */
import { prisma } from "../src/server/db";
import { makePick } from "../src/server/services/draft";

async function main() {
  const leagueId = process.argv[2];
  const d = await prisma.draft.findUniqueOrThrow({ where: { leagueId } });
  let n = 0;
  for (let cur = d; cur.status === "RUNNING"; cur = await prisma.draft.findUniqueOrThrow({ where: { leagueId } })) {
    await makePick({ leagueId, teamId: null, playerId: null, auto: true, expectedPick: cur.currentPick });
    n++;
  }
  console.log(`${n} auto-picks feitos.`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
