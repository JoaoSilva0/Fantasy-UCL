# Motor de pontuação

Código: `src/lib/fantasy/scoring.ts` (função pura `scorePlayer`). Regras por omissão: `DEFAULT_SCORING` em `src/lib/fantasy/config.ts`. O comissário edita tudo em **Admin → Pontuação**; ao guardar, todas as pontuações da liga são recalculadas e a alteração fica na auditoria.

## Tabela por omissão

Implementa integralmente as tabelas pedidas (ofensiva, defensiva, outras métricas). Acrescentos:

| Ação | Pontos | Porquê |
|---|---:|---|
| Duelo ganho (líquido) | 0.2 | Métrica real disponível na API-Football que compensa a falta de cortes/recuperações |
| Por cada 2 golos sofridos (GR/DEF) | 0 | Desativado por omissão; configurável |
| Teto de ações defensivas por jogo | 10 | Anti-inflação |
| Teto de ações criativas por jogo | 8 | Anti-inflação |
| Multiplicadores por posição | 1.0 | Normalização configurável por grupo (defensivo/criativo) e posição |

**Duplo-duplo**: ≥ 5 (configurável) em duas categorias de entre desarmes, interceções, cortes, recuperações, passes decisivos, dribles e (só GR) defesas.

## Anti-duplicação

Cada ação real é premiada uma única vez:

1. Remates enquadrados **excluem** os que deram golo.
2. Grandes oportunidades criadas excluem as que deram assistência.
3. Passes decisivos excluem assistências e grandes oportunidades já premiadas.
4. Duelos ganhos são contados **líquidos** de desarmes e dribles (que já são duelos).
5. Defesas excluem penáltis defendidos. "Penálti defendido" e "Defesa de grande penalidade durante o jogo" são a mesma ação: contam uma vez (5 pts).
6. Segundo amarelo → apenas o vermelho (−3).
7. Notas ≥ 8 e ≥ 9 não acumulam (9.2 dá +3, não +5).
8. Clean sheet exige 60+ minutos **e** zero golos sofridos *enquanto o jogador esteve em campo*.

## Equilíbrio (verificado em `tests/unit/fantasy.test.ts`)

| Perfil | Pontos |
|---|---:|
| Central: 90', clean sheet, 10 cortes, 8 interceções, 5 recuperações | **15.5** (2 + 4 + 2.5 + 4 + 1 + 2 duplo-duplo) |
| Avançado: 90', 1 golo, equipa sofre 1 | **6** (2 + 4; o remate do golo não conta 2×) |

## Métricas indisponíveis

Se o provider não fornece uma métrica, o valor fica `null`, **não pontua** e aparece "n/d" no perfil do jogador. Nunca é estimada. Com a API-Football ficam n/d: cortes, recuperações, grandes oportunidades, assistência secundária, bola no poste, erros que originam golo/remate e MVP oficial.

## Recálculo e correções

- Cada linha de estatística tem um `hash`. Se a API corrigir um número, a linha é atualizada, a versão anterior fica em `StatRevision` e os pontos de todas as ligas afetadas são recalculados (idempotente: só escreve quando `statHash` ou `rulesHash` mudam).
- As jornadas fecham ~2 h após o último jogo + 2 h de período de graça. Correções posteriores continuam a ser aplicadas.

## Estimativas

"Est." (draft, mercado, trade analyzer) = 60% média das últimas 5 jornadas + 40% média da época, **apenas com pontos reais**. Sem jogos disputados mostra "—". Não há probabilidades de titularidade nem de clean sheet: exigiriam dados (onzes prováveis, odds) que a API escolhida não fornece de forma fiável.
