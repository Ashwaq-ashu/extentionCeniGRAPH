/**
 * Registers permitted site adapters. Add new adapters here only after
 * verifying the site's terms and an authorized access method.
 */

globalThis.CineGraphAdapters = (() => {
  const adapters = [];

  function register(adapter) {
    if (adapter?.id && typeof adapter.canHandle === "function") {
      adapters.push(adapter);
    }
  }

  if (globalThis.CineGraphDemoCatalogueAdapter) {
    register(globalThis.CineGraphDemoCatalogueAdapter);
  }

  if (globalThis.CineGraphGenericAdapter) {
    register(globalThis.CineGraphGenericAdapter);
  }

  function findFor(urlString) {
    return adapters.find((adapter) => adapter.canHandle(urlString)) || null;
  }

  return { register, findFor, list: () => [...adapters] };
})();
