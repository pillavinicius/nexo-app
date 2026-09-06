CREATE SCHEMA IF NOT EXISTS biblioteca;

-- statement-breakpoint
CREATE TABLE IF NOT EXISTS biblioteca.schema_migrations (
  version       TEXT PRIMARY KEY,
  applied_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- statement-breakpoint
CREATE TABLE IF NOT EXISTS biblioteca.emissores (
  issuer_id     TEXT PRIMARY KEY,
  nome          TEXT NOT NULL,
  cnpj          TEXT,
  codigo_cvm    TEXT,
  mercado       TEXT NOT NULL DEFAULT 'BR',
  ativo         BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT emissores_cnpj_formato CHECK (cnpj IS NULL OR cnpj ~ '^[0-9]{14}$'),
  CONSTRAINT emissores_codigo_cvm_unico UNIQUE (codigo_cvm),
  CONSTRAINT emissores_cnpj_unico UNIQUE (cnpj)
);

-- statement-breakpoint
CREATE TABLE IF NOT EXISTS biblioteca.ativos (
  ticker        TEXT PRIMARY KEY,
  issuer_id     TEXT NOT NULL REFERENCES biblioteca.emissores(issuer_id) ON DELETE RESTRICT,
  classe        TEXT NOT NULL DEFAULT 'acao-br',
  mercado       TEXT NOT NULL DEFAULT 'B3',
  ativo         BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ativos_ticker_maiusculo CHECK (ticker = upper(ticker))
);

-- statement-breakpoint
CREATE TABLE IF NOT EXISTS biblioteca.documentos (
  dedup_key          TEXT PRIMARY KEY,
  issuer_id          TEXT NOT NULL REFERENCES biblioteca.emissores(issuer_id) ON DELETE RESTRICT,
  fonte              TEXT NOT NULL,
  source_document_id TEXT NOT NULL,
  categoria          TEXT,
  tipo               TEXT,
  titulo             TEXT,
  data_documento     DATE,
  data_ingestao      TIMESTAMPTZ NOT NULL DEFAULT now(),
  url_origem         TEXT NOT NULL,
  formato            TEXT NOT NULL,
  status_parse       TEXT NOT NULL DEFAULT 'pendente',
  texto_corrido      TEXT,
  tabelas_json       JSONB,
  hash_conteudo      TEXT,
  erro_parse         TEXT,
  metadata_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT documentos_fonte_valida CHECK (fonte IN ('cvm_ipe', 'cvm_fnet', 'cvm_rad', 'sec', 'ri')),
  CONSTRAINT documentos_formato_valido CHECK (formato IN ('pdf', 'html', 'xml', 'zip', 'ole', 'rtf', 'gzip', 'json', 'text', 'outro')),
  CONSTRAINT documentos_status_parse_valido CHECK (status_parse IN ('pendente', 'ok', 'falhou', 'nao_suportado')),
  CONSTRAINT documentos_hash_formato CHECK (hash_conteudo IS NULL OR hash_conteudo ~ '^[a-f0-9]{64}$'),
  CONSTRAINT documentos_fonte_id_unico UNIQUE (fonte, source_document_id)
);

-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ativos_issuer ON biblioteca.ativos (issuer_id) WHERE ativo;

-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_documentos_issuer_data ON biblioteca.documentos (issuer_id, data_documento DESC);

-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_documentos_categoria ON biblioteca.documentos (categoria);

-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_documentos_status_parse ON biblioteca.documentos (status_parse, data_ingestao);

-- statement-breakpoint
INSERT INTO biblioteca.schema_migrations (version)
VALUES ('001_biblioteca_b1')
ON CONFLICT (version) DO NOTHING;
