export const ASSET_LOOKUP_STATUS = Object.freeze({
  IDLE: "idle",
  LOADING: "loading",
  FOUND: "found",
  NOT_FOUND: "not_found",
  UNAVAILABLE: "unavailable",
  MANUAL_FALLBACK: "manual_fallback",
});

export const ASSET_LOOKUP_ERROR = Object.freeze({
  TICKER_NOT_FOUND: "TICKER_NOT_FOUND",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  AUTOMATIC_DATA_UNAVAILABLE: "AUTOMATIC_DATA_UNAVAILABLE",
});

const NOT_FOUND_PATTERN =
  /(?:ticker|symbol|s[ií]mbolo|ativo).{0,40}(?:not found|invalid|inexistente|n[aã]o encontrado)|(?:not found|invalid symbol|no data|no results|sem results|lista vazia)/i;

function normalizedAttempt(attempt = {}) {
  const status = Number(attempt.status);
  return {
    status: Number.isFinite(status) ? status : 0,
    message: String(attempt.message || attempt.error || "").trim(),
  };
}

export function classifyProviderLookupAttempts(attempts = []) {
  const rows = attempts.map(normalizedAttempt);
  const infrastructureFailure = rows.some(
    ({ status }) => status === 0 || [401, 403, 408, 429].includes(status) || status >= 500
  );
  const explicitNotFound = rows.some(({ message }) => NOT_FOUND_PATTERN.test(message));
  const successfulEmptyResult = rows.some(
    ({ status, message }) => status >= 200 && status < 300 && /sem results|no results|no data|lista vazia/i.test(message)
  );

  if (!infrastructureFailure && (explicitNotFound || successfulEmptyResult)) {
    return ASSET_LOOKUP_STATUS.NOT_FOUND;
  }

  return ASSET_LOOKUP_STATUS.UNAVAILABLE;
}

export function assetLookupFailurePayload({ ticker, route, attempts = [], status } = {}) {
  const resolvedStatus = status || classifyProviderLookupAttempts(attempts);
  const notFound = resolvedStatus === ASSET_LOOKUP_STATUS.NOT_FOUND;

  return {
    ok: false,
    requestedTicker: ticker || "",
    route: route || null,
    tickerExists: notFound ? false : null,
    manualFallback: false,
    lookupStatus: resolvedStatus,
    errorCode: notFound
      ? ASSET_LOOKUP_ERROR.TICKER_NOT_FOUND
      : ASSET_LOOKUP_ERROR.PROVIDER_UNAVAILABLE,
    error: notFound
      ? "Ticker inexistente"
      : "Não foi possível validar o ticker porque o provedor automático está indisponível",
  };
}

export function resolveAssetLookupState({ responseOk, data, hasAutomaticPrice } = {}) {
  if (data?.tickerExists === false || data?.errorCode === ASSET_LOOKUP_ERROR.TICKER_NOT_FOUND) {
    return ASSET_LOOKUP_STATUS.NOT_FOUND;
  }

  if (responseOk && data?.ok) {
    if (hasAutomaticPrice) return ASSET_LOOKUP_STATUS.FOUND;
    return data?.tickerExists === true
      ? ASSET_LOOKUP_STATUS.MANUAL_FALLBACK
      : ASSET_LOOKUP_STATUS.UNAVAILABLE;
  }

  if (data?.tickerExists === true && data?.manualFallback === true) {
    return ASSET_LOOKUP_STATUS.MANUAL_FALLBACK;
  }

  return ASSET_LOOKUP_STATUS.UNAVAILABLE;
}
