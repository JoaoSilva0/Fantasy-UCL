# Análise de APIs de futebol

> Preços e limites indicativos com base na informação pública conhecida; **confirmar sempre na página de preços do fornecedor antes de subscrever**.

## Comparação

| Critério | API-Football (api-sports.io) | Sportmonks Football v3 | football-data.org |
|---|---|---|---|
| Cobertura UCL (fase de liga + KO) | Sim (league id `2`) | Sim | Sim (código `CL`) |
| Plantéis / fotos / nacionalidade / idade / número | Sim (`players`, `players/squads`) | Sim | Plantéis básicos, sem fotos |
| Minutos, golos, assistências, cartões | Sim | Sim | Golos/cartões por jogo; sem estatística individual completa |
| Remates / remates enquadrados | Sim | Sim | Não |
| Passes / passes decisivos | Sim (`passes.key`) | Sim | Não |
| Desarmes, interceções, remates bloqueados | Sim | Sim | Não |
| Duelos ganhos, dribles | Sim | Sim | Não |
| Cortes (clearances), recuperações | **Não** | Sim (planos avançados) | Não |
| Grandes oportunidades criadas, erros que originam golo/remate, bola no poste | **Não** | Sim (planos avançados) | Não |
| Defesas GR, penáltis defendidos/falhados/cometidos/conquistados | Sim | Sim | Não |
| Nota de desempenho | Sim (`games.rating`) | Sim | Não |
| MVP oficial UEFA | Não | Não fiável | Não |
| Direto | Sim (atualização ~15 s) | Sim | Resultado em direto (limitado) |
| IDs estáveis de jogadores | Sim | Sim | Sim |
| Lesões/suspensões | Sim (`injuries`) | Sim (sidelined) | Não |
| Custo indicativo | Free: 100 pedidos/dia (épocas atuais restritas); **Pro ≈ 19 USD/mês, 7 500 pedidos/dia** | Planos europeus pagos (dezenas a centenas de €/mês); estatísticas avançadas nos planos superiores | Grátis com 10 pedidos/min, mas sem estatísticas individuais |

## Decisão

**API-Football, plano Pro**, como provider principal:

1. Melhor relação fiabilidade / profundidade / custo para um grupo de amigos.
2. Um único pedido `GET /fixtures?id={id}` devolve eventos, onzes e estatísticas por jogador → baixo consumo (≈ 18 jogos por jornada de fase de liga).
3. Cobre a maioria das métricas do sistema de pontuação.

**football-data.org** fica excluída: não tem estatísticas individuais, o que tornaria impossível o sistema de pontuação pedido.

**Sportmonks** é o upgrade recomendado se o grupo quiser cortes, recuperações, grandes oportunidades e erros. A arquitetura está preparada: basta implementar `FootballProvider` (`src/server/providers/types.ts`) e declarar as `capabilities` — o motor de pontuação ativa automaticamente as métricas suportadas. **Não foi incluído um adaptador Sportmonks não testado** para não simular uma integração que não existe.

## Métricas e disponibilidade (API-Football)

| Métrica de pontuação | Campo API-Football | Estado |
|---|---|---|
| Golo / assistência | `goals.total`, `goals.assists` | ✅ |
| Remate enquadrado | `shots.on` | ✅ |
| Drible bem-sucedido | `dribbles.success` | ✅ |
| Penálti conquistado/falhado/cometido/defendido | `penalty.won/missed/commited/saved` | ✅ |
| Fora de jogo | `offsides` | ✅ |
| Interceção / desarme / remate bloqueado | `tackles.interceptions/total/blocks` | ✅ |
| Duelos ganhos | `duels.won` | ✅ (usado líquido de desarmes e dribles) |
| Defesas GR | `goals.saves` | ✅ |
| Passe decisivo | `passes.key` | ✅ |
| Cartões | `cards.yellow/red` | ✅ |
| Autogolo | eventos (`detail = "Own Goal"`) | ✅ |
| Nota ≥ 8 / ≥ 9 | `games.rating` | ✅ |
| Minutos / clean sheet | `games.minutes` + eventos de golo e substituições | ✅ (clean sheet calculado com golos sofridos **enquanto o jogador esteve em campo**) |
| Hat-trick / duplo-duplo | derivados | ✅ |
| Cortes, recuperações | — | ❌ n/d |
| Grande oportunidade criada, assistência secundária | — | ❌ n/d |
| Bola no poste, erros que originam golo/remate | — | ❌ n/d |
| MVP oficial | — | ❌ n/d |

## Configuração

```bash
# .env
FOOTBALL_PROVIDER=api-football
API_FOOTBALL_KEY=xxxxxxxx           # dashboard.api-football.com → Account → API Key
API_FOOTBALL_BASE_URL=https://v3.football.api-sports.io
UCL_LEAGUE_ID=2
UCL_SEASON=2026                     # ano de início da época (2026 = 2026/27)
CRON_SECRET=um-segredo-longo
```

A chave existe apenas no servidor (`src/server/providers/api-football.ts`); nunca é enviada ao browser.

### Fluxo de sincronização
1. `npm run sync -- season` (ou botão no painel do comissário): clubes da fase de liga, jornadas, jogos, plantéis, lesões.
2. `/api/cron/sync?job=live` (a cada minuto): só jogos em janela ativa (−15 min a +3 h do pontapé de saída) → estatísticas → recálculo de pontos → evento em tempo real.
3. `/api/cron/sync?job=post` (de hora a hora): re-sincroniza jogos terminados nas últimas 48 h para apanhar correções e fecha as jornadas.
4. `/api/cron/sync?job=daily`: plantéis e lesões.
