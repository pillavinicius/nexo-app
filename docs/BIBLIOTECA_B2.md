# Biblioteca Viva — B2

O B2 prova a ingestão idempotente de uma fonte antes de ampliar a Biblioteca.

## Piloto

- fonte: CVM IPE/RAD;
- ativo: BBAS3;
- emissor: Banco do Brasil S.A., CNPJ 00.000.000/0001-91, código CVM 1023;
- categoria: Fato Relevante;
- janela: desde 01/08/2026;
- universo versionado: `data/biblioteca/universo.json`.

## Regra operacional

1. O índice anual do IPE descobre candidatos.
2. A chave `cvm_ipe:<Protocolo_Entrega>` é consultada antes do download.
3. Somente documentos ausentes são baixados.
4. Magic bytes definem o formato real.
5. Binário, SHA-256 e metadados são persistidos no Neon.
6. O parse permanece `pendente` para a B3.
7. Uma segunda execução imediata precisa baixar zero documentos e manter a mesma contagem.

Durante a fase B2, a prova é executada no prebuild da Vercel. Esse bootstrap será substituído pelo cron noturno no B5.

## Limites

- máximo de 12 MB por documento;
- somente a categoria e o ativo do universo entram;
- falhas permanecem registradas na execução;
- nenhum conteúdo documental entra no prompt ou no motor nesta fase.
