const express = require("express");

const { config, publicConfig } = require("./src/config");
const { runAudit } = require("./src/audit");
const { renderDashboard } = require("./src/ui");
const { loadSuppliers } = require("./src/suppliers");
const { listProducts } = require("./src/prom");

const app = express();
app.disable("x-powered-by");

const state = {
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastError: null,
  report: null
};

let auditPromise = null;

async function startAudit(reason = "manual") {
  if (auditPromise) {
    return auditPromise;
  }

  state.running = true;
  state.lastStartedAt = new Date().toISOString();
  state.lastError = null;

  auditPromise = (async () => {
    try {
      const report = await runAudit({
        reason
      });

      state.report = report;
      state.lastFinishedAt =
        new Date().toISOString();

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

async function getBezetStats() {
  const suppliers =
    await loadSuppliers();

  const offers =
    suppliers.bezet.offers;

  const groups = new Map();

  for (const offer of offers) {
    const groupId =
      String(
        offer.groupId ||
        offer.id ||
        ""
      ).trim();

    if (!groupId) {
      continue;
    }

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

  const examples = [];

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

    if (examples.length < 20) {
      examples.push({
        groupId,
        name:
          items[0]?.name ||
          "",
        variants:
          items.length,
        availableVariants:
          statuses.filter(
            x =>
              x ===
              "available"
          ).length,
        unavailableVariants:
          statuses.filter(
            x =>
              x ===
              "unavailable"
          ).length
      });
    }
  }

  const result = {
    supplier: "BEZET",

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

    examples
  };

  return result;
}

async function inspectFamily(
  supplierName,
  groupId
) {
  const suppliers =
    await loadSuppliers();

  const promProducts =
    await listProducts();

  const supplier =
    supplierName.toUpperCase() ===
    "BEZET"
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
      supplierName.toUpperCase(),

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
        "1.2.0",
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
        "1.2.0",
      mode:
        "READ_ONLY",
      config:
        publicConfig(),
      state
    });
  }
);

app.get(
  "/api/bezet-stats",
  async (_req, res) => {
    try {
      const result =
        await getBezetStats();

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
      `[PrimeTac Sync] v1.2.0 READ_ONLY listening on :${config.port}`
    );

    console.log(
      `[PrimeTac Sync] audit interval: ${config.syncIntervalHours}h`
    );

    if (
      config.autoAudit
    ) {
      setTimeout(() => {
        startAudit(
          "startup"
        ).catch(err => {
          console.error(
            "[PrimeTac Sync] startup audit failed:",
            err.message
          );
        });
      }, 3000);

      setInterval(() => {
        startAudit(
          "scheduled"
        ).catch(err => {
          console.error(
            "[PrimeTac Sync] scheduled audit failed:",
            err.message
          );
        });
      },
      config
        .syncIntervalHours *
        60 *
        60 *
        1000
      );
    }

    setTimeout(
      async () => {
        try {
          const stats =
            await getBezetStats();

          console.log(
            "[BEZET_CATALOG_STATS]"
          );

          console.log(
            JSON.stringify(
              stats
            )
          );
        } catch (err) {
          console.error(
            "[BEZET_STATS_ERROR]",
            err.message
          );
        }
      },
      10000
    );
  }
);
