/**
 * Shared scoring client for content scripts and extension pages.
 * Default `mode` is "local": scores on-device against the bundled
 * Letterboxd library. Swap to "api" when the backend URL is confirmed.
 */

globalThis.CineGraphScoringClient = (() => {
  const DEFAULT_CONFIG = {
    mode: "local",
    baseUrl: null,
    profileToken: null,
    region: "IN",
  };

  function getConfig() {
    const fromWindow = globalThis.CineGraphScoringConfig || {};
    return { ...DEFAULT_CONFIG, ...fromWindow };
  }

  function normalizeYear(year) {
    if (year == null || year === "") {
      return null;
    }
    const parsed = Number.parseInt(String(year), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizePayload(payload) {
    const titles = (payload?.titles || []).map((entry) => ({
      raw_title: String(entry.raw_title || "").trim(),
      year: normalizeYear(entry.year),
      source: entry.source || null,
      pageMeta: entry.pageMeta || null,
    }));

    return {
      profile_token: payload?.profile_token || getConfig().profileToken,
      region: payload?.region || getConfig().region,
      titles: titles.filter((entry) => entry.raw_title),
    };
  }

  function validateScoreResponse(data) {
    if (!data || typeof data !== "object") {
      throw new Error("Invalid scoring response shape.");
    }

    const results = Array.isArray(data.results) ? data.results : [];
    const unresolved = Array.isArray(data.unresolved) ? data.unresolved : [];

    return { results, unresolved };
  }

  function normalizeUnresolved(unresolved) {
    return (unresolved || []).map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }
      if (entry && typeof entry.raw_title === "string") {
        return entry.raw_title;
      }
      return String(entry ?? "").trim();
    }).filter(Boolean);
  }

  async function scoreViaApi(payload) {
    const config = getConfig();
    const baseUrl = config.baseUrl;

    if (!baseUrl) {
      throw new Error(
        "Scoring API is not configured. Set scoringSettings.baseUrl in extension storage when the backend is ready."
      );
    }

    if (!payload.profile_token) {
      throw new Error(
        "Profile token is required for API scoring. Configure scoringSettings.profileToken after your team confirms auth."
      );
    }

    const headers = {
      "Content-Type": "application/json",
    };

    if (config.authHeaderName && config.authHeaderValue) {
      headers[config.authHeaderName] = config.authHeaderValue;
    }

    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/extension/score`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const detail = response.status === 429
        ? "Rate limit reached. Try again later."
        : `Scoring API error (${response.status}).`;
      throw new Error(detail);
    }

    const parsed = validateScoreResponse(await response.json());
    return {
      results: parsed.results,
      unresolved: normalizeUnresolved(parsed.unresolved),
    };
  }

  async function score(payload) {
    const normalized = normalizePayload(payload);
    const config = getConfig();

    if (!normalized.titles.length) {
      return { results: [], unresolved: [] };
    }

    if (config.mode === "api") {
      return scoreViaApi(normalized);
    }

    const provider = globalThis.CineGraphLetterboxdProvider;
    if (!provider?.score) {
      throw new Error("Letterboxd profile provider is not loaded.");
    }

    const response = await provider.score(normalized);
    return validateScoreResponse(response);
  }

  function isDemoMode() {
    // Legacy mock mode only. "local" (Letterboxd) scores are real and
    // render without the Demo prefix.
    return getConfig().mode === "dev-mock";
  }

  return {
    score,
    isDemoMode,
    normalizePayload,
    validateScoreResponse,
  };
})();
