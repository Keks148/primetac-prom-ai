const express = require("express");

const { config, publicConfig } = require("./src/config");
const { runAudit } = require("./src/audit");
const { renderDashboard } = require("./src/ui");
const { loadSuppliers } = require("./src/suppliers");
const { listProducts } = require("./src/prom");
const { buildFilteredCatalogStats } = require("./src/catalog-filter");

const app = express();
app.disable("x-powered-by");

const state = {
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastError: null,
  report: null,
  catalogStats: null,
  filteredStats: null
};

let auditPromise = null;
let statsPromise = null;
let filteredStatsPromise = null;

async function startAudit(reason = "manual") {
  if (auditPromise) return auditPromise;

  state.running = true;
  state.lastStartedAt = new Date().toISOString();
  state.lastError = null;

  auditPromise = (async () => {
    try {
      const report = await runAudit({ reason });

      state.report = report;
      state.lastFinishedAt = new Date().toISOString();

      return report;
    } catch (err) {
      state.lastError =
        err?.stack ||
        err?.message ||
        String(err);

      throw err;
    } finally {
      state.running = false;
      auditPromise = null;
    }
  })();

  return auditPromise;
}

function availabilityStatus(offer) {
  const raw = String(
    offer?.available ?? ""
  )
    .trim()
    .toLowerCase();

  if (
    [
      "true",
      "1",
      "yes",
      "available",
      "in_stock"
    ].includes(raw)
  ) {
    return "available";
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
    return "unavailable";
  }

  const quantity = Number(
    offer?.quantity
  );

  if (Number.isFinite(quantity)) {
    return quantity > 0
      ? "available"
      : "unavailable";
  }

  return "unknown";
}

function buildSupplierStats(
  supplierName,
  supplierData
) {
  const offers =
    supplierData?.offers || [];

  const groups = new Map();

  for (const offer of offers) {
    const groupId =
      String(
        offer.groupId ||
        offer.id ||
        ""
      ).trim();

    if (!groupId) continue;

    if (!groups.has(groupId)) {
      groups.set(groupId, []);
    }

    groups
      .get(groupId)
      .push(offer);
  }

  let availableOffers = 0;
  let unavailableOffers = 0;
  let unknownOffers = 0;

  for (const offer of offers) {
    const status =
      availabilityStatus(offer);

    if (status === "available") {
      availableOffers++;
    } else if (
      status === "unavailable"
    ) {
      unavailableOffers++;
    } else {
      unknownOffers++;
    }
  }

  let availableModels = 0;
  let unavailableModels = 0;
  let unknownModels = 0;

  let singletonModels = 0;
  let multiVariantModels = 0;

  let availableSingletonModels = 0;
  let availableMultiVariantModels = 0;

  let maxVariants = 0;

  const variantDistribution = {};
  const availableExamples = [];

  for (
    const [groupId, items]
    of groups.entries()
  ) {
    const statuses =
      items.map(
        availabilityStatus
      );

    const hasAvailable =
      statuses.includes(
        "available"
      );

    const hasUnknown =
      statuses.includes(
        "unknown"
      );

    if (hasAvailable) {
      availableModels++;
    } else if (hasUnknown) {
      unknownModels++;
    } else {
      unavailableModels++;
    }

    if (items.length === 1) {
      singletonModels++;

      if (hasAvailable) {
        availableSingletonModels++;
      }
    } else {
      multiVariantModels++;

      if (hasAvailable) {
        availableMultiVariantModels++;
      }
    }

    maxVariants =
      Math.max(
        maxVariants,
        items.length
      );

    const bucket =
      String(items.length);

    variantDistribution[bucket] =
      (variantDistribution[bucket] || 0) + 1;

    if (
      hasAvailable &&
      availableExamples.length < 20
    ) {
      availableExamples.push({
        groupId,
        name:
          items[0]?.name ||
          "",
        categoryId:
          items[0]?.categoryId ||
          "",
        variants:
          items.length,
        availableVariants:
          statuses.filter(
            status =>
              status ===
              "available"
          ).length,
        unavailableVariants:
          statuses.filter(
            status =>
              status ===
              "unavailable"
          ).length
      });
    }
  }

  return {
    supplier:
      supplierName,

    ok:
      Boolean(
        supplierData?.ok
      ),

    configured:
      Boolean(
        supplierData?.configured
      ),

    error:
      supplierData?.error ||
      null,

    totalOffers:
      offers.length,

    realProducts:
      groups.size,

    availableProducts:
      availableModels,

    unavailableProducts:
      unavailableModels,

    unknownAvailabilityProducts:
      unknownModels,

    singletonProducts:
      singletonModels,

    multiVariantProducts:
      multiVariantModels,

    availableSingletonProducts:
      availableSingletonModels,

    availableMultiVariantProducts:
      availableMultiVariantModels,

    availableOffers,
    unavailableOffers,
    unknownOffers,

    maxVariantsInOneProduct:
      maxVariants,

    variantDistribution,

    fitsProm1000All:
      groups.size <= 1000,

    fitsProm1000AvailableOnly:
      availableModels <= 1000,

    cardsIfUploadEverything:
      groups.size,

    cardsIfUploadAvailableOnly:
      availableModels,

    freeSlotsIfAvailableOnly:
      Math.max(
        0,
        1000 -
        availableModels
      ),

    overLimitIfEverything:
      Math.max(
        0,
        groups.size -
        1000
      ),

    overLimitIfAvailableOnly:
      Math.max(
        0,
        availableModels -
        1000
      ),

    availableExamples
  };
}

