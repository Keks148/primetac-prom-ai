const { listProducts, listGroups } = require("./prom");
const { loadSuppliers } = require("./suppliers");

function norm(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/[’'`"]/g, "")
    .replace(/[^a-zа-яіїєґ0-9]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clean(value) {
  return String(value ?? "").trim();
}

function getPromGroupId(product) {
  return (
    product?.group?.id ??
    product?.group_id ??
    product?.category_id ??
    null
  );
}

function getVariationGroupId(product) {
  const value =
    product?.variation_group_id ??
    product?.variationGroupId ??
    product?.variation_group?.id ??
    null;

  if (value == null || value === "") {
    return null;
  }

  return String(value);
}

function buildFamilies(offers) {
  const map = new Map();

  for (const offer of offers) {
    if (!offer.groupId) continue;

    const familyKey =
      `${offer.supplier}:${offer.groupId}`;

    if (!map.has(familyKey)) {
      map.set(familyKey, []);
    }

    map.get(familyKey).push(offer);
  }

  return [...map.entries()]
    .filter(([, items]) => items.length >= 2)
    .map(([familyKey, items]) => ({
      familyKey,
      supplier: items[0].supplier,
      groupId: String(items[0].groupId),
      offers: items
    }));
}

function getParamMap(offer) {
  const map = new Map();

  for (const param of offer.params || []) {
    const name = clean(param?.name);
    const value = clean(param?.value);

    if (!name) continue;

    map.set(norm(name), {
      name,
      value
    });
  }

  return map;
}

function analyzeDimensions(offers) {
  const knownNames = new Map();

  for (const offer of offers) {
    for (const [key, param] of getParamMap(offer)) {
      if (!knownNames.has(key)) {
        knownNames.set(
          key,
          param.name || key
        );
      }
    }
  }

  const dimensions = [];

  for (const [key, name] of knownNames) {
    const values = new Set();

    for (const offer of offers) {
      const param =
        getParamMap(offer).get(key);

      if (param?.value) {
        values.add(norm(param.value));
      }
    }

    if (values.size > 1) {
      dimensions.push({
        key,
        name,
        distinctValues: values.size
      });
    }
  }

  const missingValues = [];

  for (const offer of offers) {
    const params = getParamMap(offer);

    for (const dimension of dimensions) {
      const value =
        params.get(dimension.key)?.value || "";

      if (!value) {
        missingValues.push({
          offerId: clean(offer.id),
          dimension: dimension.name
        });
      }
    }
  }

  const combinations = new Map();
  const duplicates = [];

  if (dimensions.length) {
    for (const offer of offers) {
      const params = getParamMap(offer);

      const combination = dimensions
        .map(
          dimension =>
            norm(
              params.get(
                dimension.key
              )?.value || ""
            )
        )
        .join("||");

      if (
        combinations.has(combination)
      ) {
        duplicates.push({
          firstOfferId:
            combinations.get(combination),
          secondOfferId:
            clean(offer.id)
        });
      } else {
        combinations.set(
          combination,
          clean(offer.id)
        );
      }
    }
  }

  return {
    dimensions: dimensions.map(
      dimension => ({
        name: dimension.name,
        distinctValues:
          dimension.distinctValues
      })
    ),
    missingValues,
    duplicateCombinations: duplicates
  };
}

function buildExactMatches(
  promProducts,
  supplierOffers
) {
  const offersById = new Map();

  for (const offer of supplierOffers) {
    const id = clean(offer.id);

    if (!id) continue;

    if (!offersById.has(id)) {
      offersById.set(id, []);
    }

    offersById
      .get(id)
      .push(offer);
  }

  const promIdCounts = new Map();

  for (const product of promProducts) {
    const externalId =
      clean(product.external_id);

    if (!externalId) continue;

    promIdCounts.set(
      externalId,
      (promIdCounts.get(externalId) || 0) + 1
    );
  }

  const matches = [];
  const unmatched = [];
  const ambiguous = [];

  for (const product of promProducts) {
    const externalId =
      clean(product.external_id);

    if (!externalId) {
      unmatched.push({
        promId: product.id,
        externalId: null,
        name: product.name || ""
      });

      continue;
    }

    const candidates =
      offersById.get(externalId) || [];

    if (!candidates.length) {
      unmatched.push({
        promId: product.id,
        externalId,
        name: product.name || ""
      });

      continue;
    }

    const exactNameCandidates =
      candidates.filter(
        offer =>
          norm(offer.name) ===
          norm(product.name)
      );

    if (
      exactNameCandidates.length !== 1
    ) {
      ambiguous.push({
        promId: product.id,
        externalId,
        promName:
          product.name || "",
        candidates:
          candidates.length,
        matchingNames:
          exactNameCandidates.length
      });

      continue;
    }

    const offer =
      exactNameCandidates[0];

    matches.push({
      prom: product,
      offer,

      supplier:
        offer.supplier,

      externalId,

      familyKey:
        offer.groupId
          ? `${offer.supplier}:${offer.groupId}`
          : null,

      duplicateExternalIdInProm:
        (promIdCounts.get(externalId) || 0) > 1
    });
  }

  const duplicateExternalIds =
    [...promIdCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([externalId, count]) => ({
        externalId,
        count
      }));

  return {
    matches,
    unmatched,
    ambiguous,
    duplicateExternalIds
  };
}

function analyzeRepair(
  families,
  exactMatching
) {
  const matchesByFamily =
    new Map();

  for (const match of exactMatching.matches) {
    if (!match.familyKey) continue;

    if (
      !matchesByFamily.has(
        match.familyKey
      )
    ) {
      matchesByFamily.set(
        match.familyKey,
        []
      );
    }

    matchesByFamily
      .get(match.familyKey)
      .push(match);
  }

  const results = [];

  for (const family of families) {
    const matches =
      matchesByFamily.get(
        family.familyKey
      ) || [];

    // Для ремонта нужны минимум
    // две отдельные карточки Prom.
    if (matches.length < 2) {
      continue;
    }

    const issues = [];

    const dimensionAudit =
      analyzeDimensions(
        family.offers
      );

    const supplierNames =
      new Set(
        family.offers
          .map(
            offer =>
              norm(offer.name)
          )
          .filter(Boolean)
      );

    if (supplierNames.size !== 1) {
      issues.push(
        "different_supplier_names"
      );
    }

    if (
      dimensionAudit
        .dimensions.length === 0
    ) {
      issues.push(
        "no_variant_characteristic"
      );
    }

    if (
      dimensionAudit
        .dimensions.length > 3
    ) {
      issues.push(
        "more_than_3_variant_characteristics"
      );
    }

    if (
      dimensionAudit
        .missingValues.length
    ) {
      issues.push(
        "missing_variant_values"
      );
    }

    if (
      dimensionAudit
        .duplicateCombinations.length
    ) {
      issues.push(
        "duplicate_variant_combination"
      );
    }

    const promGroups =
      [
        ...new Set(
          matches
            .map(
              match =>
                getPromGroupId(
                  match.prom
                )
            )
            .filter(
              value =>
                value != null
            )
            .map(String)
        )
      ];

    if (promGroups.length !== 1) {
      issues.push(
        "different_prom_groups"
      );
    }

    if (
      matches.some(
        match =>
          match
            .duplicateExternalIdInProm
      )
    ) {
      issues.push(
        "duplicate_external_id_in_prom"
      );
    }

    const variationGroupIds =
      [
        ...new Set(
          matches
            .map(
              match =>
                getVariationGroupId(
                  match.prom
                )
            )
            .filter(Boolean)
        )
      ];

    const alreadyGrouped =
      variationGroupIds.length === 1 &&
      matches.every(
        match =>
          getVariationGroupId(
            match.prom
          )
      );

    if (
      variationGroupIds.length > 1
    ) {
      issues.push(
        "conflicting_existing_variation_groups"
      );
    }

    const matchedOfferIds =
      new Set(
        matches.map(
          match =>
            clean(match.offer.id)
        )
      );

    const missingOfferIds =
      family.offers
        .map(
          offer =>
            clean(offer.id)
        )
        .filter(
          id =>
            !matchedOfferIds.has(id)
        );

    let status =
      "SUSPICIOUS";

    if (!issues.length) {
      if (alreadyGrouped) {
        status =
          "ALREADY_GROUPED";
      } else if (
        matches.length ===
        family.offers.length
      ) {
        status =
          "SAFE_COMPLETE";
      } else {
        status =
          "SAFE_PARTIAL";
      }
    }

    const repairCandidate =
      status ===
        "SAFE_COMPLETE" ||
      status ===
        "SAFE_PARTIAL";

    const estimatedCardSavings =
      repairCandidate
        ? matches.length - 1
        : 0;

    results.push({
      familyKey:
        family.familyKey,

      supplier:
        family.supplier,

      groupId:
        family.groupId,

      title:
        family.offers[0]
          ?.name || "",

      supplierVariantCount:
        family.offers.length,

      matchedPromCount:
        matches.length,

      missingSupplierVariantCount:
        missingOfferIds.length,

      missingSupplierOfferIds:
        missingOfferIds,

      promGroupId:
        promGroups.length === 1
          ? promGroups[0]
          : null,

      variantDimensions:
        dimensionAudit.dimensions,

      existingVariationGroupIds:
        variationGroupIds,

      alreadyGrouped,

      status,

      issues,

      estimatedCardSavings,

      sampleMatched:
        matches
          .slice(0, 8)
          .map(match => ({
            promId:
              match.prom.id,

            externalId:
              match.externalId,

            sku:
              match.prom.sku ||
              match.prom.sku_code ||
              match.prom.article ||
              null,

            name:
              match.prom.name ||
              "",

            params:
              match.offer.params ||
              []
          }))
    });
  }

  results.sort(
    (a, b) =>
      b.estimatedCardSavings -
        a.estimatedCardSavings ||
      b.matchedPromCount -
        a.matchedPromCount
  );

  const safeComplete =
    results.filter(
      item =>
        item.status ===
        "SAFE_COMPLETE"
    );

  const safePartial =
    results.filter(
      item =>
        item.status ===
        "SAFE_PARTIAL"
    );

  const suspicious =
    results.filter(
      item =>
        item.status ===
        "SUSPICIOUS"
    );

  const alreadyGrouped =
    results.filter(
      item =>
        item.status ===
        "ALREADY_GROUPED"
    );

  const estimatedCardSavings =
    results.reduce(
      (sum, item) =>
        sum +
        item.estimatedCardSavings,
      0
    );

  return {
    results,

    summary: {
      familiesWithAtLeast2ExactMatches:
        results.length,

      safeComplete:
        safeComplete.length,

      safePartial:
        safePartial.length,

      suspicious:
        suspicious.length,

      alreadyGrouped:
        alreadyGrouped.length,

      estimatedCardSavings
    }
  };
}

async function runAudit({
  reason = "manual"
} = {}) {
  const startedAt =
    new Date().toISOString();

  const [
    promProducts,
    promGroups,
    suppliers
  ] = await Promise.all([
    listProducts(),
    listGroups(),
    loadSuppliers()
  ]);

  const supplierOffers = [
    ...suppliers.bezet.offers,
    ...suppliers.militaris.offers
  ];

  const families =
    buildFamilies(
      supplierOffers
    );

  const matching =
    buildExactMatches(
      promProducts,
      supplierOffers
    );

  const repair =
    analyzeRepair(
      families,
      matching
    );

  const matchedFamilyKeys =
    new Set(
      matching.matches
        .map(
          match =>
            match.familyKey
        )
        .filter(Boolean)
    );

  const report = {
    version: "1.1.0",

    mode: "READ_ONLY",

    reason,

    startedAt,

    finishedAt:
      new Date().toISOString(),

    prom: {
      products:
        promProducts.length,

      groups:
        promGroups.length
    },

    suppliers: {
      BEZET: {
        ok:
          suppliers.bezet.ok,

        configured:
          suppliers.bezet
            .configured,

        error:
          suppliers.bezet
            .error,

        offers:
          suppliers.bezet
            .offers.length,

        offersWithGroupId:
          suppliers.bezet
            .offers.filter(
              offer =>
                offer.groupId
            ).length
      },

      MILITARIS: {
        ok:
          suppliers.militaris.ok,

        configured:
          suppliers.militaris
            .configured,

        error:
          suppliers.militaris
            .error,

        offers:
          suppliers.militaris
            .offers.length,

        offersWithGroupId:
          suppliers.militaris
            .offers.filter(
              offer =>
                offer.groupId
            ).length
      }
    },

    // Оставляем старые поля,
    // чтобы текущая панель не сломалась.
    matching: {
      exactMatches:
        matching.matches.length,

      unmatchedPromProducts:
        matching.unmatched.length,

      exactSku: 0,

      externalIdEqualsSupplierSku: 0,

      externalIdPlusExactName:
        matching.matches.length,

      ambiguousPromProducts:
        matching.ambiguous.length,

      duplicateExternalIdsInProm:
        matching
          .duplicateExternalIds
          .length
    },

    variants: {
      totalFamilies:
        families.length,

      totalVariantOffers:
        families.reduce(
          (sum, family) =>
            sum +
            family.offers.length,
          0
        ),

      matchedFamilies:
        matchedFamilyKeys.size,

      bySupplier: {
        BEZET:
          families.filter(
            family =>
              family.supplier ===
              "BEZET"
          ).length,

        MILITARIS:
          families.filter(
            family =>
              family.supplier ===
              "MILITARIS"
          ).length
      }
    },

    repair: {
      ...repair.summary,

      estimatedCardsAfterRepair:
        Math.max(
          0,
          promProducts.length -
            repair.summary
              .estimatedCardSavings
        )
    },

    samples: {
      safeRepairFamilies:
        repair.results
          .filter(
            item =>
              item.status ===
                "SAFE_COMPLETE" ||
              item.status ===
                "SAFE_PARTIAL"
          )
          .slice(0, 30),

      suspiciousFamilies:
        repair.results
          .filter(
            item =>
              item.status ===
              "SUSPICIOUS"
          )
          .slice(0, 30),

      focusFamily118147:
        repair.results.find(
          item =>
            item.familyKey ===
            "BEZET:118147"
        ) || null,

      ambiguousMatches:
        matching.ambiguous
          .slice(0, 20),

      duplicateExternalIdsInProm:
        matching
          .duplicateExternalIds
          .slice(0, 20)
    },

    safety: {
      writesToProm: false,
      deletesFromProm: false,
      createsProducts: false,
      changesGroups: false,
      fuzzyMatchingForWrites: false,

      identityRule:
        "supplier offer id == Prom external_id AND normalized product name matches"
    }
  };

  console.log(
    "[VARIANT_REPAIR_AUDIT]",
    JSON.stringify({
      version:
        report.version,

      prom:
        report.prom,

      matching:
        report.matching,

      variants:
        report.variants,

      repair:
        report.repair,

      focusFamily118147:
        report.samples
          .focusFamily118147,

      safeExamples:
        report.samples
          .safeRepairFamilies
          .slice(0, 10)
          .map(item => ({
            familyKey:
              item.familyKey,

            title:
              item.title,

            status:
              item.status,

            supplierVariants:
              item
                .supplierVariantCount,

            promCards:
              item
                .matchedPromCount,

            dimensions:
              item
                .variantDimensions,

            savings:
              item
                .estimatedCardSavings
          })),

      suspiciousExamples:
        report.samples
          .suspiciousFamilies
          .slice(0, 10)
          .map(item => ({
            familyKey:
              item.familyKey,

            title:
              item.title,

            issues:
              item.issues
          }))
    })
  );

  return report;
}

module.exports = {
  runAudit
};
