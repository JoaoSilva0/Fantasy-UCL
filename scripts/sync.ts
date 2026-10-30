/**
 * Sincronização manual com a API real:
 *   npm run sync -- season | live | post
 */
import { syncLive, syncPostMatch, syncSeason } from "../src/server/services/sync";

const job = process.argv[2] ?? "season";
const fn = { season: syncSeason, live: syncLive, post: syncPostMatch }[job];
if (!fn) {
  console.error("Uso: npm run sync -- season|live|post");
  process.exit(1);
}
fn().then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0); }).catch((e) => { console.error(e.message); process.exit(1); });