async function getCatalogStats() {
  if (statsPromise) {
    return statsPromise;
  }

  statsPromise = (async () => {
    const suppliers =
      await loadSuppliers();

    const bezet =
      buildSupplierStats(
        "BEZET",
        suppliers.bezet
      );

    const militaris =
      buildSupplierStats(
        "MILITARIS",
        suppliers.militaris
      );

    const combinedAvailableProducts =
      bezet.availableProducts +
      militaris.availableProducts;

    const combinedRealProducts =
      bezet.realProducts +
      militaris.realProducts;

    const combinedAvailableOffers =
      bezet.availableOffers +
      militaris.availableOffers;

    const result = {
      generatedAt:
        new Date().toISOString(),

      suppliers: {
        BEZET:
          bezet,

        MILITARIS:
          militaris
      },

      combined: {
        realProducts:
          combinedRealProducts,

        availableProducts:
          combinedAvailableProducts,

        availableOffers:
          combinedAvailableOffers,

        fitsProm1000AvailableOnly:
          combinedAvailableProducts <= 1000,

        freeSlotsIfAvailableOnly:
          Math.max(
            0,
            1000 -
            combinedAvailableProducts
          ),

        overLimitIfAvailableOnly:
          Math.max(
            0,
            combinedAvailableProducts -
            1000
          ),

        identityRule:
          "supplier + groupId"
      }
    };

    state.catalogStats =
      result;

    return result;
  })();

  try {
    return await statsPromise;
  } finally {
    statsPromise = null;
  }
}

async function getFilteredStats() {
  if (filteredStatsPromise) {
    return filteredStatsPromise;
  }

  filteredStatsPromise = (async () => {
    const suppliers =
      await loadSuppliers();

    const result =
      buildFilteredCatalogStats(
        suppliers,
        {
          minPrice: 500,
          maxMilitarisAccessories: 40,
          maxCards: 1000
        }
      );

    state.filteredStats =
      result;

    return result;
  })();

  try {
    return await filteredStatsPromise;
  } finally {
    filteredStatsPromise = null;
  }
}

