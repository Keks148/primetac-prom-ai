const {
  listProducts,
  listGroups
} = require("./prom");

const ACCIDENTAL_GROUP_IDS =
  new Set([
    "157179044","157179045","157179046","157179047",
    "157179048","157179049","157179050","157179051",
    "157179052","157179053","157179054","157179055",
    "157179056","157179057","157179058","157179059",
    "157179060","157179061","157179062","157179063",
    "157179064","157179065","157179066","157179067"
  ]);

function clean(value) {
  return String(value ?? "").trim();
}

function groupIdOf(product) {
  return (
    product?.group?.id ??
    product?.group_id ??
    product?.category_id ??
    null
  );
}

function variationGroupIdOf(product) {
  return (
    product?.variation_group_id ??
    product?.variationGroupId ??
    product?.variation_group?.id ??
    null
  );
}

function presenceOf(product) {
  return (
    product?.presence ??
    product?.available ??
    product?.availability ??
    product?.status ??
    null
  );
}

function quantityOf(product) {
  return (
    product?.quantity ??
    product?.quantity_in_stock ??
    product?.stock ??
    product?.stock_quantity ??
    null
  );
}

function compactProduct(product) {
  return {
    id: product?.id ?? null,
    externalId: product?.external_id ?? null,
    sku:
      product?.sku ??
      product?.sku_code ??
      product?.article ??
      null,
    name: product?.name ?? "",
    groupId: groupIdOf(product),
    variationGroupId: variationGroupIdOf(product),
    presence: presenceOf(product),
    quantity: quantityOf(product),
    price: product?.price ?? null,
    imagesCount:
      Array.isArray(product?.images)
        ? product.images.length
        : Array.isArray(product?.pictures)
          ? product.pictures.length
          : null
  };
}

function increment(object, key) {
  const k = clean(key) || "(empty)";
  object[k] = (object[k] || 0) + 1;
}

async function auditPromPlacement() {
  const [products, groups] =
    await Promise.all([
      listProducts(),
      listGroups()
    ]);

  const byGroup = {};
  const presence = {};
  const variationGroups = new Set();

  const accidental = [];
  const original = [];
  const noGroup = [];

  for (const product of products) {
    const groupId = groupIdOf(product);

    const groupKey =
      groupId == null
        ? ""
        : String(groupId);

    increment(byGroup, groupKey);
    increment(presence, presenceOf(product));

    const variationId =
      variationGroupIdOf(product);

    if (
      variationId != null &&
      String(variationId).trim()
    ) {
      variationGroups.add(
        String(variationId)
      );
    }

    const item =
      compactProduct(product);

    if (!groupKey) {
      noGroup.push(item);
    } else if (
      ACCIDENTAL_GROUP_IDS.has(groupKey)
    ) {
      accidental.push(item);
    } else {
      original.push(item);
    }
  }

  const accidentalGroups =
    groups
      .filter(
        group =>
          ACCIDENTAL_GROUP_IDS.has(
            String(group?.id)
          )
      )
      .map(
        group => ({
          id: group?.id,
          name:
            group?.name ??
            group?.title ??
            "",
          parentId:
            group?.parent_group_id ??
            group?.parent_id ??
            group?.parent?.id ??
            null
        })
      );

  return {
    products: products.length,
    groups: groups.length,

    accidentalGroupsPresent:
      accidentalGroups.length,

    accidentalGroupIds:
      accidentalGroups.map(
        group => group.id
      ),

    productsInAccidentalGroups:
      accidental.length,

    productsInOriginalGroups:
      original.length,

    productsWithoutGroup:
      noGroup.length,

    variationGroups:
      variationGroups.size,

    presenceCounts:
      presence,

    productsByGroup:
      byGroup,

    samples: {
      accidental:
        accidental.slice(0, 40),

      original:
        original.slice(0, 40),

      noGroup:
        noGroup.slice(0, 20)
    }
  };
}

module.exports = {
  ACCIDENTAL_GROUP_IDS,
  auditPromPlacement
};
