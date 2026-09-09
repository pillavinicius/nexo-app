# NEXO APP - Documento mestre de desenvolvimento

Versao: 1.0  
Atualizado em: 2026-09-09  
Repositorio: `pillavinicius/nexo-app`  
Status geral: Beta em refinamento controlado

## 1. Objetivo

Este documento consolida o estado do NEXO APP, a ordem de implementacao dos modulos e os gates necessarios para cada janela. Ele funciona como indice mestre; os documentos tecnicos de cada modulo continuam sendo a fonte normativa detalhada.

Principios permanentes:

- codigo calcula; o modelo interpreta;
- nenhuma camada inventa dados ausentes;
- ausencia de evidencia permanece explicita;
- Scan, Deep e reclassificacao conservam funcoes separadas;
- uma correcao nao entra em producao sem regressao em pelo menos tres tickers de setores diferentes;
- modulo que nao altera decisao, risco ou auditabilidade de forma mensuravel nao entra apenas para decorar prosa;
- toda saida numerica relevante deve preservar formula, premissas, origem, versao e data de referencia;
- o relatorio final deve usar exatamente os mesmos valores governados pelo servidor.

## 2. Estado consolidado

| Bloco | Estado | Proxima acao |
| --- | --- | --- |
| Scan / Deep / reclassificacao | Beta funcional | Encerrar os bloqueios semanticos e matematicos da bateria v1.7 |
| Biblioteca Viva B0-B3.2 | Implementada, em homologacao | Concluir rotulos humanos e regressao documental |
| NFI F1b | Implementado | Manter regressao e operacao offline |
| TDN F2 | Implementado | Manter contrato setorial e dados insuficientes explicitos |
| HDL atual | Funcional, mas ainda dependente de entrada manual | Substituir pelo HDL v1.3 deterministico em janela propria |
| BJR | Especificado, nao implementado | Implementar em F3a apos pre-condicoes de dados e contrato |
| NCS | Planejado | Implementar apos BJR, consumindo `bjr_estimavel` |

## 3. Janela J0 - fechamento e homologacao do B3.2

### Momento

Imediato. Nenhum novo modulo estrutural deve ser incorporado antes deste fechamento.

### Escopo

Corrigir os defeitos encontrados na bateria real BBAS3, ROMI3 e VALE3 processada por `P3B_v1.7 / VALUATION_v1.7`:

1. EV/EBITDA nao pode transformar preco de equity por simples razao de multiplos quando existe divida liquida material. A camada exige EV, EBITDA, divida liquida e quantidade de acoes compativeis; sem isso, retorna `N/D`.
2. Percentuais de upside/downside da tese final devem ser recalculados deterministicamente a partir da cotacao e dos limites finais governados.
3. Pequena divergencia de arredondamento em uma memoria reproduzivel deve ser normalizada; nao deve invalidar toda a camada.
4. Quando zona e BESST nao existem, a tese nao pode usar a expressao `margem de seguranca`. Usar `desconto aparente` ou descricao equivalente.
5. Proximos passos nao podem antecipar `COMPRAR`. Gatilhos devem ordenar nova coleta, novo Deep ou novo valuation, deixando o veredito para o fluxo completo.
6. Rotulos documentais devem usar titulo humano e data local, sem dominio bruto ou data JavaScript. Exemplo: `Documento 1 - BBAS3 - Release de Resultados 2T26 - 07/09/2026`.

### Gate obrigatorio

- matriz virtual: BBAS3, ROMI3 e VALE3;
- teste especifico de EV versus equity value com empresa alavancada;
- teste de percentuais nos dois extremos da zona;
- teste de normalizacao de arredondamento e de conflito real de premissa;
- tese final sem linguagem de zona, BESST, margem de seguranca ou compra quando a governanca bloquear esses campos;
- PDF renderizado e inspecionado;
- suite completa e build de producao;
- zero chamadas aos provedores analiticos durante a regressao.

### Criterio de saida

B3.2 homologado somente quando os tres relatorios reais passarem sem erro bloqueador. Depois disso, congelar o contrato da versao e abrir a proxima janela.

## 4. Janela J1 - HDL v1.3 deterministico

### Momento

Primeira janela estrutural depois da homologacao do B3.2. Implementar isoladamente, sem BJR ou NCS no mesmo ciclo.

### Objetivo