async function inspectFamily(
  supplierName,
  groupId
) {
  const suppliers =
    await loadSuppliers();

  const promProducts =
    await listProducts();

  const supplierKey =
    supplierName
      .toUpperCase();

  const supplier =
    supplierKey === "BEZET"
      ? suppliers.bezet
      : suppliers.militaris;

  const offers =
    supplier.offers.filter(
      item =>
        String(
          item.groupId
        ) ===
        String(groupId)
    );

  const promByExternalId =
    new Map();

  for (
    const product
    of promProducts
  ) {
    const externalId =
      String(
        product.external_id ||
        ""
      ).trim();

    if (externalId) {
      promByExternalId.set(
        externalId,
        product
      );
    }
  }

  const rows =
    offers.map(offer => {
      const prom =
        promByExternalId.get(
          String(offer.id)
        ) || null;

      return {
        supplier:
          offer.supplier,

        offerId:
          offer.id,

        groupId:
          offer.groupId,

        sku:
          offer.sku,

        supplierName:
          offer.name,

        categoryId:
          offer.categoryId,

        price:
          offer.price,

        quantity:
          offer.quantity,

        available:
          offer.available,

        params:
          offer.params,

        promFound:
          Boolean(prom),

        promId:
          prom?.id ||
          null,

        promExternalId:
          prom?.external_id ||
          null,

        promSku:
          prom?.sku ||
          prom?.sku_code ||
          prom?.article ||
          null,

        promName:
          prom?.name ||
          null,

        promGroupId:
          prom?.group?.id ??
          prom?.group_id ??
          prom?.category_id ??
          null
      };
    });

  return {
    supplier:
      supplierKey,

    groupId:
      String(groupId),

    supplierOfferCount:
      offers.length,

    promMatchedCount:
      rows.filter(
        row =>
          row.promFound
      ).length,

    rows
  };
}

app.get(
  "/health",
  (_req, res) => {
    res.json({
      ok: true,
      service:
        "PrimeTac Sync",
      version:
        "1.4.4",
      mode:
        "READ_ONLY",
      running:
        state.running,
      lastFinishedAt:
        state.lastFinishedAt
    });
  }
);

app.get(
  "/api/status",
  (_req, res) => {
    res.json({
      service:
        "PrimeTac Sync",
      version:
        "1.4.4",
      mode:
        "READ_ONLY",
      config:
        publicConfig(),
      state
    });
  }
);

app.get(
  "/api/catalog-stats",
  async (_req, res) => {
    try {
      const result =
        await getCatalogStats();

      res.json({
        ok: true,
        result
      });
    } catch (err) {
      res
        .status(500)
        .json({
          ok: false,
          error:
            err?.message ||
            String(err)
        });
    }
  }
);

app.get(
  "/api/filtered-stats",
  async (_req, res) => {
    try {
      const result =
        await getFilteredStats();

      console.log(
        "[FILTERED_CATALOG_STATS]"
      );

      console.log(
        JSON.stringify(
          result
        )
      );

      res.json({
        ok: true,
        result
      });
    } catch (err) {
      res
        .status(500)
        .json({
          ok: false,
          error:
            err?.message ||
            String(err)
        });
    }
  }
);

app.get(
  "/api/bezet-stats",
  async (_req, res) => {
    try {
      const result =
        await getCatalogStats();

      res.json({
        ok: true,
        result:
          result.suppliers.BEZET
      });
    } catch (err) {
      res
        .status(500)
        .json({
          ok: false,
          error:
            err?.message ||
            String(err)
        });
    }
  }
);

app.get(
  "/api/militaris-stats",
  async (_req, res) => {
    try {
      const result =
        await getCatalogStats();

      res.json({
        ok: true,
        result:
          result.suppliers.MILITARIS
      });
    } catch (err) {
      res
        .status(500)
        .json({
          ok: false,
          error:
            err?.message ||
            String(err)
        });
    }
  }
);

app.get(
  "/api/family/:supplier/:groupId",
  async (req, res) => {
    try {
      const result =
        await inspectFamily(
          req.params.supplier,
          req.params.groupId
        );

      res.json({
        ok: true,
        result
      });
    } catch (err) {
      res
        .status(500)
        .json({
          ok: false,
          error:
            err?.message ||
            String(err)
        });
    }
  }
);

app.post(
  "/api/audit",
  async (_req, res) => {
    try {
      const report =
        await startAudit(
          "manual"
        );

      res.json({
        ok: true,
        report
      });
    } catch (err) {
      res
        .status(500)
        .json({
          ok: false,
          error:
            err?.message ||
            String(err)
        });
    }
  }
);

