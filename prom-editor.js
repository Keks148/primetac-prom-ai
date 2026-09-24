const fs = require("fs");
const path = require("path");
const { config } = require("./config");
const { listProducts, listGroups } = require("./prom");

const EDITOR_VERSION = "2.1.1";
const STATE_PATH =
  process.env.PROM_EDITOR_STATE_PATH ||
  "/var/data/primetac-prom-editor-state.json";

const BLOCKED_BRANDS = [
  /\blowa\b/iu,
  /\bhelikon[\s-]*tex\b/iu,
  /\bhelikon\b/iu,
  /хеликон/iu
];

const SAFE_HEADWEAR = [
  /шапк/iu,
  /балаклав/iu,
  /баф/iu,
  /панам/iu,
  /кепк/iu,
  /бейсболк/iu,
  /берет/iu,
  /головн.*убор/iu
];

const HARD_BLOCK = [
  /бронеплит/iu,
  /бронепак/iu,
  /plate\s*carrier/iu,
  /плитоноск/iu,
  /рпс/iu,
  /разгруз/iu,
  /розвантаж/iu,
  /шлем/iu,
  /\bhelmet/iu,
  /каск/iu,
  /кавер.*(?:шлем|шолом|каск)/iu,
  /чехол.*(?:шлем|каск)/iu,
  /чохол.*шолом/iu,
  /накладк.*(?:шлем|каск)/iu,
  /накладк.*шолом/iu,
  /окуляр/iu,
  /очки/iu,
  /goggle/iu,
  /магазин.*(?:оруж|збро|автомат|винтов|пістолет|пистолет)/iu,
  /(?:оруж|збро).*магазин/iu,
  /підсум/iu,
  /подсум/iu,
  /кобур/iu,
  /holster/iu,
  /рем(?:ень|інь).*оруж/iu,
  /оруж.*рем(?:ень|інь)/iu,
  /рем(?:ень|інь).*збро/iu,
  /збро.*рем(?:ень|інь)/iu,
  /рюкзак/iu,
  /сумк/iu,
  /мессендж/iu,
  /баул/iu,
  /органайзер/iu,
  /карабин/iu,
  /карабін/iu,
  /фонар/iu,
  /ліхтар/iu,
  /наушник/iu,
  /навушник/iu,
  /нож/iu,
  /ніж/iu,
  /мультитул/iu,
  /шеврон/iu,
  /патч/iu,
  /спальн.*(?:меш|міш)/iu,
  /каремат/iu,
  /наколен/iu,
  /налокот/iu,
  /маскувальн.*сіт/iu,
  /маскировочн.*сет/iu,
  /сетк.*маскир/iu,
  /cетк.*маскир/iu,
  /термоодеял/iu,
  /сертификат/iu,
  /сертифікат/iu
];

const APPAREL_OR_SHOES = [
  /тактичн.*одяг/iu,
  /тактическ.*одежд/iu,
  /одяг/iu,
  /одежд/iu,
  /футболк/iu,
  /поло/iu,
  /штани/iu,
  /штаны/iu,
  /брюк/iu,
  /шорт/iu,
  /джинс/iu,
  /трус/iu,
  /куртк/iu,
  /вітров/iu,
  /ветров/iu,
  /кофт/iu,
  /худі/iu,
  /худи/iu,
  /фліс/iu,
  /флис/iu,
  /сороч/iu,
  /рубаш/iu,
  /\bubacs\b/iu,
  /термобілиз/iu,
  /термобель/iu,
  /дощов/iu,
  /дождев/iu,
  /пончо/iu,
  /костюм/iu,
  /жилет/iu,
  /безрукав/iu,
  /бомбер/iu,
  /анорак/iu,
  /св[іи]тшот/iu,
  /толстовк/iu,
  /манти/iu,
  /ботин/iu,
  /черевик/iu,
  /берц/iu,
  /крос/iu,
  /взут/iu,
  /обув/iu,
  /сандал/iu,
  /тапк/iu,
  /шкарпет/iu,
  /носк/iu,
  /стельк/iu,
  /рукавич/iu,
  /перчат/iu,
  /головн.*убор/iu,
  /кепк/iu,
  /бейсболк/iu,
  /панам/iu,
  /шапк/iu,
  /баф/iu,
  /балаклав/iu,
  /берет/iu
];

