const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const {
  mapSelectedProduct
} = require("./group-mapper");

const ENRICHMENT_VERSION =
  "1.0.0";

const CACHE_PATH =
  process.env
    .ENRICHMENT_CACHE_PATH ||
  "/var/data/primetac-enrichment-cache.json";

let memoryCache = null;

const GROUP_LABELS = {
  "156580908": {
    ua: "Окуляри та маски",
    ru: "Очки и маски"
  },

  "156580910": {
    ua: "Маскувальні костюми",
    ru: "Маскировочные костюмы"
  },

  "157085421": {
    ua: "Тактичний одяг",
    ru: "Тактическая одежда"
  },

  "157085422": {
    ua: "Тактичне взуття",
    ru: "Тактическая обувь"
  },

  "157085423": {
    ua: "Головні убори",
    ru: "Головные уборы"
  },

  "157085424": {
    ua: "Рюкзаки та сумки",
    ru: "Рюкзаки и сумки"
  },

  "157085425": {
    ua: "Тактичне спорядження",
    ru: "Тактическое снаряжение"
  },

  "157085427": {
    ua: "Туризм та польове спорядження",
    ru: "Туризм и полевое снаряжение"
  },

  "157085428": {
    ua: "Аксесуари",
    ru: "Аксессуары"
  },

  "157085430": {
    ua: "Куртки та вітровки",
    ru: "Куртки и ветровки"
  },

  "157085431": {
    ua: "Штани та шорти",
    ru: "Брюки и шорты"
  },

  "157085432": {
    ua: "Фліс, кофти та худі",
    ru: "Флис, кофты и худи"
  },

  "157085433": {
    ua: "Футболки та поло",
    ru: "Футболки и поло"
  },

  "157085434": {
    ua: "Сорочки та UBACS",
    ru: "Рубашки и UBACS"
  },

  "157085435": {
    ua: "Термобілизна",
    ru: "Термобелье"
  },

  "157085436": {
    ua: "Дощовики та пончо",
    ru: "Дождевики и пончо"
  },

  "157085437": {
    ua: "Черевики та берці",
    ru: "Ботинки и берцы"
  },

  "157085438": {
    ua: "Кросівки",
    ru: "Кроссовки"
  },

  "157085439": {
    ua: "Шкарпетки та устілки",
    ru: "Носки и стельки"
  },

  "157085440": {
    ua: "Кепки",
    ru: "Кепки"
  },

  "157085441": {
    ua: "Балаклави",
    ru: "Балаклавы"
  },

  "157085442": {
    ua: "Шапки та бафи",
    ru: "Шапки и бафы"
  },

  "157085443": {
    ua: "Рюкзаки",
    ru: "Рюкзаки"
  },

  "157085444": {
    ua: "Тактичні сумки",
    ru: "Тактические сумки"
  },

  "157085445": {
    ua: "Баули та органайзери",
    ru: "Баулы и органайзеры"
  },

  "157085446": {
    ua: "Плитоноски та жилети",
    ru: "Плитоноски и жилеты"
  },

  "157085447": {
    ua: "РПС та розвантаження",
    ru: "РПС и разгрузочные системы"
  },

  "157085448": {
    ua: "Підсумки",
    ru: "Подсумки"
  },

  "157085449": {
    ua: "Ремені",
    ru: "Ремни"
  },

  "157085450": {
    ua: "Кобури та кріплення",
    ru: "Кобуры и крепления"
  },

  "157085451": {
    ua: "Рукавички",
    ru: "Перчатки"
  },

  "157085453": {
    ua: "Наколінники та налокітники",
    ru: "Наколенники и налокотники"
  },

  "157085454": {
    ua: "Спальні мішки",
    ru: "Спальные мешки"
  },

  "157085455": {
    ua: "Патчі та шеврони",
    ru: "Патчи и шевроны"
  },

  "157085456": {
    ua: "Інструменти та карабіни",
    ru: "Инструменты и карабины"
  },

  "157085457": {
    ua: "Інші аксесуари",
    ru: "Другие аксессуары"
  }
};

const VARIANT_PARAM_WORDS = [
  "розмір",
  "размер",
  "size",
  "колір",
  "цвет",
  "color",
  "colour",
  "рост",
  "зріст"
];

