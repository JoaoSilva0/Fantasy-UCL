# Fase 1 — Planeamento

## 1. Arquitetura

```
┌───────────────────────────── Next.js 15 (App Router) ─────────────────────────────┐
│  React Server Components  ──►  Prisma  ──►  PostgreSQL                              │
│  Server Actions (mutações validadas com Zod, sempre no servidor)                     │
│  Route Handlers:                                                                    │
│    /api/leagues/:id/stream   SSE (tempo real: draft, trades, pontuações, chat)       │
│    /api/cron/:job            jobs protegidos por CRON_SECRET (sync, waivers, ticks)  │
│  Serviços de domínio (src/server/services)                                          │
│    draft · roster · waivers · trades · scoring · standings · activity · sync        │
│  Motor de fantasy puro, testável (src/lib/fantasy)                                  │
│    scoring · snake · lineup · trade-analyzer · schedule                             │
│  Providers de dados (src/server/providers)                                          │
│    api-football (real, ativado por API key) · demo (fictício, sempre rotulado)      │
└────────────────────────────────────────────────────────────────────────────────────┘
```

Decisões:

| Tema | Decisão | Porquê |
|---|---|---|
| Framework | Next.js 15 + React 19 + TypeScript | Um só deploy (Vercel), RSC para páginas rápidas, Server Actions para mutações seguras |
| UI | Tailwind v4 + componentes próprios no padrão shadcn/ui (cva + tailwind-merge + Radix) + Framer Motion | Controlo total do design premium, sem aspeto de template |
| BD | PostgreSQL + Prisma 6 | Relacional (constraints únicas impedem jogadores duplicados), transações com `SELECT … FOR UPDATE` para o draft |
| Auth | Sessões próprias: bcrypt + token aleatório (hash SHA-256 guardado em BD) em cookie `httpOnly`/`SameSite=Lax` | Funciona sem serviços externos; sessões revogáveis. Trocável por Supabase Auth (só `src/server/auth.ts` muda) |
| Tempo real | Server-Sent Events sobre a tabela `ActivityEvent` (cursor incremental) | Funciona em qualquer host (Vercel incluído, com reconexão automática do `EventSource`); não exige infraestrutura extra. Upgrade possível para Supabase Realtime |
| Relógio do draft | Autoritativo no servidor (`pickDeadline`). Auto-pick executado de forma *lazy* (qualquer pedido após o prazo) + cron | Não depende de um worker permanente; idempotente com lock de linha |
| Jobs | `/api/cron/*` (Vercel Cron, GitHub Actions ou `npm run worker` em local) | Sincronização ao vivo, processamento de waivers, fecho de jornadas |

### Multi-liga e isolamento
Todas as entidades de jogo têm `leagueId`. Todos os acessos passam por `requireMember(leagueId)` / `requireCommissioner(leagueId)`.
Os dados de futebol (épocas, clubes, jogadores, jogos, estatísticas) são partilhados entre ligas da mesma época — os **pontos** são calculados por liga, porque cada liga pode ter regras próprias.

## 2. Base de dados (resumo — ver `prisma/schema.prisma`)

- **Futebol real**: `Season`, `Club`, `Player`, `Round` (jornada fantasy), `Fixture`, `PlayerMatchStat` (estatísticas + hash + fonte), `StatRevision` (histórico de correções), `ApiCache`, `SyncLog`.
- **Fantasy**: `League` (settings + scoring em JSON validado por Zod), `Team` (1 por utilizador por liga — `@@unique([leagueId, userId])`), `RosterEntry` (`@@unique([leagueId, playerId])` → **impossível duplicar jogadores**), `Draft`, `DraftPick`, `DraftQueue`, `Lineup`, `LeaguePlayerPoints`, `TeamRoundScore`, `Matchup`, `Trade`, `TradeItem`, `TradeVote`, `WaiverClaim`, `PlayerLeagueState` (waivers).
- **Social/Auditoria**: `Transaction` (log append-only de todas as operações), `ActivityEvent` (feed + tempo real), `ChatMessage`, `Notification`.

## 3. Regras de fantasy

