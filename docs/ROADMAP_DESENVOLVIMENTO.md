# NEXO APP - Documento mestre de produto, método e desenvolvimento

Versão: 2.5

Atualizado em: 2026-09-16

Repositório: `pillavinicius/nexo-app`

Estado: Beta em refinamento controlado

Função: fonte única de escopo, estado, decisões e ordem de implementação

## Mapa rápido

- Identidade, arquitetura, macro e Camada de Dissonância: seções 3 a 5.
- Dados, Quant Engine e portões: seções 6 e 7.
- Scan, EDG, Deep e valuation: seções 8 a 11.
- Ciclo Goldberg e Biblioteca Viva: seções 12 e 13.
- Classes de ativos e Carteira NEXO: seções 14 e 15.
- Produto, reporting, infraestrutura e custos: seções 16 a 19.
- Roadmap J0-J9: seção 20.
- Homologação, decisões e backlog: seções 21 a 23.
- Fontes e protocolo de retomada: seções 24 a 26.

## 1. Regra de uso deste documento

Este arquivo consolida o escopo conhecido do Método NEXO e do NEXO APP. Ele substitui o uso do roadmap anterior como visão parcial do Ciclo Goldberg.

Os documentos técnicos específicos continuam válidos como contratos detalhados. Em caso de divergência:

1. a especificação mais nova e explicitamente ratificada vence;
2. o conflito deve ser registrado na seção de decisões pendentes;
3. nenhuma das versões pode ser escolhida silenciosamente pelo código;
4. contrato, engine, teste, interface e relatório devem convergir na mesma alteração.

Todo novo escopo aprovado precisa atualizar este documento no mesmo ciclo. Uma ideia apenas registrada deve aparecer como `REGISTRADA`, nunca como implementada ou aprovada.

## 2. Legenda oficial de estado

| Estado | Significado |
| --- | --- |
| `IMPLEMENTADO` | Existe no código e possui testes automatizados |
| `EM_HOMOLOGACAO` | Implementado, mas ainda há bateria real ou bloqueio conhecido |
| `ESPECIFICADO` | Possui contrato suficiente para iniciar implementação |
| `PLANEJADO` | Objetivo aprovado, contrato ainda incompleto |
| `REGISTRADO` | Ideia preservada para avaliação futura |
| `DECISAO_PENDENTE` | Depende de ratificação metodológica, jurídica ou de produto |
| `BLOQUEADO` | Não pode avançar antes de um pré-requisito explícito |

## 3. Identidade do NEXO

O NEXO é um Sistema Operacional de Decisão Econômica. Seu objetivo principal não é prever preço, mas identificar se existe assimetria entre narrativa, fundamentos, risco e preço, com rastreabilidade suficiente para que a tese possa ser confirmada, acompanhada ou rejeitada.

Princípios oficiais:

- qualidade empresarial e oportunidade de investimento são dimensões diferentes;
- qualidade não gera retorno por si só; assimetria gera retorno potencial;
- uma empresa excelente pode ser um investimento neutro quando o mercado já precificou sua excelência;
- o sistema mede melhor presença ou perda de assimetria do que trajetórias futuras de preço;
- preço histórico é evidência narrativa e comportamental, não valor intrínseco;
- código calcula; a camada analítica interpreta;
- dado ausente reduz confiança e nunca vira zero;
- uma hipótese precisa ter evidência, origem, janela e condição observável de expiração;
- nenhum módulo isolado pode promover compra fora da hierarquia de governança;
- o NEXO não substitui decisão humana e não se apresenta como recomendação automática.

## 4. Arquitetura geral de decisão

### 4.1 Ordem conceitual

1. Contexto macro e regime.
2. Qualidade, disponibilidade e compatibilidade dos dados.
3. Filtros eliminatórios e governança.
4. NEXO Scan.
5. Declaração e governança do edge.
6. NEXO Deep com Biblioteca Viva.
7. Validação das narrativas econômicas e do risco.
8. Reclassificação determinística.
9. Relatório, acompanhamento e carteira.

### 4.2 Fluxo macro e micro para ações

Camada macro:

`IEI -> MFI -> SIM -> SDS-M`

Camada micro:

`NP -> IQD -> SEE -> SNM -> FDM -> CNE -> PIJR -> TNH -> PIN -> RES -> ECS -> ICN-D -> ICN-R -> GNP-E -> GNP-N -> Veredito`

O EDG governa o teto da classificação e a expiração da tese. HDL, NFI, TDN, BJR, NCS e NALM entram quando aplicáveis ao ativo e à natureza do edge.

## 5. Camada macro NEXO

### 5.1 NMI - NEXO Macro Intelligence / Context Engine

Estado: estrutura `IMPLEMENTADA`; saída do seed comprovada no snapshot versionado. Revalidação operacional permanece em P0.

Função:

- consolidar contexto macroeconômico, financeiro, mercado de capitais, crédito imobiliário e cenário internacional;
- publicar um Context Package versionado, datado e validado;
- alimentar Scan, Deep e reclassificação com o mesmo contexto;
- separar dado oficial, proxy, manual e indisponível;
- impedir que contexto seed ou degradado pareça fato de produção.

Estado técnico atual:

- coletor macro e coletor NMI offline;
- contrato e validador de contexto;
- `data/context/latest.json` versionado;
- integração com `/api/analyze`, interface e `/api/health`;
- coleta fora da Vercel e consumo somente de dados já publicados.
- `data/context/latest.json` registra `is_seed_mode: false`, `run_type: t2_reconciled` e watermark oficial do BCB SGS;
- P0 permanece como revalidação do fluxo real e do deploy, não como autorização para recolocar o pacote em seed.

Evoluções:

- ampliar fontes primárias e reduzir campos manuais;
- incluir divergência entre inflação implícita e Focus como sinal, não como correção automática;
- manter point-in-time, freeze histórico, lineage e compatibilidade de contrato.

### 5.2 IEI, MFI, SIM e SDS-M

Estado: `PLANEJADO` como evolução permanente da leitura macro.

- IEI identifica a essência econômica dominante do mercado;
- MFI identifica quem está formando o índice;
- SIM identifica fatores macro dominantes e sensibilidades atuais;
- SDS-M estima vulnerabilidades e drawdowns setoriais sob estresse.

Essas saídas devem preceder a narrativa predominante e alimentar NP, SNM, FDM, CNE, PIJR, valuation e interpretação setorial.

### 5.3 NMH - NEXO Macro Histórico

Estado: `PLANEJADO`.

Objetivo: criar uma base viva de regimes brasileiros, da redemocratização ao presente, e do mercado de crédito imobiliário.

Conteúdo mínimo:

- governos e regimes;
- PIB, inflação, Selic e câmbio;
- Ibovespa, drawdowns e retorno em BRL e USD;
- múltiplos históricos;
- composição dominante do índice e setores;
- sensibilidades macro e crises comparáveis;
- analogias de regime com limitações explícitas.

Filosofia: não apenas identificar onde estamos, mas com quais períodos nos parecemos e quais riscos normalmente emergem nesses contextos.

### 5.4 Camada de Dissonância

Estado consolidado em 2026-09-16: contrato-mãe `v0.2` ainda em `DRAFT`, com CD-1 ratificada e CD-2 a CD-15 provisórias; engine, snapshot e adaptadores ainda não implementados. Os scripts dos probes reais de B3, SGS e DPM foram incorporados à `main` em `bb3f407`, e as três saídas originais completas foram recebidas e conferidas. O Escopo Unificado v2.0, complementado pela Emenda 1 e pela correção documental do item 5.3 registrada neste roadmap, substitui os escopos anteriores e fecha NFI v1.2, FXE v0.3 e DPM v0.2 para implementação offline. Nenhum deles está integrado ao route.

Objetivo: diagnosticar se uma tese está apoiada em números verificáveis, mecânica de mercado ou narrativa, obrigando o código a calcular observações, índices, rótulos e flags antes da interpretação analítica.

Eixos do contrato:

| Eixo | Conteúdo | Medidas principais |
| --- | --- | --- |
| R | Números verificáveis | Selic, IPCA, crédito, atividade, lucro agregado, câmbio PTAX e FXE agregado |
| M | Mecânica de mercado | Fluxos por tipo de investidor, participação estrangeira e fundos ANBIMA opcionais |
| N | Narrativa | Focus, recomendações institucionais formais e preço do índice |
| D | Dissonância direta | Surpresas de política monetária e resíduo FXE empresa versus setor |

