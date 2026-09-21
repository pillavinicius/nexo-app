# NEXO — Roadmap mestre de desenvolvimento

**Atualizado em:** 2026-09-21  
**Status:** documento de retomada. Este arquivo registra sequência, prioridades, decisões fechadas, propostas e bloqueios. Não ratifica automaticamente valores marcados como proposta.

## 1. Princípio de arquitetura

O NEXO deve separar explicitamente três responsabilidades:

1. **Código/dados resolvem o objetivo e reproduzível.**
2. **IA interpreta casos cinzentos e contexto econômico.**
3. **Governança decide elegibilidade e pode vetar antes da análise econômica.**

Regra geral para fontes novas: **probe primeiro; contrato/schema depois**. Não fixar códigos de séries ou campos antes de observar a fonte real.

## 2. Sequência e prioridades de desenvolvimento

### P0 — Governança de elegibilidade e veto
Consolidar em uma única camada os filtros 0A–0D. Esta camada vem antes de Scan/Deep quando a regra tiver poder de veto.

Ordem interna recomendada:
1. **0A — Liquidez por tipo de ativo**
2. **0B — Governança corporativa com dados objetivos**
3. **0C — Insiders**
4. **0D — Mordomia cristã (0D-VETO e 0D-SIM)**

Motivo da prioridade: são filtros de elegibilidade. Um ativo vetado não deve consumir análise profunda desnecessária. O resultado precisa ser auditável, com evidência, fonte, data e razão do veto/alerta.

### P1 — Allocation Hurdle Layer
Prosseguir após estabilizar os contratos necessários da camada P0. Manter **shadow mode**, sem autoridade sobre sizing, conforme especificação vigente.

### P2 — NMI / contexto macro e crédito
Expandir o NMI, incluindo o ECI / saúde do sistema financeiro brasileiro descrito no item 4.

### P3 — Expansões posteriores
Demais classes, trilhos e módulos permanecem subordinados aos respectivos escopos específicos e às validações/probes necessários.

> A ordem acima é de implementação/risco arquitetural, não significa que módulos já funcionais devam ser removidos ou reescritos.

---

## 3. P0 — Camada unificada de Governança, Elegibilidade e Veto

### 3.1 Contrato comum

Cada filtro deve retornar, no mínimo:
- `status`: pass / alert / veto / insufficient_data / not_applicable;
- `reason_code`;
- evidências e fonte;
- `as_of` / data de referência;
- indicação de decisão determinística ou julgamento da IA;
- versão da regra/contrato.

**Fail-safe:** ausência de dado não pode virar aprovação silenciosa. Cada módulo deve definir explicitamente se `insufficient_data` bloqueia, alerta ou encaminha para julgamento.

**Separação obrigatória:** a IA não pode sobrescrever fatos objetivos nem alterar um veto determinístico. Casos cinzentos devem ter contrato próprio de prompt e evidências visíveis.

### 3.2 0A — Liquidez por tipo de ativo

**Objetivo:** substituir a régua única atual de R$ 300 mil/dia por critérios específicos por classe e, quando houver aporte informado, avaliar tamanho da posição.

| Classe | Régua | Estado |
|---|---:|---|
| FIIs | R$ 300 mil/dia | **DEFINIDO** |
| ETFs BR | R$ 300 mil/dia | **DEFINIDO** |
| Ações BR | R$ 1 milhão/dia | **PROPOSTA — RATIFICAR** |
| Ações EUA — Trilho 2 | US$ 10 milhões/dia | **PROPOSTA — RATIFICAR** |
| ETFs irlandeses — Trilho 1 | patrimônio >= US$ 500 milhões + spread baixo | **PROPOSTA — RATIFICAR** |
| Títulos de crédito — NCS | a definir | **PENDENTE** |
| Tamanho da posição | até 10% do volume médio diário quando aporte for informado na Camada de Alocação | **PROPOSTA — RATIFICAR** |

Implementação: usar constantes nomeadas/configuração versionada para permitir alteração sem reescrever regra.

Observação ETFs irlandeses: volume negociado em bolsa não deve ser usado isoladamente como proxy de liquidez; a regra proposta usa patrimônio e spread.

### 3.3 0B — Governança corporativa objetiva

**Objetivo:** reduzir notas/vetos produzidos apenas por prompt. O que for verificável deve ser calculado/derivado por código.

