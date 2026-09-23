function norm(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/[’'`"]/g, "")
    .replace(/&amp;/g, " ")
    .replace(/&#0?39;/g, "")
    .replace(/[^a-zа-яіїєґ0-9]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function priceOf(offer) {
  const raw = String(offer?.price ?? "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "");

  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function isAvailable(offer) {
  const raw = String(
    offer?.available ?? ""
  ).trim().toLowerCase();

  if (
    ["true", "1", "yes", "available", "in_stock"]
      .includes(raw)
  ) {
    return true;
  }

  if (
    ["false", "0", "no", "unavailable", "out_of_stock"]
      .includes(raw)
  ) {
    return false;
  }

  const q = Number(offer?.quantity);
  return Number.isFinite(q) && q > 0;
}

const FORBIDDEN = [
  // Шлемы / каски
  "шолом",
  "шлем",
  "каска",
  "helmet",

  // Баллистические плиты
  "бронеплита",
  "бронеплити",
  "бронеплиты",
  "броне плита",
  "броне плиты",
  "балістична плита",
  "балістичні плити",
  "баллистическая плита",
  "баллистические плиты",
  "armor plate",
  "armour plate",

  // Магазины / боеприпасы
  "магазин ак",
  "магазин для ак",
  "магазин ar",
  "магазин для ar",
  "магазин m4",
  "магазин для m4",
  "магазин glock",
  "магазин для glock",
  "magazine ak",
  "magazine ar",
  "патрон",
  "боєприпас",
  "боеприпас"
];

const CLOTHING = [
  "штани",
  "брюки",
  "джинси",
  "джинсы",
  "куртка",
  "парка",
  "бомбер",
  "вітровка",
  "ветровка",
  "анорак",
  "кофта",
  "худі",
  "худи",
  "світшот",
  "свитшот",
  "светр",
  "свитер",
  "фліска",
  "флиска",
  "флісова",
  "флисовая",
  "футболка",
  "лонгслів",
  "лонгслив",
  "поло",
  "сорочка",
  "рубашка",
  "шорти",
  "шорты",
  "термобілизна",
  "термобелье",
  "термо білизна",
  "термо белье",
  "костюм",
  "комплект одягу",
  "комплект одежды",
  "тактична форма",
  "тактическая форма",
  "дощовик",
  "дождевик",
  "плащ",
  "пончо",
  "білизна",
  "белье"
];

const FOOTWEAR = [
  "черевики",
  "ботинки",
  "берці",
  "берцы",
  "кросівки",
  "кроссовки",
  "взуття",
  "обувь",
  "сандалі",
  "сандалии",
  "тактичні туфлі",
  "тактические туфли",
  "boots",
  "shoes",
  "sneakers"
];


const MILITARIS_EXCLUDE_ALL_BRANDS = [
  "helikon tex",
  "helikon-tex",
  "хеликон текс",
  "хелікон текс"
];

const MILITARIS_EXCLUDE_FOOTWEAR_BRANDS = [
  "lowa",
  "лова"
];

const ACCESSORY = [
  "рюкзак",
  "сумка",
  "підсумок",
  "подсумок",
  "ремінь",
  "ремень",
  "баф",
  "балаклава",
  "шапка",
  "кепка",
  "панама",
  "рукавиц",
  "перчатк",
  "окуляр",
  "очки",
  "гамаш",
  "чохол",
  "чехол",
  "карабін",
  "карабин",
  "ліхтар",
  "фонарь",
  "аптечк",
  "нашивк",
  "шеврон",
  "кобура",
  "підтяжк",
  "подтяжк",
  "наколінник",
  "наколенник",
  "налокітник",
  "налокотник",
  "підвісна система",
  "подвесная система",
  "липучк",
  "molle"
];

function hasAny(text, needles) {
  return needles.some(x => text.includes(x));
}

function classifyFamily(items, supplierName) {
  const name =
    items.find(x => x?.name)?.name || "";

  const vendor =
    items.find(x => x?.vendor)?.vendor || "";

  const text =
    norm(`${name} ${vendor}`);

  const isFootwear =
    hasAny(text, FOOTWEAR);

  if (
    supplierName === "MILITARIS" &&
    hasAny(
      text,
      MILITARIS_EXCLUDE_ALL_BRANDS
    )
  ) {
    return {
      type: "forbidden",
      reason: "excluded_militaris_helikon_tex"
    };
  }

  if (
    supplierName === "MILITARIS" &&
    isFootwear &&
    hasAny(
      text,
      MILITARIS_EXCLUDE_FOOTWEAR_BRANDS
    )
  ) {
    return {
      type: "forbidden",
      reason: "excluded_militaris_lowa_footwear"
    };
  }

  if (hasAny(text, FORBIDDEN)) {
    return {
      type: "forbidden",
      reason: "excluded_category"
    };
  }

  if (isFootwear) {
    return {
      type: "footwear",
      reason: "priority_footwear"
    };
  }

  if (hasAny(text, CLOTHING)) {
    return {
      type: "clothing",
      reason: "priority_clothing"
    };
  }

  if (hasAny(text, ACCESSORY)) {
    return {
      type: "accessory",
      reason: "limited_accessory"
    };
  }

  return {
    type: "other",
    reason: "other"
  };
}

function groupSupplierOffers(offers) {
  const map = new Map();

  for (const offer of offers || []) {
    const groupId = String(
      offer.groupId ||
      offer.id ||
      ""
    ).trim();

    if (!groupId) continue;

    if (!map.has(groupId)) {
      map.set(groupId, []);
    }

    map.get(groupId).push(offer);
  }

  return map;
}

function analyzeSupplier(
  supplierName,
  offers,
  minPrice = 500
) {
  const groups =
    groupSupplierOffers(offers);

  const rows = [];

  for (const [groupId, items] of groups) {
    const availableItems =
      items.filter(isAvailable);

    if (!availableItems.length) {
      continue;
    }

    const eligibleItems =
      availableItems.filter(
        item =>
          priceOf(item) >= minPrice
      );

    const familyClass =
      classifyFamily(
        items,
        supplierName
      );

    const minAvailablePrice =
      Math.min(
        ...availableItems.map(priceOf)
      );

    const maxAvailablePrice =
      Math.max(
        ...availableItems.map(priceOf)
      );

    const minEligiblePrice =
      eligibleItems.length
        ? Math.min(
            ...eligibleItems.map(priceOf)
          )
        : null;

    const row = {
      supplier:
        supplierName,

      familyKey:
        `${supplierName}:${groupId}`,

      groupId,

      categoryId:
        String(
          items[0]?.categoryId ||
          ""
        ),

      name:
        items[0]?.name ||
        "",

      type:
        familyClass.type,

      reason:
        familyClass.reason,

      totalVariants:
        items.length,

      availableVariants:
        availableItems.length,

      eligibleVariants:
        eligibleItems.length,

      minAvailablePrice,
      maxAvailablePrice,
      minEligiblePrice,

      passesPrice:
        eligibleItems.length > 0,

      excluded:
        familyClass.type ===
          "forbidden" ||
        eligibleItems.length === 0
    };

    rows.push(row);
  }

  const keptPriority =
    rows.filter(
      row =>
        !row.excluded &&
        (
          row.type === "clothing" ||
          row.type === "footwear"
        )
    );

  const optionalAccessories =
    rows.filter(
      row =>
        !row.excluded &&
        row.type === "accessory"
    );

  const optionalOther =
    rows.filter(
      row =>
        !row.excluded &&
        row.type === "other"
    );

  const excludedForbidden =
    rows.filter(
      row =>
        row.type === "forbidden"
    );

  const excludedByPrice =
    rows.filter(
      row =>
        row.type !== "forbidden" &&
        !row.passesPrice
    );

  return {
    supplier:
      supplierName,

    minPrice,

    availableFamilies:
      rows.length,

    priorityClothing:
      rows.filter(
        row =>
          !row.excluded &&
          row.type === "clothing"
      ).length,

    priorityFootwear:
      rows.filter(
        row =>
          !row.excluded &&
          row.type === "footwear"
      ).length,

    priorityTotal:
      keptPriority.length,

    optionalAccessories:
      optionalAccessories.length,

    optionalOther:
      optionalOther.length,

    excludedForbidden:
      excludedForbidden.length,

    excludedByPrice:
      excludedByPrice.length,

    samples: {
      clothing:
        keptPriority
          .filter(
            row =>
              row.type === "clothing"
          )
          .slice(0, 15),

      footwear:
        keptPriority
          .filter(
            row =>
              row.type === "footwear"
          )
          .slice(0, 15),

      accessories:
        optionalAccessories
          .slice(0, 15),

      other:
        optionalOther
          .slice(0, 15),

      forbidden:
        excludedForbidden
          .slice(0, 15),

      below500:
        excludedByPrice
          .slice(0, 15)
    },

    rows
  };
}

function buildFilteredCatalogStats(
  suppliers,
  {
    minPrice = 500,
    maxMilitarisAccessories = 40,
    maxCards = 1000
  } = {}
) {
  // BEZET НЕ РЕЖЕМ ВООБЩЕ:
  // берем все реальные модели, у которых есть хотя бы один вариант в наличии.
  const bezetGroups =
    groupSupplierOffers(
      suppliers.bezet.offers
    );

  const bezetSelected = [];

  for (
    const [groupId, items]
    of bezetGroups.entries()
  ) {
    const availableItems =
      items.filter(isAvailable);

    if (!availableItems.length) {
      continue;
    }

    bezetSelected.push({
      supplier: "BEZET",
      familyKey:
        `BEZET:${groupId}`,
      groupId,
      categoryId:
        String(
          items[0]?.categoryId ||
          ""
        ),
      name:
        items[0]?.name ||
        "",
      type:
        "bezet_keep_all",
      reason:
        "bezet_not_filtered",
      totalVariants:
        items.length,
      availableVariants:
        availableItems.length,
      eligibleVariants:
        availableItems.length,
      minAvailablePrice:
        Math.min(
          ...availableItems.map(priceOf)
        ),
      maxAvailablePrice:
        Math.max(
          ...availableItems.map(priceOf)
        ),
      excluded:
        false
    });
  }

  // MILITARIS режем по правилам.
  const militaris =
    analyzeSupplier(
      "MILITARIS",
      suppliers.militaris.offers,
      minPrice
    );

  const militarisPriority =
    militaris.rows
      .filter(
        row =>
          !row.excluded &&
          (
            row.type === "clothing" ||
            row.type === "footwear"
          )
      )
      .sort(
        (a, b) => {
          const aScore =
            a.type === "footwear"
              ? 2
              : 1;

          const bScore =
            b.type === "footwear"
              ? 2
              : 1;

          return (
            bScore - aScore ||
            b.availableVariants -
              a.availableVariants ||
            (b.minEligiblePrice || 0) -
              (a.minEligiblePrice || 0)
          );
        }
      );

  const militarisAccessories =
    militaris.rows
      .filter(
        row =>
          !row.excluded &&
          row.type === "accessory"
      )
      .sort(
        (a, b) =>
          b.availableVariants -
            a.availableVariants ||
          (b.minEligiblePrice || 0) -
            (a.minEligiblePrice || 0)
      );

  const selected = [
    ...bezetSelected
  ];

  for (const row of militarisPriority) {
    if (selected.length >= maxCards) {
      break;
    }

    selected.push(row);
  }

  let addedMilitarisAccessories = 0;

  for (const row of militarisAccessories) {
    if (
      selected.length >= maxCards ||
      addedMilitarisAccessories >=
        maxMilitarisAccessories
    ) {
      break;
    }

    selected.push(row);
    addedMilitarisAccessories++;
  }

  const selectedBySupplier = {
    BEZET:
      selected.filter(
        row =>
          row.supplier === "BEZET"
      ).length,

    MILITARIS:
      selected.filter(
        row =>
          row.supplier ===
          "MILITARIS"
      ).length
  };

  const selectedMilitarisByType = {
    clothing:
      selected.filter(
        row =>
          row.supplier ===
            "MILITARIS" &&
          row.type === "clothing"
      ).length,

    footwear:
      selected.filter(
        row =>
          row.supplier ===
            "MILITARIS" &&
          row.type === "footwear"
      ).length,

    accessory:
      selected.filter(
        row =>
          row.supplier ===
            "MILITARIS" &&
          row.type === "accessory"
      ).length
  };

  return {
    rules: {
      BEZET:
        "keep all available models; no price/category/brand filtering",

      MILITARIS: {
        minPrice,

        exclude:
          "helmets, ballistic plates, weapon magazines/ammunition, Helikon-Tex, LOWA footwear",

        priority:
          "clothing and footwear",

        accessories:
          `max ${maxMilitarisAccessories}`,

        other:
          "not auto-selected"
      },

      maxCards
    },

    suppliers: {
      BEZET: {
        availableFamilies:
          bezetSelected.length,

        selected:
          selectedBySupplier.BEZET,

        filteredOut:
          0
      },

      MILITARIS: {
        availableFamilies:
          militaris.availableFamilies,

        priorityClothing:
          militaris.priorityClothing,

        priorityFootwear:
          militaris.priorityFootwear,

        priorityTotal:
          militaris.priorityTotal,

        optionalAccessories:
          militaris.optionalAccessories,

        optionalOther:
          militaris.optionalOther,

        excludedForbidden:
          militaris.excludedForbidden,

        excludedByPrice:
          militaris.excludedByPrice,

        selected:
          selectedBySupplier.MILITARIS
      }
    },

    combined: {
      selectedCards:
        selected.length,

      freeSlotsTo1000:
        Math.max(
          0,
          maxCards -
          selected.length
        ),

      selectedBySupplier,

      selectedMilitarisByType
    },

    samples: {
      selected:
        selected.slice(0, 40),

      militaris:
        militaris.samples
    }
  };
}

module.exports = {
  buildFilteredCatalogStats
};