app.get(
  "/api/audit",
  async (_req, res) => {
    try {
      const report =
        await startAudit(
          "manual-get"
        );

      res.json({
        ok: true,
        report
      });
    } catch (err) {
      res
        .status(500)
        .json({
          ok: false,
          error:
            err?.message ||
            String(err)
        });
    }
  }
);

app.get(
  "/",
  (_req, res) => {
    res
      .type("html")
      .send(
        renderDashboard({
          state,
          config:
            publicConfig()
        })
      );
  }
);

app.listen(
  config.port,
  () => {
    console.log(
      `[PrimeTac Sync] v1.4.4 READ_ONLY listening on :${config.port}`
    );

    const KYIV_SLOTS = [
      4,
      8,
      11,
      14,
      17,
      20,
      23
    ];

    console.log(
      `[PrimeTac Sync] schedule Europe/Kyiv: ${KYIV_SLOTS.map(h => String(h).padStart(2, "0") + ":00").join(", ")}`
    );

    function kyivParts(date = new Date()) {
      const parts =
        new Intl.DateTimeFormat(
          "en-CA",
          {
            timeZone:
              "Europe/Kyiv",
            year:
              "numeric",
            month:
              "2-digit",
            day:
              "2-digit",
            hour:
              "2-digit",
            minute:
              "2-digit",
            hourCycle:
              "h23"
          }
        )
          .formatToParts(date)
          .reduce(
            (acc, item) => {
              if (
                item.type !==
                "literal"
              ) {
                acc[item.type] =
                  item.value;
              }

              return acc;
            },
            {}
          );

      return {
        year:
          parts.year,
        month:
          parts.month,
        day:
          parts.day,
        hour:
          Number(parts.hour),
        minute:
          Number(parts.minute)
      };
    }

    let lastScheduledSlot =
      null;

    async function runScheduledCycle(
      reason
    ) {
      try {
        await startAudit(
          reason
        );

        const filtered =
          await getFilteredStats();

        console.log(
          "[SCHEDULED_FILTERED_CATALOG_STATS]"
        );

        console.log(
          JSON.stringify(
            filtered
          )
        );
      } catch (err) {
        console.error(
          "[PrimeTac Sync] scheduled cycle failed:",
          err?.message ||
          String(err)
        );
      }
    }

    if (
      config.autoAudit
    ) {
      setTimeout(() => {
        runScheduledCycle(
          "startup"
        );
      }, 3000);

      // Проверяем часы по Киеву раз в минуту.
      // Окно 10 минут защищает от пропуска слота после холодного старта Render.
      setInterval(
        () => {
          const now =
            kyivParts();

          if (
            !KYIV_SLOTS.includes(
              now.hour
            ) ||
            now.minute > 9
          ) {
            return;
          }

          const slotKey =
            `${now.year}-${now.month}-${now.day}-${String(now.hour).padStart(2, "0")}`;

          if (
            slotKey ===
            lastScheduledSlot
          ) {
            return;
          }

          lastScheduledSlot =
            slotKey;

          runScheduledCycle(
            `scheduled-${slotKey}`
          );
        },
        60 * 1000
      );
    }

    setTimeout(
      async () => {
        try {
          const stats =
            await getCatalogStats();

          console.log(
            "[SUPPLIER_CATALOG_STATS]"
          );

          console.log(
            JSON.stringify(
              stats
            )
          );
        } catch (err) {
          console.error(
            "[SUPPLIER_STATS_ERROR]",
            err?.message ||
            String(err)
          );
        }
      },
      12000
    );

    setTimeout(
      async () => {
        try {
          const filtered =
            await getFilteredStats();

          console.log(
            "[FILTERED_CATALOG_STATS]"
          );

          console.log(
            JSON.stringify(
              filtered
            )
          );
        } catch (err) {
          console.error(
            "[FILTERED_CATALOG_STATS_ERROR]",
            err?.message ||
            String(err)
          );
        }
      },
      25000
    );
  }
);
