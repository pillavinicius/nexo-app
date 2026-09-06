# Biblioteca Viva — B3

O B3 transforma os documentos binários da B2 em evidência textual rastreável para o Deep.

## Fluxo

1. Documentos pendentes são extraídos sem alterar o binário e o SHA-256 originais.
2. O texto normalizado recebe versão e data de parser.
3. O Deep consulta até seis documentos recentes do emissor.
4. Cada lacuna é classificada como `resolvida` ou `aberta`.
5. Uma lacuna só é resolvida quando cita um `dedup_key` realmente presente no contexto.
6. Ajustes de score que aleguem documento inexistente são descartados pelo servidor.

## Fonte complementar condicionada

O campo de RI não existe mais na entrada da análise. Ele aparece após o Deep somente quando a Biblioteca registra uma lacuna aberta. Nessa situação, um endereço HTTPS público é obrigatório para aprofundar.

A rota `/api/biblioteca/ingest-url` bloqueia rede privada, credenciais na URL, redirecionamentos excessivos e arquivos acima de 12 MB. O conteúdo é armazenado no emissor do ticker, processado e disponibilizado para a nova execução do Deep.

## Comparação de homologação

O teste dirigido usa a mesma resposta analítica candidata em dois contextos:

- sem o documento citado: o ajuste é rejeitado e o score é preservado;
- com o documento citado: o ajuste explícito é aceito e calculado pelo servidor.

Essa comparação é virtual e certifica a governança do motor; não constitui análise real do BBAS3.
