// Teste E2E no browser real (Chromium), com 4 utilizadores em simultâneo.
// Pré-requisito: app a correr (npm run build && npm start). Uso:
//   BASE_URL=http://localhost:3000 SHOTS=./shots node tests/e2e/league-flow.mjs
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { execSync } from "child_process";
import fs from "fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS ?? "./shots";
fs.mkdirSync(SHOTS, { recursive: true });
const run = Date.now().toString(36);
const log = (...a) => console.log("•", ...a);
const assert = (c, m) => { if (!c) throw new Error("FALHOU: " + m); };

const browser = await chromium.launch();
const users = [];
for (let i = 1; i <= 4; i++) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error(`[u${i} pageerror]`, e.message));
  users.push({ ctx, page, name: `Amigo ${i}`, email: `e2e${i}-${run}@test.pt` });
}
const shot = (p, n, full = true) => p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: full });

// 1. Registo
for (const u of users) {
  await u.page.goto(`${BASE}/register`);
  await u.page.fill('input[name="displayName"]', u.name);
  await u.page.fill('input[name="email"]', u.email);
  await u.page.fill('input[name="password"]', "palavra-passe-1");
  await u.page.click('button:has-text("Criar conta")');
  await u.page.waitForURL("**/dashboard");
}
log("4 contas registadas");
const [a, b, c, d] = users;
await shot(a.page, "01-dashboard-vazio");

// 2. Criar liga DEMO
await a.page.goto(`${BASE}/leagues/new`);
await a.page.click("text=Época DEMO");
await a.page.fill('input[placeholder="Liga dos Amigos"]', "Liga E2E");
await a.page.fill('input[placeholder="Galácticos de Alvalade"]', "Os Invencíveis");
await a.page.selectOption("select >> nth=0", "4");
await a.page.selectOption("select >> nth=2", "30");
await shot(a.page, "02-criar-liga");
await a.page.click('button:has-text("Criar liga")');
await a.page.waitForURL(/\/leagues\/c[a-z0-9]{20,}$/);
const leagueUrl = a.page.url();
const leagueId = leagueUrl.split("/").pop();
const code = (await a.page.locator(".font-mono.tracking-\\[0\\.3em\\]").innerText()).trim();
log("liga criada", leagueId, "código", code);

// 3. Convites
const teamNames = ["", "Dragões FC", "Leões de Ouro", "Águias Reais"];
for (const [i, u] of [b, c, d].entries()) {
  await u.page.goto(`${BASE}/join/${code}`);
  await u.page.fill("input", teamNames[i + 1]);
  await u.page.click('button:has-text("Entrar na liga")');
  await u.page.waitForURL(leagueUrl);
}
// Utilizador não convidado não vê a liga
const outsider = await (await browser.newContext()).newPage();
const r404 = await outsider.goto(`${leagueUrl}`);
assert(outsider.url().includes("/login"), "não autenticado deve ir para login");
log("3 convidados entraram; liga invisível para não autenticados");
await a.page.reload();
await shot(a.page, "03-lobby");

// 4. Sorteio e início do draft
a.page.once("dialog", (dlg) => dlg.accept());
await a.page.click('button:has-text("Sortear ordem do draft")');
await a.page.waitForSelector('button:has-text("Iniciar draft")');
await shot(a.page, "04-lobby-ordem-sorteada");
await a.page.click('button:has-text("Iniciar draft")');
await a.page.waitForSelector("text=Entrar na sala de draft");
for (const u of users) await u.page.goto(`${leagueUrl}/draft`);
log("draft iniciado");

// 5. Primeiras 6 escolhas pela UI; quem está no relógio clica "Escolher" no 1.º disponível.
for (let k = 0; k < 6; k++) {
  let picker = null;
  for (let tries = 0; tries < 40 && !picker; tries++) {
    for (const u of users) if (await u.page.locator("text=É a tua vez!").count()) picker = u;
    if (!picker) await users[0].page.waitForTimeout(250);
  }
  assert(picker, "ninguém está no relógio");
  const before = await d.page.locator("text=/#\\d+ · auto|#\\d+$/").count();
  await picker.page.locator('tbody button:has-text("Escolher"):not([disabled])').first().click();
  await picker.page.waitForTimeout(400);
  log(`pick ${k + 1} por ${picker.name}`);
}
// Tempo real: o utilizador D deve ver as 6 escolhas no quadro sem recarregar.
await d.page.waitForFunction(() => document.body.innerText.includes("6/60 escolhas"), null, { timeout: 15000 });
log("tempo real OK: quadro atualizado noutro browser sem reload");
await shot(a.page, "05-sala-draft");
await d.ctx.newPage().then(async (p) => { await p.setViewportSize({ width: 390, height: 844 }); await p.goto(`${leagueUrl}/draft`); await shot(p, "05b-sala-draft-mobile"); await p.close(); });

// Pausa / retoma pelo comissário
await a.page.click('button:has-text("Pausar")');
await a.page.waitForSelector('button:has-text("Retomar")');
await b.page.waitForSelector("text=Pausa", { timeout: 10000 });
await a.page.click('button:has-text("Retomar")');
log("pausa/retoma propagada");

