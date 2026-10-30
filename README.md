# MIDWEEK — Fantasy Champions League privada

Fantasy da UEFA Champions League para grupos privados de amigos: ligas por convite, **snake draft em tempo real**, plantéis com onze/capitão/formação, **trades entre participantes** com votação e anti-colusão, **free agents e waivers** rotativos, H2H com playoffs, pontuação avançada que valoriza defesas, e integração com estatísticas reais via API-Football.

> Projeto independente de fãs; não afiliado à UEFA. A marca "MIDWEEK" e o logótipo são originais.

## Documentação
- [`docs/01-PLANEAMENTO.md`](docs/01-PLANEAMENTO.md) — arquitetura, BD, regras, draft, riscos
- [`docs/02-APIS.md`](docs/02-APIS.md) — comparação de APIs, decisão, métricas disponíveis, configuração
- [`docs/03-PONTUACAO.md`](docs/03-PONTUACAO.md) — motor de pontuação, anti-duplicação, equilíbrio

## Stack
Next.js 15 (App Router, Server Actions) · React 19 · TypeScript · Tailwind v4 · componentes no padrão shadcn/ui (Radix + cva) · Framer Motion · PostgreSQL · Prisma 6 · SSE para tempo real · Vitest + Playwright.

## Arranque local

```bash
cp .env.example .env          # ajustar DATABASE_URL
npm install
npx prisma migrate deploy
npm run build && npm start    # ou: npm run dev
```

Abrir http://localhost:3000, criar conta, **Criar liga**.
- Sem `API_FOOTBALL_KEY`: escolhe **Época DEMO** — clubes, jogadores e estatísticas **fictícios**, sempre rotulados. Cada liga DEMO tem a sua época isolada; o comissário simula jornadas em *Admin → Dados & jornadas*.
- Com `API_FOOTBALL_KEY`: botão **Importar época real** (ou `npm run sync -- season`) importa clubes da fase de liga, jornadas, jogos, plantéis e lesões.

Para os jobs automáticos em local: `npm run worker` (auto-picks, trocas, waivers, sync ao vivo/pós-jogo).

## Testes

```bash
npm test                    # unitários: motor de pontuação, snake, onze, trades, adaptador API-Football
npm run test:integration    # PostgreSQL real: liga de 8, draft completo de 120 escolhas (com corrida
                            # concorrente), jornada ao vivo→fechada com pontos validados, trades, veto, waivers
BASE_URL=http://localhost:3000 node tests/e2e/league-flow.mjs   # browser real, 4 utilizadores em simultâneo
```

## Deploy (Vercel + Supabase/Neon)

1. Criar uma base de dados PostgreSQL (Supabase, Neon…). Usar a connection string *pooled* em `DATABASE_URL`.
2. `npx prisma migrate deploy` contra essa BD.
3. **Se usar Supabase**: correr [`prisma/rls.sql`](prisma/rls.sql) — ativa RLS em todas as tabelas, bloqueando o acesso direto via chaves `anon`/`authenticated` (a app acede só pelo servidor).
4. Importar o repositório na Vercel e definir as variáveis de `.env.example` (`API_FOOTBALL_KEY`, `CRON_SECRET`, …).
5. Cron (compatível com a Vercel Hobby, que só permite crons diários):
   - `vercel.json` → `daily` (plantéis e lesões), uma vez por dia.
   - [`.github/workflows/cron.yml`](.github/workflows/cron.yml) → `tick` a cada 5 min, `live` a cada 5 min nas noites de UCL (ter/qua/qui, 17–23h UTC) e `post` de hora a hora. Requer os secrets `APP_URL` e `CRON_SECRET` no GitHub e só corre a partir da branch `main`.
   - Durante o draft, o relógio continua em tempo real enquanto houver alguém na sala (o stream SSE aplica os auto-picks); o `tick` só apanha drafts sem ninguém ligado.
   - Com Vercel Pro, pode voltar-se a pôr `tick`/`live` a cada minuto no `vercel.json` e desligar o workflow.

## Segurança
- Sessões com token aleatório (só o hash SHA-256 é guardado), cookie `httpOnly`/`SameSite=Lax`/`Secure`, bcrypt (12 rounds).
- Todas as mutações são Server Actions com validação Zod e verificação de membro/comissário no servidor. Ligas privadas devolvem 404 a não-membros (páginas e stream SSE).
- Constraints na BD: um jogador por liga (`RosterEntry @@unique([leagueId, playerId])`), uma equipa por utilizador por liga, escolhas únicas no draft. Escolhas serializadas com `SELECT … FOR UPDATE`.
- Bloqueios de onze/trocas/libertações validados no servidor contra o início real dos jogos.
- Auditoria append-only (`Transaction`) de draft, trocas, contratações, waivers, alterações de regras e recálculos; histórico de correções de estatísticas (`StatRevision`).
- API keys apenas em variáveis de ambiente do servidor.

## Limitações conhecidas
- A API-Football não fornece cortes, recuperações, grandes oportunidades, erros, bolas no poste nem MVP oficial → essas métricas ficam "n/d" (ver docs). Upgrade: implementar um provider Sportmonks (`src/server/providers/types.ts`).
- O plantel usa o plantel atual do clube (`players/squads`), não a lista oficial de inscrição UEFA (não disponível na API).
- Notificações são in-app + tempo real; não há push/email.
