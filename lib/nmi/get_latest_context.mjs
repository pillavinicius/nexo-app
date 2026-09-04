import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  checkCompatibility,
  CONTRACT_VERSION,
  validateContextPackage,
} from "./nexo_context_validator.mjs";

function unavailable(reason, details = {}) {
  return {
    ok: false,
    status: "unavailable",
    reason,
    ...details,
  };
}

export function getLatestContext({
  consumerVersion = CONTRACT_VERSION,
  readContextFile,
} = {}) {
  let content;

  try {
    content = readContextFile
      ? readContextFile()
      : readFileSync(join(process.cwd(), "data", "context", "latest.json"), "utf8");
  } catch (error) {
    return unavailable("missing_or_unreadable", { error: error.message });
  }

  let contextPackage;

  try {
    contextPackage = JSON.parse(content);
  } catch (error) {
    return unavailable("invalid_json", { error: error.message });
  }

  const compatibility = checkCompatibility(
    contextPackage?.contextSchemaVersion,
    consumerVersion
  );

  if (compatibility.status === "incompatible") {
    return unavailable("incompatible_contract", { compatibility });
  }

  const validation = validateContextPackage(contextPackage);

  if (!validation.ok) {
    return unavailable("contract_invalid", {
      errors: validation.errors,
      compatibility,
    });
  }

  return {
    ok: true,
    status: contextPackage.is_seed_mode ? "seed" : "available",
    contextPackage,
    meta: {
      contextId: contextPackage.context_id,
      schemaVersion: contextPackage.contextSchemaVersion,
      compatibility: compatibility.status,
      compatibilityReason: compatibility.reason || null,
      isSeedMode: validation.isSeedMode,
      marketCloseDate: contextPackage.market_close_date,
      runType: contextPackage.run_type,
      overallConfidence: contextPackage.quality.overall_confidence,
    },
  };
}

function formatValue(value, unit) {
  if (value === null || value === undefined) return "indisponível";

  if (unit === "fraction_of_gdp") {
    return `${(value * 100).toFixed(2)}% do PIB`;
  }

  if (unit === "percent_per_year") return `${value.toFixed(2)}% a.a.`;
  if (unit === "percent_12m") return `${value.toFixed(2)}% em 12 meses`;
  return String(value);
}

export function buildNmiPromptContext(result) {
  if (!result?.ok) {
    return [
      "CONTEXTO NMI: INDISPONÍVEL",
      `Motivo técnico: ${result?.reason || "não informado"}.`,
      "Não invente, presuma ou substitua valores macroeconômicos ausentes.",
      "Prossiga apenas com os demais dados disponíveis e sinalize a limitação quando relevante.",
    ].join("\n");
  }

  const pkg = result.contextPackage;
  const observations = pkg.source_observations || {};
  const lines = [
    `CONTEXTO NMI VALIDADO — ${result.status === "seed" ? "SEMENTE" : "DISPONÍVEL"}`,
    `Context ID: ${pkg.context_id}`,
    `Contrato: ${pkg.contextSchemaVersion} (${result.meta.compatibility})`,
    `Data de mercado: ${pkg.market_close_date}; execução: ${pkg.run_type}`,
    `Regime: ${pkg.regime.label}; convicção: ${(pkg.regime.conviction_score * 100).toFixed(2)}%`,
    `Confiança global: ${(pkg.quality.overall_confidence * 100).toFixed(2)}%`,
  ];

  for (const [name, label] of [
    ["selic_target", "Selic meta"],
    ["ipca_12m", "IPCA 12m"],
    ["credit_gdp", "Crédito/PIB"],
  ]) {
    const observation = observations[name];
    if (!observation) {
      lines.push(`${label}: indisponível (sem observação vinculada)`);
      continue;
    }

    lines.push(
      `${label}: ${formatValue(observation.value, observation.unit)}; ` +
        `status=${observation.status}; fonte=${observation.provider}/${observation.series_code}; ` +
        `observado_em=${observation.observed_at || "indisponível"}`
    );
  }

  const unavailableSources = Object.entries(pkg.source_watermarks || {})
    .filter(([, watermark]) => watermark.status === "unavailable")
    .map(([source]) => source);

  if (unavailableSources.length) {
    lines.push(`Fontes indisponíveis: ${unavailableSources.join(", ")}.`);
  }

  if (Array.isArray(pkg.alerts) && pkg.alerts.length) {
    lines.push(
      "Alertas ativos: " +
        pkg.alerts
          .filter((alert) => alert.state === "active")
          .map((alert) => `${alert.code} (${alert.severity})`)
          .join(", ")
    );
  }

  if (result.status === "seed") {
    lines.push(
      "REGRA DE SEED: use apenas como referência de teste; não alimente score, veto ou veredito."
    );
  }

  lines.push(
    "REGRAS DE CONSUMO: null significa indisponível, nunca zero. Não sintetize campos ausentes. " +
      "Em conflito com um dado macro automático do contexto da interface, priorize o NMI validado. " +
      "Valor macro digitado pelo usuário deve ser tratado como hipótese de cenário e o conflito deve ser sinalizado. " +
      "Use o NMI como contexto transversal; ele não substitui dados específicos do ativo nem determina sozinho o veredito."
  );

  return lines.join("\n");
}
