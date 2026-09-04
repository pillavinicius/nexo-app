function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function displayNumber(value, maximumFractionDigits = 2, locale = "pt-BR", useGrouping = false) {
  const number = finite(value);
  if (number === null) return "";
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits,
    useGrouping,
  }).format(number);
}

export function displayInputNumber(value, currency = "BRL") {
  return displayNumber(value, 2, currency === "USD" ? "en-US" : "pt-BR");
}

export function displayMoney(value, currency = "BRL") {
  const number = finite(value);
  if (number === null) return "";
  const code = String(currency || "BRL").toUpperCase();
  const locale = code === "USD" ? "en-US" : "pt-BR";
  const amount = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(number);
  return code === "BRL" ? `R$ ${amount}` : `${code} ${amount}`;
}

export function monthYear(value) {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(value || ""));
  return match ? `${match[2]}/${match[1].slice(2)}` : "";
}

export function assetPrefill(payload) {
  const asset = payload?.asset || {};
  const derived = payload?.derived || {};
  const currency = asset.currency || "BRL";
  return {
    currentPrice: displayInputNumber(asset.price ?? derived.currentPrice, currency),
    currency: asset.currency || "",
    histMin: displayInputNumber(derived.minPrice, currency),
    histMinDate: monthYear(derived.minDate),
    histMax: displayInputNumber(derived.maxPrice, currency),
    histMaxDate: monthYear(derived.maxDate),
  };
}

export function compactAssetContext(payload) {
  if (!payload?.ok) return null;
  const asset = payload.asset || {};
  const indicators = payload.keyIndicators || {};
  const derived = payload.derived || {};
  const advanced = payload.derivedAdvanced || {};
  const metrics = payload.nexoMetrics || {};
  return {
    ticker: payload.requestedTicker || asset.ticker || asset.symbol || null,
    route: payload.route || null,
    provider: asset.dataProvider || asset.source || null,
    name: asset.name || asset.fullName || null,
    assetType: asset.assetType || null,
    currency: asset.currency || null,
    price: asset.price ?? derived.currentPrice ?? null,
    changePercent: asset.changePercent ?? null,
    updatedAt: asset.updatedAt || payload.updatedAt || null,
    market: {
      open: asset.market?.open ?? null,
      high: asset.market?.high ?? null,
      low: asset.market?.low ?? null,
      volume: asset.market?.volume ?? null,
    },
    indicators: {
      pe: indicators.pe ?? null,
      pb: indicators.pb ?? null,
      evEbitda: indicators.evEbitda ?? null,
      dividendYieldPercent: indicators.dividendYieldPercent ?? null,
      roe: indicators.roe ?? null,
      roic: indicators.roic ?? null,
      netDebtToEbitda: indicators.netDebtToEbitda ?? null,
    },
    history: {
      firstDate: derived.firstDate ?? null,
      lastDate: derived.lastDate ?? null,
      minPrice: derived.minPrice ?? null,
      minDate: derived.minDate ?? null,
      maxPrice: derived.maxPrice ?? null,
      maxDate: derived.maxDate ?? null,
      returnPercent: derived.returnPercent ?? null,
      averageFinancialVolume: derived.averageFinancialVolume ?? null,
    },
    risk: {
      volatility90dAnnualizedPercent: advanced.volatility90dAnnualizedPercent ?? null,
      maxDrawdownPercent: advanced.maxDrawdownPercent ?? null,
      sharpeRatio: advanced.sharpeRatio ?? null,
      sortinoRatio: advanced.sortinoRatio ?? null,
      cagrPercent: advanced.cagrPercent ?? null,
      liquidityHint: metrics.liquidityHint ?? null,
    },
  };
}
