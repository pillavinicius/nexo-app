# Biblioteca Viva — B3

O B3 transforma os documentos binários da B2 em evidência textual rastreável para o Deep.

## Fluxo

1. Documentos pendentes são extraídos sem alterar o binário e o SHA-256 originais.
2. O texto normalizado recebe versão e data de parser.
3. O Deep busca até vinte documentos candidatos do emissor, ordena-os pela relação com as lacunas abertas e envia no máximo os seis mais pertinentes à análise.
4. Cada lacuna é classificada como `resolvida` ou `aberta`.
5. Uma lacuna só é resolvida quando cita um `dedup_key` realmente presente no contexto.
6. Ajustes de score que aleguem documento inexistente são descartados pelo servidor.

## Fonte complementar condicionada

O campo de RI não existe mais na entrada da análise. Ele aparece após o Deep somente quando a Biblioteca registra uma lacuna aberta. Nessa situação, um endereço HTTPS público é obrigatório para aprofundar.

A rota `/api/biblioteca/ingest-url` bloqueia rede privada, credenciais na URL, redirecionamentos excessivos e arquivos acima de 12 MB. Nesta versão, o texto e as tabelas selecionados pelo parser são armazenados no emissor do ticker e disponibilizados para a nova execução do Deep; a retenção do binário integral e a recuperação por página fazem parte do pacote B3.2.

Documentos de RI importados antes da resolução definitiva do emissor também podem ser recuperados pelo ticker registrado nos metadados. A interface distingue uma fonte efetivamente citada como evidência de uma fonte apenas consultada durante o Deep.

## Comparação de homologação

O teste dirigido usa a mesma resposta analítica candidata em dois contextos:

- sem o documento citado: o ajuste é rejeitado e o score é preservado;
- com o documento citado: o ajuste explícito é aceito e calculado pelo servidor.

Essa comparação é virtual e certifica a governança do motor; não constitui análise real do BBAS3.
