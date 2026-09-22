const { config } = require("./config");

function ensurePromConfigured() {
  if (!config.promToken) throw new Error("PROM_TOKEN is not configured");
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.httpTimeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.promToken}`
      }
    });

    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }

    if (!response.ok) {
      const details = typeof body === "string" ? body.slice(0, 500) : JSON.stringify(body);
      throw new Error(`Prom API ${response.status} ${response.statusText}: ${details}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function listAll(endpoint, arrayKey, limit = 100) {
  ensurePromConfigured();
  const out = [];
  let lastId = null;
  let guard = 0;

  while (guard++ < 200) {
    const url = new URL(`${config.promApiBase}/${endpoint}`);
    url.searchParams.set("limit", String(limit));
    if (lastId != null) url.searchParams.set("last_id", String(lastId));

    const body = await fetchJson(url.toString());
    const batch = Array.isArray(body?.[arrayKey]) ? body[arrayKey] : [];
    out.push(...batch);

    if (batch.length < limit) break;
    const nextId = batch[batch.length - 1]?.id;
    if (nextId == null || String(nextId) === String(lastId)) break;
    lastId = nextId;
  }

  return out;
}

async function listProducts() {
  return listAll("products/list", "products", 100);
}

async function listGroups() {
  return listAll("groups/list", "groups", 100);
}

module.exports = { listProducts, listGroups };
