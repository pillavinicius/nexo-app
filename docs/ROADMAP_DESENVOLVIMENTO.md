# NEXO APP - Documento mestre de produto, método e desenvolvimento

Versão: 2.0

Atualizado em: 2026-09-09

Repositório: `pillavinicius/nexo-app`

Estado: Beta em refinamento controlado

Função: fonte única de escopo, estado, decisões e ordem de implementação

## Mapa rápido

- Identidade, arquitetura e macro: seções 3 a 5.
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

Estado: `IMPLEMENTADO`, com evolução futura planejada.

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

### 11.2 Bloqueios da bateria v1.7

Estado: `BLOQUEADO` para homologação final do B3.2.

1. impedir escalonamento direto do preço por razão EV/EBITDA quando houver dívida material;
2. recalcular upside/downside da tese final pelos limites finais;
3. distinguir arredondamento aceitável de memória inconsistente;
4. substituir `margem de segurança` por `desconto aparente` quando não houver zona;
5. impedir próximos passos que antecipem `COMPRAR` antes de novo fluxo completo;
6. concluir nome humano e data local das evidências documentais.

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

Estado: `IMPLEMENTADO` como `NFI_v1.0`.

- mede fluxo estrangeiro oficial e posição histórica;
- explica deslocamento de preço;
- não altera valor intrínseco, score ou veredito;
- distingue dado oficial, pendente e proxy;
- mês parcial não entra indevidamente na distribuição histórica;
- extremo exige histórico mínimo suficiente;
- coletor roda offline.

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

### 18.2 Regras operacionais

- Vercel nunca executa carga histórica, `pdftotext`, Docling ou coleta pesada;
- credenciais ficam somente no servidor;
- logs não expõem segredos;
- falha de fonte permanece explícita;
- coletor não reescreve história silenciosamente;
- migração é idempotente;
- deploy exige suíte, build e gate remoto;
- nenhuma análise real é executada para validar código quando fixture suficiente existir.

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

### J0 - fechamento do B3.2 e valuation v1.8

Momento: imediato.

- corrigir os seis bloqueios da bateria BBAS3/ROMI3/VALE3;
- fechar nomes documentais;
- rodar matriz virtual e PDFs;
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

## 23. Backlog único

### Bloqueadores atuais

- seis correções da bateria v1.7;
- decisão D8;
- conclusão da nomenclatura documental.

### Pré-Beta

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

Próxima ação registrada: executar J0 e não iniciar HDL v1.3 até o B3.2 ser homologado.