// 6. Completar o draft (auto-picks via serviço — equivalente a deixar o relógio expirar)
execSync(`npx tsx --env-file=.env scripts/finish-draft.ts ${leagueId}`, { stdio: "inherit" });
await a.page.waitForSelector("text=Draft concluído", { timeout: 15000 });
await shot(a.page, "06-draft-concluido");

// 7. Plantel e onze
await a.page.goto(`${leagueUrl}/team`);
await a.page.waitForSelector("text=Plantel completo");
await shot(a.page, "07-plantel");
await a.page.selectOption('select[aria-label="Formação"]', "4-4-2");
await a.page.click('button:has-text("Guardar onze")');
await a.page.waitForSelector("text=Onze guardado");
log("onze guardado com nova formação 4-4-2");
const mob = await a.ctx.newPage();
await mob.setViewportSize({ width: 390, height: 844 });
await mob.goto(`${leagueUrl}/team`);
await shot(mob, "07b-plantel-mobile");

// 8. Trade: A propõe a B, B aceita, C e D votam (sem veto) → fica em revisão
await a.page.goto(`${leagueUrl}/trades`);
await a.page.selectOption("#builder select", { index: 0 });
const builder = a.page.locator("#builder");
await builder.locator("div.max-h-72 >> nth=0").locator("button").nth(7).click();
await builder.locator("div.max-h-72 >> nth=1").locator("button").nth(7).click();
await a.page.waitForSelector("text=Valor que dás");
await builder.locator("textarea").fill("Proposta irrecusável 😏");
await builder.locator('button:has-text("Enviar proposta")').click();
await a.page.waitForSelector("text=Proposta enviada");
await shot(a.page, "08-trades");
const receiverName = await a.page.locator("#builder select option:checked").innerText();
const receiver = users.find((u, i) => receiverName.startsWith(teamNames[i] || "Os Invencíveis") && i > 0) ?? b;
await receiver.page.goto(`${leagueUrl}/trades`);
await receiver.page.click('button:has-text("Aceitar")');
await receiver.page.waitForSelector("text=Em revisão");
log("troca aceite → em votação da liga");

// 9. Simular jornada DEMO ao vivo e completa
await a.page.goto(`${leagueUrl}/admin`);
await a.page.click("text=Dados & jornadas");
await a.page.click('button:has-text("Simular 1.ª parte")');
await a.page.waitForSelector("text=Jogos ao intervalo");
await b.page.goto(`${leagueUrl}/live`);
await b.page.waitForSelector("text=AO VIVO");
await shot(b.page, "09-ao-vivo");
await a.page.click('button:has-text("Simular jornada completa")');
await a.page.waitForSelector("text=Jornada simulada e fechada");
log("jornada simulada (ao vivo → final)");

// 10. Classificações, prémios, perfil de jogador, dashboards
await a.page.goto(`${leagueUrl}/standings`);
await shot(a.page, "10-classificacao");
await a.page.goto(`${leagueUrl}/standings?view=premios`);
await shot(a.page, "11-premios");
await a.page.goto(`${leagueUrl}`);
await shot(a.page, "12-liga-dashboard");
await a.page.goto(`${leagueUrl}/team`);
// Abre o perfil do melhor jogador do plantel (o primeiro com pontos) e expande o detalhe da pontuação.
await a.page.goto(`${leagueUrl}/standings?view=premios`);
await a.page.locator('a[href*="/players/"]').first().click();
await a.page.waitForSelector("text=Pontuação jogo a jogo");
await a.page.locator("details summary").first().click();
await shot(a.page, "13-jogador");
await a.page.goto(`${leagueUrl}/market`);
await shot(a.page, "14-mercado");
await a.page.goto(`${leagueUrl}/calendar`);
await shot(a.page, "15-calendario");
await a.page.goto(`${BASE}/dashboard`);
await shot(a.page, "16-dashboard");
await a.page.goto(`${leagueUrl}/admin`);
await a.page.click("text=Pontuação");
await shot(a.page, "17-admin-pontuacao");

// 11. Chat / trash talk com reação
await c.page.goto(leagueUrl);
await c.page.fill('input[placeholder="Manda uma boca…"]', "Esta jornada foi minha 🐐");
await c.page.click('button[aria-label="Enviar"]');
await a.page.goto(leagueUrl);
await a.page.waitForSelector("text=Esta jornada foi minha", { timeout: 10000 });
log("chat entregue");

// 12. Segurança: B não acede ao admin; outsider autenticado não vê a liga
await b.page.goto(`${leagueUrl}/admin`);
assert(await b.page.locator("text=Apenas o comissário").count(), "não-comissário não deve ver admin");
const o = await browser.newContext(); const op = await o.newPage();
await op.goto(`${BASE}/register`); await op.fill('input[name="displayName"]', "Intruso"); await op.fill('input[name="email"]', `intruso-${run}@t.pt`); await op.fill('input[name="password"]', "palavra-passe-1"); await op.click('button:has-text("Criar conta")'); await op.waitForURL("**/dashboard");
await op.goto(leagueUrl);
assert(await op.locator("text=Página não encontrada").count(), "liga privada deve dar 404 a não-membros");
const sse = await op.request.get(`${leagueUrl.replace("/leagues/", "/api/leagues/")}/stream`);
assert(sse.status() === 404, "stream SSE deve recusar não-membros");
log("isolamento OK (admin, página e stream)");

await browser.close();
console.log("\n✅ E2E concluído. Screenshots em", SHOTS);
