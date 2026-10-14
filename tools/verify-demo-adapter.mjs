/**
 * Quick offline check for demo adapter URL matching (no Chrome required).
 * Run: node tools/verify-demo-adapter.mjs
 */

const demoAdapter = {
  canHandle(urlString) {
    try {
      const url = new URL(urlString);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return false;
      }
      const isLocalHost =
        url.hostname === "localhost" || url.hostname === "127.0.0.1";
      const looksLikeDemoPath =
        url.pathname.includes("cinegraph_movie_catalogue") ||
        /\/index\.html$/i.test(url.pathname);
      return isLocalHost && looksLikeDemoPath;
    } catch {
      return false;
    }
  },
};

const cases = [
  ["http://127.0.0.1:5500/cinegraph_movie_catalogue_demo/index.html", true],
  ["http://127.0.0.1:5500/index.html", true],
  ["https://www.imdb.com/title/tt1375666/", false],
  ["chrome://extensions/", false],
];

let failed = 0;

for (const [url, expected] of cases) {
  const actual = demoAdapter.canHandle(url);
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} ${url} → ${actual}`);
  if (!pass) {
    failed += 1;
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("All demo adapter URL checks passed.");
}