function clean(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function norm(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[’'`"]/g, "")
    .replace(/[^a-zа-яіїєґ0-9]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripHtml(value) {
  return clean(
    String(value ?? "")
      .replace(
        /<script[\s\S]*?<\/script>/giu,
        " "
      )
      .replace(
        /<style[\s\S]*?<\/style>/giu,
        " "
      )
      .replace(
        /<[^>]+>/g,
        " "
      )
      .replace(
        /&nbsp;/giu,
        " "
      )
      .replace(
        /&amp;/giu,
        "&"
      )
  );
}

function shortText(
  value,
  max = 900
) {
  const text =
    stripHtml(value);

  if (
    text.length <= max
  ) {
    return text;
  }

  return (
    text
      .slice(0, max - 1)
      .trim() +
    "…"
  );
}

function hash(value) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(value)
    )
    .digest("hex");
}

function emptyCache() {
  return {
    schema: 1,
    enrichmentVersion:
      ENRICHMENT_VERSION,
    createdAt:
      new Date().toISOString(),
    updatedAt:
      new Date().toISOString(),
    entries: {}
  };
}

function ensureDir() {
  fs.mkdirSync(
    path.dirname(CACHE_PATH),
    {
      recursive: true
    }
  );
}

function loadCache() {
  if (memoryCache) {
    return memoryCache;
  }

  try {
    const parsed =
      JSON.parse(
        fs.readFileSync(
          CACHE_PATH,
          "utf8"
        )
      );

    if (
      parsed &&
      parsed.entries &&
      typeof parsed.entries ===
        "object"
    ) {
      memoryCache =
        parsed;

      return memoryCache;
    }
  } catch {
    // Первый запуск или поврежденный
    // старый файл: создаем новый.
  }

  memoryCache =
    emptyCache();

  return memoryCache;
}

function saveCache(cache) {
  ensureDir();

  cache.updatedAt =
    new Date().toISOString();

  const tmp =
    `${CACHE_PATH}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(
      cache,
      null,
      2
    ),
    "utf8"
  );

  fs.renameSync(
    tmp,
    CACHE_PATH
  );

  memoryCache =
    cache;
}

function supplierData(
  suppliers,
  supplierName
) {
  return supplierName ===
    "BEZET"
      ? suppliers.bezet
      : suppliers.militaris;
}

function familyOffers(
  suppliers,
  row
) {
  const data =
    supplierData(
      suppliers,
      row.supplier
    );

  return (
    data?.offers || []
  ).filter(
    offer =>
      String(
        offer.groupId ||
        offer.id ||
        ""
      ) ===
      String(
        row.groupId ||
        ""
      )
  );
}

function sourceCategory(
  suppliers,
  row
) {
  const data =
    supplierData(
      suppliers,
      row.supplier
    );

  return (
    data?.categories || []
  ).find(
    category =>
      String(category.id) ===
      String(
        row.categoryId ||
        ""
      )
  ) || null;
}

function firstValue(
  items,
  key
) {
  const found =
    (items || []).find(
      item =>
        clean(
          item?.[key]
        )
    );

  return clean(
    found?.[key]
  );
}

function collectPictures(
  items
) {
  const out = [];
  const seen =
    new Set();

  for (
    const item
    of items || []
  ) {
    for (
      const picture
      of item?.pictures || []
    ) {
      const value =
        clean(picture);

      if (
        !value ||
        seen.has(value)
      ) {
        continue;
      }

      seen.add(value);
      out.push(value);

      if (
        out.length >= 10
      ) {
        return out;
      }
    }
  }

  return out;
}

function collectCharacteristics(
  items
) {
  const map =
    new Map();

  for (
    const item
    of items || []
  ) {
    for (
      const param
      of item?.params || []
    ) {
      const name =
        clean(param?.name);

      const value =
        clean(param?.value);

      if (
        !name ||
        !value
      ) {
        continue;
      }

      const key =
        norm(name);

      if (!map.has(key)) {
        map.set(
          key,
          {
            name,
            values:
              new Set()
          }
        );
      }

      map
        .get(key)
        .values.add(value);
    }
  }

  return [
    ...map.values()
  ]
    .map(
      item => ({
        name:
          item.name,

        values:
          [...item.values]
            .slice(0, 40)
      })
    )
    .slice(0, 60);
}

function staticCharacteristics(
  characteristics
) {
  return (
    characteristics || []
  )
    .filter(item => {
      const name =
        norm(item.name);

      return !VARIANT_PARAM_WORDS
        .some(
          word =>
            name.includes(word)
        );
    })
    .filter(
      item =>
        item.values.length === 1
    )
    .slice(0, 8);
}

function variantsSummary(
  characteristics
) {
  return (
    characteristics || []
  )
    .filter(item => {
      const name =
        norm(item.name);

      return (
        VARIANT_PARAM_WORDS
          .some(
            word =>
              name.includes(word)
          ) ||
        item.values.length > 1
      );
    })
    .slice(0, 3)
    .map(
      item => ({
        name:
          item.name,
        values:
          item.values.slice(
            0,
            30
          )
      })
    );
}

function groupLabels(
  mapping,
  promGroups
) {
  const id =
    String(
      mapping?.groupId ||
      ""
    );

  if (
    GROUP_LABELS[id]
  ) {
    return GROUP_LABELS[id];
  }

  const promGroup =
    (promGroups || [])
      .find(
        group =>
          String(group?.id) === id
      );

  const name =
    clean(
      promGroup?.name
    );

  return {
    ua:
      name ||
      "Товар",
    ru:
      name ||
      "Товар"
  };
}

function keywordTokens(
  sourceName
) {
  const banned =
    new Set([
      "bezet",
      "militaris",
      "black",
      "olive",
      "coyote",
      "multicam",
      "черный",
      "чорний",
      "хаки",
      "койот",
      "синий",
      "синій",
      "серый",
      "сірий"
    ]);

  return norm(sourceName)
    .split(" ")
    .filter(
      token =>
        token.length >= 4 &&
        !banned.has(token)
    )
    .slice(0, 6);
}

function uniqueList(
  values,
  max = 10
) {
  const out = [];
  const seen =
    new Set();

  for (
    const raw
    of values
  ) {
    const value =
      clean(raw);

    const key =
      norm(value);

    if (
      !value ||
      !key ||
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);
    out.push(value);

    if (
      out.length >= max
    ) {
      break;
    }
  }

  return out;
}

function buildKeywords({
  sourceName,
  brand,
  labels,
  language
}) {
  const category =
    language === "ua"
      ? labels.ua
      : labels.ru;

  const tactical =
    language === "ua"
      ? "тактичний"
      : "тактический";

  const buy =
    language === "ua"
      ? "купити"
      : "купить";

  const tokens =
    keywordTokens(
      sourceName
    );

  return uniqueList([
    sourceName,
    category,
    brand,
    brand
      ? `${category} ${brand}`
      : "",
    `${buy} ${category}`,
    `${tactical} ${category}`,
    ...tokens.map(
      token =>
        `${category} ${token}`
    )
  ], 10);
}

function listHtml(
  pairs,
  language
) {
  if (!pairs.length) {
    return "";
  }

  const title =
    language === "ua"
      ? "Основні характеристики"
      : "Основные характеристики";

  return [
    `<p><strong>${title}:</strong></p>`,
    "<ul>",
    ...pairs.map(
      ([name, value]) =>
        `<li><strong>${escapeHtml(name)}:</strong> ${escapeHtml(value)}</li>`
    ),
    "</ul>"
  ].join("");
}

function generateContent({
  row,
  offers,
  category,
  mapping,
  promGroups
}) {
  const sourceName =
    firstValue(
      offers,
      "name"
    ) ||
    clean(row.name);

  const brand =
    firstValue(
      offers,
      "vendor"
    );

  const sku =
    firstValue(
      offers,
      "sku"
    );

  const country =
    firstValue(
      offers,
      "country"
    );

  const barcode =
    firstValue(
      offers,
      "barcode"
    );

  const sourceDescription =
    shortText(
      firstValue(
        offers,
        "description"
      ),
      1000
    );

  const characteristics =
    collectCharacteristics(
      offers
    );

  const staticParams =
    staticCharacteristics(
      characteristics
    );

  const variantParams =
    variantsSummary(
      characteristics
    );

  const labels =
    groupLabels(
      mapping,
      promGroups
    );

  const uaPairs = [];
  const ruPairs = [];

  if (brand) {
    uaPairs.push([
      "Бренд",
      brand
    ]);

    ruPairs.push([
      "Бренд",
      brand
    ]);
  }

  uaPairs.push([
    "Категорія",
    labels.ua
  ]);

  ruPairs.push([
    "Категория",
    labels.ru
  ]);

  if (sku) {
    uaPairs.push([
      "Артикул",
      sku
    ]);

    ruPairs.push([
      "Артикул",
      sku
    ]);
  }

  if (country) {
    uaPairs.push([
      "Країна",
      country
    ]);

    ruPairs.push([
      "Страна",
      country
    ]);
  }

  for (
    const param
    of staticParams
  ) {
    uaPairs.push([
      param.name,
      param.values[0]
    ]);

    ruPairs.push([
      param.name,
      param.values[0]
    ]);
  }

  const safeSource =
    sourceDescription
      ? escapeHtml(
          sourceDescription
        )
      : "";

  const uaIntro =
    `${escapeHtml(sourceName)} — товар у категорії «${escapeHtml(labels.ua)}»${brand ? ` бренду ${escapeHtml(brand)}` : ""}.`;

  const ruIntro =
    `${escapeHtml(sourceName)} — товар в категории «${escapeHtml(labels.ru)}»${brand ? ` бренда ${escapeHtml(brand)}` : ""}.`;

  const uaVariantText =
    variantParams.length
      ? `<p>Доступні різновиди за характеристиками: ${escapeHtml(
          variantParams
            .map(
              item =>
                item.name
            )
            .join(", ")
        )}. Актуальна наявність конкретних варіантів оновлюється автоматично.</p>`
      : "";

  const ruVariantText =
    variantParams.length
      ? `<p>Доступные разновидности по характеристикам: ${escapeHtml(
          variantParams
            .map(
              item =>
                item.name
            )
            .join(", ")
        )}. Актуальное наличие конкретных вариантов обновляется автоматически.</p>`
      : "";

  const uaDescription = [
    `<p>${uaIntro}</p>`,
    safeSource
      ? `<p>${safeSource}</p>`
      : "",
    listHtml(
      uaPairs,
      "ua"
    ),
    uaVariantText,
    "<p>Фото, ціна та наявність синхронізуються з даними постачальника. Перед замовленням оберіть доступний варіант товару.</p>"
  ]
    .filter(Boolean)
    .join("");

  const ruDescription = [
    `<p>${ruIntro}</p>`,
    safeSource
      ? `<p>${safeSource}</p>`
      : "",
    listHtml(
      ruPairs,
      "ru"
    ),
    ruVariantText,
    "<p>Фото, цена и наличие синхронизируются с данными поставщика. Перед заказом выберите доступный вариант товара.</p>"
  ]
    .filter(Boolean)
    .join("");

  const keywordsUa =
    buildKeywords({
      sourceName,
      brand,
      labels,
      language:
        "ua"
    });

  const keywordsRu =
    buildKeywords({
      sourceName,
      brand,
      labels,
      language:
        "ru"
    });

  return {
    titleUa:
      sourceName,

    titleRu:
      sourceName,

    descriptionUa:
      uaDescription,

    descriptionRu:
      ruDescription,

    keywordsUa,
    keywordsRu,

    seo: {
      titleUa:
        `${sourceName} | PrimeTac Group`
          .slice(0, 110),

      titleRu:
        `${sourceName} | PrimeTac Group`
          .slice(0, 110),

      descriptionUa:
        `Замовити ${labels.ua.toLowerCase()} PrimeTac Group. Актуальні фото, характеристики, ціна та наявність.`
          .slice(0, 250),

      descriptionRu:
        `Заказать ${labels.ru.toLowerCase()} PrimeTac Group. Актуальные фото, характеристики, цена и наличие.`
          .slice(0, 250)
    },

    source: {
      categoryId:
        clean(
          row.categoryId
        ),

      categoryName:
        clean(
          category?.name
        ),

      categoryPath:
        clean(
          category?.path
        ),

      brand,
      sku,
      country,
      barcode
    }
  };
}

function sourceFingerprint({
  row,
  offers,
  category,
  mapping
}) {
  const characteristics =
    collectCharacteristics(
      offers
    );

  const staticParams =
    staticCharacteristics(
      characteristics
    );

  return hash({
    supplier:
      row.supplier,

    familyKey:
      row.familyKey,

    categoryId:
      row.categoryId,

    targetGroupId:
      mapping.groupId,

    name:
      firstValue(
        offers,
        "name"
      ) ||
      row.name,

    vendor:
      firstValue(
        offers,
        "vendor"
      ),

    description:
      firstValue(
        offers,
        "description"
      ),

    country:
      firstValue(
        offers,
        "country"
      ),

    barcode:
      firstValue(
        offers,
        "barcode"
      ),

    staticParams:
      staticParams.map(
        item => [
          item.name,
          item.values[0]
        ]
      ),

    sourceCategory:
      category
        ? [
            category.id,
            category.name,
            category.path
          ]
        : null
  });
}

function buildDynamic({
  row,
  offers,
  mapping
}) {
  const available =
    offers.filter(
      offer => {
        const raw =
          clean(
            offer.available
          ).toLowerCase();

        if (
          [
            "true",
            "1",
            "yes",
            "available",
            "in_stock"
          ].includes(raw)
        ) {
          return true;
        }

        const quantity =
          Number(
            offer.quantity
          );

        return (
          Number.isFinite(
            quantity
          ) &&
          quantity > 0
        );
      }
    );

  return {
    targetGroupId:
      mapping.groupId,

    pictures:
      collectPictures(
        offers
      ),

    characteristics:
      collectCharacteristics(
        offers
      ),

    variants:
      variantsSummary(
        collectCharacteristics(
          offers
        )
      ),

    sourceOfferIds:
      offers
        .map(
          item =>
            clean(item.id)
        )
        .filter(Boolean),

    availableOfferIds:
      available
        .map(
          item =>
            clean(item.id)
        )
        .filter(Boolean),

    prices:
      uniqueList(
        available.map(
          item =>
            clean(item.price)
        ),
        30
      ),

    quantityTotal:
      available.reduce(
        (sum, item) => {
          const n =
            Number(
              item.quantity
            );

          return (
            sum +
            (
              Number.isFinite(n)
                ? Math.max(
                    0,
                    n
                  )
                : 0
            )
          );
        },
        0
      )
  };
}

function qualityOf(
  content,
  dynamic
) {
  const checks = {
    titleUa:
      Boolean(
        clean(
          content.titleUa
        )
      ),

    titleRu:
      Boolean(
        clean(
          content.titleRu
        )
      ),

    descriptionUa:
      Boolean(
        clean(
          content.descriptionUa
        )
      ),

    descriptionRu:
      Boolean(
        clean(
          content.descriptionRu
        )
      ),

    keywordsUa:
      content.keywordsUa
        .length >= 3,

    keywordsRu:
      content.keywordsRu
        .length >= 3,

    pictures:
      dynamic.pictures
        .length >= 1,

    targetGroup:
      Boolean(
        dynamic.targetGroupId
      )
  };

  const total =
    Object.keys(
      checks
    ).length;

  const passed =
    Object.values(
      checks
    )
      .filter(Boolean)
      .length;

  return {
    score:
      Math.round(
        passed /
        total *
        100
      ),

    checks,

    missing:
      Object.entries(
        checks
      )
        .filter(
          ([, ok]) =>
            !ok
        )
        .map(
          ([name]) =>
            name
        )
  };
}

function refreshEnrichment({
  suppliers,
  selectedRows,
  promGroups
}) {
  const cache =
    loadCache();

  const now =
    new Date()
      .toISOString();

  let changed =
    false;

  let generated =
    0;

  let regenerated =
    0;

  let reused =
    0;

  let locked =
    0;

  const items = [];

  for (
    const row
    of selectedRows || []
  ) {
    const mapping =
      mapSelectedProduct(
        row
      );

    if (
      mapping.status !==
        "MAPPED" ||
      !mapping.groupId
    ) {
      continue;
    }

    const offers =
      familyOffers(
        suppliers,
        row
      );

    if (!offers.length) {
      continue;
    }

    const category =
      sourceCategory(
        suppliers,
        row
      );

    const fingerprint =
      sourceFingerprint({
        row,
        offers,
        category,
        mapping
      });

    const old =
      cache.entries[
        row.familyKey
      ] ||
      null;

    let content;
    let event;

    if (
      old?.lockContent &&
      old?.content
    ) {
      content =
        old.content;

      event =
        "locked_reuse";

      locked++;
    } else if (
      old &&
      old.enrichmentVersion ===
        ENRICHMENT_VERSION &&
      old.sourceFingerprint ===
        fingerprint &&
      old.content
    ) {
      content =
        old.content;

      event =
        "reused";

      reused++;
    } else {
      content =
        generateContent({
          row,
          offers,
          category,
          mapping,
          promGroups
        });

      if (old) {
        event =
          "regenerated";

        regenerated++;
      } else {
        event =
          "generated";

        generated++;
      }

      changed =
        true;
    }

    const dynamic =
      buildDynamic({
        row,
        offers,
        mapping
      });

    let publishState =
      old?.publishState ||
      "never";

    if (
      old &&
      old.sourceFingerprint !==
        fingerprint &&
      publishState ===
        "published"
    ) {
      publishState =
        "metadata_dirty";
    }

    cache.entries[
      row.familyKey
    ] = {
      familyKey:
        row.familyKey,

      supplier:
        row.supplier,

      groupId:
        row.groupId,

      enrichmentVersion:
        ENRICHMENT_VERSION,

      sourceFingerprint:
        fingerprint,

      lockContent:
        Boolean(
          old?.lockContent
        ),

      publishState,

      content,

      createdAt:
        old?.createdAt ||
        now,

      contentUpdatedAt:
        event ===
          "generated" ||
        event ===
          "regenerated"
          ? now
          : old
              ?.contentUpdatedAt ||
            now,

      lastSeenAt:
        now
    };

    const quality =
      qualityOf(
        content,
        dynamic
      );

    const updateMode =
      publishState ===
        "never"
        ? "FULL"
        : publishState ===
            "metadata_dirty"
          ? "METADATA_AND_DYNAMIC"
          : "DYNAMIC_ONLY";

    items.push({
      familyKey:
        row.familyKey,

      supplier:
        row.supplier,

      sourceGroupId:
        row.groupId,

      sourceCategoryId:
        row.categoryId,

      event,
      updateMode,
      publishState,
      content,
      dynamic,
      quality
    });
  }

  if (
    changed ||
    !fs.existsSync(
      CACHE_PATH
    )
  ) {
    saveCache(cache);
  }

  const lowQuality =
    items.filter(
      item =>
        item.quality.score < 100
    );

  const summary = {
    enrichmentVersion:
      ENRICHMENT_VERSION,

    cachePath:
      CACHE_PATH,

    selected:
      items.length,

    generated,
    regenerated,
    reused,
    locked,

    fullPublishNeeded:
      items.filter(
        item =>
          item.updateMode ===
          "FULL"
      ).length,

    metadataRefreshNeeded:
      items.filter(
        item =>
          item.updateMode ===
          "METADATA_AND_DYNAMIC"
      ).length,

    dynamicOnly:
      items.filter(
        item =>
          item.updateMode ===
          "DYNAMIC_ONLY"
      ).length,

    perfectQuality:
      items.filter(
        item =>
          item.quality.score ===
          100
      ).length,

    lowQuality:
      lowQuality.length,

    lowQualityExamples:
      lowQuality
        .slice(0, 20)
        .map(
          item => ({
            familyKey:
              item.familyKey,

            supplier:
              item.supplier,

            score:
              item.quality.score,

            missing:
              item.quality.missing
          })
        )
  };

  return {
    summary,
    items
  };
}

function markPublished(
  familyKeys
) {
  const cache =
    loadCache();

  let changed =
    false;

  const now =
    new Date()
      .toISOString();

  for (
    const key
    of familyKeys || []
  ) {
    const entry =
      cache.entries[key];

    if (!entry) {
      continue;
    }

    entry.publishState =
      "published";

    entry.publishedAt =
      now;

    changed =
      true;
  }

  if (changed) {
    saveCache(cache);
  }

  return {
    changed
  };
}

module.exports = {
  ENRICHMENT_VERSION,
  CACHE_PATH,
  refreshEnrichment,
  markPublished
};