const BLOCK_GROUP = [
  /тактичн.*споряджен/iu,
  /тактическ.*снаряжен/iu,
  /захисн.*споряджен/iu,
  /защитн.*снаряжен/iu,
  /аксесуар/iu,
  /рюкзак/iu,
  /сумк/iu,
  /туризм.*споряджен/iu
];

const TARGET_GROUPS = {
  CLOTHING: 157085421,
  FOOTWEAR: 157085422,
  HEADWEAR: 157085423,
  JACKETS: 157085430,
  PANTS: 157085431,
  FLEECE: 157085432,
  TSHIRTS: 157085433,
  SHIRTS: 157085434,
  THERMAL: 157085435,
  RAIN: 157085436,
  BOOTS: 157085437,
  SNEAKERS: 157085438,
  SOCKS: 157085439,
  CAPS: 157085440,
  BALACLAVA: 157085441,
  HATS_BUFFS: 157085442,
  GLOVES: 157085451
};

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function norm(value) {
  return clean(value).toLowerCase();
}

function stripHtml(value) {
  return clean(String(value ?? "").replace(/<[^>]*>/g, " "));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function groupIdOf(product) {
  return (
    product?.group?.id ??
    product?.group_id ??
    product?.category_id ??
    null
  );
}

function brandOf(product) {
  return clean(
    product?.vendor ??
    product?.brand ??
    product?.manufacturer ??
    product?.producer ??
    ""
  );
}

function categoryNameOf(product) {
  return clean(
    product?.category?.name ??
    product?.category?.caption ??
    ""
  );
}

function quantityOf(product) {
  const value =
    product?.quantity_in_stock ??
    product?.quantity ??
    product?.stock_quantity ??
    product?.stock ??
    null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function presenceOf(product) {
  return norm(
    product?.presence ??
    product?.availability ??
    product?.available ??
    ""
  );
}

function isAvailable(product) {
  const presence = presenceOf(product);
  if (
    ["available", "in_stock", "true", "1", "в наявності", "в наличии"]
      .includes(presence)
  ) return true;
  if (
    ["not_available", "unavailable", "out_of_stock", "false", "0", "немає", "нет"]
      .includes(presence)
  ) return false;
  const q = quantityOf(product);
  return q == null ? true : q > 0;
}

function buildGroupInfo(groups) {
  const byId = new Map();
  for (const group of groups || []) {
    if (group?.id != null) byId.set(String(group.id), group);
  }

  function pathOf(group) {
    const names = [];
    const seen = new Set();
    let current = group;
    while (current?.id != null && !seen.has(String(current.id))) {
      seen.add(String(current.id));
      const name = clean(current?.name ?? current?.title);
      if (name) names.unshift(name);
      const parentId =
        current?.parent_group_id ??
        current?.parent_id ??
        current?.parent?.id ??
        null;
      if (parentId == null) break;
      current = byId.get(String(parentId)) || null;
    }
    return names.join(" > ");
  }

  const paths = new Map();
  for (const [id, group] of byId.entries()) paths.set(id, pathOf(group));
  return { byId, paths };
}

function classifyProduct(product, groupsInfo) {
  const name = clean(product?.name);
  const brand = brandOf(product);
  const groupId = groupIdOf(product);
  const groupPath =
    groupId == null
      ? ""
      : clean(groupsInfo.paths.get(String(groupId)) || "");
  const category = categoryNameOf(product);

  const identityText = [name, brand, category].filter(Boolean).join(" | ");
  const productText = [name, category].filter(Boolean).join(" | ");

  if (BLOCKED_BRANDS.some(rx => rx.test(identityText))) {
    return { action: "REMOVE", reason: "blocked_brand", groupPath, brand };
  }

  // "Шапка-подшлемник" is headwear, not a helmet.
  if (SAFE_HEADWEAR.some(rx => rx.test(productText))) {
    return { action: "KEEP", reason: "headwear_exception", groupPath, brand };
  }

  if (HARD_BLOCK.some(rx => rx.test(productText))) {
    return {
      action: "REMOVE",
      reason: "non_apparel_hard_block",
      groupPath,
      brand
    };
  }

  if (APPAREL_OR_SHOES.some(rx => rx.test(productText))) {
    return {
      action: "KEEP",
      reason: "apparel_or_footwear",
      groupPath,
      brand
    };
  }

  if (APPAREL_OR_SHOES.some(rx => rx.test(groupPath))) {
    return {
      action: "KEEP",
      reason: "apparel_or_footwear_group",
      groupPath,
      brand
    };
  }

  if (BLOCK_GROUP.some(rx => rx.test(groupPath))) {
    return {
      action: "REMOVE",
      reason: "non_apparel_group",
      groupPath,
      brand
    };
  }

  return { action: "REVIEW", reason: "uncertain", groupPath, brand };
}

function targetGroupForProduct(product) {
  // Group by the product name only. Prom marketplace/category data can be wrong
  // after supplier imports and must not move a fleece jacket into thermal underwear.
  const text = norm(product?.name);

  if (/термобілиз|термобель|thermal underwear|base layer/iu.test(text)) {
    return { id: TARGET_GROUPS.THERMAL, labelUa: "Термобілизна", labelRu: "Термобелье" };
  }
  if (/дощов|дождев|пончо/iu.test(text)) {
    return { id: TARGET_GROUPS.RAIN, labelUa: "Дощовики та пончо", labelRu: "Дождевики и пончо" };
  }
  if (/куртк|вітров|ветров|бомбер|анорак|jacket|smock|parka/iu.test(text)) {
    return { id: TARGET_GROUPS.JACKETS, labelUa: "Куртки та вітровки", labelRu: "Куртки и ветровки" };
  }
  if (/фліс|флис|fleece|худі|худи|hoodie|кофт|толстовк|св[іи]тшот|sweatshirt/iu.test(text)) {
    return { id: TARGET_GROUPS.FLEECE, labelUa: "Фліс, кофти та худі", labelRu: "Флис, кофты и худи" };
  }
  if (/футболк|поло/iu.test(text)) {
    return { id: TARGET_GROUPS.TSHIRTS, labelUa: "Футболки та поло", labelRu: "Футболки и поло" };
  }
  if (/сороч|рубаш|shirt|\bubacs\b/iu.test(text)) {
    return { id: TARGET_GROUPS.SHIRTS, labelUa: "Сорочки та UBACS", labelRu: "Рубашки и UBACS" };
  }
  if (/штани|штаны|брюк|pants|trousers|шорт|shorts|джинс|jeans|карго|cargo|трус/iu.test(text)) {
    return { id: TARGET_GROUPS.PANTS, labelUa: "Штани та шорти", labelRu: "Брюки и шорты" };
  }
  if (/ботин|черевик|берц|boots?/iu.test(text)) {
    return { id: TARGET_GROUPS.BOOTS, labelUa: "Черевики та берці", labelRu: "Ботинки и берцы" };
  }
  if (/крос|sneakers?|trainers?/iu.test(text)) {
    return { id: TARGET_GROUPS.SNEAKERS, labelUa: "Кросівки", labelRu: "Кроссовки" };
  }
  if (/шкарпет|носк|стельк/iu.test(text)) {
    return { id: TARGET_GROUPS.SOCKS, labelUa: "Шкарпетки та устілки", labelRu: "Носки и стельки" };
  }
  if (/балаклав|подшлемник/iu.test(text)) {
    return { id: TARGET_GROUPS.BALACLAVA, labelUa: "Балаклави", labelRu: "Балаклавы" };
  }
  if (/кепк|бейсболк|панам/iu.test(text)) {
    return { id: TARGET_GROUPS.CAPS, labelUa: "Кепки та панами", labelRu: "Кепки и панамы" };
  }
  if (/шапк|баф|берет/iu.test(text)) {
    return { id: TARGET_GROUPS.HATS_BUFFS, labelUa: "Шапки та бафи", labelRu: "Шапки и бафы" };
  }
  if (/рукавич|перчат/iu.test(text)) {
    return { id: TARGET_GROUPS.GLOVES, labelUa: "Рукавички", labelRu: "Перчатки" };
  }
  if (/взут|обув|сандал|тапк/iu.test(text)) {
    return { id: TARGET_GROUPS.FOOTWEAR, labelUa: "Тактичне взуття", labelRu: "Тактическая обувь" };
  }
  if (/головн.*убор/iu.test(text)) {
    return { id: TARGET_GROUPS.HEADWEAR, labelUa: "Головні убори", labelRu: "Головные уборы" };
  }
  if (APPAREL_OR_SHOES.some(rx => rx.test(text))) {
    return { id: TARGET_GROUPS.CLOTHING, labelUa: "Тактичний одяг", labelRu: "Тактическая одежда" };
  }
  return null;
}

function unique(values, limit = 10) {
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

function joinMax(values, maxLength = 255) {
  const out = [];
  let total = 0;
  for (const value of values) {
    const v = clean(value).slice(0, 50);
    if (!v) continue;
    const extra = (out.length ? 2 : 0) + v.length;
    if (total + extra > maxLength) break;
    out.push(v);
    total += extra;
  }
  return out.join(", ");
}

function buildKeywords(product, classification) {
  const name = clean(product?.name);
  const brand = classification?.brand || brandOf(product);
  const target = targetGroupForProduct(product);
  const ua = target?.labelUa || "тактичний одяг";
  const ru = target?.labelRu || "тактическая одежда";

  return joinMax(unique([
    name,
    brand,
    ua,
    ru,
    "купити " + name,
    "купить " + name,
    brand ? ua + " " + brand : "",
    brand ? ru + " " + brand : "",
    "PrimeTac Group " + ua
  ], 9), 255);
}

function buildDescriptions(product, classification) {
  const name = clean(product?.name) || "Товар";
  const target = targetGroupForProduct(product);
  const brand = classification?.brand || brandOf(product);
  const sku = clean(product?.sku ?? product?.sku_code ?? product?.article ?? "");

  const uaItems = [
    brand ? "<li><strong>Бренд:</strong> " + escapeHtml(brand) + "</li>" : "",
    sku ? "<li><strong>Артикул:</strong> " + escapeHtml(sku) + "</li>" : "",
    target ? "<li><strong>Тип:</strong> " + escapeHtml(target.labelUa) + "</li>" : ""
  ].filter(Boolean).join("");

  const ruItems = [
    brand ? "<li><strong>Бренд:</strong> " + escapeHtml(brand) + "</li>" : "",
    sku ? "<li><strong>Артикул:</strong> " + escapeHtml(sku) + "</li>" : "",
    target ? "<li><strong>Тип:</strong> " + escapeHtml(target.labelRu) + "</li>" : ""
  ].filter(Boolean).join("");

  return {
    ua: [
      "<p><strong>" + escapeHtml(name) + "</strong></p>",
      "<p>Практична модель з актуального каталогу PrimeTac Group. Ціна та наявність оновлюються з даних постачальника.</p>",
      uaItems ? "<p><strong>Основна інформація:</strong></p><ul>" + uaItems + "</ul>" : "",
      "<p>Перед замовленням перевірте доступний розмір або варіант товару в картці.</p>"
    ].filter(Boolean).join(""),
    ru: [
      "<p><strong>" + escapeHtml(name) + "</strong></p>",
      "<p>Практичная модель из актуального каталога PrimeTac Group. Цена и наличие обновляются из данных поставщика.</p>",
      ruItems ? "<p><strong>Основная информация:</strong></p><ul>" + ruItems + "</ul>" : "",
      "<p>Перед заказом проверьте доступный размер или вариант товара в карточке.</p>"
    ].filter(Boolean).join("")
  };
}

function keywordCount(product) {
  const raw =
    product?.keywords ??
    product?.search_keywords ??
    product?.searchKeywords ??
    "";
  if (Array.isArray(raw)) return raw.filter(Boolean).length;
  return clean(raw).split(",").map(v => v.trim()).filter(Boolean).length;
}

function shouldFillDescription(product) {
  return stripHtml(product?.description).length < 180;
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

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function promRequest(endpoint, { method = "GET", body = null, language = null } = {}, attempt = 0) {
  if (!config.promToken) throw new Error("PROM_TOKEN is not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.httpTimeoutMs);

  try {
    const response = await fetch(
      config.promApiBase + "/" + String(endpoint).replace(/^\/+/, ""),
      {
        method,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          Authorization: "Bearer " + config.promToken,
          ...(language ? { "X-LANGUAGE": language } : {}),
          ...(body != null ? { "Content-Type": "application/json" } : {})
        },
        body: body != null ? JSON.stringify(body) : undefined
      }
    );

    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text.slice(0, 500) };
    }

    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      await wait(700 * 2 ** attempt);
      return promRequest(endpoint, { method, body, language }, attempt + 1);
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
      throw new Error(
        "Prom products/edit returned errors: " +
        JSON.stringify(response.errors).slice(0, 1000)
      );
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
  const groupFixes = [];
  const editPayload = [];
  const translations = [];

  for (const product of products) {
    const classification = classifyProduct(product, groupsInfo);
    const currentGroupId = groupIdOf(product);
    const targetGroup = targetGroupForProduct(product);

    const item = {
      id: product?.id ?? null,
      name: clean(product?.name),
      externalId: clean(product?.external_id),
      sku: clean(product?.sku ?? product?.sku_code ?? product?.article),
      groupId: currentGroupId,
      groupPath: classification.groupPath,
      targetGroupId: targetGroup?.id ?? null,
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

    if (
      targetGroup?.id &&
      String(currentGroupId || "") !== String(targetGroup.id)
    ) {
      groupFixes.push({
        id: product.id,
        name: clean(product.name),
        from: currentGroupId,
        to: targetGroup.id,
        label: targetGroup.labelUa
      });
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
    const key = String(gid);
    countsByGroup.set(key, (countsByGroup.get(key) || 0) + 1);
  }

  const emptyGroups = (groups || [])
    .filter(group => group?.id != null && !countsByGroup.has(String(group.id)))
    .map(group => ({
      id: group.id,
      name: clean(group?.name ?? group?.title),
      parentId:
        group?.parent_group_id ??
        group?.parent_id ??
        group?.parent?.id ??
        null,
      path: clean(groupsInfo.paths.get(String(group.id)) || "")
    }));

  return {
    version: EDITOR_VERSION,
    generatedAt: new Date().toISOString(),
    mode: "POST_IMPORT_EDITOR",
    policy: {
      keep: "clothing, footwear, headwear and gloves only",
      blockedBrands: ["LOWA", "Helikon-Tex"],
      removeImplementation: "mark_not_available_via_public_api",
      unknownProducts: "review_only",
      groupFixes: "via enrichment import only",
      groupDeletion: "report_only"
    },
    counts: {
      products: products.length,
      keep: keep.length,
      remove: remove.length,
      review: review.length,
      groupFixes: groupFixes.length,
      edits: editPayload.length,
      translations: translations.length,
      emptyGroups: emptyGroups.length
    },
    keep,
    remove,
    review,
    groupFixes,
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
      groupFixExamples: plan.groupFixes.slice(0, 40),
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
  TARGET_GROUPS,
  clean,
  norm,
  stripHtml,
  groupIdOf,
  brandOf,
  categoryNameOf,
  buildGroupInfo,
  classifyProduct,
  targetGroupForProduct,
  buildKeywords,
  buildDescriptions,
  buildPromEditorPlan,
  runPromEditor
};