- Plantel: 15 jogadores (2 GR, 5 DEF, 5 MED, 3 AV), configurável antes do draft.
- Onze: 1 GR + formação ∈ {4-3-3, 4-4-2, 3-5-2, 3-4-3, 4-2-3-1, 5-3-2}. 4-2-3-1 conta como 4 DEF / 5 MED / 1 AV.
- Banco ordenado (4 jogadores). Sem substituições automáticas por omissão; quando ativas, um titular com 0 minutos num jogo terminado é trocado pelo primeiro suplente que mantenha uma formação válida.
- Capitão ×2. Vice-capitão herda a capitania se o capitão não jogar (0 minutos e jogo terminado).
- Bloqueio: `ROUND` (tudo bloqueia no primeiro pontapé de saída da jornada) ou `PER_FIXTURE` (cada jogador bloqueia no início do seu jogo; o capitão bloqueia quando o jogo do capitão atual começa).
- Formatos: `POINTS` (pontos acumulados), `H2H` (vitória 3, empate 1), `HYBRID` (H2H + 1 ponto extra por jornada se ficar na metade superior da pontuação).
- Playoffs fantasy (H2H/Híbrido): top 4 — meias-finais somam as jornadas dos Quartos de final da UCL, a final soma as das Meias-finais. O mapeamento é configurável por *stage*, por isso alterações futuras ao formato da UCL só exigem atualizar o mapeamento.

## 4. Draft

- Ordem: sorteio Fisher–Yates com semente criptográfica. **Transparência**: antes do sorteio é publicado `SHA-256(semente)`; após o sorteio a semente é revelada e qualquer participante pode verificar que a ordem deriva dela (commit–reveal).
- Snake: ronda ímpar na ordem, ronda par invertida (`src/lib/fantasy/snake.ts`).
- Relógio por escolha (configurável). Ao expirar: auto-pick → 1º jogador disponível da fila pessoal do participante que caiba no plantel; senão, o jogador disponível com melhor projeção na posição mais carenciada.
- Pausar/retomar pelo comissário (o tempo restante é preservado).
- Concorrência: cada escolha numa transação com `SELECT … FOR UPDATE` na linha do draft + constraints únicas (`draftId+overall`, `draftId+playerId`, `leagueId+playerId`).

## 5. Motor de pontuação

Ver `docs/03-PONTUACAO.md`. Funções puras, todas as regras em JSON configurável pelo comissário, com anti-duplicação explícita e normalização por posição.

## 6. APIs de dados

Ver `docs/02-APIS.md`. Decisão: **API-Football (api-sports.io), plano Pro**, com camada de provider abstrata.

## 7. Riscos e limitações

| Risco | Mitigação |
|---|---|
| Nenhuma API acessível ou chave em falta | Modo DEMO com clubes e jogadores **fictícios**, sempre rotulados como tal; estatísticas simuladas só nesse modo e marcadas como "SIMULADO" |
| API-Football não fornece cortes, recuperações, grandes oportunidades, erros, bolas no poste, MVP oficial, assistência secundária | Métricas marcadas como "n/d" (não pontuam, nunca são inventadas). Para compensar o peso defensivo usamos *duelos ganhos líquidos* (dado real). Upgrade para Sportmonks documentado |
| A API devolve `null` quando a estatística é 0 | Distinguimos por *capabilities* do provider: métrica suportada + `null` → 0; métrica não suportada → `null` (n/d) |
| Correções de estatísticas após o jogo | `hash` por linha de estatística; mudança → `StatRevision` + recálculo dos pontos de todas as ligas afetadas |
| Limites de pedidos | Cache em BD com TTL por endpoint; um só pedido por jogo (`fixtures?id=` traz eventos + estatísticas por jogador); sincronização ao vivo apenas para jogos em janela ativa |
| API indisponível | Retry com backoff, servir cache expirada (stale) e banner "dados desatualizados desde…" |
| Vercel Hobby só permite cron diário | Usar Vercel Pro, GitHub Actions (`.github/workflows/cron.yml`) ou um cron externo a chamar `/api/cron/sync` |
| Colusão em trades | Analisador de valor, sinalização de trades desequilibradas (forçam revisão), cooldown de re-troca, votação/veto |
