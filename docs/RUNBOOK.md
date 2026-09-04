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

## 3. Sair do seed mode

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

Quando o coletor real preencher esses campos, troque o `status` dos watermarks
correspondentes de `seed` para `official`. O `is_seed_mode` cai para `false`
automaticamente na próxima validação, e o teto de confiança sai junto.

Padrão obrigatório do coletor novo, igual ao macro:
**self-test offline → CSV/JSON versionado → engine determinística → gate no CI.**

---

## 4. Ordem de execução dos gates

Antes de qualquer push que toque código:

```bash
NEXO_SELFTEST=1 node scripts/nexo_macro_collector.mjs
NEXO_SELFTEST=1 node lib/nmi/nexo_context_validator.mjs
node scripts/validate_context.mjs data/context/latest.json
```

O CI (`.github/workflows/nexo-gates.yml`) roda os três sozinho a cada push.
Rodar à mão antes economiza um ciclo de deploy quebrado.

---

## 5. Fluxo Git — referência rápida

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

## 6. Pendências de segurança em aberto

- Regenerar a chave da API Anthropic (`sk-ant-...`) — apareceu em prints
- Regenerar a chave do FRED — apareceu em prints
- Credencial do `gh` em texto puro no Cloud Shell — risco aceito, não exibir