Dados candidatos:
- tag along a partir do segmento/listagem e regras aplicáveis da B3;
- controle estatal;
- composição do conselho;
- auditor;
- Formulário de Referência da CVM como fonte primária para campos cabíveis.

**Arquitetura:** banco/dados resolvem casos claros; IA recebe somente casos cinzentos, no mesmo princípio do 0D.

**PENDÊNCIAS antes de implementação:**
- mapear as 5 dimensões atuais e transformar cada uma em regra objetiva, híbrida ou qualitativa;
- definir régua/notas e regra de dado ausente;
- definir exatamente quais condições geram veto, alerta ou julgamento;
- probe das fontes/fields antes de congelar contrato.

### 3.4 0C — Coletor de insiders

**Objetivo:** substituir pesquisa ad hoc da IA por histórico reproduzível.

Fontes candidatas:
- Brasil: CVM Dados Abertos — Valores Mobiliários Negociados e Detidos;
- EUA: SEC Form 4 / EDGAR, aproveitando infraestrutura já validada na Biblioteca Viva.

**BLOQUEIO DE ESCOPO:** executar probes primeiro e registrar campos reais, periodicidade, identificadores, correções/republicações e capacidade point-in-time. Só depois fechar schema e regras interpretativas.

A IA poderá interpretar padrão e contexto, mas não inventar histórico ausente.

### 3.5 0D — Mordomia cristã

Manter junto da camada de Governança por também possuir poder de elegibilidade/veto. Escopo de referência: **0D-VETO + 0D-SIM v1.0**.

**Quatro bloqueios obrigatórios antes da implementação:**
1. limite de receita para veto — **20% é PROPOSTA, não decisão**;
2. ticker fora do banco curado — decidir entre zona de julgamento ou bloqueio;
3. definir universo inicial do banco curado;
4. decidir se 0D-SIM terá tela no app ou somente CLI.

**Regra de governança:** critérios de mordomia devem permanecer identificados separadamente dos critérios de governança corporativa, mesmo compartilhando a mesma camada técnica. O relatório deve mostrar claramente qual regra gerou veto/alerta e sua natureza.

---

## 4. P2 — ECI / Saúde do Sistema Financeiro Brasileiro

**Status:** interesse confirmado; registrar como expansão do **ECI na Fase 2 do NMI**, não como módulo concorrente.

Objetivo principal: fornecer contexto de expansão/aperto de crédito, com uso especialmente relevante no julgamento de FIIs.

Cobertura desejada:
- poupança: saldo e captação líquida, incluindo direção/tendência;
- financiamento imobiliário: volume, crescimento e taxas praticadas;
- relação entre funding de poupança e financiamento imobiliário;
- demais componentes do sistema financeiro úteis para detectar expansão ou aperto de crédito.

**Regras de implementação:**
- probe antes de fixar códigos de séries;
- código coleta/calcula; IA interpreta;
- preservar fonte, data, unidade, transformação e point-in-time quando aplicável;
- ausência de fonte oficial não autoriza dado sintético;
- integrar ao Context Package/NMI com contrato versionado.

**PENDENTE:** mapear fontes oficiais e executar probes para fechar séries, periodicidade e transformações.

---

## 5. Gates para retomada

Antes de implementar P0:
- ratificar somente os valores ainda marcados como proposta que forem necessários à etapa;
- fechar política de `insufficient_data` de cada filtro;
- garantir evidência auditável e testes determinísticos;
- impedir que prompt altere veto objetivo.

Antes de 0C e ECI:
- executar probes;
- arquivar amostras/relatórios de probe;
- fechar contrato somente depois da inspeção dos dados reais.

Antes de 0D:
- resolver os quatro bloqueios listados em 3.5.

## 6. Regra de manutenção deste roadmap

Toda decisão futura deve usar uma das etiquetas:
- **DEFINIDO** — decisão ratificada;
- **PROPOSTA — RATIFICAR** — hipótese ainda não aprovada;
- **PENDENTE** — falta definição/dado;
- **BLOQUEADO** — implementação não deve começar antes da decisão/probe indicado;
- **IMPLEMENTADO** — código integrado e validado pelos gates correspondentes.

Não promover proposta a definido por inferência, conveniência de implementação ou decisão da IA.
