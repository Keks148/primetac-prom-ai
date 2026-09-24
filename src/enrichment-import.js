const fs = require("fs");
const path = require("path");

const { config } = require("./config");
const { listProducts, listGroups } = require("./prom");
const { loadSuppliers } = require("./suppliers");
const {
  clean,
  norm,
  groupIdOf,
  buildGroupInfo,
  classifyProduct,
  targetGroupForProduct,
  buildKeywords,
  buildDescriptions
} = require("./prom-editor");

const STATE_PATH =
  process.env.PROM_ENRICH_IMPORT_STATE_PATH ||
  "/var/data/primetac-enrich-import-state.json";

const PUBLIC_BASE_URL =
  String(
    process.env.PUBLIC_BASE_URL ||
    "https://primetac-prom-ai.onrender.com"
  ).replace(/\/+$/, "");

function csvCell(value) {
  const s = String(value ?? "");
  return '"' + s.replace(/"/g, '""') + '"';
}

function csvRow(values) {
  return values.map(csvCell).join(",");
}

function sourceIndex(suppliers) {
  const byId = new Map();
  const bySku = new Map();

  for (const supplier of [suppliers?.bezet, suppliers?.militaris]) {
    for (const offer of supplier?.offers || []) {
      const id = clean(offer?.id);
      const sku = clean(offer?.sku).toLowerCase();
      if (id) byId.set(id.toLowerCase(), offer);
      if (sku) {
        if (!bySku.has(sku)) bySku.set(sku, []);
        bySku.get(sku).push(offer);
      }
    }
  }

  return { byId, bySku };
}

function findSourceOffer(product, index) {
  const ext = clean(product?.external_id).toLowerCase();
  if (ext && index.byId.has(ext)) return index.byId.get(ext);

  const sku = clean(
    product?.sku ??
    product?.sku_code ??
    product?.article
  ).toLowerCase();

  const candidates = sku ? (index.bySku.get(sku) || []) : [];
  if (candidates.length === 1) return candidates[0];

  if (candidates.length > 1) {
    const name = norm(product?.name);
    const scored = candidates
      .map(offer => {
        const offerName = norm(offer?.name);
        const tokens = name.split(/\s+/u).filter(x => x.length >= 4);
        const score = tokens.filter(t => offerName.includes(t)).length;
        return { offer, score };
      })
      .sort((a, b) => b.score - a.score);
    if (scored[0]?.score > 0) return scored[0].offer;
  }

  return null;
}

function uniquePairs(pairs, max = 10) {
  const out = [];
  const seen = new Set();

  for (const pair of pairs) {
    const name = clean(pair?.name).slice(0, 100);
    const value = clean(pair?.value).slice(0, 255);
    const unit = clean(pair?.unit).slice(0, 30);
    if (!name || !value) continue;
    const key = name.toLowerCase() + "\u0000" + value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, value, unit });
    if (out.length >= max) break;
  }

  return out;
}

function extractColor(name) {
  // Token matching avoids false positives such as "термобелье" -> "белый".
  const tokens = norm(name)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/u)
    .filter(Boolean);

  const tokenSet = new Set(tokens);

  const aliases = [
    [["чорний", "чорна", "чорне", "чорні", "черный", "чёрный", "черная", "черное", "черные", "black"], "Чорний"],
    [["койот", "coyote"], "Койот"],
    [["хаки", "khaki"], "Хакі"],
    [["олива", "оливковый", "оливкова", "olive"], "Олива"],
    [["сірий", "сіра", "сіре", "сірі", "серый", "серая", "серое", "серые", "gray", "grey"], "Сірий"],
    [["синий", "синяя", "синее", "синие", "синій", "синя", "синє", "сині", "blue"], "Синій"],
    [["navy"], "Темно-синій"],
    [["білий", "біла", "біле", "білі", "белый", "белая", "белое", "белые", "white"], "Білий"],
    [["пісочний", "пісочна", "песочный", "песочная", "sand"], "Пісочний"],
    [["коричневий", "коричнева", "коричневый", "коричневая", "brown"], "Коричневий"],
    [["зелений", "зелена", "зеленый", "зеленая", "green"], "Зелений"],
    [["мультикам", "multicam"], "Multicam"],
    [["mint"], "М'ятний"],
    [["berry"], "Ягідний"],
    [["beige"], "Бежевий"]
  ];

  for (const [words, value] of aliases) {
    if (words.some(word => tokenSet.has(word))) {
      return value;
    }
  }

  return "";
}

function extractGender(name) {
  const text = norm(name);
  if (/женск|жіноч/iu.test(text)) return "Жіночий";
  if (/мужск|чоловіч/iu.test(text)) return "Чоловічий";
  return "";
}

function extractSeason(name) {
  const text = norm(name);
  if (/зим/iu.test(text)) return "Зима";
  if (/демисез|демісез/iu.test(text)) return "Демісезон";
  if (/літн|летн/iu.test(text)) return "Літо";
  return "";
}

