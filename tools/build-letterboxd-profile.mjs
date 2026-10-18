/**
 * Build the bundled Letterboxd profile from a raw Letterboxd export.
 *
 * Run: node tools/build-letterboxd-profile.mjs
 * Reads:  letterboxd export dir (profile.csv, ratings.csv, diary.csv,
//         watchlist.csv, reviews.csv — first matching directory wins)
 * Writes: shared/letterboxd-data.js  (generated — do not hand-edit)
 *
 * The generated file embeds ONLY film metadata (titles/years/ratings/dates).
 * Re-run after each new Letterboxd export, then reload the extension.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function findExportDir() {
  const hits = readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.toLowerCase().startsWith("letterboxd-"))
    .map((d) => d.name);
  if (!hits.length) throw new Error("No letterboxd-* export directory found next to tools/.");
  return join(ROOT, hits[0]);
}

/** Minimal CSV parser: handles quotes, escaped quotes, commas, newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else if (c === "\r") {
      // skip
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift().map((h) => h.trim());
  return rows
    .filter((r) => r.some((cell) => String(cell ?? "").trim() !== ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

function readCsv(dir, name) {
  try {
    return parseCsv(readFileSync(join(dir, name), "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return [];
  }
}

function num(v) {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
function int(v) {
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}
function uriKey(uri) {
  const m = String(uri || "").match(/boxd\.it\/([A-Za-z0-9]+)/);
  return m ? m[1] : String(uri || "").trim();
}

const DIR = findExportDir();
console.log("Export dir:", DIR);

const profileRows = readCsv(DIR, "profile.csv");
const ratingRows = readCsv(DIR, "ratings.csv");
const diaryRows = readCsv(DIR, "diary.csv");
const watchlistRows = readCsv(DIR, "watchlist.csv");
const reviewRows = readCsv(DIR, "reviews.csv");

const profile = profileRows[0] || {};
const favUris = (profile["Favorite Films"] || "")
  .split(",").map((s) => uriKey(s)).filter(Boolean);

const ratings = ratingRows
  .filter((r) => r.Name)
  .map((r) => ({ title: r.Name, year: int(r.Year), rating: num(r.Rating), uri: uriKey(r["Letterboxd URI"]), date: r.Date || null }));

const byUri = new Map();
for (const r of ratings) if (r.uri) byUri.set(r.uri, r);
for (const d of diaryRows) {
  const k = uriKey(d["Letterboxd URI"]);
  if (k && !byUri.has(k) && d.Name) byUri.set(k, { title: d.Name, year: int(d.Year), rating: num(d.Rating), uri: k, date: d.Date || null });
}
for (const w of watchlistRows) {
  const k = uriKey(w["Letterboxd URI"]);
  if (k && !byUri.has(k) && w.Name) byUri.set(k, { title: w.Name, year: int(w.Year), rating: null, uri: k, date: w.Date || null });
}

const reviewsByTitle = new Map();
for (const r of reviewRows) {
  if (!r.Name || !r.Review) continue;
  reviewsByTitle.set(`${r.Name}|||${r.Year || ""}`, r.Review.slice(0, 280));
}

const diary = diaryRows
  .filter((d) => d.Name)
  .map((d) => ({
    title: d.Name,
    year: int(d.Year),
    rating: num(d.Rating),
    rewatch: /^yes$/i.test(d.Rewatch || ""),
    watchedDate: d["Watched Date"] || d.Date || null,
    review: reviewsByTitle.get(`${d.Name}|||${d.Year || ""}`) || null,
  }));

const watchlist = watchlistRows
  .filter((w) => w.Name)
  .map((w) => ({ title: w.Name, year: int(w.Year), uri: uriKey(w["Letterboxd URI"]), addedDate: w.Date || null }));

const ratedTitles = new Set(ratings.map((r) => `${r.title}|||${r.year ?? ""}`));
const watchlistFresh = watchlist.filter((w) => !ratedTitles.has(`${w.title}|||${w.year ?? ""}`));

const favorites = favUris.map((u) => {
  const hit = byUri.get(u);
  return hit ? { title: hit.title, year: hit.year, rating: hit.rating } : { title: u, year: null, rating: null };
});

const rated = ratings.filter((r) => r.rating != null);
const avg = rated.length ? rated.reduce((s, r) => s + r.rating, 0) / rated.length : null;
const fiveStar = rated.filter((r) => r.rating >= 4.5).length;
const rewatches = diary.filter((d) => d.rewatch);
const lowRated = [...rated].sort((a, b) => a.rating - b.rating).slice(0, 6);
const decades = {};
for (const r of rated) {
  if (r.year == null) continue;
  const d = `${Math.floor(r.year / 10) * 10}s`;
  decades[d] = (decades[d] || 0) + 1;
}
const topDecade = Object.entries(decades).sort((a, b) => b[1] - a[1])[0];

const given = (profile["Given Name"] || "").trim();
const family = (profile["Family Name"] || "").trim();

const data = {
  generatedAt: new Date().toISOString().slice(0, 10),
  source: "letterboxd-export",
  user: {
    username: profile.Username || "fxwyz",
    name: [given, family].filter(Boolean).join(" ") || profile.Username || "Me",
    location: profile.Location || null,
    bio: (profile.Bio || "").replace(/<[^>]*>/g, "").trim() || null,
    memberSince: profile["Date Joined"] || null,
  },
  stats: {
    rated: rated.length,
    avgRating: avg != null ? Math.round(avg * 100) / 100 : null,
    fiveStar,
    diaryCount: diary.length,
    rewatchCount: rewatches.length,
    watchlistCount: watchlistFresh.length,
    topDecade: topDecade ? `${topDecade[0]} (${topDecade[1]})` : null,
  },
  favorites,
  ratings,
  diary,
  watchlist: watchlistFresh,
  mostWatched: rewatches.map((d) => ({
    title: d.title,
    year: d.year,
    why: `Rewatched${d.rating != null ? ` · your ${d.rating}★` : ""}`,
  })),
  coldSpots: lowRated.map((r) => ({ title: r.title, year: r.year, rating: r.rating })),
};

const outPath = join(ROOT, "shared", "letterboxd-data.js");
const payload = JSON.stringify(data);
writeFileSync(
  outPath,
  `/** GENERATED by tools/build-letterboxd-profile.mjs — do not hand-edit.\n * Source: Letterboxd export (${data.generatedAt}). Re-run the builder\n * after each new export, then reload the extension.\n */\nglobalThis.CineGraphLetterboxdData = ${payload};\nif (typeof module !== "undefined" && module.exports) module.exports = globalThis.CineGraphLetterboxdData;\n`
);

console.log(`Wrote shared/letterboxd-data.js (${(payload.length / 1024).toFixed(1)} KB)`);
console.log(`User: ${data.user.name} (@${data.user.username}) · rated=${data.stats.rated} avg=${data.stats.avgRating} fiveStar=${fiveStar} diary=${diary.length} rewatches=${rewatches.length} watchlistFresh=${watchlistFresh.length}`);
console.log("Favorites:", favorites.map((f) => `${f.title} (${f.year})`).join(" · "));
console.log("Cold spots:", lowRated.map((r) => `${r.title} ${r.rating}★`).join(" · "));
console.log("Top decade:", data.stats.topDecade);
