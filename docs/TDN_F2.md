# F2 · TDN — Teste de Defesa Nominal

## Objetivo

O TDN mede se uma empresa preservou economia real em choques inflacionários observados. O módulo não presume proteção pela classificação setorial e não altera automaticamente o score ou o veredito global.

## Janelas canônicas

- J1: ano-base 2014, choque 2015–2016.
- J2: ano-base 2020, choque 2021–2022.
- Utilities reguladas: observação final com um ano de defasagem, em 2017 e 2023.
- As duas janelas precisam estar completas. Cobertura parcial resulta em `dados_insuficientes` e score nulo.

## Métricas

Para empresas operacionais, o servidor calcula:

1. crescimento real da receita contra o IPCA acumulado;
2. variação da margem bruta;
3. variação da margem operacional;
4. variação do capital de giro sobre receita.

Cada janela recebe score de 0 a 5. O resultado final é a média das duas janelas e pode ser `real`, `misto` ou `nominal`.

## Matriz setorial

- Operacionais: contrato padrão.
- Utilities reguladas: defasagem regulatória de um ano.
- Commodities exportadoras: exige separar operação, preço internacional e câmbio; sem essa atribuição, o resultado fica limitado a `misto`.
- Bancos e seguradoras: `not_applicable` na v1, pois margem industrial e capital de giro não são métricas adequadas.
- FIIs e ativos exteriores: fora do TDN v1.
- Ativo brasileiro ainda não curado: `dados_insuficientes`; nunca herda perfil padrão.

## Fontes e point-in-time

- Fatos contábeis: DFP anual oficial da CVM, individual e consolidada, com preferência pela cobertura consolidada.
- Inflação: IPCA oficial do IBGE.
- Cada fato preserva documento, versão, data em que se tornou conhecido, período, escopo e conta contábil.
- O coletor é offline: `npm run collect:tdn`.
- A aplicação lê o arquivo versionado e, quando disponível, a tabela `biblioteca.fatos_financeiros` no Neon.
- Nenhum download da CVM ocorre na rota da Vercel.

## Governança

- Código calcula; modelo interpreta em `tdn_conclusao`.
- Números, score e classificação TDN são imutáveis para a IA.
- TDN não promove nem rebaixa o veredito global sozinho.
- Quando escolhido como insumo do EDG, só é aceito se as duas janelas estiverem completas.
- O relatório final preserva a saída do último Deep sem uma nova chamada analítica.

## Operação

1. Rodar o coletor offline quando houver atualização anual relevante.
2. Revisar o diff dos fatos e da matriz setorial.
3. Executar `npm run test:tdn` e a suíte completa.
4. Aplicar a migração `004_tdn_historical_facts.sql` quando o banco estiver configurado.
5. Sincronizar a base versionada no Neon com `npm run bootstrap:tdn`.
