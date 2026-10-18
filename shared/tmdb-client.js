/**
 * CineGraph TMDB metadata client (shared: service worker + extension pages).
 * TMDB supplies metadata only (poster, overview, rating, year, genres) —
 * taste bands still come from the local scorer / backend scorer.
 *
 * Auth: supports TMDB v3 api_key OR v4 read token (JWT, starts with "eyJ").
 * Key is stored in chrome.storage.local under `tmdbSettings.apiKey` and is
 * never logged or included in payload summaries.
 */

globalThis.CineGraphTmdb = (() => {
  const API_BASE = "https://api.themoviedb.org/3";
  const IMG_BASE = "https://image.tmdb.org/t/p";
  const CACHE_KEY = "tmdbCache";
  const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  const SETTINGS_KEY = "tmdbSettings";

  function isJwt(token) {
    return typeof token === "string" && token.startsWith("eyJ") && token.split(".").length === 3;
  }

  async function getSettings() {
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        const s = await chrome.storage.local.get(SETTINGS_KEY);
        return s[SETTINGS_KEY] || {};
      }
    } catch { /* ignore */ }
    return {};
  }

  async function getApiKey() {
    const s = await getSettings();
    const k = (s.apiKey || "").trim();
    return k || null;
  }

  async function isConfigured() {
    return Boolean(await getApiKey());
  }

  function buildUrl(path, apiKey, params = {}) {
    const url = new URL(API_BASE + path);
    if (!isJwt(apiKey)) {
      url.searchParams.set("api_key", apiKey);
    }
    url.searchParams.set("language", "en-US");
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== "") url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  function authHeaders(apiKey) {
    // v4 read token uses Bearer auth; v3 key goes in query string.
    if (isJwt(apiKey)) return { Authorization: `Bearer ${apiKey}` };
    return {};
  }

  async function tmdbFetch(path, apiKey, params = {}) {
    const res = await fetch(buildUrl(path, apiKey, params), {
      headers: { Accept: "application/json", ...authHeaders(apiKey) },
    });
    if (res.status === 401) throw new Error("TMDB key rejected (401). Check your API key.");
    if (res.status === 429) throw new Error("TMDB rate limit reached. Try again in a few seconds.");
    if (!res.ok) throw new Error(`TMDB error (${res.status}).`);
    return res.json();
  }

  // -- Cache (chrome.storage.local, best-effort) ---------------------------
  async function readCache() {
    try {
      const s = await chrome.storage.local.get(CACHE_KEY);
      return s[CACHE_KEY] && typeof s[CACHE_KEY] === "object" ? s[CACHE_KEY] : {};
    } catch { return {}; }
  }

  async function writeCache(cache) {
    try {
      // Cap size: keep newest ~300 entries.
      const keys = Object.keys(cache);
      if (keys.length > 300) {
        const sorted = keys.sort((a, b) => (cache[b].cachedAt || 0) - (cache[a].cachedAt || 0));
        const trimmed = {};
        for (const k of sorted.slice(0, 300)) trimmed[k] = cache[k];
        cache = trimmed;
      }
      await chrome.storage.local.set({ [CACHE_KEY]: cache });
    } catch { /* best-effort */ }
  }

  function cacheGet(cache, key) {
    const e = cache[key];
    if (!e) return null;
    if (Date.now() - (e.cachedAt || 0) > CACHE_TTL_MS) return null;
    return e.value;
  }

  // -- Normalizers ----------------------------------------------------------
  function imageUrl(path, size = "w342") {
    if (!path) return null;
    return `${IMG_BASE}/${size}${path}`;
  }

  function pickBestMatch(results, year) {
    if (!results?.length) return null;
    if (year != null) {
      const exact = results.find((r) => {
        const y = r.release_date ? Number.parseInt(r.release_date.slice(0, 4), 10) : null;
        return y === year;
      });
      if (exact) return exact;
    }
    // Prefer highest vote_count (most canonical), then popularity.
    return [...results].sort(
      (a, b) => (b.vote_count || 0) - (a.vote_count || 0) || (b.popularity || 0) - (a.popularity || 0)
    )[0];
  }

  function toMeta(details) {
    if (!details) return null;
    const year = details.release_date ? Number.parseInt(details.release_date.slice(0, 4), 10) : null;
    return {
      tmdb_id: details.id ?? null,
      title: details.title || details.name || null,
      original_title: details.original_title || details.original_name || null,
      year: Number.isFinite(year) ? year : null,
      release_date: details.release_date || details.first_air_date || null,
      overview: details.overview || null,
      poster: imageUrl(details.poster_path, "w342"),
      poster_small: imageUrl(details.poster_path, "w185"),
      backdrop: imageUrl(details.backdrop_path, "w780"),
      rating: typeof details.vote_average === "number" ? Math.round(details.vote_average * 10) / 10 : null,
      votes: details.vote_count ?? null,
      genres: Array.isArray(details.genres) ? details.genres.map((g) => g.name).filter(Boolean)
        : Array.isArray(details.genre_ids) ? details.genre_ids.map(String) : [],
      runtime: details.runtime ?? null,
      media_type: details.media_type || "movie",
    };
  }

  // -- Public API ------------------------------------------------------------
  async function searchTitle(rawTitle, year = null) {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error("TMDB API key is not set. Add it in the TMDB settings section.");
    const title = String(rawTitle || "").trim();
    if (!title) return null;
    const cache = await readCache();
    const ck = `search:${title.toLowerCase()}#${year ?? ""}`;
    const hit = cacheGet(cache, ck);
    if (hit) return hit;

    const data = await tmdbFetch("/search/movie", apiKey, {
      query: title,
      year: year ?? undefined,
      include_adult: "false",
      page: "1",
    });
    const best = pickBestMatch(data.results || [], year);
    let meta = null;
    if (best?.id) {
      // Hydrate with full details (genres, runtime) — also cached.
      try {
        meta = await getDetails(best.id);
      } catch {
        meta = toMeta(best);
      }
    }
    cache[ck] = { value: meta, cachedAt: Date.now() };
    await writeCache(cache);
    return meta;
  }

  async function getDetails(tmdbId) {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error("TMDB API key is not set.");
    const cache = await readCache();
    const ck = `movie:${tmdbId}`;
    const hit = cacheGet(cache, ck);
    if (hit) return hit;
    const data = await tmdbFetch(`/movie/${tmdbId}`, apiKey, {});
    const meta = toMeta(data);
    cache[ck] = { value: meta, cachedAt: Date.now() };
    await writeCache(cache);
    return meta;
  }

  async function getTrending(page = 1) {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error("TMDB API key is not set.");
    const data = await tmdbFetch("/trending/movie/week", apiKey, { page: String(page) });
    return (data.results || []).map(toMeta).filter(Boolean);
  }

  async function getPopular(page = 1) {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error("TMDB API key is not set.");
    const data = await tmdbFetch("/movie/popular", apiKey, { page: String(page) });
    return (data.results || []).map(toMeta).filter(Boolean);
  }

  /**
   * Enrich scored results with TMDB metadata. Never throws: per-title
   * failures resolve to `tmdb: null` so scoring still displays.
   * Concurrency-limited to stay under TMDB rate limits.
   */
  async function enrichResults(results, { concurrency = 4 } = {}) {
    const apiKey = await getApiKey().catch(() => null);
    if (!apiKey) return (results || []).map((r) => ({ ...r, tmdb: null }));
    const items = results || [];
    const out = new Array(items.length);
    let cursor = 0;
    async function worker() {
      while (cursor < items.length) {
        const i = cursor++;
        const r = items[i];
        try {
          const meta = await searchTitle(r.raw_title, r.year ?? null);
          out[i] = { ...r, tmdb: meta, year: r.year ?? meta?.year ?? null };
        } catch {
          out[i] = { ...r, tmdb: null };
        }
      }
    }
    const n = Math.min(concurrency, items.length || 1);
    await Promise.all(Array.from({ length: n }, worker));
    return out;
  }

  return {
    getApiKey,
    isConfigured,
    searchTitle,
    getDetails,
    getTrending,
    getPopular,
    enrichResults,
    imageUrl,
    SETTINGS_KEY,
  };
})();
