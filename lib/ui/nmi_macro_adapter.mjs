function finite(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
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
