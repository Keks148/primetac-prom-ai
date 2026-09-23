function norm(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/[’'`"]/g, "")
    .replace(/[^a-zа-яіїєґ0-9]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Используем только однозначные рабочие группы.
// Дублирующиеся старые верхнеуровневые группы вида "Демісезонні"
// намеренно не используются.
const GROUPS = Object.freeze({
  clothing: {
    rain: 157085436,
    jackets: 157085430,
    shirts: 157085434,
    thermal: 157085435,
    fleece: 157085432,
    tshirts: 157085433,
    pants: 157085431
  },

  footwear: {
    sneakers: 157085438,
    boots: 157085437,
    socks: 157085439
  },

  headwear: {
    balaclava: 157085441,
    caps: 157085440,
    hatsBuffs: 157085442
  },

  bags: {
    organizers: 157085445,
    backpacks: 157085443,
    tacticalBags: 157085444
  },

  equipment: {
    holsters: 157085450,
    pouches: 157085448,
    plateCarriers: 157085446,
    belts: 157085449,
    loadBearing: 157085447,
    gloves: 157085451
  },

  protective: {
    kneeElbow: 157085453
  },

  accessories: {
    toolsCarabiners: 157085456,
    other: 157085457,
    patches: 157085455
  },

  tourism: {
    sleepingBags: 157085454
  },

  parents: {
    clothing: 157085421,
    footwear: 157085422,
    headwear: 157085423,
    bags: 157085424,
    equipment: 157085425,
    protective: 157085426,
    tourism: 157085427,
    accessories: 157085428
  },

  existingSpecific: {
    gogglesMasks: 156580908,
    camouflageSuits: 156580910
  }
});


const SOURCE_CATEGORY_GROUPS = Object.freeze({
  BEZET: Object.freeze({
    "188": GROUPS.clothing.pants,
    "203": GROUPS.clothing.tshirts,
    "187": GROUPS.clothing.jackets,
    "205": GROUPS.clothing.tshirts,
    "189": GROUPS.clothing.pants,
    "195": GROUPS.clothing.pants,
    "220": GROUPS.clothing.shirts,
    "15": GROUPS.clothing.pants,
    "7": GROUPS.clothing.jackets,
    "9": GROUPS.clothing.pants,
    "25": GROUPS.clothing.fleece,
    "206": GROUPS.parents.clothing,
    "226": GROUPS.existingSpecific.gogglesMasks,
    "228": GROUPS.clothing.fleece,
    "227": GROUPS.clothing.pants,
    "204": GROUPS.clothing.fleece,
    "190": GROUPS.bags.tacticalBags,
    "191": GROUPS.parents.headwear,
    "196": GROUPS.clothing.jackets,
    "19": GROUPS.headwear.caps,
    "24": GROUPS.footwear.socks,
    "141": GROUPS.clothing.pants,
    "11": GROUPS.clothing.pants,
    "154": GROUPS.parents.headwear,
    "207": GROUPS.equipment.belts,
    "182": GROUPS.parents.clothing,
    "16": GROUPS.clothing.tshirts,
    "162": GROUPS.clothing.pants,
    "26": GROUPS.clothing.pants,
    "135": GROUPS.clothing.shirts,
    "180": GROUPS.parents.clothing,
    "224": GROUPS.bags.backpacks,
    "138": GROUPS.clothing.thermal,
    "55": GROUPS.clothing.pants,
    "139": GROUPS.clothing.thermal,
    "229": GROUPS.clothing.fleece,
    "159": GROUPS.parents.headwear,
    "27": GROUPS.clothing.fleece,
    "18": GROUPS.clothing.shirts,
    "20": GROUPS.headwear.hatsBuffs,
    "110": GROUPS.clothing.pants,
    "211": GROUPS.equipment.gloves,
    "111": GROUPS.clothing.pants,
    "10": GROUPS.clothing.pants,
    "193": GROUPS.parents.footwear,
    "47": GROUPS.parents.clothing,
    "194": GROUPS.accessories.patches,
    "12": GROUPS.clothing.pants,
    "117": GROUPS.headwear.balaclava,
    "161": GROUPS.headwear.caps,
    "219": GROUPS.clothing.jackets,
    "198": GROUPS.parents.headwear,
    "112": GROUPS.clothing.jackets,
    "113": GROUPS.clothing.jackets,
    "192": GROUPS.accessories.other,
    "122": GROUPS.equipment.belts,
    "128": GROUPS.parents.clothing,
    "116": GROUPS.clothing.fleece,
    "4": GROUPS.clothing.jackets,
    "5": GROUPS.clothing.jackets,
    "42": GROUPS.parents.headwear,
    "99": GROUPS.parents.clothing,
    "43": GROUPS.bags.tacticalBags
  }),

  MILITARIS: Object.freeze({
    "1175": GROUPS.clothing.tshirts,
    "1254": GROUPS.clothing.jackets,
    "1258": GROUPS.footwear.boots,
    "1253": GROUPS.clothing.jackets,
    "1173": GROUPS.clothing.fleece,
    "1180": GROUPS.parents.clothing,
    "1172": GROUPS.clothing.shirts,
    "1282": GROUPS.clothing.pants,
    "1255": GROUPS.clothing.jackets,
    "1256": GROUPS.footwear.sneakers,
    "1257": GROUPS.footwear.sneakers,
    "1199": GROUPS.equipment.gloves,
    "1284": GROUPS.clothing.pants,
    "1259": GROUPS.footwear.boots,
    "1285": GROUPS.clothing.pants,
    "1281": GROUPS.clothing.pants,
    "1181": GROUPS.clothing.thermal,
    "1179": GROUPS.clothing.pants,
    "1222": GROUPS.existingSpecific.gogglesMasks,
    "1193": GROUPS.parents.headwear,
    "1270": GROUPS.clothing.rain,
    "1176": GROUPS.clothing.shirts,
    "1286": GROUPS.footwear.sneakers,
    "1283": GROUPS.clothing.pants,
    "1218": GROUPS.existingSpecific.camouflageSuits,
    "1280": GROUPS.footwear.boots,
    "1187": GROUPS.bags.backpacks,
    "1194": GROUPS.headwear.caps,
    "1178": GROUPS.clothing.pants
  })
});

function sourceCategoryMapping(row) {
  const supplier =
    String(
      row?.supplier ||
      ""
    ).toUpperCase();

  const categoryId =
    String(
      row?.categoryId ||
      ""
    ).trim();

  const supplierMap =
    SOURCE_CATEGORY_GROUPS[
      supplier
    ];

  if (
    !supplierMap ||
    !categoryId
  ) {
    return null;
  }

  const groupId =
    supplierMap[
      categoryId
    ];

  if (!groupId) {
    return null;
  }

  return mapped(
    groupId,
    `source_category:${supplier}:${categoryId}`
  );
}

function hit(text, words) {
  return words.some(word =>
    text.includes(word)
  );
}

function mapped(groupId, rule) {
  return {
    status: "MAPPED",
    groupId,
    rule
  };
}

function mapSelectedProduct(row) {
  const text =
    norm(row?.name);

  if (!text) {
    return {
      status: "UNMAPPED",
      groupId: null,
      rule: "empty_name"
    };
  }

  const bySourceCategory =
    sourceCategoryMapping(
      row
    );

  if (bySourceCategory) {
    return bySourceCategory;
  }

  if (
    hit(text, [
      "килт",
      "кілт"
    ])
  ) {
    return mapped(
      GROUPS.parents.clothing,
      "clothing_tactical_kilt"
    );
  }

  // Обувь / name-based fallback
  if (
    hit(text, [
      "шкарпет",
      "носки",
      "устілк",
      "стельк"
    ])
  ) {
    return mapped(
      GROUPS.footwear.socks,
      "footwear_socks_insoles"
    );
  }

  if (
    hit(text, [
      "кросівк",
      "кроссов",
      "sneaker"
    ])
  ) {
    return mapped(
      GROUPS.footwear.sneakers,
      "footwear_sneakers"
    );
  }

  if (
    hit(text, [
      "черевик",
      "ботинк",
      "берц",
      "boots",
      "boot "
    ])
  ) {
    return mapped(
      GROUPS.footwear.boots,
      "footwear_boots"
    );
  }

  // Головные уборы
  if (
    hit(text, [
      "балаклав"
    ])
  ) {
    return mapped(
      GROUPS.headwear.balaclava,
      "headwear_balaclava"
    );
  }

  if (
    hit(text, [
      "кепк",
      "бейсболк",
      "cap "
    ])
  ) {
    return mapped(
      GROUPS.headwear.caps,
      "headwear_caps"
    );
  }

  if (
    hit(text, [
      "баф",
      "шапк",
      "beanie"
    ])
  ) {
    return mapped(
      GROUPS.headwear.hatsBuffs,
      "headwear_hats_buffs"
    );
  }

  // Одежда. Сначала более специфичные типы.
  if (
    hit(text, [
      "дощовик",
      "дождевик",
      "пончо",
      "raincoat"
    ])
  ) {
    return mapped(
      GROUPS.clothing.rain,
      "clothing_rain"
    );
  }

  if (
    hit(text, [
      "термобілиз",
      "термобель",
      "термо білиз",
      "термо бель"
    ])
  ) {
    return mapped(
      GROUPS.clothing.thermal,
      "clothing_thermal"
    );
  }

  if (
    hit(text, [
      "ubacs",
      "убакс",
      "сорочк",
      "рубашк",
      "combat shirt"
    ])
  ) {
    return mapped(
      GROUPS.clothing.shirts,
      "clothing_shirts_ubacs"
    );
  }

  if (
    hit(text, [
      "фліс",
      "флис",
      "худі",
      "худи",
      "світшот",
      "свитшот",
      "кофта",
      "светр",
      "свитер"
    ])
  ) {
    return mapped(
      GROUPS.clothing.fleece,
      "clothing_fleece_hoodie"
    );
  }

  if (
    hit(text, [
      "футболк",
      "поло",
      "лонгслів",
      "лонгслив",
      "t shirt"
    ])
  ) {
    return mapped(
      GROUPS.clothing.tshirts,
      "clothing_tshirts_polo"
    );
  }

  if (
    hit(text, [
      "штани",
      "брюки",
      "шорти",
      "шорты",
      "джинс"
    ])
  ) {
    return mapped(
      GROUPS.clothing.pants,
      "clothing_pants_shorts"
    );
  }

  if (
    hit(text, [
      "куртк",
      "парка",
      "бомбер",
      "вітровк",
      "ветровк",
      "анорак",
      "jacket"
    ])
  ) {
    return mapped(
      GROUPS.clothing.jackets,
      "clothing_jackets"
    );
  }

  // Рюкзаки и сумки
  if (
    hit(text, [
      "органайзер",
      "баул"
    ])
  ) {
    return mapped(
      GROUPS.bags.organizers,
      "bags_organizers"
    );
  }

  if (
    hit(text, [
      "рюкзак"
    ])
  ) {
    return mapped(
      GROUPS.bags.backpacks,
      "bags_backpacks"
    );
  }

  if (
    hit(text, [
      "сумк"
    ])
  ) {
    return mapped(
      GROUPS.bags.tacticalBags,
      "bags_tactical"
    );
  }

  // Тактическое снаряжение
  if (
    hit(text, [
      "кобур"
    ])
  ) {
    return mapped(
      GROUPS.equipment.holsters,
      "equipment_holsters"
    );
  }

  if (
    hit(text, [
      "підсум",
      "подсум"
    ])
  ) {
    return mapped(
      GROUPS.equipment.pouches,
      "equipment_pouches"
    );
  }

  if (
    hit(text, [
      "плитоноск",
      "plate carrier",
      "тактичний жилет",
      "тактический жилет"
    ])
  ) {
    return mapped(
      GROUPS.equipment.plateCarriers,
      "equipment_plate_carriers"
    );
  }

  if (
    hit(text, [
      "рпс",
      "розвантаж",
      "разгруз"
    ])
  ) {
    return mapped(
      GROUPS.equipment.loadBearing,
      "equipment_load_bearing"
    );
  }

  if (
    hit(text, [
      "ремін",
      "ремень",
      "belt"
    ])
  ) {
    return mapped(
      GROUPS.equipment.belts,
      "equipment_belts"
    );
  }

  if (
    hit(text, [
      "рукавич",
      "перчат"
    ])
  ) {
    return mapped(
      GROUPS.equipment.gloves,
      "equipment_gloves"
    );
  }

  if (
    hit(text, [
      "наколін",
      "наколен",
      "налокіт",
      "налокот"
    ])
  ) {
    return mapped(
      GROUPS.protective.kneeElbow,
      "protective_knee_elbow"
    );
  }

  // Аксессуары
  if (
    hit(text, [
      "шеврон",
      "патч",
      "нашив"
    ])
  ) {
    return mapped(
      GROUPS.accessories.patches,
      "accessories_patches"
    );
  }

  if (
    hit(text, [
      "карабін",
      "карабин",
      "мультитул",
      "інструмент",
      "инструмент"
    ])
  ) {
    return mapped(
      GROUPS.accessories.toolsCarabiners,
      "accessories_tools"
    );
  }

  if (
    hit(text, [
      "спальний міш",
      "спальный меш",
      "sleeping bag"
    ])
  ) {
    return mapped(
      GROUPS.tourism.sleepingBags,
      "tourism_sleeping_bags"
    );
  }

  // Никакого "угадаем похожую группу".
  return {
    status: "UNMAPPED",
    groupId: null,
    rule: "no_safe_rule"
  };
}

function buildGroupMappingAudit(
  selectedRows,
  promGroups
) {
  const validGroupIds =
    new Set(
      (promGroups || [])
        .map(group =>
          String(group?.id ?? "")
        )
        .filter(Boolean)
    );

  const rows =
    (selectedRows || []).map(row => {
      const mapping =
        mapSelectedProduct(row);

      const groupExists =
        mapping.groupId == null
          ? false
          : validGroupIds.has(
              String(mapping.groupId)
            );

      return {
        supplier:
          row.supplier,

        familyKey:
          row.familyKey,

        name:
          row.name,

        sourceCategoryId:
          row.categoryId,

        mappedGroupId:
          mapping.groupId,

        mappingStatus:
          mapping.status,

        rule:
          mapping.rule,

        groupExists
      };
    });

  const mapped =
    rows.filter(
      row =>
        row.mappingStatus ===
          "MAPPED" &&
        row.groupExists
    );

  const brokenTarget =
    rows.filter(
      row =>
        row.mappingStatus ===
          "MAPPED" &&
        !row.groupExists
    );

  const unmapped =
    rows.filter(
      row =>
        row.mappingStatus ===
          "UNMAPPED"
    );

  const byGroup = {};

  for (const row of mapped) {
    const key =
      String(
        row.mappedGroupId
      );

    byGroup[key] =
      (byGroup[key] || 0) + 1;
  }

  return {
    total:
      rows.length,

    mapped:
      mapped.length,

    unmapped:
      unmapped.length,

    brokenTarget:
      brokenTarget.length,

    safeToImport:
      unmapped.length === 0 &&
      brokenTarget.length === 0,

    byGroup,

    unmappedExamples:
      unmapped.slice(0, 80),

    brokenTargetExamples:
      brokenTarget.slice(0, 30)
  };
}

module.exports = {
  GROUPS,
  SOURCE_CATEGORY_GROUPS,
  mapSelectedProduct,
  buildGroupMappingAudit
};
