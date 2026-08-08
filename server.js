import express from "express";
import { XMLParser } from "fast-xml-parser";

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const PROM_BASE = "https://my.prom.ua/api/v1";
const MILITARIS_XML_URL =
  process.env.MILITARIS_XML_URL ||
  "https://militaris.com.ua/content/export/04658108dda3987543769e4a63b496ca.xml";

let militarisCache = {
  loadedAt: null,
  items: [],
  byId: new Map(),
  bySku: new Map(),
  rawCount: 0,
  error: null
};

function requirePromToken(req, res, next) {
  if (!process.env.PROM_TOKEN) {
    return res.status(500).json({ error: "PROM_TOKEN не задан на сервере" });
  }
  next();
}

async function promRequest(path) {
  const response = await fetch(`${PROM_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.PROM_TOKEN}`,
      Accept: "application/json"
    }
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) {
    const err = new Error(`Prom API: ${response.status}`);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

function arr(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function first(obj, names) {
  if (!obj || typeof obj !== "object") return undefined;
  for (const name of names) {
    if (obj[name] != null) return obj[name];
    const key = Object.keys(obj).find(k => k.toLowerCase() === name.toLowerCase());
    if (key && obj[key] != null) return obj[key];
  }
  return undefined;
}

function scalar(v) {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object") {
    if (v["#text"] != null) return String(v["#text"]);
    if (v["@_value"] != null) return String(v["@_value"]);
  }
  return "";
}

function cleanNumber(v) {
  const s = scalar(v).replace(/\s/g, "").replace(",", ".");
  const m = s.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/[^a-zа-яіїєґ0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s) {
  return new Set(normalizeText(s).split(" ").filter(x => x.length >= 3));
}

function jaccard(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

function brandDiscount(brandOrName) {
  const s = normalizeText(brandOrName);
  if (s.includes("salomon")) return 0.20;
  if (s.includes("helikon")) return 0.10;
  if (s.includes("lowa")) return 0.05;
  if (s.includes("belleville")) return 0.15;
  return 0.15;
}

function walkForProductArrays(node, out = []) {
  if (!node || typeof node !== "object") return out;
  for (const [k, v] of Object.entries(node)) {
    const kl = k.toLowerCase();
    if (["item", "offer", "product"].includes(kl)) {
      for (const x of arr(v)) if (x && typeof x === "object") out.push(x);
    } else if (typeof v === "object") {
      walkForProductArrays(v, out);
    }
  }
  return out;
}

function normalizeMilitarisItem(x) {
  const id = scalar(first(x, ["id", "g:id", "offer_id", "external_id", "@_id"]));
  const sku = scalar(first(x, ["sku", "vendorCode", "g:mpn", "article", "articul", "code"]));
  const name = scalar(first(x, ["name", "title", "g:title"]));
  const brand = scalar(first(x, ["brand", "vendor", "g:brand"]));
  const url = scalar(first(x, ["url", "link", "g:link"]));
  const price = cleanNumber(first(x, ["price", "g:price", "priceuah", "price_ua"]));
  const availableRaw = scalar(first(x, ["available", "availability", "g:availability", "@_available"]));
  return {
    id, sku, name, brand, url, price,
    available: availableRaw || null
  };
}

async function refreshMilitaris() {
  const r = await fetch(MILITARIS_XML_URL, {
    headers: { "User-Agent": "PrimeTacPromAI/2.0" }
  });
  if (!r.ok) throw new Error(`Militaris XML: HTTP ${r.status}`);
  const xml = await r.text();

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    processEntities: true,
    trimValues: true
  });
  const parsed = parser.parse(xml);
  const raw = walkForProductArrays(parsed);
  const items = raw
    .map(normalizeMilitarisItem)
    .filter(x => x.name || x.id || x.sku)
    .filter(x => x.price > 0);

  const byId = new Map();
  const bySku = new Map();
  for (const x of items) {
    if (x.id) byId.set(normalizeText(x.id), x);
    if (x.sku) bySku.set(normalizeText(x.sku), x);
  }

  militarisCache = {
    loadedAt: new Date().toISOString(),
    items,
    byId,
    bySku,
    rawCount: raw.length,
    error: null
  };
  return {
    loadedAt: militarisCache.loadedAt,
    count: items.length,
    rawCount: raw.length
  };
}

function promProducts(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.products)) return data.products;
  return [];
}

function findMilitarisMatch(p) {
  if (!militarisCache.items.length) return null;

  const candidates = [
    p.external_id, p.sku, p.article, p.code, p.id
  ].map(normalizeText).filter(Boolean);

  for (const c of candidates) {
    if (militarisCache.bySku.has(c)) {
      return { item: militarisCache.bySku.get(c), method: "sku", confidence: 1 };
    }
    if (militarisCache.byId.has(c)) {
      return { item: militarisCache.byId.get(c), method: "id", confidence: 1 };
    }
  }

  const name = p.name || "";
  let best = null;
  let bestScore = 0;
  // Ограничиваем работу: сначала товары с общими словами/брендом.
  const np = normalizeText(name);
  const words = [...tokens(name)];
  for (const m of militarisCache.items) {
    const nm = normalizeText(m.name);
    if (words.length && !words.some(w => nm.includes(w))) continue;
    const score = jaccard(np, nm);
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }

  if (best && bestScore >= 0.55) {
    return { item: best, method: "name", confidence: Number(bestScore.toFixed(3)) };
  }
  return null;
}

