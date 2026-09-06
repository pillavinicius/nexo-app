const SOURCES = new Set(["cvm_ipe", "cvm_fnet", "cvm_rad", "sec", "ri"]);
const FORMATS = new Set(["pdf", "html", "xml", "zip", "ole", "rtf", "gzip", "json", "text", "outro"]);
const PARSE_STATUSES = new Set(["pendente", "ok", "falhou", "nao_suportado"]);

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

    async updateParseState({ dedupKey, status, texto = null, tabelas = null, hashConteudo = null, erro = null }) {
      const normalizedStatus = normalizeEnum(status, PARSE_STATUSES, "parse_status");
      if (normalizedStatus === "ok" && !texto && !tabelas) throw new Error("biblioteca_parse_output_required");
      if (hashConteudo && !/^[a-f0-9]{64}$/.test(hashConteudo)) throw new Error("biblioteca_content_hash_invalid");
      const rows = await database.query(
        `UPDATE biblioteca.documentos
            SET status_parse = $2, texto_corrido = $3, tabelas_json = $4::jsonb,
                hash_conteudo = $5, erro_parse = $6
          WHERE dedup_key = $1
          RETURNING dedup_key, status_parse, hash_conteudo`,
        [required(dedupKey, "dedup_key"), normalizedStatus, texto, tabelas ? JSON.stringify(tabelas) : null, hashConteudo, erro]
      );
      return rows[0] || null;
    },
  };
}
