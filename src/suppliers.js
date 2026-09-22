const { XMLParser } = require("fast-xml-parser");
const { config } = require("./config");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true
});

function arr(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function valueOf(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] != null && String(obj[key]).trim() !== "") {
      return String(obj[key]).trim();
    }
  }
  return "";
}

function findOfferArrays(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 12) return [];
  const found = [];

  for (const [k, v] of Object.entries(node)) {
    const lower = k.toLowerCase();
    if (["offer", "item", "product"].includes(lower)) {
      if (Array.isArray(v)) found.push(v);
      else if (v && typeof v === "object") found.push([v]);
    }
    if (v && typeof v === "object") found.push(...findOfferArrays(v, depth + 1));
  }
  return found;
}

function chooseOffers(parsed) {
  const candidates = findOfferArrays(parsed)
    .filter(list => list.length > 0)
    .sort((a, b) => b.length - a.length);
  return candidates[0] || [];
}

function extractParams(raw) {
  const params = [];
  const direct = [
    ...arr(raw?.param),
    ...arr(raw?.params?.param),
    ...arr(raw?.parameter),
    ...arr(raw?.parameters?.parameter)
  ];

  for (const p of direct) {
    if (!p || typeof p !== "object") continue;
    const name = valueOf(p, ["@name", "name", "@id", "id"]);
    const value = valueOf(p, ["#text", "value", "@value"]);
    if (name || value) params.push({ name, value });
  }
  return params;
}

function normalizeOffer(raw, supplier) {
  return {
    supplier,
    id: valueOf(raw, ["@id", "id", "offer_id", "offerId"]),
    groupId: valueOf(raw, ["@group_id", "@groupId", "group_id", "groupId", "variation_group_id", "variationGroupId"]),
    sku: valueOf(raw, ["vendorCode", "vendor_code", "sku", "SKU", "article", "articul", "code", "@sku"]),
    name: valueOf(raw, ["name", "model", "title"]),
    vendor: valueOf(raw, ["vendor", "brand", "manufacturer"]),
    categoryId: valueOf(raw, ["categoryId", "category_id", "@category_id"]),
    price: valueOf(raw, ["price", "@price"]),
    quantity: valueOf(raw, ["quantity", "stock_quantity", "stock", "count"]),
    available: valueOf(raw, ["@available", "available", "in_stock", "presence"]),
    params: extractParams(raw)
  };
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.httpTimeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/xml,text/xml,text/plain;q=0.9,*/*;q=0.8",
        "User-Agent": "PrimeTac-Sync/1.0 READ_ONLY"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function loadSupplier(name, url) {
  if (!url) {
    return { supplier:name, configured:false, ok:false, error:`${name} XML URL is not configured`, offers:[] };
  }

  try {
    const xml = await fetchText(url);
    const parsed = parser.parse(xml);
    const rawOffers = chooseOffers(parsed);
    return {
      supplier:name,
      configured:true,
      ok:true,
      error:null,
      offers:rawOffers.map(x => normalizeOffer(x, name))
    };
  } catch (err) {
    return {
      supplier:name,
      configured:true,
      ok:false,
      error:err?.message || String(err),
      offers:[]
    };
  }
}

async function loadSuppliers() {
  const [bezet, militaris] = await Promise.all([
    loadSupplier("BEZET", config.bezetXmlUrl),
    loadSupplier("MILITARIS", config.militarisXmlUrl)
  ]);
  return { bezet, militaris };
}

module.exports = { loadSuppliers };