Regra-mãe CD-1, ratificada em 2026-09-10: o gate pergunta se a medida muda rótulo, flag, ordem de eventos ou veredito de alguma afirmação. Não exige alteração de recomendação. A validação ocorre por ablação C7.

Regras estruturais:

- observação atômica preserva `disponivel_em`, `fonte`, `qualidade_fonte`, `status`, `n`, `vintage`, `estado_publicacao` e `metodo_z`;
- o z-score robusto usa mediana e MAD, com fallback clássico somente quando MAD = 0 e com método registrado;
- rótulos e flags são calculados em código, nunca inferidos em prosa;
- somente `estado_publicacao = t2_official` agrega; D+2 é a defasagem oficial do fluxo B3;
- fluxo B3 é soma-zero por dia; violação torna o dia `PARCIAL`;
- afirmações são `CONFIRMADA`, `CONTRADITA` ou `NAO_VERIFICAVEL`; afirmação causal permanece `NAO_VERIFICAVEL`;
- texto de terceiros é proibido no pacote. A exceção CD-15 é o diff do comunicado oficial do BC, limitado a seis frases;
- coletor entrega medidas e dados. Catálogo, orientação, sinais, flags e rótulos pertencem aos adaptadores e à engine;
- dado ou constante ausente nunca vira zero, proxy silencioso ou valor inventado. O bloco dependente sai como `AUSENTE`.

Arquitetura especificada:

- `lib/dissonancia/constants.mjs`;
- `lib/dissonancia/dissonancia_engine.mjs`;
- `lib/dissonancia/snapshot.mjs`;
- `lib/dissonancia/adapters/{nfi,fxe,dpm,cin,nmi,hg}.mjs`;
- snapshots de teste em `data/dissonancia/snapshots/`;
- após os gates, `nexoDissonancia` passa a ser publicado em `data/context/latest.json` pelo fluxo do NMI.

Estado por peça:

| Peça | Versão | Estado | Próximo gate |
| --- | --- | --- | --- |
| Contrato de Dissonância | v0.2 | `DRAFT`; CD-1 ratificada e CD-2 a CD-15 provisórias | aprovar Anexo A antes de produção e congelar constantes após os gates |
| NFI por tipo de investidor | v1.2 | migração `ESPECIFICADA`; fonte BDI diária, cinco categorias, unidade, D+2 e gate de jan/2026 confirmados; probe 25/25 e saída completa recebida | criar `calendario_b3.csv`, substituir engine/coletor preservando repositório e testes atuais |
| FXE | v0.3 | `ESPECIFICADO`; saída original recebida: 15/15 séries consultadas e quatro identidades em 2.493/2.493 dias; `11050` e `13970` confirmados como conceitos distintos | implementar engine/coletor e executar gates G-FXE-1 a G-FXE-4 |
| DPM | v0.2 | `ESPECIFICADO`; endpoints, entidades Focus, datas, SGS e FRED confirmados; probe 24/24 e saída completa recebida | implementar engine/coletor, mapa Focus reunião->Copom e gates completos |
| CIN | v0.1 | escopo escrito; curadoria manual | completar dez/2025 a ago/2026 com pelo menos três casas |
| Engine, snapshot e adaptadores | v0.2 | `ESPECIFICADO` | implementar com 28 fixtures sintéticas |
| Teste Brasil 2026 | Anexo A | protocolo fechado | depende dos dados reais dos coletores |
| Integração ao route | I-1 a I-5 | `BLOQUEADA` pelos gates | somente Onda 6 |

Validação pré-comprometida Brasil 2026:

| Snapshot | Data | Leitura principal |
| --- | --- | --- |
| T1 | 2026-01-30 | fim do mês de entrada estrangeira recorde |
| T2 | 2026-04-15 | pico do acumulado estrangeiro no ano |
| T3 | 2026-07-31 | saída em curso antes do rebaixamento institucional |
| T4 | 2026-08-11 | rebaixamento do JPMorgan para neutro |
| T5 | 2026-08-31 | rotação: institucional comprador e estrangeiro vendedor |

Critérios C1-C7:

- C1: cada snapshot executado cinco vezes deve preservar rótulo, flags e ordem em 5/5;
- C2: nenhuma observação com `disponivel_em > T` pode entrar;
- C3: em T4, a virada de M1 deve aparecer antes do evento N3 de 2026-08-11;
- C4: pelo menos seis de sete afirmações duras corretas e nenhuma afirmação causal marcada como confirmada;
- C5: A/B cego nos snapshots T2 e T4, com a chave mantida fechada até a pontuação;
- C6: T1 deve apontar dominância estrangeira positiva e T5 deve ativar `ROTACAO_ESTRANGEIRO_LOCAL`;
- C7: a ablação individual de cada coletor precisa mudar rótulo, flag, ordem ou veredito em pelo menos um snapshot de 2026 ou no caso fora da amostra ratificado. Caso contrário, o coletor volta a `DRAFT`.

O rótulo esperado de cada snapshot não é pré-fixado. A Emenda 1 resolveu `IMP-14`: o caso fora da amostra será jan-fev/2022, com a série mensal legada como fonte secundária declarada; julho/2025 foi descartado. A série mensal permanece separada da série diária principal e atende somente esse caso. O eixo M de 2022 é degradado: granularidade mensal, apenas estrangeiro, sem z robusto de 756 d.u., soma-zero, dominância entre tipos ou `ROTACAO_ESTRANGEIRO_LOCAL`. C6 e a parcela de dominância de C3 ficam `NAO_APLICAVEL`, sem reprovação; C1, C2, C4, C5, C7 e o restante de C3 permanecem válidos. As constantes ficam congeladas após 2026 e o gabarito é escrito antes da execução.

O contrato detalhado continua pertencendo ao documento-mãe `NEXO_Contrato_Dissonancia_v0.2.md`. O Escopo Unificado v2.0, de 2026-09-15, complementado pela Emenda 1, governa a implementação de NFI v1.2, FXE v0.3 e DPM v0.2 e supersede todos os escopos anteriores desses coletores; ele não substitui o contrato-mãe.

## 6. Fundação de dados e Quant Engine

### 6.1 Data Core / Quant Engine

Estado: `IMPLEMENTADO`.

Versão observada no repositório: Asset Route 2.5.2.

Cobertura atual:

- ações brasileiras por HG Brasil, complementadas por dados CVM quando disponíveis;
- FIIs e ETFs brasileiros com cobertura básica e histórico;
- ações e ETFs internacionais por Twelve Data;
- normalização de moeda, tipo, datas, fontes e falhas;
- cálculo local de drawdown, recuperação, volatilidade, Sharpe, Sortino, CAGR, Ulcer, Calmar e indicadores NEXO;
- perfis econômicos distintos para indústria, banco, seguradora e fundos/ETFs;
- tratamento de métrica não aplicável separado de dado ausente.

### 6.2 IQD - Índice de Qualidade dos Dados

Estado: `IMPLEMENTADO`.

Versão observada: `IQD_v2.1_history_calibrated`.

O IQD mede qualidade, completude e confiabilidade dos dados recebidos. Não mede qualidade da empresa, valuation ou atratividade do ativo.

Regras:

- histórico curto reduz confiança;
- bancos e seguradoras não são penalizados por ausência de margens industriais incompatíveis;
- FIIs e ETFs redistribuem pesos quando demonstrações corporativas não se aplicam;
- a camada analítica interpreta o score, mas não o recalcula.

### 6.3 Provedores e precedência

Estado: `EM_HOMOLOGACAO`.

- HG Brasil permanece fonte primária operacional para ativos brasileiros;
- Twelve Data atende ativos internacionais e registry de ETFs, sem garantir holdings completas;
- Okanebox está aprovada como complemento ou fallback por campo, nunca como substituição silenciosa;
- toda divergência precisa preservar provedor, data, unidade e regra de precedência;
- splits devem ser validados para impedir dupla correção;
- integrações precisam expor saúde e cobertura sem revelar credenciais.

## 7. Portões anteriores ao Scan