function sourceParamValue(offer, aliases) {
  const wanted = aliases.map(value => norm(value));

  for (const param of offer?.params || []) {
    const name = norm(param?.name);

    if (
      wanted.some(
        alias =>
          name === alias ||
          name.includes(alias)
      )
    ) {
      const value =
        clean(param?.value);

      if (value) {
        return value;
      }
    }
  }

  return "";
}

function canonicalParamName(name) {
  const value = norm(name);

  if (["цвет", "колір", "color", "colour"].includes(value)) {
    return "Колір";
  }

  if (["размер", "розмір", "size"].includes(value)) {
    return "Розмір";
  }

  if (["пол", "стать", "gender"].includes(value)) {
    return "Стать";
  }

  if (["сезон", "season"].includes(value)) {
    return "Сезон";
  }

  if (
    [
      "бренд",
      "brand",
      "vendor",
      "виробник",
      "производитель"
    ].includes(value)
  ) {
    return "Бренд";
  }

  if (
    [
      "країна",
      "страна",
      "country",
      "країна виробник",
      "страна производитель"
    ].includes(value)
  ) {
    return "Країна виробник";
  }

  return clean(name);
}

function buildCharacteristics(product, offer, target) {
  const pairs = [];

  const reserved =
    new Set([
      "Колір",
      "Стать",
      "Сезон",
      "Бренд",
      "Країна виробник",
      "Тип товару"
    ]);

  for (const param of offer?.params || []) {
    const canonicalName =
      canonicalParamName(
        param?.name
      );

    if (
      !canonicalName ||
      reserved.has(
        canonicalName
      )
    ) {
      continue;
    }

    pairs.push({
      name:
        canonicalName,

      value:
        param?.value,

      unit: ""
    });
  }

  const vendor =
    clean(offer?.vendor) ||
    sourceParamValue(
      offer,
      [
        "бренд",
        "brand",
        "виробник",
        "производитель"
      ]
    );

  const country =
    clean(offer?.country) ||
    sourceParamValue(
      offer,
      [
        "країна виробник",
        "страна производитель",
        "country"
      ]
    );

  // If the name explicitly contains a color, it wins over a stale supplier
  // parameter. This prevents cards such as "... белый" + "Цвет: Черный".
  const color =
    extractColor(
      product?.name
    ) ||
    sourceParamValue(
      offer,
      [
        "колір",
        "цвет",
        "color",
        "colour"
      ]
    );

  // Do not invent "Unisex". Only write gender when the name/feed actually says it.
  const gender =
    extractGender(
      product?.name
    ) ||
    sourceParamValue(
      offer,
      [
        "стать",
        "пол",
        "gender"
      ]
    );

  const season =
    extractSeason(
      product?.name
    ) ||
    sourceParamValue(
      offer,
      [
        "сезон",
        "season"
      ]
    );

  if (vendor) {
    pairs.unshift({
      name: "Бренд",
      value: vendor,
      unit: ""
    });
  }

  if (country) {
    pairs.push({
      name:
        "Країна виробник",
      value:
        country,
      unit: ""
    });
  }

  if (target?.labelUa) {
    pairs.push({
      name:
        "Тип товару",
      value:
        target.labelUa,
      unit: ""
    });
  }

  if (color) {
    pairs.push({
      name: "Колір",
      value: color,
      unit: ""
    });
  }

  if (gender) {
    pairs.push({
      name: "Стать",
      value: gender,
      unit: ""
    });
  }

  if (season) {
    pairs.push({
      name: "Сезон",
      value: season,
      unit: ""
    });
  }

  return uniquePairs(
    pairs,
    10
  );
}

function safeDescription(product, classification, lang) {
  const current = clean(product?.description);
  if (current && current.replace(/<[^>]*>/g, " ").length >= 80) return current;
  const generated = buildDescriptions(product, classification);
  return lang === "ru" ? generated.ru : generated.ua;
}

function buildSeo(product, target, lang) {
  const name = clean(product?.name);
  const label = lang === "ru" ? target?.labelRu : target?.labelUa;
  const title = (name + " | PrimeTac Group").slice(0, lang === "ru" ? 250 : 270);
  const description =
    lang === "ru"
      ? ("Купить " + (label || "тактическую одежду и обувь") + " в PrimeTac Group. Актуальные характеристики, цена и наличие.").slice(0, 250)
      : ("Купити " + (label || "тактичний одяг та взуття") + " у PrimeTac Group. Актуальні характеристики, ціна та наявність.").slice(0, 270);
  return { title, description };
}

function readState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return {};
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    const tmp = STATE_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(tmp, STATE_PATH);
  } catch (err) {
    console.error("[PROM_ENRICH_STATE_ERROR]", err?.message || String(err));
  }
}

