# Biblioteca Viva — B3 + B3.2

O B3 transforma documentos em evidência rastreável. A B3.2 separa definitivamente a fonte integral preservada do contexto seletivo enviado ao Deep.

## Fluxo

1. Todo documento permitido, inclusive fonte RI fornecida pelo usuário, preserva binário integral e SHA-256. Arquivos maiores são divididos em blocos binários verificáveis para respeitar o limite de transporte do banco sem perder nenhum byte.
2. O parser extrai todas as páginas e tabelas detectáveis e cria chunks de até 1.800 caracteres com sobreposição controlada.
3. Cada página e chunk mantém documento, página, ordem, hash e versão do parser.
4. O Deep pesquisa o índice pela lacuna, recupera no máximo doze chunks e respeita orçamento total de 28 mil caracteres.
5. O documento integral nunca entra no prompt; somente os menores trechos suficientes são enviados.
6. Se um índice antigo ainda não foi reprocessado, o fallback por documento permanece disponível e é explicitamente auditado.
7. Cada lacuna é classificada como `resolvida`, `parcial` ou `aberta`; a parcial permanece no escopo do aprofundamento sem parecer ausência total de evidência.
8. Uma lacuna só é resolvida quando cita um `dedup_key` realmente presente no contexto.
9. Ajustes de score que aleguem documento inexistente são descartados pelo servidor.

## Fonte complementar condicionada

O campo de RI não existe mais na entrada da análise. Ele aparece após o Deep somente quando a Biblioteca registra uma lacuna aberta. Nessa situação, um endereço HTTPS público é obrigatório para aprofundar.

A rota `/api/biblioteca/ingest-url` bloqueia rede privada, credenciais na URL, redirecionamentos excessivos e arquivos acima de 12 MB. O download integral é gravado antes do parse; assim, uma falha de interpretação não descarta a fonte. Após o parse, páginas e chunks são indexados para a nova execução do Deep.

Documentos de RI importados antes da resolução definitiva do emissor também podem ser recuperados pelo ticker registrado nos metadados. A interface distingue uma fonte efetivamente citada como evidência de uma fonte apenas consultada durante o Deep.

## Contagens da interface

- `Documentos no acervo`: todos os documentos processados ligados ao ativo.
- `Documentos indexados`: documentos com páginas e chunks B3.2 disponíveis.
- `Trechos consultados`: chunks efetivamente enviados naquela chamada ao Deep.

Essas quantidades não devem ser confundidas. Um acervo com nove documentos pode consultar apenas dois trechos de uma única fonte.

## Backfill

O bootstrap reindexa binários antigos e tenta recuperar fontes RI legadas que guardavam somente o recorte textual. O processo é idempotente: documentos já indexados na versão corrente não são baixados nem processados novamente.

## Comparação de homologação

O teste dirigido usa a mesma resposta analítica candidata em dois contextos:

- sem o documento citado: o ajuste é rejeitado e o score é preservado;
- com o documento citado: o ajuste explícito é aceito e calculado pelo servidor.

Essa comparação é virtual e certifica a governança do motor; não constitui análise real do BBAS3.
