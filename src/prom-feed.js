const crypto = require("crypto");

const {
  mapSelectedProduct
} = require("./group-mapper");

function clean(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function xml(value) {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cdata(value) {
  return String(value ?? "")
    .replace(
      /]]>/g,
      "]]]]><![CDATA[>"
    );
}

function num(value) {
  const n =
    Number(
      String(
        value ?? ""
      )
        .replace(",", ".")
        .trim()
    );

  return Number.isFinite(n)
    ? n
    : null;
}

function availabilityStatus(
  offer
) {
  const raw =
    clean(
      offer?.available
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

  if (
    [
      "false",
      "0",
      "no",
      "unavailable",
      "out_of_stock"
    ].includes(raw)
  ) {
    return false;
  }

  const quantity =
    num(
      offer?.quantity
    );

  return (
    quantity != null &&
    quantity > 0
  );
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
  )
    .filter(
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
    )
    .sort(
      (a, b) =>
        String(
          a.id ||
          ""
        ).localeCompare(
          String(
            b.id ||
            ""
          ),
          "en",
          {
            numeric: true
          }
        )
    );
}

function stableNumeric(
  prefix,
  raw,
  maxTail = 89999999
) {
  const digits =
    String(
      raw ?? ""
    ).replace(
      /\D+/g,
      ""
    );

  if (
    digits &&
    Number(digits) <=
      maxTail
  ) {
    return (
      prefix +
      Number(digits)
    );
  }

  const hash =
    crypto
      .createHash("sha1")
      .update(
        String(
          raw ?? ""
        )
      )
      .digest()
      .readUInt32BE(0);

  return (
    prefix +
    (
      hash %
      maxTail
    )
  );
}

function offerId(
  supplier,
  sourceOfferId
) {
  return stableNumeric(
    supplier ===
      "BEZET"
      ? 1000000000
      : 2000000000,
    sourceOfferId,
    899999999
  );
}

function variantGroupId(
  supplier,
  sourceGroupId
) {
  return stableNumeric(
    supplier ===
      "BEZET"
      ? 100000000
      : 200000000,
    sourceGroupId,
    89999999
  );
}

function familyKeyToItem(
  enrichmentItems
) {
  return new Map(
    (
      enrichmentItems ||
      []
    ).map(
      item => [
        item.familyKey,
        item
      ]
    )
  );
}

function paramMap(
  offer
) {
  const out =
    new Map();

  for (
    const param
    of offer?.params || []
  ) {
    const name =
      clean(
        param?.name
      );

    const value =
      clean(
        param?.value
      );

    if (
      !name ||
      !value
    ) {
      continue;
    }

    out.set(
      name.toLowerCase(),
      {
        name,
        value
      }
    );
  }

  return out;
}

function chooseVariantParams(
  offers
) {
  if (
    !Array.isArray(offers) ||
    offers.length <= 1
  ) {
    return [];
  }

  const keys =
    new Map();

  for (
    const offer
    of offers
  ) {
    for (
      const [
        lower,
        pair
      ]
      of paramMap(
        offer
      )
    ) {
      if (
        !keys.has(lower)
      ) {
        keys.set(
          lower,
          {
            name:
              pair.name,
            values:
              new Set(),
            present:
              0
          }
        );
      }

      const entry =
        keys.get(lower);

      entry.values.add(
        pair.value
      );

      entry.present++;
    }
  }

  const hints = [
    "розмір",
    "размер",
    "size",
    "колір",
    "цвет",
    "color",
    "colour",
    "зріст",
    "рост"
  ];

  return [
    ...keys.entries()
  ]
    .map(
      ([lower, entry]) => ({
        lower,
        ...entry,
        complete:
          entry.present ===
          offers.length,

        varies:
          entry.values.size > 1,

        hintRank:
          hints.findIndex(
            hint =>
              lower.includes(
                hint
              )
          )
      })
    )
    .filter(
      entry =>
        entry.complete &&
        entry.varies
    )
    .sort(
      (a, b) => {
        const ar =
          a.hintRank < 0
            ? 99
            : a.hintRank;

        const br =
          b.hintRank < 0
            ? 99
            : b.hintRank;

        return (
          ar - br ||
          b.values.size -
            a.values.size ||
          a.name.localeCompare(
            b.name,
            "uk"
          )
        );
      }
    )
    .slice(0, 3)
    .map(
      entry =>
        entry.name
    );
}

function variantSignature(
  offer,
  variantParamNames
) {
  const map =
    paramMap(offer);

  return variantParamNames
    .map(
      name => {
        const pair =
          map.get(
            name.toLowerCase()
          );

        return pair
          ? `${name}=${pair.value}`
          : "";
      }
    )
    .join("|");
}

