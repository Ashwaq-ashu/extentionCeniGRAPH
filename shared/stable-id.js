/**
 * Stable title identity — shared by page bridge, worker, and tests.
 * Key rule: catalogue ID wins when available; otherwise slug(title)+year.
 * Never merges different movies just because titles look similar.
 */

(function () {
  function slugTitle(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }

  function normalizeYear(y) {
    if (y == null || y === "") return null;
    const n = Number.parseInt(String(y), 10);
    return Number.isFinite(n) ? n : null;
  }

  function stableKey({ catalogue_id, raw_title, year }) {
    if (catalogue_id != null && String(catalogue_id).trim() !== "") {
      return `id:${String(catalogue_id).trim()}`;
    }
    const slug = slugTitle(raw_title);
    const yy = normalizeYear(year);
    return yy != null ? `t:${slug}#${yy}` : `t:${slug}`;
  }

  function normalizeRecord(entry) {
    const raw_title = String(entry?.raw_title || "").trim().replace(/\s+/g, " ");
    const year = normalizeYear(entry?.year);
    const catalogue_id =
      entry?.catalogue_id != null && String(entry.catalogue_id).trim() !== ""
        ? String(entry.catalogue_id).trim()
        : null;
    return {
      raw_title,
      year,
      catalogue_id,
      source: entry?.source || null,
      pageMeta: entry?.pageMeta || null,
      id: stableKey({ catalogue_id, raw_title, year }),
    };
  }

  /** Dedupe within a single scan by stable key (keeps first occurrence). */
  function dedupeWithinScan(records) {
    const seen = new Set();
    const out = [];
    for (const r of records || []) {
      const n = normalizeRecord(r);
      if (!n.raw_title) continue;
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push(n);
    }
    return out;
  }

  /**
   * Diff a fresh detection against the previous scan.
   * Returns { fresh, added, removed, kept } as arrays of records/keys.
   */
  function diffScans(freshRecords, prevRecords) {
    const fresh = dedupeWithinScan(freshRecords);
    const prev = dedupeWithinScan(prevRecords);
    const prevKeys = new Set(prev.map((r) => r.id));
    const freshKeys = new Set(fresh.map((r) => r.id));
    return {
      fresh,
      added: fresh.filter((r) => !prevKeys.has(r.id)),
      removed: prev.filter((r) => !freshKeys.has(r.id)),
      kept: fresh.filter((r) => prevKeys.has(r.id)),
    };
  }

  const api = { slugTitle, normalizeYear, stableKey, normalizeRecord, dedupeWithinScan, diffScans };
  if (typeof globalThis !== "undefined") globalThis.CineGraphStableId = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
