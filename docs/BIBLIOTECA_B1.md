# Biblioteca Viva — B1

O B1 fixa a fundação persistente da Biblioteca Viva. A escolha é Neon/Postgres, acessado apenas no servidor por `DATABASE_URL`.

## Modelo

- `biblioteca.emissores`: identidade da companhia por CNPJ e código CVM;
- `biblioteca.ativos`: tickers vinculados ao emissor, permitindo mais de uma classe por companhia;
- `biblioteca.documentos`: metadados, origem, formato, estado do parse e futuras saídas de texto/tabelas;
- `biblioteca.schema_migrations`: versão aplicada da estrutura.

O documento pertence ao emissor. Uma consulta por ticker resolve primeiro o emissor, evitando duplicar o mesmo documento quando uma companhia possui mais de uma classe de ação.

## Provisionamento

1. Criar um projeto Postgres no Neon pela integração da Vercel.
2. Disponibilizar `DATABASE_URL` nos ambientes Preview e Production.
3. Aplicar `npm run migrate:biblioteca` uma vez em cada banco.
4. Confirmar `data.bibliotecaB1.status = ready` em `/api/health`.

A aplicação nunca expõe a string de conexão. Sem configuração, o estado é `not_configured`; com conexão sem migração, `migration_required`; falhas permanecem `unavailable`.

## Fronteiras

- B1 não baixa documentos;
- B2 fará a ingestão e provará deduplicação;
- B3 preencherá `texto_corrido`, `tabelas_json` e `status_parse`;
- documento e emissor são persistidos uma vez; tickers são aliases consultáveis;
- `status_parse` é obrigatório e nunca some silenciosamente.