### 7.1 Fluxo 0A a 0D

Estado: fundação `IMPLEMENTADA`; expansão específica permanece `PLANEJADA`.

Fluxo:

`0A Liquidez -> 0B Governança -> 0C Insiders -> 0D-VETO -> Scan -> Deep -> Veredito`

- 0A impede análise operacional incompatível com liquidez mínima;
- 0B avalia governança, propriedade, conselho, transparência, remuneração e riscos reputacionais;
- 0C trata sinais de insiders e alinhamento quando houver dados confiáveis;
- 0D-VETO é portão eliminatório e precede o Scan;
- 0D-SIM permanece fora do pipeline decisório e serve para planejamento e simulação.

Qualquer bifurcação do 0B por instrumento deve ser ratificada antes de alterar contratos existentes.

## 8. NEXO Scan

Estado do fluxo no app: `IMPLEMENTADO`; arquitetura metodológica completa segue em evolução versionada.

Objetivo:

- detectar distorções econômicas e narrativas;
- priorizar investigação;
- gerar score, tese, riscos, catalisadores, lacunas e veredito inicial;
- não apresentar o resultado como recomendação automática.

Saídas oficiais:

- Ranking NEXO;
- Convicção NEXO;
- Veredito NEXO;
- prioridade de investigação;
- lacunas obrigatórias para o Deep.

### 8.1 Módulos do Scan

| Módulo | Função consolidada | Estado no produto |
| --- | --- | --- |
| NP | Identificar narrativa predominante | Integrado ao prompt; contrato próprio a consolidar |
| IQD | Qualidade e completude do dado | `IMPLEMENTADO` |
| SEE | Combinar fundamento econômico e eficiência da trajetória | Integrado; engine dedicada futura |
| SNM | Sensibilidade da narrativa ao ambiente macro | Integrado; engine dedicada futura |
| FDM | Organizar forças, fragilidades e direcionadores materiais | Integrado; engine dedicada futura |
| CNE | Testar coerência da narrativa com fatos e contexto | Integrado; evolução histórica planejada |
| PIJR | Confrontar prêmio implícito com juros e riscos | Integrado; recebe NMI/HDL |
| TNH | Temperatura do preço na trajetória histórica | Integrado |
| PIN | Testar narrativa de prêmio, negligência ou punição | Integrado |
| RES | Resiliência a choques, recuperação, volatilidade e liquidez | Integrado |
| ECS | Estrutura de capital, dívida, caixa, liquidez e solvência | Integrado |
| ICN-D | Coerência da narrativa com dados e documentos | Integrado; depende da Biblioteca |
| ICN-R | Coerência da narrativa com resultados realizados | Integrado; histórico futuro amplia força |
| GNP-E | Qualidade econômica/narrativa da trajetória | Integrado conceitualmente |
| GNP-N | Risco narrativo e comportamental | Integrado conceitualmente |

Módulos sem engine dedicada não devem ser chamados de determinísticos apenas porque aparecem no prompt.

## 9. EDG - Edge Declaration Gate

Estado: `IMPLEMENTADO` como `EDG_v1.0`.

Tipos de edge:

- informacional;
- analítico;
- estrutural;
- temporal;
- nenhum.

Campos canônicos:

- tipo;
- evidência;
- módulo que sustenta a evidência;
- condição observável de expiração;
- data de declaração;
- status.

Regras ratificadas:

- D2: sem edge válido, o Scan fica limitado a WATCHLIST e Deep/Final não podem emitir COMPRAR;
- D3: edge expirado gera sinal de saída que precede leitura favorável de preço;
- condição de expiração vaga não é aceita;
- EDG não cria recomendação; apenas limita classificações de outros módulos;
- ativos internacionais permanecem bloqueados nos módulos que exigem referência soberana e dados na mesma moeda.

## 10. NEXO Deep e reclassificação

Estado: `EM_HOMOLOGACAO`.

Objetivo do Deep:

- responder lacunas do Scan;
- validar ou rejeitar a oportunidade investigada;
- separar evidência documental, inferência e hipótese;
- recalcular somente o que possui memória estruturada;
- produzir tese confirmada, parcialmente confirmada, enfraquecida, rejeitada ou armadilha detectada.

Regras implementadas:

- no máximo uma chamada analítica por Deep;
- resultado anterior preservado em aprofundamentos;
- lacuna classificada como resolvida, parcial ou aberta;
- score só pode mudar com evidência nova aceita pelo servidor;
- documento inexistente ou métrica semanticamente incompatível não altera score;
- NPL +90d, New NPL e coberturas são métricas distintas;
- resultado final é consolidado deterministicamente, sem nova chamada probabilística;
- interface e PDF usam o mesmo objeto governado.

### 10.1 Decisão metodológica pendente D8

Existe conflito entre duas regras históricas:

- regra original: o Deep não altera Score, Ranking, ICN, CNE, PIJR ou Veredito do Scan;
- implementação atual: o Deep pode ajustar dimensões do score quando encontra evidência nova, documental e auditável.

Até ratificação, o comportamento em produção permanece o implementado, mas todo ajuste precisa aparecer separadamente como `score de entrada`, `ajustes aceitos` e `score após Deep`. A decisão final deve definir se isso é alteração do Scan ou um `NEXO Delta` separado.

## 11. Valuation narrativo NEXO

Estado: `EM_HOMOLOGACAO`.

Filosofia:

- não buscar um preço correto por média ponderada;
- interpretar narrativas econômicas concorrentes;
- cada modelo revela uma hipótese distinta e sua fragilidade;
- zona de convergência exige pelo menos duas camadas válidas e coerentes;
- BESST é margem adicional abaixo da zona, não substituto do valuation.

Narrativas clássicas possíveis:

- DCF: valor condicionado ao futuro esperado;
- Bazin/Yield: sustentabilidade de renda;
- patrimonial/reprodução: valor dos ativos existentes;
- EPV/Greenwald: valor sem crescimento;
- PTC-NEXO: comportamento extremo ou pânico;
- Moat/QSP: durabilidade competitiva;
- MOC: assimetria e timing;
- Macro/IMDM: pressão sistêmica e ciclo.

### 11.1 Camadas atuais do relatório

- C1: âncora fundamental direta e mensurável;
- C2: validação relativa por múltiplos, yields, spreads, pares ou benchmarks;
- C3: valor econômico e estratégico condicionado a riscos e cenários.

Regras de integridade atuais:

- fórmula, inputs, unidades, origem e evidências devem ser estruturados;
- média ou composição exige componentes e pesos;
- premissa textual precisa coincidir com o cálculo;
- EV/EBITDA só chega a equity após dedução estruturada da dívida líquida;
- camada inválida exibe `N/D`;
- zona usa valores finais governados, não números antigos do modelo;
- BESST usa a regra-alvo de 15% a 25% abaixo do piso da zona;
- P/VP e P/L da tese final usam a mesma base do Deep;
- arredondamento tolerável deve ser normalizado; conflito material invalida;
- se a zona for bloqueada, a tese não pode afirmar convergência, upside, preço justo, BESST ou margem de segurança.

### 11.2 Fechamento da bateria v1.7

Estado: correções `IMPLEMENTADAS` no P3B v1.8 / VALUATION v1.8; contrato B3.2 permanece `EM_HOMOLOGACAO` até a bateria real final.

1. impedir escalonamento direto do preço por razão EV/EBITDA quando houver dívida material;
2. recalcular upside/downside da tese final pelos limites finais;
3. distinguir arredondamento aceitável de memória inconsistente;
4. substituir `margem de segurança` por `desconto aparente` quando não houver zona;
5. impedir próximos passos que antecipem `COMPRAR` antes de novo fluxo completo;
6. concluir nome humano e data local das evidências documentais.

Validação interna concluída em 2026-09-09:

- conflitos materiais de aritmética invalidam a camada; apenas arredondamentos dentro da tolerância são normalizados;
- EV/EBITDA exige conversão estruturada de enterprise value para equity;
- posicionamento do preço, upside/downside e BESST são reconstruídos pelos limites finais governados;
- sem zona consolidada, a apresentação usa `desconto aparente` e não afirma margem de segurança;
- próximos passos exigem novo fluxo completo antes de qualquer mudança para `COMPRAR`;
- evidências exibem nome humano e data em formato local, mantendo o identificador técnico apenas internamente;
- matriz virtual BBAS3/ROMI3/VALE3, contratos da rota e PDF aprovados sem chamadas analíticas externas.

