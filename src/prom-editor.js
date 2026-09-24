const fs = require("fs");
const path = require("path");
const { config } = require("./config");
const { listProducts, listGroups } = require("./prom");

const EDITOR_VERSION = "2.0.0";
const STATE_PATH = process.env.PROM_EDITOR_STATE_PATH || "/var/data/primetac-prom-editor-state.json";

const BLOCKED_BRANDS = [
  /\blowa\b/iu,
  /\bhelikon[\s-]*tex\b/iu,
  /\bhelikon\b/iu,
  /\bхеликон\b/iu
];

const HARD_BLOCK = [
  /бронеплит/iu, /бронепак/iu, /plate\s*carrier/iu, /плитоноск/iu,
  /\bрпс\b/iu, /разгруз/iu, /розвантаж/iu,
  /\bшлем/iu, /\bhelmet/iu, /\bкаск/iu,
  /кавер.*(?:шлем|шолом|каск)/iu, /чехол.*(?:шлем|каск)/iu, /чохол.*шолом/iu,
  /накладк.*(?:шлем|каск)/iu, /накладк.*шолом/iu,
  /окуляр/iu, /\bочки\b/iu, /goggle/iu,
  /магазин.*(?:оруж|збро|автомат|винтов|пістолет|пистолет)/iu,
  /(?:оруж|збро).*магазин/iu,
  /підсум/iu, /подсум/iu, /кобур/iu, /holster/iu,
  /рем(?:ень|інь).*оруж/iu, /оруж.*рем(?:ень|інь)/iu,
  /рем(?:ень|інь).*збро/iu, /збро.*рем(?:ень|інь)/iu,
  /\bрюкзак/iu, /\bсумк/iu, /\bбаул/iu, /органайзер/iu,
  /\bкарабин/iu, /\bкарабін/iu, /\bфонар/iu, /\bліхтар/iu,
  /\bнож\b/iu, /\bніж\b/iu, /шеврон/iu, /\bпатч/iu,
  /спальн.*(?:меш|міш)/iu, /наколен/iu, /налокот/iu,
  /маскувальн.*сіт/iu, /маскировочн.*сет/iu
];

const APPAREL_OR_SHOES = [
  /тактичн.*одяг/iu, /тактическ.*одежд/iu, /\bодяг\b/iu, /\bодежд/iu,
  /\bфутболк/iu, /\bполо\b/iu, /\bштани\b/iu, /\bбрюк/iu, /\bшорт/iu,
  /\bкуртк/iu, /вітров/iu, /ветров/iu, /\bкофт/iu, /\bхуді/iu, /\bхуди/iu,
  /\bфліс/iu, /\bфлис/iu, /\bсороч/iu, /\bрубаш/iu, /\bubacs\b/iu,
  /термобілиз/iu, /термобель/iu, /дощов/iu, /дождев/iu, /\bпончо\b/iu,
  /\bкостюм/iu, /\bботин/iu, /\bчеревик/iu, /\bберц/iu, /\bкрос/iu,
  /\bвзут/iu, /\bобув/iu, /\bшкарпет/iu, /\bноск/iu, /\bстельк/iu,
  /\bрукавич/iu, /\bперчат/iu, /головн.*убор/iu, /\bкепк/iu,
  /\bпанам/iu, /\bшапк/iu, /\bбаф\b/iu, /\bбалаклав/iu
];

const BLOCK_GROUP = [
  /тактичн.*споряджен/iu, /тактическ.*снаряжен/iu,
  /захисн.*споряджен/iu, /защитн.*снаряжен/iu,
  /аксесуар/iu, /рюкзак/iu, /сумк/iu, /туризм.*споряджен/iu
];

