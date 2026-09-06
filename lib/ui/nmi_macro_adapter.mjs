function finite(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function promptItem(item) {
  if (!item) return "não informado";
  if (item.ok) {
    return `${item.value} (${item.source}${item.date ? " · " + item.date : ""})`;
  }
  return `não informado (${item.mode || "manual"})`;
}

export function buildComplementaryMacroContext({
  enabled = false,
  automatic = {},
  manual = {},
} = {}) {
  if (!enabled) {
    return "- Dados complementares habilitados: NÃO. Ignore campos complementares na análise.\n";
  }

  const automaticOrManual = (key, manualValue) =>
    manualValue || (automatic[key]?.ok ? automatic[key].value : "não informado");

  return (
    "- Dados complementares habilitados: SIM\n" +
    "- Selic diária: " + promptItem(automatic.selic_diaria) + "\n" +
    "- CDI diário: " + promptItem(automatic.cdi_diario) + "\n" +
    "- IPCA mensal: " + promptItem(automatic.ipca_mensal) + "\n" +
    "- USD PTAX: " + promptItem(automatic.usd_ptax) + "\n" +
    "- Fed Funds: " + promptItem(automatic.fed_funds) + "\n" +
    "- Ibovespa pontos: " + automaticOrManual("ibovespa_pontos", manual.ibov) + "\n" +
    "- S&P 500 pontos: " + automaticOrManual("sp500_pontos", manual.sp500) + "\n" +
    "- IFIX pontos: " + automaticOrManual("ifix_pontos", manual.ifix) + "\n" +
    "- P/L atual Ibovespa: " + (manual.plIbov || "não informado") + "\n" +
    "- P/L atual S&P 500: " + (manual.plSp500 || "não informado") + "\n" +
    "- Juros futuro Brasil: " + (manual.jurosFuturo || "não informado") + "\n"
  );
}

function observationItem(label, observation, { scale = 1 } = {}) {
  const rawValue = finite(observation?.value);
  const official = observation?.status === "official" && rawValue !== null;

  return {
    label,
    value: official ? rawValue * scale : null,
    date: observation?.observed_at || null,
    source: observation?.provider
      ? `NMI · ${observation.provider} ${observation.series_code}`
      : "NMI",
    ok: official,
    mode: official ? "automatic_validated" : "unavailable",
    unit: observation?.unit || null,
  };
}

export function nmiContextToMacroData(contextPackage) {
  if (!contextPackage || typeof contextPackage !== "object") return null;

  const observations = contextPackage.source_observations || {};
  const isSeedMode = contextPackage.is_seed_mode === true;
  const automatic = {
    selic_meta: observationItem("Selic Meta % a.a.", observations.selic_target),
    ipca_12m: observationItem("IPCA acumulado em 12 meses", observations.ipca_12m),
    credit_gdp: observationItem("Crédito/PIB", observations.credit_gdp, {
      scale: 100,
    }),
  };

  if (isSeedMode) {
    for (const item of Object.values(automatic)) {
      item.ok = false;
      item.value = null;
      item.mode = "seed_not_for_decision";
    }
  }

  return {
    ok: true,
    updated_at: contextPackage.as_of || null,
    nmi: {
      available: !isSeedMode,
      status: isSeedMode ? "seed" : "validated",
      contextId: contextPackage.context_id || null,
      schemaVersion: contextPackage.contextSchemaVersion || null,
      marketCloseDate: contextPackage.market_close_date || null,
      overallConfidence: contextPackage.quality?.overall_confidence ?? null,
      regimeLabel: contextPackage.regime?.label || null,
      regimeConviction: contextPackage.regime?.conviction_score ?? null,
      flowIntelligence: contextPackage.brazil?.flow_intelligence || null,
    },
    automatic,
  };
}

export function mergeMacroData(nmiData, supplementalData) {
  if (!nmiData) return supplementalData || null;
  if (!supplementalData) return nmiData;

  const validatedNmiItems = Object.fromEntries(
    Object.entries(nmiData.automatic || {}).filter(([, item]) => item?.ok)
  );

  return {
    ...supplementalData,
    nmi: nmiData.nmi,
    automatic: {
      ...(supplementalData.automatic || {}),
      ...validatedNmiItems,
    },
  };
}