## 12. Ciclo Goldberg

### 12.1 HDL - Hurdle do Leviatã

Estado atual: `IMPLEMENTADO` em `HDL_v1.0`; atualização `HDL_v1.3` está `ESPECIFICADA`.

Pergunta única: o ativo paga mais do que o Tesouro, líquido de imposto, no horizonte correto?

O HDL:

- não calcula valuation;
- não altera score ou veredito isoladamente;
- não emite compra;
- precisa operar na mesma moeda e classe comparável;
- deve reportar `alfa_vs_classe_pp` em todo Deep aplicável.

Atualização v1.3:

- remover a TIR livre do fluxo comum;
- calcular piso real por lucro normalizado sem crescimento;
- calcular cenário central por DY real e crescimento sustentável real;
- derivar horizonte por contrato, edge ou default;
- calcular inflação implícita pela curva;
- calcular hurdle líquido com IR sobre ganho nominal;
- proibir extrapolação além do maior vértice;
- manter re-rating igual a zero;
- preservar override apenas com origem, justificativa e delta auditável;
- dividir FII de papel e tijolo para impedir dupla deflação.

Gates: self-test 46/46, paridade de contrato, A/B pré-comprometido, invariância dos estimadores e matriz real.

### 12.2 NFI - NEXO Flow Intelligence

Estado atual: `IMPLEMENTADO` como `NFI_v1.0`. Migração `NFI_v1.2` `ESPECIFICADA`, com fonte real validada, ainda sem engine/coletor migrados ou integração.

- mede fluxo estrangeiro oficial e posição histórica;
- explica deslocamento de preço;
- não altera valor intrínseco, score ou veredito;
- distingue dado oficial, pendente e proxy;
- mês parcial não entra indevidamente na distribuição histórica;
- extremo exige histórico mínimo suficiente;
- coletor roda offline.

Mudança contratual da v1.2:

- substituir a planilha mensal agregada pelo BDI diário da B3, disponível desde março/2022 e separado nas cinco categorias confirmadas: institucionais, instituições financeiras, estrangeiro, individuais e outros;
- interpretar a tabela BDI como acumulada no mês: o fluxo diário é a diferença entre dias consecutivos do mesmo mês, com reset somente no primeiro dia útil real;
- converter a unidade publicada de R$ mil para BRL multiplicando por 1.000;
- aplicar D+2 por calendário de pregão da B3; o calendário é pré-requisito e o coletor falha alto fora da cobertura;
- marcar como `PARCIAL` o primeiro dia disponível quando não houver o dia útil anterior necessário, sem tratá-lo como início de mês;
- preservar `fluxo_liquido_brl` por compatibilidade com o repositório, rota, PDF e tela atuais;
- tratar soma-zero como teste de parsing, não como sinal econômico, porque compras e vendas fecham por construção nessa fonte;
- calcular no engine soma de 20 dias úteis, z robusto em 756 dias úteis, participação estrangeira e acumulado anual por tipo;
- manter a tabela mensal T2 apenas para volume segmentado/M4; nunca tratá-la como saldo;
- manter M5/ANBIMA opcional e fundos de pensão fora da v1.2;
- impedir leitura por ticker e uso como argumento de momentum;
- validar janeiro/2026, reconciliação mensal em seis meses, contrato C6, ablação C7 e os testes de UI existentes durante toda a migração.

O probe real `nexo_b3_probe_v02.mjs` está versionado na `main`, passou 25/25 e teve sua saída completa recebida. A evidência confirma cinco categorias, fechamento construtivo com razão zero, escopo de todos os mercados e G-NFI-1 com distância relativa de 0,05%. Observou-se D+2 normalmente e D+3 no arquivo posterior ao feriado de 7/set, reforçando o uso obrigatório do calendário de pregão. Até a migração cumprir os gates, `NFI_v1.0` permanece a implementação efetiva.

Ao substituir o coletor atual, a leitura mensal não pode ser apagada: `parseB3ForeignFlowReport` e `NFI_SOURCE_URL` devem migrar para `scripts/collectors/nfi_mensal_legado_collector.mjs`, com saída exclusiva em `data/goldberg/nfi_fluxo_mensal_legado.csv`. Esse coletor é implementado somente depois da migração v1.2 e do registro dos gates G-NFI-1 a G-NFI-6; seus dados não se misturam à série diária.

### 12.2.1 FXE - Fluxo Externo

Estado: `ESPECIFICADO` como `FXE_v0.3`; probe real versionado e aprovado conforme o Escopo Unificado. A saída original completa foi recebida e conferida: 15/15 séries responderam, e as quatro identidades fecharam em 2.493/2.493 dias.

- decompõe receita externa em quantidade, preço em USD e câmbio pela identidade logarítmica exata;
- publica FXE agregado como contexto R7 e o resíduo empresa versus setor SH4 como D4;
- exige invariância numérica inferior a `1e-9` antes de publicar;
- usa exportação segregada como base preferencial. Receita total exige flag e limiar multiplicado por 1,5;
- usa limiares provisórios `FXE_L1 = 0.05` e `FXE_L2 = 0.10` até a validação;
- mantém `applicability` explícita para setores fora do escopo;
- exclui ETFs, inclusive BXPO11, e extingue a razão BXPO11/BDOM11 da v0.1;
- usa as séries SGS 13962 a 13970 para câmbio contratado diário e SGS 1 para PTAX; 27574 a 27577 cobrem IC-Br;
- calcula o `conversion_ratio` padrão com `Demais` (13965) + pagamento antecipado (13964), nunca com ACC (13963), que permanece série separada de financiamento;
- verifica diariamente quatro identidades contábeis; dia que não fecha vira `PARCIAL`;
- usa Comex Stat para balança mensal; a balança SGS foi descartada por redundância metodológica;
- mantém transações correntes como `AUSENTE`, pois o código SGS não foi localizado e a série não integra o `conversion_ratio`.
- usa 13970 como saldo financeiro diário da IES-13 porque essa série integra as quatro identidades contábeis exigidas pelo FXE. A série 11050, mensal e oriunda da IES-14, mede conceito diferente e apresenta magnitudes de outra ordem; por isso é ignorada pelo FXE. Não há redundância entre 11050 e 13970, nem confirmação adicional pendente por agregação mensal.

### 12.2.2 DPM - Decisões de Política Monetária

Estado: `ESPECIFICADO` como `DPM_v0.2`; probe real versionado e aprovado em 24/24, com saída completa recebida e Q1-Q7 aprovadas.

- registra todas as reuniões, inclusive manutenções, com decisão, votação, ciclo e surpresa;
- usa o último Focus anterior à decisão para a surpresa Copom;
- usa variação do Treasury de dois anos no dia como proxy determinístico da surpresa Fed;
- reconstrói ciclos sem inferir votação quando o texto não casa com as regras fechadas;
- limita o diff do comunicado oficial do Copom a seis frases;
- mantém o calendário FOMC como CSV curado manualmente;
- deriva `data_decisao` de `dataReferencia`; SGS 432 marca a vigência no dia útil seguinte e não substitui a data da decisão;
- extrai votação da ata publicada seis dias depois, com `disponivel_em` próprio; antes disso, votação é `AUSENTE`;
- filtra Focus com `baseCalculo = 0`, evitando duplicidade entre bases 0 e 1;
- ainda precisa construir, com falha alta, o mapa `R<n>/<ano> -> nroReuniao` a partir da lista oficial de atas;
- precisa ampliar SGS 432 em blocos para provar correspondência reunião-mudança desde 1999.

### 12.2.3 CIN - Consenso Institucional

Estado: `ESPECIFICADO` como `CIN_v0.1`; coleta manual, sem automação nesta versão.

- aceita somente recomendações formais explícitas `UW`, `N` ou `OW`;
- usa enum fechado de casas definido no contrato;
- exige integridade da cadeia `recomendacao_anterior` por casa e escopo;
- exige curadoria mínima entre dezembro de 2025 e agosto de 2026, com pelo menos três casas e URL;
- mantém CMAs curadas fora do contrato até existir motor de alocação;
- adia automação até superar dez documentos por mês durante três meses.