function clean(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function norm(value) {
  return clean(value).toLowerCase();
}

function stripHtml(value) {
  return clean(String(value == null ? "" : value).replace(/<[^>]*>/g, " "));
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function groupIdOf(product) {
  return product && (
    (product.group && product.group.id) ??
    product.group_id ??
    product.category_id ??
    null
  );
}

function brandOf(product) {
  return clean(product && (
    product.vendor ??
    product.brand ??
    product.manufacturer ??
    product.producer ??
    ""
  ));
}

function categoryNameOf(product) {
  return clean(product && product.category && (
    product.category.name ??
    product.category.caption ??
    ""
  ));
}

function quantityOf(product) {
  const value = product && (
    product.quantity_in_stock ??
    product.quantity ??
    product.stock_quantity ??
    product.stock ??
    null
  );
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function presenceOf(product) {
  return norm(product && (
    product.presence ??
    product.availability ??
    product.available ??
    ""
  ));
}

function isAvailable(product) {
  const presence = presenceOf(product);
  if (["available", "in_stock", "true", "1", "в наявності", "в наличии"].includes(presence)) return true;
  if (["not_available", "unavailable", "out_of_stock", "false", "0", "немає", "нет"].includes(presence)) return false;
  const q = quantityOf(product);
  return q == null ? true : q > 0;
}

function buildGroupInfo(groups) {
  const byId = new Map();
  for (const group of groups || []) {
    if (group && group.id != null) byId.set(String(group.id), group);
  }

  function pathOf(group) {
    const names = [];
    const seen = new Set();
    let current = group;
    while (current && current.id != null && !seen.has(String(current.id))) {
      seen.add(String(current.id));
      const name = clean(current.name ?? current.title);
      if (name) names.unshift(name);
      const parentId =
        current.parent_group_id ??
        current.parent_id ??
        (current.parent && current.parent.id) ??
        null;
      if (parentId == null) break;
      current = byId.get(String(parentId)) || null;
    }
    return names.join(" > ");
  }

  const paths = new Map();
  for (const entry of byId.entries()) paths.set(entry[0], pathOf(entry[1]));
  return { byId, paths };
}

function classifyProduct(product, groupsInfo) {
  const name = clean(product && product.name);
  const brand = brandOf(product);
  const groupId = groupIdOf(product);
  const groupPath = groupId == null ? "" : clean(groupsInfo.paths.get(String(groupId)) || "");
  const category = categoryNameOf(product);
  const haystack = [name, brand, groupPath, category].filter(Boolean).join(" | ");

  if (BLOCKED_BRANDS.some((rx) => rx.test(haystack))) {
    return { action: "REMOVE", reason: "blocked_brand", groupPath, brand };
  }
  if (HARD_BLOCK.some((rx) => rx.test(haystack))) {
    return { action: "REMOVE", reason: "non_apparel_hard_block", groupPath, brand };
  }
  if (APPAREL_OR_SHOES.some((rx) => rx.test(haystack))) {
    return { action: "KEEP", reason: "apparel_or_footwear", groupPath, brand };
  }
  if (BLOCK_GROUP.some((rx) => rx.test(groupPath))) {
    return { action: "REMOVE", reason: "non_apparel_group", groupPath, brand };
  }
  return { action: "REVIEW", reason: "uncertain", groupPath, brand };
}

function keywordTokens(value) {
  return clean(value)
    .split(/[\s,.;:()\[\]{}\/\\|+_-]+/u)
    .map((v) => v.trim())
    .filter((v) => v.length >= 3 && v.length <= 32 && !/^\d+$/u.test(v));
}

function unique(values, limit = 15) {
  const out = [];
  const seen = new Set();
  for (const raw of values) {
    const value = clean(raw);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

function buildKeywords(product, classification) {
  const name = clean(product && product.name);
  const brand = classification.brand;
  const groupPath = classification.groupPath;
  const isShoes = /взут|обув|ботин|черевик|берц|крос|шкарпет|носк|стельк/iu.test([name, groupPath].join(" "));
  const baseUa = isShoes ? "тактичне взуття" : "тактичний одяг";
  const baseRu = isShoes ? "тактическая обувь" : "тактическая одежда";
  const values = [
    name,
    brand,
    baseUa,
    baseRu,
    "купити " + name,
    "купить " + name,
    brand ? baseUa + " " + brand : "",
    brand ? baseRu + " " + brand : ""
  ];
  keywordTokens(name).forEach((token) => values.push(baseUa + " " + token));
  keywordTokens(name).forEach((token) => values.push(baseRu + " " + token));
  return unique(values, 15).join(", ").slice(0, 1024);
}

function buildDescriptions(product, classification) {
  const name = clean(product && product.name) || "Товар";
  const brand = classification.brand;
  const group = classification.groupPath.split(" > ").filter(Boolean).pop() || "";
  const sku = clean(product && (product.sku ?? product.sku_code ?? product.article ?? ""));

  const uaItems = [
    brand ? "<li><strong>Бренд:</strong> " + escapeHtml(brand) + "</li>" : "",
    sku ? "<li><strong>Артикул:</strong> " + escapeHtml(sku) + "</li>" : "",
    group ? "<li><strong>Категорія:</strong> " + escapeHtml(group) + "</li>" : ""
  ].filter(Boolean).join("");

  const ruItems = [
    brand ? "<li><strong>Бренд:</strong> " + escapeHtml(brand) + "</li>" : "",
    sku ? "<li><strong>Артикул:</strong> " + escapeHtml(sku) + "</li>" : "",
    group ? "<li><strong>Категория:</strong> " + escapeHtml(group) + "</li>" : ""
  ].filter(Boolean).join("");

  const ua = [
    "<p><strong>" + escapeHtml(name) + "</strong></p>",
    "<p>Практична модель з актуального каталогу PrimeTac Group. Ціна та наявність синхронізуються з даними постачальника.</p>",
    uaItems ? "<p><strong>Основна інформація:</strong></p><ul>" + uaItems + "</ul>" : "",
    "<p>Перед замовленням перевірте доступний розмір або варіант товару в картці.</p>"
  ].filter(Boolean).join("");

  const ru = [
    "<p><strong>" + escapeHtml(name) + "</strong></p>",
    "<p>Практичная модель из актуального каталога PrimeTac Group. Цена и наличие синхронизируются с данными поставщика.</p>",
    ruItems ? "<p><strong>Основная информация:</strong></p><ul>" + ruItems + "</ul>" : "",
    "<p>Перед заказом проверьте доступный размер или вариант товара в карточке.</p>"
  ].filter(Boolean).join("");

  return { ua, ru };
}

function keywordCount(product) {
  const raw = product && (
    product.keywords ??
    product.search_keywords ??
    product.searchKeywords ??
    ""
  );
  if (Array.isArray(raw)) return raw.filter(Boolean).length;
  return clean(raw).split(",").map((v) => v.trim()).filter(Boolean).length;
}

function shouldFillDescription(product) {
  return stripHtml(product && product.description).length < 180;
}

function shouldFillKeywords(product) {
  return keywordCount(product) < 6;
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
    console.error("[PROM_EDITOR_STATE_ERROR]", err?.message || String(err));
  }
}

async function promRequest(endpoint, { method = "GET", body = null, language = null } = {}) {
  if (!config.promToken) throw new Error("PROM_TOKEN is not configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.httpTimeoutMs);
  try {
    const response = await fetch(config.promApiBase + "/" + String(endpoint).replace(/^\/+/, ""), {
      method,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: "Bearer " + config.promToken,
        ...(language ? { "X-LANGUAGE": language } : {}),
        ...(body != null ? { "Content-Type": "application/json" } : {})
      },
      body: body != null ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text.slice(0, 500) };
    }
    if (!response.ok) {
      throw new Error(
        "Prom API " + response.status + " " + response.statusText + ": " +
        JSON.stringify(payload).slice(0, 800)
      );
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function hasErrors(payload) {
  const errors = payload?.errors;
  if (!errors) return false;
  if (typeof errors === "string") return errors.trim().length > 0;
  if (Array.isArray(errors)) return errors.length > 0;
  if (typeof errors === "object") return Object.keys(errors).length > 0;
  return false;
}

async function editProducts(items, language = "uk") {
  if (!items.length) return { processed: 0, responses: [] };
  const responses = [];
  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50);
    const response = await promRequest("products/edit", {
      method: "POST",
      language,
      body: batch
    });
    if (hasErrors(response)) {
      throw new Error("Prom products/edit returned errors: " + JSON.stringify(response.errors).slice(0, 1000));
    }
    responses.push(response);
  }
  return { processed: items.length, responses };
}

async function putTranslation(productId, lang, data) {
  return promRequest("products/translation", {
    method: "PUT",
    body: {
      product_id: String(productId),
      lang,
      ...data
    }
  });
}

async function buildPromEditorPlan() {
  const [products, groups] = await Promise.all([listProducts(), listGroups()]);
  const groupsInfo = buildGroupInfo(groups);
  const keep = [];
  const remove = [];
  const review = [];
  const editPayload = [];
  const translations = [];

  for (const product of products) {
    const classification = classifyProduct(product, groupsInfo);
    const item = {
      id: product?.id ?? null,
      name: clean(product?.name),
      externalId: clean(product?.external_id),
      sku: clean(product?.sku ?? product?.sku_code ?? product?.article),
      groupId: groupIdOf(product),
      groupPath: classification.groupPath,
      brand: classification.brand,
      presence: presenceOf(product),
      quantity: quantityOf(product),
      reason: classification.reason
    };

    if (classification.action === "REMOVE") {
      remove.push(item);
      if (isAvailable(product) || quantityOf(product) !== 0) {
        editPayload.push({
          id: Number(product.id),
          presence: "not_available",
          quantity_in_stock: 0
        });
      }
      continue;
    }

    if (classification.action === "REVIEW") {
      review.push(item);
      continue;
    }

    const fillKeywords = shouldFillKeywords(product);
    const fillDescription = shouldFillDescription(product);
    const payload = { id: Number(product.id) };
    const keywords = buildKeywords(product, classification);

    if (fillKeywords) payload.keywords = keywords;

    if (fillDescription) {
      const descriptions = buildDescriptions(product, classification);
      payload.description = descriptions.ua;
      translations.push({
        productId: String(product.id),
        lang: "ru",
        data: {
          description: descriptions.ru,
          ...(fillKeywords ? { keywords } : {})
        }
      });
    } else if (fillKeywords) {
      translations.push({
        productId: String(product.id),
        lang: "ru",
        data: { keywords }
      });
    }

    if (Object.keys(payload).length > 1) editPayload.push(payload);

    keep.push({
      ...item,
      fillKeywords,
      fillDescription
    });
  }

  const countsByGroup = new Map();
  for (const product of products) {
    const gid = groupIdOf(product);
    if (gid == null) continue;
    countsByGroup.set(String(gid), (countsByGroup.get(String(gid)) || 0) + 1);
  }

  const emptyGroups = (groups || [])
    .filter((group) => group?.id != null && !countsByGroup.has(String(group.id)))
    .map((group) => ({
      id: group.id,
      name: clean(group?.name ?? group?.title),
      parentId: group?.parent_group_id ?? group?.parent_id ?? group?.parent?.id ?? null,
      path: clean(groupsInfo.paths.get(String(group.id)) || "")
    }));

  return {
    version: EDITOR_VERSION,
    generatedAt: new Date().toISOString(),
    mode: "POST_IMPORT_EDITOR",
    policy: {
      keep: "clothing and footwear only",
      blockedBrands: ["LOWA", "Helikon-Tex"],
      removeImplementation: "mark_not_available_via_public_api",
      unknownProducts: "review_only",
      groupDeletion: "report_only_public_api_has_no_group_delete"
    },
    counts: {
      products: products.length,
      keep: keep.length,
      remove: remove.length,
      review: review.length,
      edits: editPayload.length,
      translations: translations.length,
      emptyGroups: emptyGroups.length
    },
    keep,
    remove,
    review,
    emptyGroups,
    editPayload,
    translations
  };
}

async function runPromEditor({ apply = false, reason = "manual" } = {}) {
  const plan = await buildPromEditorPlan();
  const result = {
    version: EDITOR_VERSION,
    reason,
    apply,
    startedAt: new Date().toISOString(),
    plan: {
      generatedAt: plan.generatedAt,
      policy: plan.policy,
      counts: plan.counts,
      removeExamples: plan.remove.slice(0, 40),
      reviewExamples: plan.review.slice(0, 40),
      emptyGroupExamples: plan.emptyGroups.slice(0, 40)
    },
    applied: {
      productEdits: 0,
      translations: 0
    }
  };

  if (apply) {
    const edits = await editProducts(plan.editPayload, "uk");
    result.applied.productEdits = edits.processed;

    for (const item of plan.translations) {
      try {
        await putTranslation(item.productId, item.lang, item.data);
        result.applied.translations++;
      } catch (err) {
        console.error("[PROM_EDITOR_TRANSLATION_ERROR]", JSON.stringify({
          productId: item.productId,
          error: err?.message || String(err)
        }));
      }
    }
  }

  result.finishedAt = new Date().toISOString();
  const state = readState();
  state.lastRun = result;
  state.version = EDITOR_VERSION;
  writeState(state);

  console.log("[PROM_EDITOR_RUN]");
  console.log(JSON.stringify(result));
  return result;
}

module.exports = {
  EDITOR_VERSION,
  STATE_PATH,
  classifyProduct,
  buildPromEditorPlan,
  runPromEditor
};
