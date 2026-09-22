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

function compact(value) {
  return norm(value).replace(/\s+/g, "");
}

function uniqueIndex(items, getter) {
  const map = new Map();
  const duplicates = new Set();
  for (const item of items) {
    const k = compact(getter(item));
    if (!k) continue;
    if (map.has(k)) duplicates.add(k);
    else map.set(k, item);
  }
  for (const k of duplicates) map.delete(k);
  return map;
}

function supplierFamilies(offers) {
  const groups = new Map();

  for (const offer of offers) {
    if (!offer.groupId) continue;
    const familyKey = `${offer.supplier}:${offer.groupId}`;
    if (!groups.has(familyKey)) groups.set(familyKey, []);
    groups.get(familyKey).push(offer);
  }

  return [...groups.entries()]
    .filter(([, items]) => items.length >= 2)
    .map(([familyKey, items]) => ({
      familyKey,
      supplier: items[0].supplier,
      groupId: items[0].groupId,
      count: items.length,
      sample: items.slice(0, 5).map(x => ({ id:x.id, sku:x.sku, name:x.name }))
    }))
    .sort((a, b) => b.count - a.count);
}

function exactMatches(promProducts, supplierOffers) {
  const bySku = uniqueIndex(supplierOffers, x => x.sku);
  const byId = uniqueIndex(supplierOffers, x => x.id);

  const matches = [];
  const unmatched = [];

  for (const p of promProducts) {
    const pSku = p.sku || p.sku_code || p.article || "";
    const pExternal = p.external_id || "";
    const pName = norm(p.name || "");

    let offer = null;
    let reason = null;

    const skuKey = compact(pSku);
    const externalKey = compact(pExternal);

    if (skuKey && bySku.has(skuKey)) {
      offer = bySku.get(skuKey);
      reason = "exact_sku";
    } else if (externalKey && bySku.has(externalKey)) {
      offer = bySku.get(externalKey);
      reason = "external_id_equals_supplier_sku";
    } else if (externalKey && byId.has(externalKey)) {
      const candidate = byId.get(externalKey);
      if (pName && pName === norm(candidate.name)) {
        offer = candidate;
        reason = "external_id_plus_exact_name";
      }
    }

    if (offer) {
      matches.push({
        promId: p.id,
        promExternalId: p.external_id || null,
        promSku: pSku || null,
        promName: p.name || "",
        supplier: offer.supplier,
        supplierId: offer.id || null,
        supplierSku: offer.sku || null,
        supplierGroupId: offer.groupId || null,
        supplierName: offer.name || "",
        reason
      });
    } else {
      unmatched.push({
        promId:p.id,
        externalId:p.external_id || null,
        sku:pSku || null,
        name:p.name || ""
      });
    }
  }

  return { matches, unmatched };
}

async function runAudit({ reason = "manual" } = {}) {
  const startedAt = new Date().toISOString();

  const [promProducts, promGroups, suppliers] = await Promise.all([
    listProducts(),
    listGroups(),
    loadSuppliers()
  ]);

  const supplierOffers = [...suppliers.bezet.offers, ...suppliers.militaris.offers];
  const families = supplierFamilies(supplierOffers);
  const matching = exactMatches(promProducts, supplierOffers);

  const matchedFamilyKeys = new Set();
  for (const m of matching.matches) {
    if (m.supplierGroupId) matchedFamilyKeys.add(`${m.supplier}:${m.supplierGroupId}`);
  }

  return {
    version:"1.0.0",
    mode:"READ_ONLY",
    reason,
    startedAt,
    finishedAt:new Date().toISOString(),
    prom:{
      products:promProducts.length,
      groups:promGroups.length
    },
    suppliers:{
      BEZET:{
        ok:suppliers.bezet.ok,
        configured:suppliers.bezet.configured,
        error:suppliers.bezet.error,
        offers:suppliers.bezet.offers.length,
        offersWithGroupId:suppliers.bezet.offers.filter(x => x.groupId).length
      },
      MILITARIS:{
        ok:suppliers.militaris.ok,
        configured:suppliers.militaris.configured,
        error:suppliers.militaris.error,
        offers:suppliers.militaris.offers.length,
        offersWithGroupId:suppliers.militaris.offers.filter(x => x.groupId).length
      }
    },
    matching:{
      exactMatches:matching.matches.length,
      unmatchedPromProducts:matching.unmatched.length,
      exactSku:matching.matches.filter(x => x.reason === "exact_sku").length,
      externalIdEqualsSupplierSku:matching.matches.filter(x => x.reason === "external_id_equals_supplier_sku").length,
      externalIdPlusExactName:matching.matches.filter(x => x.reason === "external_id_plus_exact_name").length
    },
    variants:{
      totalFamilies:families.length,
      totalVariantOffers:families.reduce((sum, f) => sum + f.count, 0),
      matchedFamilies:families.filter(f => matchedFamilyKeys.has(f.familyKey)).length,
      bySupplier:{
        BEZET:families.filter(f => f.supplier === "BEZET").length,
        MILITARIS:families.filter(f => f.supplier === "MILITARIS").length
      }
    },
    samples:{
      families:families.slice(0, 30),
      matched:matching.matches.slice(0, 30),
      unmatched:matching.unmatched.slice(0, 30)
    },
    safety:{
      writesToProm:false,
      fuzzyMatchingForWrites:false,
      note:"This release performs GET/read-only operations only."
    }
  };
}

module.exports = { runAudit };