function dedupeVariants(
  offers,
  variantParamNames
) {
  if (
    variantParamNames.length === 0
  ) {
    return offers.slice(0, 1);
  }

  const seen =
    new Set();

  const out = [];

  for (
    const offer
    of offers
  ) {
    const signature =
      variantSignature(
        offer,
        variantParamNames
      );

    if (
      !signature ||
      seen.has(signature)
    ) {
      continue;
    }

    seen.add(signature);
    out.push(offer);
  }

  return out;
}

function picturesForOffer(
  offer,
  fallback
) {
  const raw = [
    ...(offer?.pictures || []),
    ...(fallback || [])
  ];

  const out = [];
  const seen =
    new Set();

  for (
    const picture
    of raw
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
      break;
    }
  }

  return out;
}

function staticParamsForOffer(
  offer,
  variantNames
) {
  const variantSet =
    new Set(
      variantNames.map(
        name =>
          name.toLowerCase()
      )
    );

  return (
    offer?.params || []
  )
    .map(
      param => ({
        name:
          clean(
            param?.name
          ),
        value:
          clean(
            param?.value
          )
      })
    )
    .filter(
      param =>
        param.name &&
        param.value
    )
    .filter(
      param =>
        !variantSet.has(
          param.name
            .toLowerCase()
        )
    )
    .slice(0, 40);
}

function variantParamsForOffer(
  offer,
  variantNames
) {
  const map =
    paramMap(offer);

  return variantNames
    .map(
      name => {
        const pair =
          map.get(
            name.toLowerCase()
          );

        return pair
          ? {
              name:
                pair.name,
              value:
                pair.value
            }
          : null;
      }
    )
    .filter(Boolean);
}

function validSku(
  value
) {
  return clean(value)
    .slice(0, 25);
}

function testRows(
  selectedRows,
  suppliers,
  limit = 20
) {
  const candidates =
    (selectedRows || [])
      .map(row => {
        const mapping =
          mapSelectedProduct(
            row
          );

        const offers =
          familyOffers(
            suppliers,
            row
          );

        const available =
          offers.filter(
            availabilityStatus
          );

        return {
          row,
          mapping,
          offers,
          available,
          score:
            (
              available.length > 1
                ? 100
                : 0
            ) +
            Math.min(
              30,
              available.length
            )
        };
      })
      .filter(
        item =>
          item.mapping.status ===
            "MAPPED" &&
          item.mapping.groupId &&
          item.available.length > 0
      );

  const byTarget =
    new Map();

  for (
    const item
    of candidates
  ) {
    const id =
      String(
        item.mapping.groupId
      );

    if (
      !byTarget.has(id)
    ) {
      byTarget.set(
        id,
        []
      );
    }

    byTarget
      .get(id)
      .push(item);
  }

  for (
    const list
    of byTarget.values()
  ) {
    list.sort(
      (a, b) =>
        b.score -
          a.score ||
        a.row.familyKey
          .localeCompare(
            b.row.familyKey,
            "en",
            {
              numeric: true
            }
          )
    );
  }

  const chosen = [];

  const supplierOrder = [
    "BEZET",
    "MILITARIS"
  ];

  const targetIds =
    [...byTarget.keys()]
      .sort(
        (a, b) =>
          Number(a) -
          Number(b)
      );

  // Сначала разнообразие по группам и поставщикам.
  for (
    const supplier
    of supplierOrder
  ) {
    for (
      const targetId
      of targetIds
    ) {
      const item =
        (
          byTarget
            .get(targetId) ||
          []
        ).find(
          candidate =>
            candidate.row
              .supplier ===
            supplier
        );

      if (
        item &&
        !chosen.some(
          x =>
            x.row.familyKey ===
            item.row.familyKey
        )
      ) {
        chosen.push(item);
      }

      if (
        chosen.length >=
        limit
      ) {
        break;
      }
    }

    if (
      chosen.length >=
      limit
    ) {
      break;
    }
  }

  if (
    chosen.length < limit
  ) {
    const rest =
      candidates
        .filter(
          item =>
            !chosen.some(
              x =>
                x.row
                  .familyKey ===
                item.row
                  .familyKey
            )
        )
        .sort(
          (a, b) =>
            b.score -
              a.score ||
            a.row.familyKey
              .localeCompare(
                b.row.familyKey,
                "en",
                {
                  numeric: true
                }
              )
        );

    chosen.push(
      ...rest.slice(
        0,
        limit -
          chosen.length
      )
    );
  }

  return chosen.map(
    item =>
      item.row
  );
}