Substituir a TIR escolhida pelo usuario por dois estimadores deterministas e comparar o retorno real do ativo com o Tesouro liquido de imposto no horizonte auditavel.

O HDL nao calcula valuation e nunca emite compra. Ele limita ou qualifica conclusoes de outros modulos.

### Entregas

- `scripts/collectors/hdl_collector.mjs`, executado offline;
- curva versionada em `data/goldberg/hdl_curva.csv`;
- engine `HDL_v1.3` com zero dependencias externas em runtime;
- horizonte derivado por contrato, edge ou default, sempre com origem;
- interpolacao permitida e extrapolacao proibida, com `clamped` explicito;
- inflacao implicita pela curva prefixada versus real, com Focus apenas como comparacao;
- hurdle real liquido de IR calculado sobre o ganho nominal;
- TIR real piso por lucro normalizado sem crescimento;
- TIR real central por DY real mais crescimento sustentavel real;
- `REERATING_PCT = 0` como decisao metodologica;
- `alfa_vs_classe_pp`, `alfa_piso_pp`, dependencia de crescimento e natureza do alfa em todo Deep;
- paridade automatica entre contrato documentado e campos emitidos.

### Decisoes a ratificar na abertura da janela

| ID | Decisao | Diretriz provisoria |
| --- | --- | --- |
| D5 | Tributacao de proventos por instrumento | Manter parametrizada; validar regra vigente antes da producao |
| D6 | Separar FII em `fii_papel` e `fii_tijolo` | Aprovar e migrar o schema junto do HDL, pois evita dupla deflacao |
| D7 | Remover TIR manual da interface | Remover do fluxo comum; manter override somente auditavel, justificado e sem alterar o piso |

Nenhuma decisao provisoria deve ser espalhada como numero magico. Todas ficam em `HDL_CONST`.

### Gates

- self-test de referencia: 46/46;
- contrato: paridade integral entre documento e engine;
- A/B com criterios pre-comprometidos;
- invariancia: `payout = 100%` e `g = 0` implica piso aproximadamente igual ao central;
- teste com posicoes vivas definido antes de observar o resultado;
- comparacao do hurdle bruto versus liquido registrada mesmo se nao mudar sinal;
- nenhum campo de compra ou recomendacao na saida HDL;
- matriz multissetorial e PDF final.

### Observacao sobre os anexos

Os PDFs `hdl engine`, `hdl ab test` e `check contrato` sao referencias de implementacao e validacao. Como linhas longas de codigo podem ser truncadas pela formatacao do PDF, a implementacao deve ser reconstruida no repositorio e validada pelos testes; nao se deve copiar trechos truncados como fonte executavel.

## 5. Janela J2 - estabilizacao integrada do ciclo Goldberg

### Momento

Depois do HDL v1.3 passar nos gates e operar em relatorios reais sem regressao.

### Escopo

- integrar HDL, NFI, TDN, Biblioteca e governanca do Deep sob contratos versionados;
- revisar compatibilidade por classe de ativo;
- confirmar que cada modulo altera somente os campos sob sua responsabilidade;
- consolidar runbook de coletores offline, datas de referencia, freeze historico e recuperacao de falhas;
- executar bateria ampliada com acoes, banco, commodity, industria, utility, seguradora e FII de cada tipo.

### Criterio de saida

Nenhuma divergencia entre interface, API, PDF e contrato; nenhuma chamada duplicada; nenhum modulo promovendo veredito fora de sua hierarquia.

## 6. Janela J3 - BJR v1.1, fase F3a

### Momento

Apos a estabilizacao integrada. O BJR e pre-requisito do NCS e nao bloqueia J0, HDL, NFI ou TDN.

### Objetivo

Transformar o risco de consolidacao substancial em recuperacao judicial em medida datada, segmentada por instancia e classe de credor.

### Pre-condicoes

- contrato BJR v1.1 ratificado;
- criterio de curadoria fechado antes de observar os resultados;
- banco inicial com Ambipar, Light, Americanas, Oi RJ2, Samarco e ao menos um caso de polo positivo;
- revisao humana das fontes e protocolos;
- fatores de spread mantidos como parametros, nao como calibracao definitiva.

### Entregas

