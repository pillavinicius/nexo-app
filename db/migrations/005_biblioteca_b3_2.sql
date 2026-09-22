CREATE TABLE IF NOT EXISTS biblioteca.documento_paginas (
  dedup_key      TEXT NOT NULL REFERENCES biblioteca.documentos(dedup_key) ON DELETE CASCADE,
  pagina         INTEGER NOT NULL,
  texto          TEXT NOT NULL,
  tabelas_json   JSONB NOT NULL DEFAULT '[]'::jsonb,
  hash_texto     TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (dedup_key, pagina),
  CONSTRAINT documento_paginas_numero_valido CHECK (pagina > 0),
  CONSTRAINT documento_paginas_hash_formato CHECK (hash_texto ~ '^[a-f0-9]{64}$')
);

-- statement-breakpoint
CREATE TABLE IF NOT EXISTS biblioteca.documento_binario_partes (
  dedup_key    TEXT NOT NULL REFERENCES biblioteca.documentos(dedup_key) ON DELETE CASCADE,
  parte        INTEGER NOT NULL,
  conteudo     BYTEA NOT NULL,
  tamanho_bytes INTEGER NOT NULL,
  hash_parte   TEXT NOT NULL,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (dedup_key, parte),
  CONSTRAINT documento_binario_partes_ordem_valida CHECK (parte >= 0),
  CONSTRAINT documento_binario_partes_tamanho_valido CHECK (tamanho_bytes > 0),
  CONSTRAINT documento_binario_partes_hash_formato CHECK (hash_parte ~ '^[a-f0-9]{64}$')
);

-- statement-breakpoint
CREATE TABLE IF NOT EXISTS biblioteca.documento_chunks (
  chunk_id          TEXT PRIMARY KEY,
  dedup_key         TEXT NOT NULL REFERENCES biblioteca.documentos(dedup_key) ON DELETE CASCADE,
  ordem             INTEGER NOT NULL,
  pagina_inicio     INTEGER NOT NULL,
  pagina_fim        INTEGER NOT NULL,
  secao             TEXT,
  texto             TEXT NOT NULL,
  tamanho_caracteres INTEGER NOT NULL,
  hash_texto        TEXT NOT NULL,
  parser_version    TEXT NOT NULL,
  search_vector     TSVECTOR GENERATED ALWAYS AS (to_tsvector('portuguese', coalesce(texto, ''))) STORED,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT documento_chunks_ordem_valida CHECK (ordem >= 0),
  CONSTRAINT documento_chunks_paginas_validas CHECK (pagina_inicio > 0 AND pagina_fim >= pagina_inicio),
  CONSTRAINT documento_chunks_tamanho_valido CHECK (tamanho_caracteres > 0),
  CONSTRAINT documento_chunks_hash_formato CHECK (hash_texto ~ '^[a-f0-9]{64}$'),
  CONSTRAINT documento_chunks_documento_ordem_unico UNIQUE (dedup_key, ordem)
);

-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_documento_paginas_documento
  ON biblioteca.documento_paginas (dedup_key, pagina);

-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_documento_binario_partes_documento
  ON biblioteca.documento_binario_partes (dedup_key, parte);

-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_documento_chunks_documento
  ON biblioteca.documento_chunks (dedup_key, ordem);

-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_documento_chunks_busca
  ON biblioteca.documento_chunks USING GIN (search_vector);

-- statement-breakpoint
INSERT INTO biblioteca.schema_migrations (version)
VALUES ('005_biblioteca_b3_2')
ON CONFLICT (version) DO NOTHING;