### 12.3 TDN - Teste de Defesa Nominal

Estado: `IMPLEMENTADO` como `TDN_v1.0`.

- testa preservação de economia real em 2015-2016 e 2021-2022;
- usa receita real, margens e capital de giro para empresas operacionais;
- utilities possuem defasagem regulatória;
- commodities exigem separar operação, preço internacional e câmbio;
- bancos e seguradoras são não aplicáveis na v1;
- FIIs e ativos exteriores permanecem fora da v1;
- duas janelas incompletas resultam em dados insuficientes;
- TDN só sustenta edge quando o contrato estiver completo;
- não altera score ou veredito automaticamente.

### 12.4 BJR - Banco de Jurisprudência de Recuperação Judicial

Estado: `ESPECIFICADO` como `BJR_v1.1`; fase F3a.

Objetivo: medir risco de perímetro de recuperação judicial por instância e classe de credor.

Regras centrais:

- banco curado, sem coletor automático;
- unidade caso-cêntrica;
- enums duros;
- agregação por `instância x classe_afetada`, nunca setor;
- score 5 significa perímetro respeitado e 1 significa dissolvido;
- janela móvel de quatro anos;
- amostra, confiança e estimabilidade sempre explícitas;
- ausência não pode herdar média nacional ou instância vizinha;
- risco estimável recebe prêmio; incerteza não estimável gera recusa;
- BJR não emite compra e não usa preço histórico.

Pré-condições e gates permanecem os definidos no escopo BJR v1.1, incluindo amostra com polo positivo, discriminação por instância e classe, teste point-in-time e impacto material no NCS.

### 12.5 NCS

Estado: `PLANEJADO`; bloqueado pelo BJR.

Função: aplicar portões sequenciais a situações especiais de crédito.

Contrato mínimo futuro:

- `gate_atingido`;
- `bjr_estimavel`;
- distinção entre `reprovado` e `recusado_por_incerteza`;
- reentrada automática apenas quando a recusa decorrer de amostra insuficiente posteriormente ampliada.

### 12.6 NALM

Estado: `PLANEJADO`; fase F4.

Função registrada: mapear camadas da cadeia de inteligência artificial e avaliar a durabilidade do spread econômico. O contrato completo deve ser consolidado antes da implementação.

## 13. Biblioteca Viva

Estado atual: B0, B1, B2, B3 e B3.2 `IMPLEMENTADOS`; conjunto `EM_HOMOLOGACAO`.

Princípio: banco gordo, prompt enxuto.

### 13.1 Arquitetura

- Neon/Postgres como fonte de verdade;
- documento vinculado ao emissor e tickers como aliases;
- binário integral e hash preservados;
- storage compatível com S3 previsto para expansão de escala;
- descoberta e extração fora da Vercel;
- Vercel limitada a interface, leitura e APIs leves;
- parser PDF por texto e tabelas, sem `pdf-parse`;
- páginas e chunks versionados com lineage;
- recuperação seletiva por lacuna;
- documento integral nunca enviado ao prompt;
- segunda ingestão idêntica baixa zero documentos.

### 13.2 Estágios

| Estágio | Conteúdo | Estado |
| --- | --- | --- |
| B0 | Amostra e identificação de formatos reais | `IMPLEMENTADO` |
| B1 | Schema persistente e saúde do banco | `IMPLEMENTADO` |
| B2 | Ingestão idempotente e deduplicação | `IMPLEMENTADO` |
| B3 | Extração, indexação e evidência no Deep | `IMPLEMENTADO` |
| B3.1 | Navegação por etapas e aprofundamentos preservados | `IMPLEMENTADO` |
| B3.2 | Fonte integral separada do contexto seletivo | `EM_HOMOLOGACAO` |
| B4 | Ampliação de fontes e fatos estruturados | `PLANEJADO` |
| B5 | Rotina noturna idempotente e operação contínua | `PLANEJADO` |
| B6 | Fontes internacionais/SEC e expansão por classe | `PLANEJADO` |

### 13.3 Identificação documental

- hash e `dedup_key` permanecem internos;
- interface e PDF usam nome humano;
- padrão desejado: `Documento N - TICKER - Tipo/Competência - DD/MM/AAAA`;
- domínio técnico e data bruta não podem ser o rótulo principal;
- backfill deve preservar chaves e vínculos existentes.

### 13.4 Fontes futuras

- FNET e documentos próprios de FIIs;
- fatos estruturados e demonstrações históricas adicionais;
- SEC para ativos exteriores;
- novas fontes brasileiras somente após amostra real justificar parser e contrato;
- fonte externa não libera automaticamente EDG, HDL ou NFI em moeda incompatível.

## 14. Escopo por classe de ativo

### 14.1 Ações brasileiras

Estado: `EM_HOMOLOGACAO` como primeiro perímetro completo.

Cobertura: dados de mercado, NMI, Quant/IQD, 0A-0D, Scan, EDG, HDL, NFI, TDN quando aplicável, Biblioteca, Deep, reclassificação e PDF.

### 14.2 FIIs

Estado do fluxo genérico: `IMPLEMENTADO` parcialmente. Método especializado: `PLANEJADO`.

Módulos aprovados:

- NEXO-VP: leitura de valor patrimonial e qualidade dos ativos;
- NEXO-VPM: valor patrimonial ajustado ao mercado e observabilidade;
- ECI: contexto de crédito e mercado imobiliário;
- ALE: alavancagem econômica;
- MRM: risco de marcação a mercado;
- SDS-FII: sensibilidade sistêmica a CDI, IPCA e ciclo de crédito.

ALE deve distinguir:

- intensidade da alavancagem;
- finalidade produtiva ou defensiva/negativa;
- vencimentos, duration e concentração;
- TTR-FII;
- cobertura de juros, amortizações e obrigações;
- sensibilidade sistêmica.

Decisão necessária: dividir `fii_papel` e `fii_tijolo` no schema antes do HDL v1.3.

### 14.3 ETFs brasileiros

Estado de dados: `IMPLEMENTADO` parcialmente. Análise especializada: `PLANEJADA`.

Necessidades:

- composição e concentração;
- índice, metodologia, moeda e hedge;
- custo total e liquidez;
- tracking difference;
- exposição econômica real e duplicidade de carteira;
- evitar aplicar demonstrações corporativas a fundos.

### 14.4 ETFs internacionais

Estado de dados: `IMPLEMENTADO` parcialmente por Twelve Data; análise especializada `PLANEJADA`.

Holdings e composição dependem de fonte adicional. A estratégia estrutural prioriza ETFs globais como núcleo da exposição internacional.

### 14.5 Ações internacionais / NGIS

Estado: dados básicos `IMPLEMENTADOS`; NGIS `PLANEJADO`.

O NEXO Global Investigative Scan deverá investigar:

- infraestrutura crítica;
- moat tecnológico;
- velocidade de adoção;
- dependência dos clientes;
- custo de substituição;
- narrativa já precificada;
- assimetria entre narrativa e realidade econômica.

Focos: IA, cibersegurança, energia para IA, automação, defesa, espaço e outras tendências estruturais. Integração futura com CNE, PIN, ITI e NEXO-Regime.

Regra de carteira registrada: permitir no máximo uma ação investigativa internacional simultânea, mantendo ETFs como núcleo.

### 14.6 Renda fixa, crédito e Tesouro

Estado: papel de benchmark `IMPLEMENTADO` no HDL; seleção e análise completa `PLANEJADAS`.

Necessidades futuras:

- risco de emissor e estrutura;
- garantia, senioridade e covenants;
- duration, liquidez e marcação a mercado;
- spread sobre classe soberana comparável;
- cenário de recuperação;
- integração com BJR/NCS quando aplicável.

### 14.7 Criptoativos

Estado: `REGISTRADO`, sem motor especializado homologado.

Antes de liberar análise completa, definir contrato próprio para liquidez, custódia, concentração, risco de protocolo, tokenomics, regime e perda permanente. Não reutilizar automaticamente score corporativo.

### 14.8 Options Lab

Estado: `PLANEJADO`, fora do Beta principal até contrato e proteção de risco estarem fechados.