function productMetrics(p, match) {
  const promPrice = Number(p.price || 0);
  if (!match?.item?.price) {
    return {
      matched: false,
      promPrice,
      supplierPrice: null,
      buyPrice: null,
      grossProfit: null,
      marginPct: null,
      discountPct: null
    };
  }

  const brand = match.item.brand || match.item.name || p.name || "";
  const d = brandDiscount(brand);
  const supplierPrice = Number(match.item.price);
  const buyPrice = supplierPrice * (1 - d);
  const grossProfit = promPrice - buyPrice;
  const marginPct = promPrice ? (grossProfit / promPrice) * 100 : null;

  return {
    matched: true,
    promPrice,
    supplierPrice: Math.round(supplierPrice * 100) / 100,
    buyPrice: Math.round(buyPrice * 100) / 100,
    grossProfit: Math.round(grossProfit * 100) / 100,
    marginPct: marginPct == null ? null : Math.round(marginPct * 10) / 10,
    discountPct: Math.round(d * 100),
    matchMethod: match.method,
    matchConfidence: match.confidence,
    supplierName: match.item.name,
    supplierBrand: match.item.brand || null,
    supplierSku: match.item.sku || null,
    supplierId: match.item.id || null,
    supplierUrl: match.item.url || null
  };
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    promConfigured: Boolean(process.env.PROM_TOKEN),
    aiConfigured: Boolean(process.env.OPENAI_API_KEY),
    militaris: {
      configured: Boolean(MILITARIS_XML_URL),
      loadedAt: militarisCache.loadedAt,
      count: militarisCache.items.length,
      error: militarisCache.error
    }
  });
});

app.post("/api/militaris/refresh", async (req, res) => {
  try {
    const info = await refreshMilitaris();
    res.json({ ok: true, ...info });
  } catch (e) {
    militarisCache.error = e.message;
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/products", requirePromToken, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 100);
    const lastId = req.query.last_id ? `&last_id=${encodeURIComponent(req.query.last_id)}` : "";
    const data = await promRequest(`/products/list?limit=${limit}${lastId}`);
    res.json(data);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, details: e.data || null });
  }
});

app.get("/api/orders", requirePromToken, async (req, res) => {
  try {
    const data = await promRequest("/orders/list");
    res.json(data);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, details: e.data || null });
  }
});

app.get("/api/catalog/report", requirePromToken, async (req, res) => {
  try {
    if (!militarisCache.items.length) {
      await refreshMilitaris();
    }
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 100);
    const data = await promRequest(`/products/list?limit=${limit}`);
    const products = promProducts(data);
    const report = products.map(p => {
      const match = findMilitarisMatch(p);
      return {
        product: {
          id: p.id,
          external_id: p.external_id || null,
          name: p.name,
          price: p.price,
          currency: p.currency || "UAH",
          presence: p.presence ?? null
        },
        ...productMetrics(p, match)
      };
    });
    res.json({
      count: report.length,
      matched: report.filter(x => x.matched).length,
      loadedAt: militarisCache.loadedAt,
      report
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, details: e.data || null });
  }
});

app.post("/api/analyze", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ error: "OPENAI_API_KEY не задан на сервере" });
    }
    const payload = req.body || {};
    const model = process.env.OPENAI_MODEL || "gpt-5-mini";

    const prompt = `
Ты аналитик украинского интернет-магазина тактической одежды и снаряжения PrimeTac Group.
Проанализируй товар на основании ТОЛЬКО переданных данных.

Если есть supplierPrice и buyPrice — это цена сайта поставщика Militaris и рассчитанная закупка с учётом скидки.
Если matched=false — не называй закупку реальной и укажи, что товар не сопоставлен.
matchMethod=name означает приблизительное сопоставление по названию, его надо перепроверить.
Не придумывай цены конкурентов.

Дай коротко:
1. оценка карточки;
2. прибыль и маржа, если рассчитаны;
3. риск/ошибка сопоставления;
4. стоит ли продвигать;
5. улучшенное название на украинском;
6. что исправить в карточке в первую очередь.

Данные:
${JSON.stringify(payload, null, 2)}
`.trim();

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model, input: prompt })
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: "OpenAI API error", details: data });
    }
    const text =
      data.output_text ||
      (data.output || [])
        .flatMap(item => item.content || [])
        .filter(c => c.type === "output_text")
        .map(c => c.text)
        .join("\n") ||
      "Текст ответа не найден.";
    res.json({ text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`PrimeTac Prom AI v2 running on port ${PORT}`);
});
