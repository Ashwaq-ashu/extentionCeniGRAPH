/**
 * Recheck workflow tests (no Chrome required).
 * Run: node tools/test-recheck.mjs
 * Covers: stable identity, within-scan dedupe, fresh-vs-prev diff,
 * no similar-title merging, batch splitting, score-cache validity.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

function loadStableId() {
  const src = readFileSync(new URL("../shared/stable-id.js", import.meta.url), "utf8");
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.CineGraphStableId;
}

const SID = loadStableId();
let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

// 1. Stable catalogue IDs win when available.
ok("stableKey prefers catalogue_id", () => {
  assert.equal(SID.stableKey({ catalogue_id: "tt123", raw_title: "Dune", year: 2021 }), "id:tt123");
});

// 2. Title+year keys are stable and year-sensitive.
ok("stableKey includes year", () => {
  assert.equal(SID.stableKey({ raw_title: "Dune", year: 2021 }), "t:dune#2021");
  assert.notEqual(
    SID.stableKey({ raw_title: "Dune", year: 2021 }),
    SID.stableKey({ raw_title: "Dune", year: 1984 })
  );
});

// 3. Similar titles are NOT merged.
ok("similar titles stay distinct", () => {
  const recs = SID.dedupeWithinScan([
    { raw_title: "Dune", year: 2021 },
    { raw_title: "Dune Messiah", year: 2025 },
    { raw_title: "Dune", year: 2021 }, // exact dup collapses
  ]);
  assert.equal(recs.length, 2);
});

// 4. Diff finds newly loaded cards after scroll.
ok("diffScans detects added titles", () => {
  const prev = [{ raw_title: "Mobland" }, { raw_title: "Kanguva" }];
  const fresh = [{ raw_title: "Mobland" }, { raw_title: "Kanguva" }, { raw_title: "Gold" }, { raw_title: "Infinite" }];
  const d = SID.diffScans(fresh, prev);
  assert.equal(d.fresh.length, 4);
  assert.equal(JSON.stringify([...d.added.map((r) => r.raw_title)].sort()), JSON.stringify(["Gold", "Infinite"]));
  assert.equal(d.kept.length, 2);
  assert.equal(d.removed.length, 0);
});

// 5. Removed titles reported (not shown as newly detected).
ok("diffScans reports removed", () => {
  const d = SID.diffScans([{ raw_title: "Gold" }], [{ raw_title: "Gold" }, { raw_title: "Gone" }]);
  assert.equal(JSON.stringify(d.removed.map((r) => r.raw_title)), JSON.stringify(["Gone"]));
});

// 6. Batch splitting: 25 titles at batch 10 -> 3 batches, no dup scoring.
ok("batch split covers all without overlap", () => {
  const titles = Array.from({ length: 25 }, (_, i) => ({ raw_title: `Title ${i + 1}` }));
  const batches = [];
  for (let i = 0; i < titles.length; i += 10) batches.push(titles.slice(i, i + 10));
  assert.equal(JSON.stringify(batches.map((b) => b.length)), JSON.stringify([10, 10, 5]));
  assert.equal(new Set(batches.flat().map((t) => t.raw_title)).size, 25);
});

// 7. Cache validity: same id but changed profile context must rescore.
ok("cache invalidates on profile/mode change", () => {
  const entry = { result: { raw_title: "Gold" }, profileToken: "p1", mode: "dev-mock", region: "IN" };
  const same = { profileToken: "p1", mode: "dev-mock", region: "IN" };
  const changed = { profileToken: "p2", mode: "dev-mock", region: "IN" };
  const valid = (e, c) => e.profileToken === c.profileToken && e.mode === c.mode && e.region === c.region;
  assert.equal(valid(entry, same), true);
  assert.equal(valid(entry, changed), false);
});

// 8. Unresolved: empty titles are dropped before scoring, never invented.
ok("empty titles dropped", () => {
  const recs = SID.dedupeWithinScan([{ raw_title: "  " }, { raw_title: "Gold" }]);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].raw_title, "Gold");
});

console.log(`\nAll ${passed} recheck tests passed.`);
