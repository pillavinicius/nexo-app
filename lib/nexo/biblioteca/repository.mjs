import { createHash } from "node:crypto";

const SOURCES = new Set(["cvm_ipe", "cvm_fnet", "cvm_rad", "sec", "ri"]);
const FORMATS = new Set(["pdf", "html", "xml", "zip", "ole", "rtf", "gzip", "json", "text", "outro"]);
const PARSE_STATUSES = new Set(["pendente", "ok", "falhou", "nao_suportado"]);
const RAW_PART_BYTES = 512 * 1024;

function decodeDatabaseBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string" && value.startsWith("\\x")) return Buffer.from(value.slice(2), "hex");
  return Buffer.from(value || []);
}

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`biblioteca_${name}_required`);
  return normalized;
}

export function normalizeTicker(value) {
  const ticker = required(value, "ticker").toUpperCase();
  if (!/^[A-Z0-9.-]{2,16}$/.test(ticker)) throw new Error("biblioteca_ticker_invalid");
  return ticker;
}

function normalizeCnpj(value) {
  if (value === null || value === undefined || value === "") return null;
  const cnpj = String(value).replace(/\D/g, "");
  if (cnpj.length !== 14) throw new Error("biblioteca_cnpj_invalid");
  return cnpj;
}

function normalizeEnum(value, allowed, name) {
  const normalized = required(value, name).toLowerCase();
  if (!allowed.has(normalized)) throw new Error(`biblioteca_${name}_invalid`);
  return normalized;
}

function queryClient(client) {
  if (!client || typeof client.query !== "function") throw new Error("biblioteca_query_client_required");
  return client;
}

function retrievalQuery(gaps = []) {
  const stop = new Set(["para", "pela", "pelo", "como", "qual", "quais", "sobre", "dados", "carteira", "documento", "fonte"]);
  const tokens = [...new Set((Array.isArray(gaps) ? gaps : [gaps])
    .flatMap((gap) => String(gap || "").toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])
    .filter((token) => !stop.has(token)))];
  const plain = tokens.join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (plain.includes("inadimplencia")) tokens.push("npl", "crédito", "perda");
  if (plain.includes("roic")) tokens.push("roe", "rentabilidade", "retorno");
  return [...new Set(tokens)].slice(0, 32).map((token) => `"${token.replaceAll('"', "")}"`).join(" OR ");
}

