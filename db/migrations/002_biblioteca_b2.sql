ALTER TABLE biblioteca.documentos
  ADD COLUMN IF NOT EXISTS conteudo_binario BYTEA,
  ADD COLUMN IF NOT EXISTS tamanho_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS content_type_declarado TEXT,
  ADD COLUMN IF NOT EXISTS data_download TIMESTAMPTZ;

-- statement-breakpoint
CREATE TABLE IF NOT EXISTS biblioteca.ingestion_runs (
  run_id             TEXT PRIMARY KEY,
  fonte              TEXT NOT NULL,
  iniciado_em        TIMESTAMPTZ NOT NULL,
  concluido_em       TIMESTAMPTZ,
  status             TEXT NOT NULL,
  descobertos        INTEGER NOT NULL DEFAULT 0,
  ja_existentes      INTEGER NOT NULL DEFAULT 0,
  baixados           INTEGER NOT NULL DEFAULT 0,
  inseridos          INTEGER NOT NULL DEFAULT 0,
  falhas             INTEGER NOT NULL DEFAULT 0,
  bytes_baixados     BIGINT NOT NULL DEFAULT 0,
  dedup_provada      BOOLEAN NOT NULL DEFAULT FALSE,
  detalhes_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT ingestion_runs_fonte_valida CHECK (fonte IN ('cvm_ipe')),
  CONSTRAINT ingestion_runs_status_valido CHECK (status IN ('executando', 'ok', 'falhou'))
);

-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_fonte_data
  ON biblioteca.ingestion_runs (fonte, iniciado_em DESC);

-- statement-breakpoint
INSERT INTO biblioteca.schema_migrations (version)
VALUES ('002_biblioteca_b2')
ON CONFLICT (version) DO NOTHING;
