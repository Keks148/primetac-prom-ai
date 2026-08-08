import express from "express";
import { XMLParser } from "fast-xml-parser";

const app = express();
app.use(express.json({ limit: "3mb" }));
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

function discountLabel(brandOrName) {
  const s = normalizeText(brandOrName);
  if (s.includes("salomon")) return "Salomon";
  if (s.includes("helikon")) return "Helikon-Tex";
  if (s.includes("lowa")) return "LOWA";
  if (s.includes("belleville")) return "Belleville";
  return "Остальные";
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
    headers: { "User-Agent": "PrimeTacPromAI/3.0" }
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

async function fetchAllPromProducts(maxPages = 30) {
  const all = [];
  let lastId = null;

  for (let page = 0; page < maxPages; page++) {
    const suffix = lastId ? `&last_id=${encodeURIComponent(lastId)}` : "";
    const data = await promRequest(`/products/list?limit=100${suffix}`);
    const batch = promProducts(data);

    if (!batch.length) break;
    all.push(...batch);

    if (batch.length < 100) break;

    const newLastId = batch[batch.length - 1]?.id;
    if (!newLastId || String(newLastId) === String(lastId)) break;
    lastId = newLastId;
  }

  return all;
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
  const np = normalizeText(name);
  const words = [...tokens(name)];

  let best = null;
  let bestScore = 0;

  for (const m of militarisCache.items) {
    const nm = normalizeText(m.name);
    if (words.length && !words.some(w => nm.includes(w))) continue;
    const score = jaccard(np, nm);
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }

  if (best && bestScore >= 0.60) {
    return {
      item: best,
      method: "name",
      confidence: Number(bestScore.toFixed(3))
    };
  }

  return null;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function smartPrice(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const n = Math.ceil(value);
  if (n < 300) return Math.ceil(n / 10) * 10 - 1;
  if (n < 1500) return Math.ceil(n / 20) * 20 - 1;
  if (n < 5000) return Math.ceil(n / 50) * 50 - 1;
  return Math.ceil(n / 100) * 100 - 10;
}

function priceForMargin(buyPrice, targetMarginPct) {
  const m = targetMarginPct / 100;
  if (!buyPrice || m <= 0 || m >= 1) return null;
  return smartPrice(buyPrice / (1 - m));
}

function riskFlags(promPrice, buyPrice, marginPct, match) {
  const flags = [];
  if (!match) flags.push("Нет сопоставления");
  if (match?.method === "name") flags.push("Проверить совпадение");
  if (buyPrice != null && promPrice < buyPrice) flags.push("Цена ниже закупки");
  if (marginPct != null && marginPct < 8) flags.push("Очень низкая маржа");
  else if (marginPct != null && marginPct < 15) flags.push("Низкая маржа");
  return flags;
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
      discountPct: null,
      discountGroup: null,
      recommended15: null,
      recommended20: null,
      recommended25: null,
      flags: ["Нет сопоставления"]
    };
  }

  const brandSource = `${match.item.brand || ""} ${match.item.name || ""} ${p.name || ""}`;
  const d = brandDiscount(brandSource);
  const supplierPrice = Number(match.item.price);
  const buyPrice = supplierPrice * (1 - d);
  const grossProfit = promPrice - buyPrice;
  const marginPct = promPrice ? (grossProfit / promPrice) * 100 : null;

  return {
    matched: true,
    promPrice,
    supplierPrice: round2(supplierPrice),
    buyPrice: round2(buyPrice),
    grossProfit: round2(grossProfit),
    marginPct: marginPct == null ? null : Math.round(marginPct * 10) / 10,
    discountPct: Math.round(d * 100),
    discountGroup: discountLabel(brandSource),
    matchMethod: match.method,
    matchConfidence: match.confidence,
    supplierName: match.item.name,
    supplierBrand: match.item.brand || null,
    supplierSku: match.item.sku || null,
    supplierId: match.item.id || null,
    supplierUrl: match.item.url || null,
    recommended15: priceForMargin(buyPrice, 15),
    recommended20: priceForMargin(buyPrice, 20),
    recommended25: priceForMargin(buyPrice, 25),
    flags: riskFlags(promPrice, buyPrice, marginPct, match)
  };
}

function summarize(report) {
  const matched = report.filter(x => x.matched);
  const profitable = matched.filter(x => (x.grossProfit ?? 0) > 0);
  const loss = matched.filter(x => (x.grossProfit ?? 0) <= 0);
  const highMargin = matched.filter(x => (x.marginPct ?? -999) >= 20);
  const lowMargin = matched.filter(x => (x.marginPct ?? 999) < 10);
  const nameMatches = matched.filter(x => x.matchMethod === "name");

  const oneUnitGross = matched.reduce((s, x) => s + (x.grossProfit || 0), 0);

  const byDiscount = {};
  for (const x of matched) {
    const k = `${x.discountGroup} −${x.discountPct}%`;
    byDiscount[k] = (byDiscount[k] || 0) + 1;
  }

  return {
    total: report.length,
    matched: matched.length,
    unmatched: report.length - matched.length,
    profitable: profitable.length,
    loss: loss.length,
    highMargin: highMargin.length,
    lowMargin: lowMargin.length,
    approximateMatches: nameMatches.length,
    oneUnitGross: round2(oneUnitGross),
    byDiscount
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

app.get("/api/orders", requirePromToken, async (req, res) => {
  try {
    const data = await promRequest("/orders/list");
    res.json(data);
  } catch (e) {
    res.status(e.status || 500).json({
      error: e.message,
      details: e.data || null
    });
  }
});

app.get("/api/catalog/report-all", requirePromToken, async (req, res) => {
  try {
    if (!militarisCache.items.length) await refreshMilitaris();

    const products = await fetchAllPromProducts(30);
    const report = products.map(p => {
      const match = findMilitarisMatch(p);
      return {
        product: {
          id: p.id,
          external_id: p.external_id || null,
          name: p.name,
          price: p.price,
          currency: p.currency || "UAH",
          presence: p.presence ?? null,
          sku: p.sku || p.article || p.code || null
        },
        ...productMetrics(p, match)
      };
    });

    res.json({
      loadedAt: militarisCache.loadedAt,
      summary: summarize(report),
      report
    });
  } catch (e) {
    res.status(e.status || 500).json({
      error: e.message,
      details: e.data || null
    });
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

Используй только переданные данные.
supplierPrice = розничная цена на сайте Militaris.
buyPrice = расчетная закупка по согласованной скидке дропшиппера.
recommended15/recommended20/recommended25 = технические цены для целевой валовой маржи 15/20/25%.
Это НЕ цены рынка и НЕ цены конкурентов.
Если matchMethod=name, совпадение приблизительное и его нужно перепроверить вручную.
Не придумывай спрос, количество будущих заказов или цены конкурентов.

Ответ кратко:
1) текущая валовая прибыль и маржа;
2) безопасна ли текущая цена;
3) какую из технических цен 15/20/25% разумнее тестировать и почему;
4) стоит ли товар включать в список кандидатов на продвижение;
5) риск сопоставления;
6) улучшенное название карточки на украинском.

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
      return res.status(response.status).json({
        error: "OpenAI API error",
        details: data
      });
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
  console.log(`PrimeTac Prom AI v3 running on port ${PORT}`);
});
