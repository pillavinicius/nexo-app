# NEXO — RUNBOOK operacional

Rotinas manuais do NEXO, para serem executadas sem pensar.
Ambiente: Google Cloud Shell. Repo: `pillavinicius/nexo-app`.

Princípio: **coletor roda offline, o app só lê o resultado commitado.**
A Vercel nunca executa coletor.

---

## 1. Rotina trimestral — atualizar o CSV macro

Frequência: uma vez por trimestre. Leva ~3 minutos.

```bash
cd ~/nexo-app
git pull origin main
NEXO_SELFTEST=1 node scripts/nexo_macro_collector.mjs
```

O self-test tem de fechar **28 passou, 0 falhou**. Se falhar, pare — não colete.

```bash
export FRED_API_KEY="sua_chave"
node scripts/nexo_macro_collector.mjs --refresh
```

O `--refresh` recalcula **somente o mandato corrente** (Lula 3 e Trump 2) e
recongela as 26 linhas históricas relendo o CSV existente. Ele nunca revisa
história silenciosamente.

Confira o que mudou antes de commitar:

```bash
git diff data/nexo_macro.csv
```

Só as linhas do mandato atual devem aparecer. Se linha histórica mudou,
**não commite** — o freeze quebrou e é bug.

```bash
git add data/nexo_macro.csv
git commit -m "Atualiza macro CSV (trimestre)"
git push origin main
```

O push dispara o redeploy na Vercel sozinho.

**Validação pós-deploy:** abra `/api/asset?ticker=BBSE3` e confirme
`riskFreeRateStatus: "applied_from_macro"`. Se voltar `fallback_zero`,
o CSV não foi empacotado — cheque `outputFileTracingIncludes` no `next.config.js`.

Antes do teste com ticker, abra `/api/health`. O retorno deve ter:

- `status: "ok"`;
- `data.macro.available: true`;
- `data.context.available: true`.

`data.context.isSeedMode: true` é permitido enquanto a P1 não estiver concluída,
mas o pacote seed não pode alimentar veredito.

---

## 2. Publicar um Context Package (NMI)

O gate é obrigatório e vem **antes** da escrita. Nunca persista sem validar.

```bash
cd ~/nexo-app
NEXO_SELFTEST=1 node lib/nmi/nexo_context_validator.mjs   # 26 passou, 0 falhou
node scripts/validate_context.mjs data/context/latest.json
```

Saída esperada: `OK: pacote valido`, com `compatibilidade: exact`.
Qualquer erro = pacote não vai para produção.

Depois:

```bash
git add data/context/latest.json
git commit -m "Publica Context Package <context_id>"
git push origin main
```

---

## 3. Atualizar o NMI pelo BCB SGS

O produtor NMI coleta somente fora da Vercel e publica o pacote com escrita
atômica. Não exige chave de API.

```bash
cd ~/nexo-app
npm run test:nmi:collector
npm run collect:nmi -- --as-of AAAA-MM-DD
node scripts/validate_context.mjs data/context/latest.json
git diff data/context/latest.json
```

O coletor oficial cobre:

| Série | Campo | Unidade no pacote |
|---|---|---|
| 432 | `brazil.macro.selic_target` | percentual a.a. |
| 13522 | `brazil.macro.ipca_12m` | percentual em 12 meses |
| 20622 | `brazil.credit_system.credit_gdp` | fração do PIB |

Antes de escrever, o produtor bloqueia recuo de data, perda de uma observação
oficial e pacote inválido. Se as observações não mudaram, não cria nova versão.

Depois da primeira coleta real, o pacote usa contrato 1.2. Fontes ainda não
integradas ficam `unavailable` e seus campos ficam `null`; nunca recebem número
sintético.

---

## 4. Regras do seed mode

Enquanto qualquer watermark tiver `status: "seed"`, o pacote:

- se declara `is_seed_mode: true`
- carrega `seed_penalty > 0`
- tem `overall_confidence` limitada a **0.35**

Isso é lei no validador, não convenção. Um pacote semente que se declare
"official" é **rejeitado**.

Para sair do seed é preciso o primeiro coletor real do BCB SGS:

| Série | O quê | Campo do contrato |
|---|---|---|
| 432 | Meta Selic | `brazil.macro.selic_target` |
| 13522 | IPCA acumulado 12m | `brazil.macro.ipca_12m` |
| 20622 | Crédito SFN / PIB | `brazil.credit_system.credit_gdp` |

O produtor faz a transição automaticamente: BCB vira `official`, as demais
fontes ainda não integradas viram `unavailable`, e `is_seed_mode` passa a
`false`. `unavailable` não é dado real e reduz cobertura e confiança.

Padrão obrigatório do coletor novo, igual ao macro:
**self-test offline → CSV/JSON versionado → engine determinística → gate no CI.**

---

## 5. Ordem de execução dos gates

Antes de qualquer push que toque código:

```bash
NEXO_SELFTEST=1 node scripts/nexo_macro_collector.mjs
NEXO_SELFTEST=1 node lib/nmi/nexo_context_validator.mjs
NEXO_SELFTEST=1 node scripts/nmi_context_collector.mjs
node scripts/validate_context.mjs data/context/latest.json
```

O CI (`.github/workflows/nexo-gates.yml`) roda os três sozinho a cada push.
Rodar à mão antes economiza um ciclo de deploy quebrado.

---

## 6. Fluxo Git — referência rápida

```bash
git pull origin main          # trazer o que mudou
git status --short            # ver o que está solto
git add <arquivo>             # nunca `git add .` sem conferir o status
git commit -m "mensagem"      # salva local
git push origin main          # publica e dispara o deploy
```

Autenticação já configurada via `gh auth login` (credencial em texto puro
em `~/.config/gh/hosts.yml` — não exponha em captura de tela).

---

## 7. Pendências de segurança em aberto

- Regenerar a chave da API Anthropic (`sk-ant-...`) — apareceu em prints
- Regenerar a chave do FRED — apareceu em prints
- Credencial do `gh` em texto puro no Cloud Shell — risco aceito, não exibir

---

## 8. Atualizar a curva HDL (ANBIMA)

O HDL usa a ETTJ IPCA oficial como hurdle soberano real. O coletor roda somente
no Cloud Shell e o app/Vercel lê o CSV versionado.
Referência operacional: `https://www.anbima.com.br/informacoes/est-termo/CZ.asp`.

```bash
cd ~/nexo-app
git pull origin main
npm run test:hdl
npm run test:hdl:collector
node scripts/collectors/hdl_collector.mjs --refresh
git diff data/goldberg/hdl_curva.csv
```

O `--refresh` busca a data oficial mais recente, substitui somente chaves com a
mesma combinação `data_ref + vertice_anos` e preserva as curvas históricas.
Não exige chave de API.

Antes de publicar, rode:

```bash
npm run test:hdl:integration
npm run test:hdl:ui
git add data/goldberg/hdl_curva.csv
git commit -m "Atualiza curva HDL ANBIMA"
git push origin main
```

Validação pós-deploy em `/api/health`:

- `data.hdl.available: true`;
- `data.hdl.source: "anbima_ettj"`;
- `data.hdl.sourceStatus: "official"`;
- `data.hdl.vertices > 1`.

Se a curva não estiver disponível, o Deep de ativos brasileiros deve ficar
bloqueado. Nunca preencha uma taxa sintética e nunca extrapole além do maior
vértice oficial.