function familyEntry({
  row,
  suppliers,
  enrichmentItem,
  promGroups
}) {
  const mapping =
    mapSelectedProduct(
      row
    );

  const allOffers =
    familyOffers(
      suppliers,
      row
    );

  const variantNames =
    chooseVariantParams(
      allOffers
    );

  const offers =
    dedupeVariants(
      allOffers,
      variantNames
    );

  const content =
    enrichmentItem?.content ||
    {};

  const fallbackPictures =
    enrichmentItem
      ?.dynamic
      ?.pictures ||
    [];

  const targetGroupId =
    Number(
      mapping.groupId
    );

  const validTarget =
    (promGroups || [])
      .some(
        group =>
          Number(
            group?.id
          ) ===
          targetGroupId
      );

  return {
    row,
    mapping,
    allOffers,
    offers,
    variantNames,
    content,
    fallbackPictures,
    targetGroupId,
    validTarget
  };
}

function categoriesXml(
  promGroups,
  usedGroupIds
) {
  const byId =
    new Map(
      (promGroups || [])
        .map(
          group => [
            String(
              group?.id
            ),
            group
          ]
        )
    );

  const required =
    new Set(
      [...usedGroupIds]
        .map(String)
    );

  // Добавляем родителей, чтобы структура не терялась.
  let changed =
    true;

  while (changed) {
    changed =
      false;

    for (
      const id
      of [...required]
    ) {
      const group =
        byId.get(id);

      const parentId =
        group?.parent_group_id ??
        group?.parent_id ??
        group?.parent?.id ??
        null;

      if (
        parentId != null &&
        !required.has(
          String(parentId)
        )
      ) {
        required.add(
          String(parentId)
        );

        changed =
          true;
      }
    }
  }

  return (
    (promGroups || [])
      .filter(
        group =>
          required.has(
            String(group?.id)
          )
      )
      .map(group => {
        const id =
          Number(
            group?.id
          );

        const name =
          clean(
            group?.name ??
            group?.title
          );

        const parentId =
          group?.parent_group_id ??
          group?.parent_id ??
          group?.parent?.id ??
          null;

        const parentAttr =
          parentId != null
            ? ` parentId="${xml(parentId)}"`
            : "";

        return (
          `    <category id="${xml(id)}"${parentAttr}>` +
          `${xml(name)}</category>`
        );
      })
      .join("\n")
  );
}

function offerXml({
  row,
  entry,
  offer
}) {
  const available =
    availabilityStatus(
      offer
    );

  const price =
    num(
      offer?.price
    );

  if (
    price == null ||
    price <= 0
  ) {
    return null;
  }

  const quantityRaw =
    num(
      offer?.quantity
    );

  const quantity =
    available
      ? (
          quantityRaw != null
            ? Math.max(
                0,
                Math.floor(
                  quantityRaw
                )
              )
            : 1
        )
      : 0;

  const sourceName =
    clean(
      entry.content
        .titleRu ||
      row.name ||
      offer.name
    );

  const uaName =
    clean(
      entry.content
        .titleUa ||
      sourceName
    );

  const pictures =
    picturesForOffer(
      offer,
      entry.fallbackPictures
    );

  if (
    !sourceName ||
    pictures.length === 0
  ) {
    return null;
  }

  const sourceId =
    clean(
      offer.id ||
      `${row.groupId}-${offer.sku}`
    );

  const externalId =
    offerId(
      row.supplier,
      sourceId
    );

  const groupId =
    variantGroupId(
      row.supplier,
      row.groupId
    );

  const sku =
    validSku(
      offer.sku
    );

  const brand =
    clean(
      offer.vendor ||
      entry.content
        ?.source
        ?.brand
    );

  const country =
    clean(
      offer.country ||
      entry.content
        ?.source
        ?.country
    );

  const barcode =
    clean(
      offer.barcode ||
      entry.content
        ?.source
        ?.barcode
    );

  const variantParams =
    variantParamsForOffer(
      offer,
      entry.variantNames
    );

  const staticParams =
    staticParamsForOffer(
      offer,
      entry.variantNames
    );

  const keywordsRu =
    (
      entry.content
        .keywordsRu ||
      []
    )
      .join(", ")
      .slice(0, 1024);

  const keywordsUa =
    (
      entry.content
        .keywordsUa ||
      []
    )
      .join(", ")
      .slice(0, 1024);

  const lines = [];

  lines.push(
    `    <offer id="${xml(externalId)}" available="${available ? "true" : "false"}" selling_type="r" group_id="${xml(groupId)}">`
  );

  lines.push(
    `      <name>${xml(sourceName)}</name>`
  );

  lines.push(
    `      <name_ua>${xml(uaName)}</name_ua>`
  );

  lines.push(
    `      <categoryId>${xml(entry.targetGroupId)}</categoryId>`
  );

  lines.push(
    `      <price>${xml(price)}</price>`
  );

  lines.push(
    "      <currencyId>UAH</currencyId>"
  );

  lines.push(
    `      <quantity_in_stock>${xml(quantity)}</quantity_in_stock>`
  );

  for (
    const picture
    of pictures
  ) {
    lines.push(
      `      <picture>${xml(picture)}</picture>`
    );
  }

  if (brand) {
    lines.push(
      `      <vendor>${xml(brand)}</vendor>`
    );
  }

  if (sku) {
    lines.push(
      `      <vendorCode>${xml(sku)}</vendorCode>`
    );
  }

  if (country) {
    lines.push(
      `      <country>${xml(country)}</country>`
    );
  }

  if (barcode) {
    lines.push(
      `      <gtin>${xml(barcode)}</gtin>`
    );
  }

  lines.push(
    `      <description><![CDATA[${cdata(entry.content.descriptionRu || "")}]]></description>`
  );

  lines.push(
    `      <description_ua><![CDATA[${cdata(entry.content.descriptionUa || "")}]]></description_ua>`
  );

  if (keywordsRu) {
    lines.push(
      `      <keywords>${xml(keywordsRu)}</keywords>`
    );
  }

  if (keywordsUa) {
    lines.push(
      `      <keywords_ua>${xml(keywordsUa)}</keywords_ua>`
    );
  }

  // Характеристики разновидности должны быть одинаково названы
  // и заполнены у каждого варианта.
  for (
    const param
    of variantParams
  ) {
    lines.push(
      `      <param name="${xml(param.name)}">${xml(param.value)}</param>`
    );
  }

  for (
    const param
    of staticParams
  ) {
    lines.push(
      `      <param name="${xml(param.name)}">${xml(param.value)}</param>`
    );
  }

  lines.push(
    "    </offer>"
  );

  return lines.join("\n");
}

