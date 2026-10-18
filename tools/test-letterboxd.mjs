/**
 * Letterboxd profile + provider tests (no Chrome, no network).
 * Run: node tools/test-letterboxd.mjs
 *
 * Guards: real user data loads, exact-rating verdicts win, franchise and
 * cold-spot logic cite real films, watchlist ranking works, and nothing
 * renders mock/demo placeholders.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

function load(files) {
  const ctx = { chrome: undefined };
  vm.createContext(ctx);
  for (const f of files) {
    vm.runInContext(readFileSync(new URL(f, import.meta.url), "utf8"), ctx);
  }
  return ctx;
}

const ctx = load([
  "../shared/letterboxd-data.js",
  "../shared/letterboxd-profile.js",
  "../scoring/letterboxd-provider.js",
]);

const D = ctx.CineGraphLetterboxdData;
const P = ctx.CineGraphLetterboxdProfile;
let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

ok("bundled library loads with real user", () => {
  assert.equal(D.user.username, "fxwyz");
  assert.equal(D.user.name, "Fawaz Malik");
  assert.ok(D.ratings.length >= 100, `ratings=${D.ratings.length}`);
  assert.ok(D.watchlist.length >= 300, `watchlist=${D.watchlist.length}`);
  assert.equal(D.favorites.length, 4);
  assert.ok(D.favorites.every((f) => f.title && f.year), "favorites resolved");
});

ok("favorites are the real Letterboxd picks", () => {
  const titles = D.favorites.map((f) => f.title);
  for (const t of ["Veer-Zaara", "Cars 2", "Barakamon", "F1"]) {
    assert.ok(titles.includes(t), `missing favorite ${t}`);
  }
});

ok("own 5-star rating scores Strong with real reason", () => {
  const s = P.scoreTitle("The Dark Knight", 2008);
  assert.equal(s.band, "Strong Match");
  assert.match(s.reason, /5★/);
  assert.match(s.reason, /Letterboxd/);
});

ok("own low rating scores Weak", () => {
  const s = P.scoreTitle("The Marvels", 2023);
  assert.equal(s.band, "Weak Match");
  assert.match(s.reason, /0\.5★/);
});

ok("rewatch is acknowledged", () => {
  const s = P.scoreTitle("Veer-Zaara", 2004);
  assert.equal(s.band, "Strong Match");
  assert.match(s.reason, /Rewatch|rewatch/);
});

ok("franchise of a loved film cites the real film", () => {
  const s = P.scoreTitle("Avengers: Doomsday", 2026);
  assert.ok(s.band === "Strong Match" || s.band === "Possible Match", s.band);
  assert.match(s.reason, /Avengers/);
});

ok("no mock/demo wording anywhere in reasons", () => {
  for (const t of ["Dune", "Whiplash", "12 Angry Men", "Se7en", "The Godfather"]) {
    const s = P.scoreTitle(t);
    assert.doesNotMatch(s.reason, /demo|mock|placeholder|seeded/i, `${t}: ${s.reason}`);
  }
});

ok("watchlist ranking returns real unrated titles", () => {
  const ranked = P.rankWatchlist(8);
  assert.equal(ranked.length, 8);
  const rated = new Set(D.ratings.map((r) => `${r.title}|||${r.year ?? ""}`));
  for (const w of ranked) {
    assert.ok(!rated.has(`${w.title}|||${w.year ?? ""}`), `${w.title} already rated`);
    assert.ok(["Strong Match", "Possible Match", "Weak Match"].includes(w.band));
  }
});

ok("provider returns shaped results with is_demo=false", async () => {
  const resp = await ctx.CineGraphLetterboxdProvider.score({
    titles: [
      { raw_title: "Inception", year: 2010 },
      { raw_title: "Whiplash", year: 2014 },
      { raw_title: "x", year: null },
    ],
  });
  assert.equal(resp.results.length, 2);
  assert.equal(JSON.stringify([...resp.unresolved]), JSON.stringify(["x"]));
  for (const r of resp.results) {
    assert.equal(r.is_demo, false);
    assert.ok(r.reason && r.reason.length > 10);
  }
  const inception = resp.results.find((r) => r.raw_title === "Inception");
  assert.equal(inception.band, "Strong Match");
});

ok("tasteDNA is factual stats, not invented traits", () => {
  const dna = P.tasteDNA();
  const blob = JSON.stringify(dna);
  assert.doesNotMatch(blob, /Psychological tension|World-building|Nonlinear/i);
  assert.match(blob, /111|rated/);
});

console.log(`\nAll ${passed} letterboxd tests passed.`);
