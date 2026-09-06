ALTER TABLE biblioteca.documentos
  ADD COLUMN IF NOT EXISTS parser_version TEXT,
  ADD COLUMN IF NOT EXISTS data_parse TIMESTAMPTZ;

-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_documentos_contexto
  ON biblioteca.documentos (issuer_id, status_parse, data_documento DESC);

-- statement-breakpoint
INSERT INTO biblioteca.schema_migrations (version)
VALUES ('003_biblioteca_b3')
ON CONFLICT (version) DO NOTHING;
