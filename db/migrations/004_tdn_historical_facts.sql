CREATE TABLE IF NOT EXISTS biblioteca.fatos_financeiros (
  fact_id             BIGSERIAL PRIMARY KEY,
  issuer_id           TEXT NOT NULL REFERENCES biblioteca.emissores(issuer_id) ON DELETE RESTRICT,
  metrica             TEXT NOT NULL,
  periodo_inicio      DATE,
  periodo_fim         DATE NOT NULL,
  exercicio           INTEGER NOT NULL,
  valor               NUMERIC NOT NULL,
  unidade             TEXT NOT NULL,
  escopo              TEXT NOT NULL DEFAULT 'consolidado',
  versao_documento    INTEGER NOT NULL DEFAULT 1,
  conhecido_em        DATE NOT NULL,
  fonte               TEXT NOT NULL,
  referencia_fonte    TEXT NOT NULL,
  substitui_fact_id   BIGINT REFERENCES biblioteca.fatos_financeiros(fact_id) ON DELETE SET NULL,
  metadata_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fatos_metrica_valida CHECK (metrica IN ('revenue', 'gross_profit', 'operating_income', 'current_assets', 'current_liabilities')),
  CONSTRAINT fatos_escopo_valido CHECK (escopo IN ('consolidado', 'individual')),
  CONSTRAINT fatos_unidade_valida CHECK (unidade IN ('BRL', 'BRL_thousands')),
  CONSTRAINT fatos_versao_positiva CHECK (versao_documento > 0),
  CONSTRAINT fatos_referencia_unica UNIQUE (issuer_id, metrica, periodo_fim, escopo, versao_documento, referencia_fonte)
);

-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_fatos_financeiros_point_in_time
  ON biblioteca.fatos_financeiros (issuer_id, exercicio, metrica, conhecido_em DESC, versao_documento DESC);

-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_fatos_financeiros_fonte
  ON biblioteca.fatos_financeiros (fonte, referencia_fonte);

-- statement-breakpoint
INSERT INTO biblioteca.schema_migrations (version)
VALUES ('004_tdn_historical_facts')
ON CONFLICT (version) DO NOTHING;