function buildPromFeed({
  mode,
  suppliers,
  selectedRows,
  enrichmentItems,
  promGroups,
  testLimit = 20
}) {
  const itemMap =
    familyKeyToItem(
      enrichmentItems
    );

  const rows =
    mode === "test"
      ? testRows(
          selectedRows,
          suppliers,
          testLimit
        )
      : (
          selectedRows ||
          []
        );

  const entries =
    rows
      .map(
        row =>
          familyEntry({
            row,
            suppliers,
            enrichmentItem:
              itemMap.get(
                row.familyKey
              ),
            promGroups
          })
      )
      .filter(
        entry =>
          entry.mapping.status ===
            "MAPPED" &&
          entry.validTarget &&
          entry.content
            .descriptionRu &&
          entry.content
            .descriptionUa
      );

  const usedGroupIds =
    new Set(
      entries.map(
        entry =>
          entry.targetGroupId
      )
    );

  const offersXml = [];

  const familyKeys = [];

  const preview = [];

  for (
    const entry
    of entries
  ) {
    let emitted =
      0;

    for (
      const offer
      of entry.offers
    ) {
      const rendered =
        offerXml({
          row:
            entry.row,
          entry,
          offer
        });

      if (!rendered) {
        continue;
      }

      offersXml.push(
        rendered
      );

      emitted++;
    }

    if (
      emitted > 0
    ) {
      familyKeys.push(
        entry.row
          .familyKey
      );

      preview.push({
        familyKey:
          entry.row
            .familyKey,

        supplier:
          entry.row
            .supplier,

        name:
          entry.content
            .titleRu ||
          entry.row.name,

        targetGroupId:
          entry.targetGroupId,

        sourceVariants:
          entry.allOffers
            .length,

        exportedOffers:
          emitted,

        variantParams:
          entry.variantNames
      });
    }
  }

  const date =
    new Date()
      .toISOString()
      .replace(
        "Z",
        "+00:00"
      );

  const xmlText = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<yml_catalog date="${xml(date)}">`,
    "  <shop>",
    "    <name>PrimeTac Group</name>",
    "    <company>PrimeTac Group</company>",
    "    <currencies>",
    '      <currency id="UAH" rate="1"/>',
    "    </currencies>",
    "    <categories>",
    categoriesXml(
      promGroups,
      usedGroupIds
    ),
    "    </categories>",
    "    <offers>",
    offersXml.join("\n"),
    "    </offers>",
    "  </shop>",
    "</yml_catalog>"
  ].join("\n");

  return {
    mode,
    xml:
      xmlText,

    summary: {
      requestedFamilies:
        rows.length,

      exportedFamilies:
        familyKeys.length,

      exportedOffers:
        offersXml.length,

      usedPromGroups:
        usedGroupIds.size,

      allTargetsExist:
        entries.every(
          entry =>
            entry.validTarget
        ),

      familyKeys,

      preview
    }
  };
}

module.exports = {
  buildPromFeed,
  offerId,
  variantGroupId
};