Deve ser ferramenta de simulação e planejamento, não atalho para mudar tese, score ou preço justo.

## 15. Carteira NEXO e rebalanceamento

Estado: método `APROVADO`; implementação no app `PLANEJADA`.

Fluxo oficial:

`Rebalanceamento por classe -> NEXO Scan da classe -> NEXO Deep -> decisão de alocação`

Regras:

- rebalanceamento indica classes e valores, não tickers;
- seleção de ativos acontece no Scan/Deep específico;
- qualidade não substitui assimetria;
- ETFs globais formam o núcleo internacional;
- teses investigativas possuem limites próprios;
- carteira precisa registrar tese, edge, expiração, última revisão e motivo da posição;
- alterações futuras devem preservar histórico e comparação com política-alvo.

Pesos pessoais ou snapshots de carteira não pertencem ao contrato do produto e não devem ser codificados como defaults universais.

## 16. Produto e experiência do usuário

### 16.1 Implementado

- entrada de ticker e detecção de classe;
- carregamento automático de mercado e contexto;
- formulários orientados de EDG e HDL atual;
- manuais de EDG, HDL, NFI e TDN;
- navegação entre Scan, Deep, aprofundamentos e final;
- preservação de análises anteriores;
- importação de fonte complementar após lacuna aberta;
- reset e nova análise;
- exportação PDF em desktop e mobile;
- relatório próprio, sem impressão direta da interface;
- estado de saúde do backend.

### 16.2 Próximas necessidades de produto

- autenticação e perfis de usuário;
- persistência de análises e carteira;
- histórico, comparação de versões e auditoria por usuário/data;
- painel de consumo e proteção de custos das APIs;
- limites, rate limiting e prevenção de chamadas duplicadas;
- observabilidade de falhas por provedor e módulo;
- retomada segura de análise interrompida;
- acessibilidade, responsividade e testes em dispositivos reais;
- nomenclatura humana consistente de documentos;
- página de metodologia e versão do motor;
- avisos claros de escopo e ausência de recomendação automática.

## 17. Reporting e rastreabilidade

Estado: PDF `IMPLEMENTADO` e `EM_HOMOLOGACAO` semântica.

O relatório precisa conter:

- contexto e fontes;
- versões dos motores;
- Scan, Deep e reclassificação separados;
- score de entrada, ajustes aceitos e score final;
- lacunas resolvidas, parciais e abertas;
- documentos com nomes humanos;
- C1/C2/C3 com memória governada;
- zona e BESST apenas quando válidos;
- EDG, HDL, NFI e TDN quando aplicáveis;
- tese final coerente com os campos governados;
- próximos passos que ordenem nova análise, sem antecipar veredito;
- data, ticker, moeda e cotação de referência.

Proibições:

- tokens técnicos ou hashes como rótulo principal;
- texto `suprimido pelo servidor`;
- preço inválido ainda exibido como utilizável;
- duplicação de ressalvas;
- página vazia causada por quebra indevida;
- arquivo de texto adicional no compartilhamento móvel;
- conclusão probabilística nova durante a exportação.

## 18. Infraestrutura e operação

### 18.1 Arquitetura atual

- Next.js 16.3.4;
- Vercel para aplicação e APIs leves;
- GitHub para versionamento, gates e deploy;
- Neon/Postgres para Biblioteca Viva;
- coletores offline por Cloud Shell ou rotina agendada;
- dados congelados e versionados no repositório quando apropriado;
- PDFKit para reporting;
- health check para macro, contexto, HDL, NFI, TDN e Biblioteca.

Convenção aprovada para a Camada de Dissonância:

- coletores em `scripts/collectors/` e probes em `scripts/probes/`;
- engines de domínio em `lib/nexo/<modulo>/`;
- adaptadores em `lib/dissonancia/adapters/`;
- tabelas versionadas em `data/<modulo>/`;
- contratos em `contracts/<modulo>.schema.json`.

### 18.2 Regras operacionais

- Vercel nunca executa carga histórica, `pdftotext`, Docling ou coleta pesada;
- credenciais ficam somente no servidor;
- logs não expõem segredos;
- falha de fonte permanece explícita;
- coletor não reescreve história silenciosamente;
- migração é idempotente;
- deploy exige suíte, build e gate remoto;
- nenhuma análise real é executada para validar código quando fixture suficiente existir.
- cada coletor oferece self-test offline, modo completo e `--refresh`, preservando histórico congelado;
- toda tabela de domínio inclui `disponivel_em`, `fonte`, `qualidade_fonte`, `status`, `coletado_em` e `hash_origem`;
- a coleta de dissonância começa manualmente no Cloud Shell. A migração para GitHub Actions só ocorre após mais de três execuções manuais por semana durante quatro semanas;
- se o workflow automatizado falhar duas vezes no mês, a operação retorna ao modo manual;
- dumps brutos e PDFs de terceiros não são commitados;
- `outputFileTracingIncludes` deve incluir cada arquivo de domínio lido pelo route.

### 18.3 Infraestrutura futura

- storage S3-compatível para binários em escala;
- rotina noturna B5;
- filas e retries idempotentes;
- observabilidade centralizada;
- ambientes separados de desenvolvimento, homologação e produção;
- backups, restauração e política de retenção;
- controle de acesso à Biblioteca e análises;
- orçamento e alertas de consumo por provedor.

## 19. Segurança, custos e governança de IA

Estado: fundação parcial; hardening `PLANEJADO`.

- uma chamada por execução analítica, salvo ação explícita do usuário;
- nunca repetir automaticamente chamada para reparar JSON ou semântica;
- recuperação local quando segura;
- timeout não descarta resultado já concluído;
- validação de URL contra rede privada, credenciais e redirects excessivos;
- limite de tamanho e tipo de documento;
- proteção contra prompt injection documental deve ser ampliada;
- autenticação, rate limiting e quotas ainda são pré-requisitos de produção;
- custos devem ser rastreados por operação sem revelar chaves;
- qualquer modelo novo exige contrato de saída, fallback e matriz de resiliência.

## 20. Roadmap total por janelas

### P0 - revalidar o NMI fora do seed

Estado: `EM_HOMOLOGACAO`.

O repositório já contém um snapshot `t2_reconciled` com `is_seed_mode: false` e watermark oficial do BCB SGS. O dossiê de 2026-09-15 preserva P0 como prioridade número 1; por isso, a pendência correta é revalidar a operação e o deploy, sem regredir o snapshot para seed.

Critérios de fechamento:

- executar o fluxo real de atualização do Context Package;
- confirmar que nenhum watermark obrigatório volta a `seed`;
- validar `/api/health`, consumidores do Scan/Deep/Final e data efetivamente publicada;
- registrar a evidência operacional no runbook.

### Trilha transversal D0-D6 - Camada de Dissonância

Esta trilha corre em paralelo às janelas J0-J9 e não altera a ordem de dependência do Ciclo Goldberg. A validação das fontes foi concluída; a implementação segue a ordem técnica fechada pelo Escopo Unificado v2.0 e não toca produção antes dos gates.

| Onda | Entrega | Estado em 2026-09-16 | Toca produção? |
| --- | --- | --- | --- |
| D0 | Contrato de Dissonância v0.2 e CD-1 | contrato `DRAFT`; CD-1 ratificada; demais constantes provisórias | Não |
| D1 | Probes B3, SGS/FXE e DPM | `CONCLUÍDA`; scripts na `main` em `bb3f407` e três saídas originais completas recebidas e conferidas | Não |
| D2 | Calendário B3 + migração NFI v1.2 | `ESPECIFICADO`; implementação pendente | Não |
| D3 | Engine/coletor FXE v0.3 | `ESPECIFICADO`; códigos SGS e regra ACC confirmados | Não |
| D3b | Engine/coletor DPM v0.2 | `ESPECIFICADO`; mapa Focus->Copom e histórico SGS em blocos pendentes de implementação | Não |
| D3c | Constants, engine de Dissonância, snapshot, validador, 28 fixtures, adaptadores e CIN | `ESPECIFICADO`; implementação pendente | Não |
| D4 | Teste Brasil 2026, critérios C1-C7 | protocolo fechado; depende de D2, D3, D3b e D3c | Não |
| D5 | Teste fora da amostra | `DECIDIDO` pela Emenda 1: jan-fev/2022 com série mensal legada separada e eixo M degradado declarado | Não |
| D6 | Integração I-1 a I-5 no route | `BLOQUEADA` até todos os gates | Sim |

