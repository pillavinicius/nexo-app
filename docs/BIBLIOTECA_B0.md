# Biblioteca Viva — B0

O B0 mede os formatos reais dos documentos não estruturados do CVM IPE antes da implementação dos parsers do B3.

## Execução

```bash
npm run sample:biblioteca:formats -- --years=2025,2026 --limit=80
```

A seleção é determinística e estratificada por categoria. O coletor lê somente o prefixo necessário para identificar magic bytes; não persiste o conteúdo dos documentos.

## Invariantes

- `%PDF` prevalece sobre `content-type` e extensão.
- falhas e timeouts permanecem explícitos no relatório;
- dependências de extração não homologadas permanecem fora do projeto;
- PDF usa `pdftotext` para texto e Docling para tabelas no futuro B3;
- HTML, XML e formatos Office só recebem ramo próprio se a amostra real comprovar necessidade.

Fonte canônica: `https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/IPE/DADOS/`.

## Resultado de referência

A execução de 06/09/2026 avaliou os arquivos anuais de 2025 e 2026:

- universo: 82.935 registros;
- amostra determinística: 60 documentos de 56 categorias;
- respostas válidas: 59, com uma falha HTTP mantida no relatório;
- formato detectado: 59 PDFs e nenhum HTML, XML ou Office;
- cabeçalho HTTP: 59 respostas declaradas como `text/html`, apesar dos magic bytes `%PDF`.

Decisão para B3: implementar primeiro o caminho PDF com texto e tabelas separados. A detecção continuará aceitando outros formatos e deverá marcá-los explicitamente como não suportados até que uma nova amostra justifique outro parser.