- `data/goldberg/bjr_casos.json` com schema `bjr_1.1`;
- enums duros para instancia, consolidacao, classe e impacto de recovery;
- granularidade `instancia x classe_afetada`, nunca por setor;
- uma entrada por classe quando o mesmo caso produzir desfechos distintos;
- janela movel de quatro anos e tendencia contra a janela anterior;
- `score_perimetro`: 5 significa perimetro respeitado; 1, dissolvido;
- `casos_na_janela`, `confianca_baixa` e `estimavel` sempre explicitos;
- ausencia de imputacao, media nacional ou heranca de instancia vizinha;
- parametros de conversao score-spread isolados e versionados;
- self-test e gate no fluxo de integracao continua.

### Decisoes pendentes

| ID | Decisao | Tratamento |
| --- | --- | --- |
| D1 | Bifurcacao do 0B por instrumento | Ratificar antes da integracao com NCS |
| D4 | Fatores de conversao score para premio | Implementar como parametros provisórios; calibrar sem ajustar iterativamente para passar nos gates |

### Gates que podem reprovar o modulo

1. Instancias diferentes precisam carregar sinal diferente para a mesma classe.
2. Classes diferentes precisam carregar sinal diferente na mesma instancia.
3. Retroativo point-in-time deve atingir Spearman maior ou igual a 0,6 na ordenacao dos recoveries.
4. No caso de teste do NCS, o BJR precisa alterar o spread exigido em pelo menos 0,5 p.p.; caso contrario, o modulo volta a DRAFT.

Reprovacao permite uma rodada de revisao documentada. Nao ajustar repetidamente os parametros ate o gate passar.

## 7. Janela J4 - NCS consumindo BJR

### Momento

Somente apos o BJR passar nos quatro gates.

### Contrato minimo

Acrescentar a saida do NCS:

- `gate_atingido`: `E1`, `E2`, `E3`, `E4`, `E5`, `aprovado` ou `recusado_por_incerteza`;
- `bjr_estimavel`: booleano.

Se `bjr.estimavel === false` no portao E2, o resultado deve ser `recusado_por_incerteza`, distinto de reprovacao. Casos recusados por falta de amostra podem voltar automaticamente quando o banco ganhar evidencia suficiente; casos reprovados nao retornam pelo mesmo motivo.

## 8. Matriz permanente de homologacao

Toda janela deve conter, no minimo:

- tres tickers de setores diferentes;
- um caso com dados completos;
- um caso com dados parciais;
- um caso sem documentos;
- uma memoria de calculo valida;
- uma memoria com erro aritmetico;
- uma memoria conceitualmente invalida;
- conflito semantico de metrica;
- relatorio com zona/BESST e relatorio sem zona/BESST;
- verificacao de que o score so muda com evidencia aceita;
- PDF e interface usando os mesmos dados finais.

Para o ciclo atual, a matriz minima permanece:

- BBAS3 - banco;
- ROMI3 - industria;
- VALE3 - commodity.

Na estabilizacao integrada, ampliar para utility, seguradora e FIIs de papel e tijolo.

## 9. Governanca de versoes

- toda engine exporta versao propria;
- mudanca de formula ou significado exige nova versao;
- mudanca apenas aditiva e retrocompativel usa incremento minor;
- relatorios preservam a versao do motor que os gerou;
- contrato, engine, testes e PDF devem evoluir no mesmo commit;
- implementacao nova fica em branch de trabalho ate gates locais e remotos passarem;
- nenhum deploy e chamado de homologado apenas porque compilou.

## 10. Fontes normativas desta atualizacao

- `NEXO Escopo HDL v1.3` - contrato e ordem de implementacao do HDL;
- `hdl engine` - referencia tecnica da engine deterministica;
- `hdl ab test` - criterios A/B pre-comprometidos;
- `check contrato` - paridade entre escopo e implementacao;
- `NEXO Escopo BJR v1.1` - patch normativo da fase F3a e pre-requisito do NCS;
- `docs/BIBLIOTECA_B0.md` a `docs/BIBLIOTECA_B3.md`;
- `docs/TDN_F2.md`;
- `docs/RUNBOOK.md`.

## 11. Proxima retomada

Ao retomar o desenvolvimento:

1. abrir J0;
2. corrigir somente os seis bloqueios da bateria v1.7;
3. rodar a matriz BBAS3/ROMI3/VALE3 sem API externa;
4. revisar PDFs reais;
5. homologar e congelar B3.2;
6. abrir a decisao de arquitetura do HDL v1.3.