export function createBibliotecaRepository(client) {
  const database = queryClient(client);
  return {
    async upsertIssuer({ issuerId, nome, cnpj = null, codigoCvm = null, mercado = "BR" }) {
      const params = [required(issuerId, "issuer_id"), required(nome, "issuer_name"), normalizeCnpj(cnpj), codigoCvm ? String(codigoCvm).trim() : null, required(mercado, "market").toUpperCase()];
      const rows = await database.query(
        `INSERT INTO biblioteca.emissores (issuer_id, nome, cnpj, codigo_cvm, mercado)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (issuer_id) DO UPDATE SET
           nome = EXCLUDED.nome, cnpj = EXCLUDED.cnpj, codigo_cvm = EXCLUDED.codigo_cvm,
           mercado = EXCLUDED.mercado, atualizado_em = now()
         RETURNING issuer_id, nome, cnpj, codigo_cvm, mercado, ativo`,
        params
      );
      return rows[0] || null;
    },

    async upsertAsset({ ticker, issuerId, classe = "acao-br", mercado = "B3" }) {
      const params = [normalizeTicker(ticker), required(issuerId, "issuer_id"), required(classe, "asset_class"), required(mercado, "market").toUpperCase()];
      const rows = await database.query(
        `INSERT INTO biblioteca.ativos (ticker, issuer_id, classe, mercado)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (ticker) DO UPDATE SET
           issuer_id = EXCLUDED.issuer_id, classe = EXCLUDED.classe,
           mercado = EXCLUDED.mercado, atualizado_em = now()
         RETURNING ticker, issuer_id, classe, mercado, ativo`,
        params
      );
      return rows[0] || null;
    },

    async insertDocumentMetadata(document) {
      const source = normalizeEnum(document.fonte, SOURCES, "source");
      const format = normalizeEnum(document.formato, FORMATS, "format");
      const sourceId = required(document.sourceDocumentId, "source_document_id");
      const dedupKey = required(document.dedupKey, "dedup_key");
      if (dedupKey !== `${source}:${sourceId}`) throw new Error("biblioteca_dedup_key_invalid");
      const params = [
        dedupKey, required(document.issuerId, "issuer_id"), source, sourceId,
        document.categoria || null, document.tipo || null, document.titulo || null,
        document.dataDocumento || null, required(document.urlOrigem, "source_url"), format,
        JSON.stringify(document.metadata || {}),
      ];
      const rows = await database.query(
        `INSERT INTO biblioteca.documentos
           (dedup_key, issuer_id, fonte, source_document_id, categoria, tipo, titulo,
            data_documento, url_origem, formato, status_parse, metadata_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pendente', $11::jsonb)
         ON CONFLICT (dedup_key) DO NOTHING
         RETURNING dedup_key, issuer_id, fonte, status_parse`,
        params
      );
      return { inserted: rows.length === 1, document: rows[0] || null };
    },

    async insertIngestedDocument(document) {
      const source = normalizeEnum(document.fonte, SOURCES, "source");
      const format = normalizeEnum(document.formato, FORMATS, "format");
      const sourceId = required(document.sourceDocumentId, "source_document_id");
      const dedupKey = required(document.dedupKey, "dedup_key");
      if (dedupKey !== `${source}:${sourceId}`) throw new Error("biblioteca_dedup_key_invalid");
      const content = Buffer.from(document.conteudo || []);
      if (!content.length) throw new Error("biblioteca_document_content_required");
      if (!/^[a-f0-9]{64}$/.test(String(document.hashConteudo || ""))) throw new Error("biblioteca_content_hash_invalid");
      const params = [
        dedupKey, required(document.issuerId, "issuer_id"), source, sourceId,
        document.categoria || null, document.tipo || null, document.titulo || null,
        document.dataDocumento || null, required(document.urlOrigem, "source_url"), format,
        JSON.stringify(document.metadata || {}), content.toString("hex"), content.length,
        document.contentTypeDeclarado || null, document.hashConteudo,
      ];
      const rows = await database.query(
        `INSERT INTO biblioteca.documentos
           (dedup_key, issuer_id, fonte, source_document_id, categoria, tipo, titulo,
            data_documento, url_origem, formato, status_parse, metadata_json,
            conteudo_binario, tamanho_bytes, content_type_declarado, data_download, hash_conteudo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pendente', $11::jsonb,
                 decode($12, 'hex'), $13, $14, now(), $15)
         ON CONFLICT (dedup_key) DO NOTHING
         RETURNING dedup_key, issuer_id, fonte, status_parse, tamanho_bytes, hash_conteudo`,
        params
      );
      return { inserted: rows.length === 1, document: rows[0] || null };
    },

    async upsertRawDocument(document) {
      const source = normalizeEnum(document.fonte, SOURCES, "source");
      const format = normalizeEnum(document.formato, FORMATS, "format");
      const sourceId = required(document.sourceDocumentId, "source_document_id");
      const dedupKey = required(document.dedupKey, "dedup_key");
      if (dedupKey !== `${source}:${sourceId}`) throw new Error("biblioteca_dedup_key_invalid");
      const content = Buffer.from(document.conteudo || []);
      if (!content.length) throw new Error("biblioteca_document_content_required");
      if (!/^[a-f0-9]{64}$/.test(String(document.hashConteudo || ""))) throw new Error("biblioteca_content_hash_invalid");
      const rows = await database.query(
        `INSERT INTO biblioteca.documentos
           (dedup_key, issuer_id, fonte, source_document_id, categoria, tipo, titulo,
            data_documento, url_origem, formato, status_parse, metadata_json,
            tamanho_bytes, content_type_declarado, data_download, hash_conteudo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pendente', $11::jsonb,
                 $12, $13, now(), $14)
         ON CONFLICT (dedup_key) DO UPDATE SET
           issuer_id = EXCLUDED.issuer_id, categoria = EXCLUDED.categoria, tipo = EXCLUDED.tipo,
           titulo = EXCLUDED.titulo, data_documento = EXCLUDED.data_documento,
           url_origem = EXCLUDED.url_origem, formato = EXCLUDED.formato,
           metadata_json = EXCLUDED.metadata_json, conteudo_binario = NULL,
           tamanho_bytes = EXCLUDED.tamanho_bytes, content_type_declarado = EXCLUDED.content_type_declarado,
           data_download = EXCLUDED.data_download, hash_conteudo = EXCLUDED.hash_conteudo,
           status_parse = CASE WHEN biblioteca.documentos.hash_conteudo IS DISTINCT FROM EXCLUDED.hash_conteudo
                               THEN 'pendente' ELSE biblioteca.documentos.status_parse END
         RETURNING dedup_key, issuer_id, fonte, status_parse, tamanho_bytes, hash_conteudo, (xmax = 0) AS inserted`,
        [dedupKey, required(document.issuerId, "issuer_id"), source, sourceId,
          document.categoria || null, document.tipo || null, document.titulo || null,
          document.dataDocumento || null, required(document.urlOrigem, "source_url"), format,
          JSON.stringify(document.metadata || {}), content.length,
          document.contentTypeDeclarado || null, document.hashConteudo]
      );
      await database.query("DELETE FROM biblioteca.documento_binario_partes WHERE dedup_key = $1", [dedupKey]);
      let parts = 0;
      for (let offset = 0; offset < content.length; offset += RAW_PART_BYTES) {
        const bytes = content.subarray(offset, Math.min(content.length, offset + RAW_PART_BYTES));
        const hash = createHash("sha256").update(bytes).digest("hex");
        await database.query(
          `INSERT INTO biblioteca.documento_binario_partes
             (dedup_key, parte, conteudo, tamanho_bytes, hash_parte)
           VALUES ($1, $2, decode($3, 'base64'), $4, $5)`,
          [dedupKey, parts, bytes.toString("base64"), bytes.length, hash]
        );
        parts += 1;
      }
      return { inserted: Boolean(rows[0]?.inserted), document: { ...(rows[0] || {}), binary_parts: parts } };
    },

    async readRawDocument(dedupKey) {
      const key = required(dedupKey, "dedup_key");
      const rows = await database.query(
        `SELECT conteudo FROM biblioteca.documento_binario_partes
          WHERE dedup_key = $1 ORDER BY parte`,
        [key]
      );
      return rows.length ? Buffer.concat(rows.map((row) => decodeDatabaseBytes(row.conteudo))) : null;
    },

    async upsertParsedDocument(document) {
      const source = normalizeEnum(document.fonte, SOURCES, "source");
      const format = normalizeEnum(document.formato, FORMATS, "format");
      const sourceId = required(document.sourceDocumentId, "source_document_id");
      const dedupKey = required(document.dedupKey, "dedup_key");
      if (dedupKey !== `${source}:${sourceId}`) throw new Error("biblioteca_dedup_key_invalid");
      if (!document.texto && !document.tabelas) throw new Error("biblioteca_parse_output_required");
      if (!/^[a-f0-9]{64}$/.test(String(document.hashConteudo || ""))) throw new Error("biblioteca_content_hash_invalid");
      const params = [
        dedupKey, required(document.issuerId, "issuer_id"), source, sourceId,
        document.categoria || null, document.tipo || null, document.titulo || null,
        document.dataDocumento || null, required(document.urlOrigem, "source_url"), format,
        JSON.stringify(document.metadata || {}), Number(document.tamanhoBytes || 0),
        document.contentTypeDeclarado || null, document.hashConteudo, document.texto || null,
        document.tabelas ? JSON.stringify(document.tabelas) : null, document.parserVersion || null,
      ];
      const rows = await database.query(
        `INSERT INTO biblioteca.documentos
           (dedup_key, issuer_id, fonte, source_document_id, categoria, tipo, titulo,
            data_documento, url_origem, formato, status_parse, metadata_json,
            tamanho_bytes, content_type_declarado, data_download, hash_conteudo,
            texto_corrido, tabelas_json, parser_version, data_parse)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ok', $11::jsonb,
                 $12, $13, now(), $14, $15, $16::jsonb, $17, now())
         ON CONFLICT (dedup_key) DO UPDATE SET
           status_parse = 'ok', metadata_json = EXCLUDED.metadata_json,
           tamanho_bytes = EXCLUDED.tamanho_bytes,
           content_type_declarado = EXCLUDED.content_type_declarado,
           data_download = EXCLUDED.data_download, hash_conteudo = EXCLUDED.hash_conteudo,
           texto_corrido = EXCLUDED.texto_corrido, tabelas_json = EXCLUDED.tabelas_json,
           parser_version = EXCLUDED.parser_version, data_parse = EXCLUDED.data_parse,
           erro_parse = NULL
         RETURNING dedup_key, issuer_id, fonte, status_parse, tamanho_bytes, hash_conteudo`,
        params
      );
      return { inserted: !document.existing, document: rows[0] || null };
    },

    async findByDedupKey(dedupKey) {
      const rows = await database.query(
        "SELECT * FROM biblioteca.documentos WHERE dedup_key = $1 LIMIT 1",
        [required(dedupKey, "dedup_key")]
      );
      return rows[0] || null;
    },

    async countDocuments({ fonte = null } = {}) {
      const rows = await database.query(
        "SELECT count(*)::integer AS total FROM biblioteca.documentos WHERE ($1::text IS NULL OR fonte = $1)",
        [fonte]
      );
      return Number(rows[0]?.total || 0);
    },

    async parseStatusCounts() {
      const rows = await database.query(
        `SELECT status_parse, count(*)::integer AS total
           FROM biblioteca.documentos
          GROUP BY status_parse`
      );
      return Object.fromEntries(rows.map((row) => [row.status_parse, Number(row.total || 0)]));
    },

    async recordIngestionRun(run) {
      const rows = await database.query(
        `INSERT INTO biblioteca.ingestion_runs
           (run_id, fonte, iniciado_em, concluido_em, status, descobertos, ja_existentes,
            baixados, inseridos, falhas, bytes_baixados, dedup_provada, detalhes_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
         ON CONFLICT (run_id) DO UPDATE SET
           concluido_em = EXCLUDED.concluido_em, status = EXCLUDED.status,
           descobertos = EXCLUDED.descobertos, ja_existentes = EXCLUDED.ja_existentes,
           baixados = EXCLUDED.baixados, inseridos = EXCLUDED.inseridos,
           falhas = EXCLUDED.falhas, bytes_baixados = EXCLUDED.bytes_baixados,
           dedup_provada = EXCLUDED.dedup_provada, detalhes_json = EXCLUDED.detalhes_json
         RETURNING *`,
        [run.runId, "cvm_ipe", run.iniciadoEm, run.concluidoEm, run.status,
          run.descobertos, run.jaExistentes, run.baixados, run.inseridos,
          run.falhas, run.bytesBaixados, Boolean(run.dedupProvada), JSON.stringify(run.detalhes || {})]
      );
      return rows[0] || null;
    },

    async latestIngestionRun() {
      const rows = await database.query(
        `SELECT run_id, fonte, iniciado_em, concluido_em, status, descobertos,
                ja_existentes, baixados, inseridos, falhas, bytes_baixados, dedup_provada
           FROM biblioteca.ingestion_runs
          WHERE fonte = 'cvm_ipe'
          ORDER BY iniciado_em DESC
          LIMIT 1`
      );
      return rows[0] || null;
    },

    async listByTicker({ ticker, categorias = [], desde = null, limite = 20 } = {}) {
      const safeLimit = Math.min(100, Math.max(1, Number.isInteger(Number(limite)) ? Number(limite) : 20));
      const normalizedCategories = [...new Set(categorias.map((item) => String(item).trim()).filter(Boolean))];
      return database.query(
        `SELECT d.dedup_key, a.ticker, d.fonte, d.categoria, d.tipo, d.titulo,
                d.data_documento, d.url_origem, d.formato, d.status_parse
           FROM biblioteca.documentos d
           JOIN biblioteca.ativos a ON a.issuer_id = d.issuer_id AND a.ativo = TRUE
          WHERE a.ticker = $1
            AND ($2::date IS NULL OR d.data_documento >= $2::date)
            AND (cardinality($3::text[]) = 0 OR d.categoria = ANY($3::text[]))
          ORDER BY d.data_documento DESC NULLS LAST, d.data_ingestao DESC
          LIMIT $4`,
        [normalizeTicker(ticker), desde || null, normalizedCategories, safeLimit]
      );
    },

    async findAssetByTicker(ticker) {
      const rows = await database.query(
        `SELECT a.ticker, a.issuer_id, a.classe, a.mercado, e.nome
           FROM biblioteca.ativos a
           JOIN biblioteca.emissores e ON e.issuer_id = a.issuer_id
          WHERE a.ticker = $1 AND a.ativo = TRUE AND e.ativo = TRUE
          LIMIT 1`,
        [normalizeTicker(ticker)]
      );
      return rows[0] || null;
    },

    async ensureProvisionalAsset({ ticker, classe = "acao-br" }) {
      const normalizedTicker = normalizeTicker(ticker);
      const issuerId = `ri:${normalizedTicker}`;
      await this.upsertIssuer({ issuerId, nome: `${normalizedTicker} · cadastro provisório por RI`, mercado: "BR" });
      return this.upsertAsset({ ticker: normalizedTicker, issuerId, classe: classe === "fii" ? "fii" : "acao-br", mercado: "B3" });
    },

    async listPendingDocuments({ limite = 20 } = {}) {
      const safeLimit = Math.min(100, Math.max(1, Number(limite) || 20));
      return database.query(
        `SELECT dedup_key, formato, conteudo_binario, hash_conteudo
           FROM biblioteca.documentos
          WHERE status_parse = 'pendente'
            AND (conteudo_binario IS NOT NULL OR EXISTS (
              SELECT 1 FROM biblioteca.documento_binario_partes p WHERE p.dedup_key = biblioteca.documentos.dedup_key
            ))
          ORDER BY data_ingestao ASC
          LIMIT $1`,
        [safeLimit]
      );
    },

    async listParsedByTicker({ ticker, limite = 20 } = {}) {
      const safeLimit = Math.min(50, Math.max(1, Number(limite) || 20));
      return database.query(
        `SELECT d.dedup_key, d.fonte, d.categoria, d.titulo, d.data_documento,
                d.url_origem, d.texto_corrido, d.tabelas_json, d.parser_version
           FROM biblioteca.ativos a
           JOIN biblioteca.documentos d
             ON (d.issuer_id = a.issuer_id
                 OR (d.fonte = 'ri' AND upper(d.metadata_json->>'requested_ticker') = a.ticker))
          WHERE a.ticker = $1 AND d.status_parse = 'ok' AND d.texto_corrido IS NOT NULL
            AND a.ativo = TRUE
          ORDER BY (d.fonte = 'ri') DESC, d.data_documento DESC NULLS LAST, d.data_ingestao DESC
          LIMIT $2`,
        [normalizeTicker(ticker), safeLimit]
      );
    },

    async replaceDocumentIndex({ dedupKey, pages = [], chunks = [], parserVersion }) {
      const key = required(dedupKey, "dedup_key");
      const version = required(parserVersion, "parser_version");
      if (!pages.length || !chunks.length) throw new Error("biblioteca_document_index_required");
      const pageRows = pages.map((page) => ({
        pagina: Number(page.pagina), texto: required(page.texto, "page_text"),
        tabelas_json: Array.isArray(page.tabelas) ? page.tabelas : [], hash_texto: required(page.hashTexto, "page_hash"),
      }));
      const chunkRows = chunks.map((chunk, index) => ({
        chunk_id: `${key}#${String(index).padStart(5, "0")}`,
        ordem: Number(chunk.ordem ?? index), pagina_inicio: Number(chunk.paginaInicio), pagina_fim: Number(chunk.paginaFim),
        secao: chunk.secao || null, texto: required(chunk.texto, "chunk_text"),
        tamanho_caracteres: Number(chunk.tamanhoCaracteres), hash_texto: required(chunk.hashTexto, "chunk_hash"),
      }));
      await database.query("DELETE FROM biblioteca.documento_chunks WHERE dedup_key = $1", [key]);
      await database.query("DELETE FROM biblioteca.documento_paginas WHERE dedup_key = $1", [key]);
      const insertedPages = await database.query(
        `INSERT INTO biblioteca.documento_paginas
           (dedup_key, pagina, texto, tabelas_json, hash_texto, parser_version)
         SELECT $1, pagina, texto, tabelas_json, hash_texto, $3
           FROM jsonb_to_recordset($2::jsonb)
             AS p(pagina integer, texto text, tabelas_json jsonb, hash_texto text)
         RETURNING pagina`,
        [key, JSON.stringify(pageRows), version]
      );
      const insertedChunks = await database.query(
        `INSERT INTO biblioteca.documento_chunks
           (chunk_id, dedup_key, ordem, pagina_inicio, pagina_fim, secao, texto,
            tamanho_caracteres, hash_texto, parser_version)
         SELECT chunk_id, $1, ordem, pagina_inicio, pagina_fim, secao, texto,
                tamanho_caracteres, hash_texto, $3
           FROM jsonb_to_recordset($2::jsonb)
             AS c(chunk_id text, ordem integer, pagina_inicio integer, pagina_fim integer,
                  secao text, texto text, tamanho_caracteres integer, hash_texto text)
         RETURNING chunk_id`,
        [key, JSON.stringify(chunkRows), version]
      );
      return { pages: insertedPages.length, chunks: insertedChunks.length };
    },

    async searchChunksByTicker({ ticker, gaps = [], limite = 60 } = {}) {
      const safeLimit = Math.min(120, Math.max(1, Number(limite) || 60));
      const query = retrievalQuery(gaps);
      return database.query(
        `WITH asset_documents AS (
           SELECT DISTINCT d.dedup_key, d.fonte, d.categoria, d.titulo, d.data_documento,
                  d.url_origem, d.parser_version
             FROM biblioteca.ativos a
             JOIN biblioteca.documentos d
               ON (d.issuer_id = a.issuer_id
                   OR (d.fonte = 'ri' AND upper(d.metadata_json->>'requested_ticker') = a.ticker))
            WHERE a.ticker = $1 AND a.ativo = TRUE AND d.status_parse = 'ok'
         )
         SELECT d.*, c.chunk_id, c.ordem, c.pagina_inicio, c.pagina_fim,
                c.secao, c.texto, c.tamanho_caracteres, p.tabelas_json,
                CASE WHEN $2 = '' THEN 0
                     ELSE ts_rank_cd(c.search_vector, websearch_to_tsquery('portuguese', $2)) END AS search_rank
           FROM asset_documents d
           JOIN biblioteca.documento_chunks c ON c.dedup_key = d.dedup_key
           LEFT JOIN biblioteca.documento_paginas p
             ON p.dedup_key = c.dedup_key AND p.pagina = c.pagina_inicio
          WHERE $2 = '' OR c.search_vector @@ websearch_to_tsquery('portuguese', $2)
          ORDER BY search_rank DESC, (d.fonte = 'ri') DESC,
                   d.data_documento DESC NULLS LAST, c.ordem
          LIMIT $3`,
        [normalizeTicker(ticker), query, safeLimit]
      );
    },

    async countDocumentsByTicker(ticker) {
      const rows = await database.query(
        `SELECT count(DISTINCT d.dedup_key)::integer AS total,
                count(DISTINCT d.dedup_key) FILTER (WHERE c.dedup_key IS NOT NULL)::integer AS indexed
           FROM biblioteca.ativos a
           JOIN biblioteca.documentos d
             ON (d.issuer_id = a.issuer_id
                 OR (d.fonte = 'ri' AND upper(d.metadata_json->>'requested_ticker') = a.ticker))
           LEFT JOIN biblioteca.documento_chunks c ON c.dedup_key = d.dedup_key
          WHERE a.ticker = $1 AND a.ativo = TRUE AND d.status_parse = 'ok'`,
        [normalizeTicker(ticker)]
      );
      return { total: Number(rows[0]?.total || 0), indexed: Number(rows[0]?.indexed || 0) };
    },

    async listIndexBackfillCandidates({ limite = 20 } = {}) {
      const safeLimit = Math.min(50, Math.max(1, Number(limite) || 20));
      return database.query(
        `SELECT d.dedup_key, d.formato, d.conteudo_binario, d.hash_conteudo,
                d.fonte, d.url_origem, d.metadata_json
           FROM biblioteca.documentos d
          WHERE (d.conteudo_binario IS NOT NULL OR EXISTS (
              SELECT 1 FROM biblioteca.documento_binario_partes p WHERE p.dedup_key = d.dedup_key
            ))
            AND (d.parser_version IS DISTINCT FROM $1
                 OR NOT EXISTS (SELECT 1 FROM biblioteca.documento_chunks c WHERE c.dedup_key = d.dedup_key))
          ORDER BY (d.fonte = 'ri') DESC, d.data_ingestao ASC
          LIMIT $2`,
        ["BIB_B3_2_PARSER_v2.0", safeLimit]
      );
    },

    async listRiDocumentsWithoutBinary({ limite = 10 } = {}) {
      const safeLimit = Math.min(20, Math.max(1, Number(limite) || 10));
      return database.query(
        `SELECT d.dedup_key, d.url_origem, d.metadata_json,
                upper(d.metadata_json->>'requested_ticker') AS ticker
           FROM biblioteca.documentos d
          WHERE d.fonte = 'ri' AND d.conteudo_binario IS NULL
            AND NOT EXISTS (SELECT 1 FROM biblioteca.documento_binario_partes p WHERE p.dedup_key = d.dedup_key)
            AND d.url_origem LIKE 'https://%'
          ORDER BY d.data_ingestao ASC
          LIMIT $1`,
        [safeLimit]
      );
    },

    async indexStats() {
      const rows = await database.query(
        `SELECT count(*)::integer AS documents,
                count(*) FILTER (WHERE conteudo_binario IS NOT NULL OR EXISTS (
                  SELECT 1 FROM biblioteca.documento_binario_partes p WHERE p.dedup_key = d.dedup_key
                ))::integer AS raw_documents,
                count(*) FILTER (WHERE EXISTS (
                  SELECT 1 FROM biblioteca.documento_chunks c WHERE c.dedup_key = d.dedup_key
                ))::integer AS indexed_documents,
                (SELECT count(*)::integer FROM biblioteca.documento_paginas) AS pages,
                (SELECT count(*)::integer FROM biblioteca.documento_chunks) AS chunks
           FROM biblioteca.documentos d`
      );
      return rows[0] || { documents: 0, raw_documents: 0, indexed_documents: 0, pages: 0, chunks: 0 };
    },

    async updateParseState({ dedupKey, status, texto = null, tabelas = null, hashConteudo = null, erro = null, parserVersion = null }) {
      const normalizedStatus = normalizeEnum(status, PARSE_STATUSES, "parse_status");
      if (normalizedStatus === "ok" && !texto && !tabelas) throw new Error("biblioteca_parse_output_required");
      if (hashConteudo && !/^[a-f0-9]{64}$/.test(hashConteudo)) throw new Error("biblioteca_content_hash_invalid");
      const rows = await database.query(
        `UPDATE biblioteca.documentos
            SET status_parse = $2, texto_corrido = $3, tabelas_json = $4::jsonb,
                hash_conteudo = $5, erro_parse = $6, parser_version = $7, data_parse = now()
          WHERE dedup_key = $1
          RETURNING dedup_key, status_parse, hash_conteudo, parser_version`,
        [required(dedupKey, "dedup_key"), normalizedStatus, texto, tabelas ? JSON.stringify(tabelas) : null, hashConteudo, erro, parserVersion]
      );
      return rows[0] || null;
    },
  };
}