Próxima execução da trilha:

1. criar `data/goldberg/calendario_b3.csv`;
2. migrar `lib/nexo/nfi/nfi_engine.mjs` e `scripts/collectors/nfi_collector.mjs`, preservando a leitura mensal em arquivo próprio, além do repositório, rota, UI e testes atuais;
3. registrar G-NFI-1 a G-NFI-6 e só então entregar o coletor mensal legado para o caso de 2022;
4. implementar engine e coletor FXE v0.3;
5. implementar engine e coletor DPM v0.2;
6. implementar adaptadores e schemas, depois engine/snapshot/validador da Dissonância e fixtures;
7. executar Brasil 2026, A/B, ablações e o caso fora da amostra de jan-fev/2022;
8. não integrar ao route antes da aprovação de C1-C7 e do caso fora da amostra.

### J0 - fechamento do B3.2 e valuation v1.8

Momento: em homologação real.

- corrigir os seis bloqueios da bateria BBAS3/ROMI3/VALE3 — concluído;
- fechar nomes documentais — concluído;
- rodar matriz virtual e PDFs — concluído;
- homologar e congelar contrato B3.2.

Saída: três relatórios reais sem bloqueio.

### J1 - HDL v1.3 determinístico

Momento: após J0.

- ratificar D5, D6 e D7;
- implementar engine, coletor, contrato e UI;
- migrar FII papel/tijolo;
- rodar self-test, contrato, A/B e casos reais.

Saída: HDL sem TIR livre no fluxo comum e sem comparar moedas incompatíveis.

### J2 - Biblioteca B4-B6 e estabilização Goldberg

Momento: após HDL v1.3 estável.

- ampliar fontes e fatos estruturados;
- implantar rotina noturna;
- preparar FNET e SEC;
- integrar contratos de HDL, NFI, TDN e Biblioteca;
- ampliar matriz para utility, seguradora e FIIs.

### J3 - BJR v1.1 / F3a

Momento: após Biblioteca suficiente.

- curadoria dos casos-âncora;
- engine, parâmetros e self-tests;
- gates por instância, classe, Spearman e impacto no NCS;
- uma única rodada documentada de revisão se reprovar.

### J4 - NCS / F3

Momento: somente após BJR aprovado.

- portões sequenciais;
- risco versus incerteza;
- reentrada por ganho de evidência;
- integração com crédito e situações especiais.

### J5 - NALM / F4

Momento: após fechamento do contrato NALM.

- cadeia de IA;
- durabilidade do spread;
- integração com NGIS e teses tecnológicas.

### J6 - Reporting, UX, histórico e proteção de custo

Momento: antes do Beta oficial.

- autenticação;
- persistência;
- histórico e auditoria;
- painel de custos;
- observabilidade;
- revisão completa de UX e acessibilidade;
- UAT em dispositivos reais.

### J7 - Beta oficial focado

Momento: após J0-J6.

Perímetro recomendado para ratificação: ações brasileiras como fluxo completo; outras classes aparecem somente com selo claro de cobertura parcial até seus contratos especializados passarem.

### J8 - expansão por classes

Momento: pós-Beta.

- NEXO FII completo;
- ETFs Brasil e internacionais;
- NGIS e ação investigativa internacional;
- renda fixa/crédito;
- cripto após contrato próprio;
- Options Lab;
- Carteira NEXO e rebalanceamento integrado.

### J9 - Macro Histórico e aprendizagem do sistema

Momento: evolução contínua pós-Beta.

- NMH;
- comparação de regimes;
- histórico de decisões, edges e expirações;
- backtests point-in-time;
- NEXO Delta;
- avaliação de quais módulos realmente alteram decisões e reduzem erros.

## 21. Matriz permanente de homologação

Toda mudança analítica deve testar, no mínimo:

- três tickers de setores diferentes;
- dados completos, parciais e ausentes;
- uma memória válida;
- erro aritmético;
- erro conceitual;
- conflito semântico;
- documento válido, documento não citado e ausência documental;
- zona/BESST válidos e bloqueados;
- score preservado e ajuste documental aceito;
- chamada única, timeout e JSON inválido;
- interface e PDF com o mesmo estado;
- build e gates remotos.

Matriz mínima atual:

- BBAS3 - banco;
- ROMI3 - indústria;
- VALE3 - commodity.

Matriz ampliada futura:

- utility regulada;
- seguradora;
- varejo/serviços;
- FII de papel;
- FII de tijolo;
- ETF brasileiro;
- ação internacional;
- ETF internacional;
- caso de crédito especial.

## 22. Decisões pendentes consolidadas

| ID | Tema | Momento de decisão |
| --- | --- | --- |
| D1 | Bifurcação do 0B por instrumento | Antes de BJR/NCS |
| D4 | Conversão do score BJR em prêmio | Abertura de J3 |
| D5 | Tributação de proventos no HDL | Abertura de J1, com validação da regra vigente |
| D6 | Separação de FII papel/tijolo | Abertura de J1 |
| D7 | Remoção da TIR manual | Abertura de J1 |
| D8 | Deep altera score ou produz NEXO Delta separado | Antes de congelar o contrato pós-B3.2 |
| D9 | Perímetro do Beta oficial | Antes de J6 |
| D10 | Provedor de holdings/composição de ETFs | Antes da expansão de ETFs |
| D11 | Contrato especializado de cripto | Antes de habilitar a classe |
| D12 | Prioridade entre Carteira NEXO, NEXO FII e NGIS no pós-Beta | Encerramento de J7 |

### 22.1 Decisões de implementação da Camada de Dissonância

Os IDs abaixo usam o namespace `DIS-IMP` para não colidir com as decisões históricas D1-D12 do produto. São valores de trabalho registrados pelo dossiê; alterações posteriores exigem atualização explícita do contrato.

| ID | Tema | Valor registrado |
| --- | --- | --- |
| DIS-IMP-1 | Diretórios | `scripts/collectors/`, `scripts/probes/`, `lib/nexo/<modulo>/`, `lib/dissonancia/adapters/`, `data/<modulo>/`, `contracts/` |
| DIS-IMP-2 | Execução da coleta | Cloud Shell manual; Actions somente após o gatilho de frequência |
| DIS-IMP-3 | Pós-checagem no route | uma regeneração e faixa visível; nunca correção silenciosa |
| DIS-IMP-4 | M5/ANBIMA | opcional no NFI v1.2 se houver acesso público |
| DIS-IMP-5 | Receita-base FXE | exportação segregada; receita total exige flag e limiar 1,5 vez maior |
| DIS-IMP-6 | Limiares FXE | 0,05 e 0,10 em log, provisórios até os gates |
| DIS-IMP-7 | Casas CIN | enum fechado do contrato v0.1 |
| DIS-IMP-8 | Curadoria CIN | dezembro/2025 a agosto/2026, com pelo menos três casas |
| DIS-IMP-9 | Calendário FOMC | CSV curado manualmente |
| DIS-IMP-10 | NFI legado | preservar `nfi_repository.mjs` e integrações; substituir somente engine/coletor na migração |
| DIS-IMP-11 | FXE/ACC | ACC é financiamento e nunca integra o numerador padrão do `conversion_ratio` |
| DIS-IMP-12 | DPM/votação | votação vem da ata e possui `disponivel_em` diferente da decisão |
| DIS-IMP-13 | Caso fora da amostra | jan-fev/2022 com fonte mensal legada separada; julho/2025 descartado |
| DIS-IMP-14 | Preservação NFI mensal | mover `parseB3ForeignFlowReport` e `NFI_SOURCE_URL` para `nfi_mensal_legado_collector.mjs`; nunca misturar as duas séries |

### 22.2 Decisões e constantes de contrato da Dissonância

- DIS-CD-1 está ratificada: o gate mede alteração de rótulo, flag, ordem de eventos ou veredito de afirmação;
- DIS-CD-2 a DIS-CD-15 permanecem provisórias e não bloqueiam a implementação da engine;
- DIS-CD-12 proíbe texto de terceiros no pacote;
- DIS-CD-14 define o z robusto como padrão;
- DIS-CD-15 permite apenas o diff do comunicado oficial do BC, limitado a seis frases.