async function buildEnrichmentFeed() {
  const [products, groups, suppliers] = await Promise.all([
    listProducts(),
    listGroups(),
    loadSuppliers()
  ]);

  const groupsInfo = buildGroupInfo(groups);
  const source = sourceIndex(suppliers);

  const triples = Array
    .from({ length: 10 }, () => [
      "Назва_Характеристики",
      "Одиниця_виміру_Характеристики",
      "Значення_Характеристики"
    ])
    .flat();

  const headers = [
    "Код_товару",
    "Назва_позиції",
    "Назва_позиції_укр",
    "Пошукові_запити",
    "Пошукові_запити_укр",
    "Опис",
    "Опис_укр",
    "Тип_товару",
    "HTML_заголовок",
    "HTML_заголовок_укр",
    "HTML_опис",
    "HTML_опис_укр",
    "Номер_групи",
    "Ідентифікатор_товару",
    "Унікальний_ідентифікатор",
    ...triples
  ];

  const rows = [csvRow(headers)];
  const preview = [];

  let keep = 0;
  let skippedRemove = 0;
  let skippedReview = 0;
  let skippedNoExternalId = 0;
  let sourceMatched = 0;
  let groupFixes = 0;
  let threePlusCharacteristics = 0;

  for (const product of products) {
    const classification = classifyProduct(product, groupsInfo);

    if (classification.action === "REMOVE") {
      skippedRemove++;
      continue;
    }

    if (classification.action === "REVIEW") {
      skippedReview++;
      continue;
    }

    const externalId = clean(product?.external_id);
    if (!externalId) {
      skippedNoExternalId++;
      continue;
    }

    const target = targetGroupForProduct(product);
    if (!target?.id) continue;

    keep++;

    const offer = findSourceOffer(product, source);
    if (offer) sourceMatched++;

    const characteristics = buildCharacteristics(product, offer, target);
    if (characteristics.length >= 3) threePlusCharacteristics++;

    const currentGroup = groupIdOf(product);
    if (String(currentGroup || "") !== String(target.id)) groupFixes++;

    const keywords = buildKeywords(product, classification);
    const seoUa = buildSeo(product, target, "ua");
    const seoRu = buildSeo(product, target, "ru");

    const attrCells = [];
    for (let i = 0; i < 10; i++) {
      const item = characteristics[i];
      attrCells.push(item?.name || "", item?.unit || "", item?.value || "");
    }

    const row = [
      clean(product?.sku ?? product?.sku_code ?? product?.article),
      clean(product?.name),
      clean(product?.name),
      keywords,
      keywords,
      safeDescription(product, classification, "ru"),
      safeDescription(product, classification, "ua"),
      "r",
      seoRu.title,
      seoUa.title,
      seoRu.description,
      seoUa.description,
      target.id,
      externalId,
      product?.id ?? "",
      ...attrCells
    ];

    rows.push(csvRow(row));

    if (preview.length < 80) {
      preview.push({
        id: product?.id ?? null,
        externalId,
        name: clean(product?.name),
        fromGroup: currentGroup,
        toGroup: target.id,
        targetLabel: target.labelUa,
        sourceMatched: Boolean(offer),
        characteristics
      });
    }
  }

  const csv = rows.join("\r\n") + "\r\n";
  const summary = {
    generatedAt: new Date().toISOString(),
    products: products.length,
    rows: rows.length - 1,
    keep,
    skippedRemove,
    skippedReview,
    skippedNoExternalId,
    sourceMatched,
    groupFixes,
    threePlusCharacteristics,
    bytes: Buffer.byteLength(csv, "utf8")
  };

  return { csv, summary, preview };
}

async function submitEnrichmentImport() {
  const feed = await buildEnrichmentFeed();
  const url =
    PUBLIC_BASE_URL +
    "/feeds/editor-enrichment.csv?v=" +
    encodeURIComponent(Date.now());

  const response = await fetch(
    config.promApiBase + "/products/import_url",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer " + config.promToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url,
        force_update: true,
        only_available: false,
        only_update: true,
        mark_missing_product_as: "none",
        updated_fields: [
          "group",
          "keywords",
          "attributes",
          "translations"
        ]
      }),
      signal: AbortSignal.timeout(config.httpTimeoutMs)
    }
  );

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text.slice(0, 500) };
  }

  if (!response.ok) {
    throw new Error(
      "Prom enrichment import " +
      response.status +
      ": " +
      JSON.stringify(payload).slice(0, 1000)
    );
  }

  const state = readState();
  state.lastSubmittedAt = new Date().toISOString();
  state.lastImportId = payload?.id || null;
  state.lastSummary = feed.summary;
  writeState(state);

  console.log("[PROM_ENRICH_IMPORT_SUBMITTED]");
  console.log(JSON.stringify({
    id: payload?.id || null,
    url,
    summary: feed.summary
  }));

  return {
    submitted: true,
    id: payload?.id || null,
    url,
    summary: feed.summary
  };
}

function canSubmitByGap(minGapMinutes = 180) {
  const state = readState();
  if (!state.lastSubmittedAt) return true;
  const last = Date.parse(state.lastSubmittedAt);
  if (!Number.isFinite(last)) return true;
  return Date.now() - last >= minGapMinutes * 60 * 1000;
}

module.exports = {
  STATE_PATH,
  buildEnrichmentFeed,
  submitEnrichmentImport,
  canSubmitByGap
};