Constantes e convenções fechadas pelos probes:

| Item | Valor confirmado | Evidência |
| --- | --- | --- |
| Fonte NFI | BDI capítulo 02, acumulado no mês, série desde março/2022 | `b3_probe_out2.txt` |
| Categorias NFI | cinco categorias estáveis | `b3_probe_out2.txt` |
| Unidade NFI | R$ mil, convertida para BRL por `x 1.000` | `b3_probe_out2.txt` |
| Defasagem NFI | D+2 de pregão, por `calendario_b3.csv` | `b3_probe_out2.txt` |
| `SOMA_ZERO_TOL_REL` | deixa de ser limiar econômico; soma-zero é teste de parsing e fechou com razão 0 | `b3_probe_out2.txt` |
| SGS FXE | 13962 a 13970 e PTAX 1 confirmados; IC-Br 27574 a 27577 permanecem conforme Escopo Unificado v2.0 | `sgs_probe_out.txt` original; MD5 `c6b1e4174e5164874c5e3ef5d57050f9` |
| `conversion_ratio` | 13965 + 13964; `inclui_acc = false`; quatro identidades em 2.493/2.493 dias | `sgs_probe_out.txt` original |
| Saldo financeiro FXE | usar 13970/IES-13; 11050/IES-14 é conceito distinto, não redundante, e não integra o FXE | `sgs_probe_out.txt` original; 68 meses comparados, 0 iguais |
| `SGS_TRANSACOES_CORRENTES` | `null`; bloco reporta `AUSENTE` | `sgs_probe_out.txt` original |
| Data DPM | decisão=`dataReferencia`; vigência=SGS 432 no próximo d.u.; ata=D+6 corridos | `dpm_probe_out.txt` |
| Focus | quatro entidades confirmadas e `baseCalculo = 0` | `dpm_probe_out.txt` |
| Votação DPM | extraída de `textoAta`, nunca do comunicado | `dpm_probe_out.txt` |

Constante `null` mantém o bloco dependente como `AUSENTE`; nunca autoriza valor padrão ou inferido.

Estado das evidências externas:

| Evidência | Estado | Consequência |
| --- | --- | --- |
| `b3_probe_out2.txt` | completa, recebida e revisada | nenhuma pendência documental do probe B3 |
| `dpm_probe_out.txt` | completa, recebida e revisada | nenhuma pendência documental do probe DPM |
| `sgs_probe_out.txt` | original completo, recebido e revisado; MD5 `c6b1e4174e5164874c5e3ef5d57050f9` | nenhuma pendência documental do probe SGS/FXE |

## 23. Backlog único

### Bloqueadores atuais

- revalidação operacional P0 do Context Package fora do seed;
- homologação real final do B3.2 e valuation v1.8;
- decisão D8;
- construção do `calendario_b3.csv`, pré-requisito do NFI v1.2;
- mapa determinístico `R<n>/<ano> -> nroReuniao` e validação histórica da SGS 432 em blocos no DPM;
- curadoria mínima do CIN antes do teste Brasil 2026.

### Pré-Beta

- Camada de Dissonância D1-D6, condicionada aos gates C1-C7 e ao teste fora da amostra;
- HDL v1.3;
- B4-B6;
- BJR/NCS/NALM conforme gates;
- autenticação, persistência, histórico e custos;
- UAT e documentação operacional;
- definição do perímetro oficial.

### Pós-Beta

- FIIs especializados;
- ETFs e NGIS;
- carteira e rebalanceamento;
- renda fixa/crédito completo;
- cripto;
- Options Lab;
- NMH e aprendizagem histórica.

## 24. Governança de versões e mudanças

- toda engine exporta versão própria;
- mudança de significado ou fórmula exige nova versão;
- mudança apenas aditiva e retrocompatível incrementa minor;
- relatório preserva versões que o geraram;
- nenhum contrato muda só no prompt;
- regra genérica nunca contém exceção por ticker;
- fixture deve reproduzir o erro antes da correção;
- teste antigo só muda quando o comportamento antigo for explicitamente revogado;
- deploy não equivale a homologação;
- falha em gate bloqueante impede publicação funcional;
- parâmetros metodológicos ficam isolados e versionados;
- critérios de A/B e backtest são fixados antes de observar resultados.

### 24.1 Definition of Done para coletores da Dissonância

Um coletor só muda de `ESPECIFICADO` para `IMPLEMENTADO` quando cumprir todos os itens:

- imprimir `NEXO <modulo> coletor vX.Y` na primeira linha;
- executar `NEXO_SELFTEST=1` com 100% e a contagem mínima prevista;
- suportar modo completo e `--refresh`, sem alterar histórico congelado;
- publicar tabela de domínio com as colunas obrigatórias da seção 18.2;
- possuir adaptador e testes do adaptador;
- registrar suas medidas em `catalogo_medidas_v0.2.json`;
- executar e registrar gate próprio com critério, resultado e data;
- executar e registrar a ablação C7;
- atualizar `docs/RUNBOOK.md`, `.gitignore` e `outputFileTracingIncludes` quando aplicável.

Falha em qualquer gate devolve o item a `DRAFT`, com no máximo uma rodada documentada de revisão. Probe escrito ou self-test offline aprovado não equivale a módulo implementado.

## 25. Fontes normativas consolidadas

### No repositório

- `docs/BIBLIOTECA_B0.md`;
- `docs/BIBLIOTECA_B1.md`;
- `docs/BIBLIOTECA_B2.md`;
- `docs/BIBLIOTECA_B3.md`;
- `docs/TDN_F2.md`;
- `docs/RUNBOOK.md`;
- contratos, engines, testes e dados versionados.

### Materiais externos incorporados

- NEXO Escopo Ciclo Goldberg v1.0;
- NEXO Plano de Trabalho até Beta v1.0;
- NEXO Escopo Biblioteca Viva v1.0;
- NEXO Memorando de Evolução da Biblioteca e Histórico v1.0;
- NEXO Escopo Módulo 0D Mordomia v1.0;
- NEXO Escopo HDL v1.3;
- hdl engine;
- hdl A/B test;
- check contrato HDL;
- NEXO Escopo BJR v1.1;
- NEXO Dossiê Dissonância Coletores v1.0, de 2026-09-15;
- NEXO Contrato Dissonância v0.2;
- NEXO Escopo Unificado de Implementação v2.0, de 2026-09-15, que supersede os escopos anteriores de coletores, NFI e FXE;
- NEXO Emenda 1 ao Escopo Unificado v2.0, de 2026-09-15, que resolve `IMP-14` e fixa jan-fev/2022 como caso fora da amostra;
- probes versionados `nexo_b3_probe_v02.mjs`, `nexo_sgs_probe_v02.mjs` e `nexo_dpm_probe.mjs`;
- evidências externas completas `b3_probe_out2.txt` e `dpm_probe_out.txt`, recebidas em 2026-09-16;
- evidência externa original completa `sgs_probe_out.txt`, recebida e conferida em 2026-09-16, MD5 `c6b1e4174e5164874c5e3ef5d57050f9`;
- decisões metodológicas aprovadas nas conversas do projeto.

Os PDFs que exibem código são referências de contrato. Linhas truncadas pela paginação não devem ser copiadas como fonte executável.

## 26. Protocolo para retomar o desenvolvimento

1. abrir este documento;
2. conferir bloqueadores atuais;
3. escolher somente a próxima janela aberta;
4. ratificar as decisões exigidas por ela;
5. reproduzir defeitos com fixtures;
6. implementar sem exceções por ticker;
7. rodar matriz mínima e suíte completa;
8. gerar e revisar PDF;
9. publicar e aguardar gates remotos;
10. atualizar estado, versão, decisões e backlog neste arquivo.

Próxima ação registrada em 2026-09-16: revalidar P0; criar o calendário B3 e iniciar a migração NFI v1.2, preservando em arquivo próprio a leitura mensal; depois implementar FXE v0.3 e DPM v0.2 na ordem do Escopo Unificado; concluir J0; não integrar Dissonância ao route nem iniciar HDL v1.3 antes dos respectivos gates.
