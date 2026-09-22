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

async function inspectFamily(supplierName, groupId) {
  const suppliers = await loadSuppliers();
  const promProducts = await listProducts();

  const supplier =
    supplierName.toUpperCase() === "BEZET"
      ? suppliers.bezet
      : suppliers.militaris;

  const offers = supplier.offers.filter(
    item => String(item.groupId) === String(groupId)
  );

  const promByExternalId = new Map();

  for (const product of promProducts) {
    const externalId = String(
      product.external_id || ""
    ).trim();

    if (externalId) {
      promByExternalId.set(
        externalId,
        product
      );
    }
  }

  const rows = offers.map(offer => {
    const prom =
      promByExternalId.get(
        String(offer.id)
      ) || null;

    return {
      supplier: offer.supplier,
      offerId: offer.id,
      groupId: offer.groupId,
      sku: offer.sku,
      supplierName: offer.name,
      price: offer.price,
      quantity: offer.quantity,
      available: offer.available,
      params: offer.params,

      promFound: Boolean(prom),

      promId: prom?.id || null,
      promExternalId:
        prom?.external_id || null,

      promSku:
        prom?.sku ||
        prom?.sku_code ||
        prom?.article ||
        null,

      promName:
        prom?.name || null,

      promGroupId:
        prom?.group?.id ??
        prom?.group_id ??
        prom?.category_id ??
        null
    };
  });

  const promGroups = [
    ...new Set(
      rows
        .map(row => row.promGroupId)
        .filter(value => value != null)
        .map(String)
    )
  ];

  const normalized = value =>
    String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

  const result = {
    supplier: supplierName.toUpperCase(),
    groupId: String(groupId),

    supplierOfferCount: offers.length,

    promMatchedCount:
      rows.filter(row => row.promFound).length,

    missingInProm:
      rows
        .filter(row => !row.promFound)
        .map(row => row.offerId),

    promGroups,

    samePromGroup:
      promGroups.length <= 1,

    allMatchedNamesEqual:
      rows
        .filter(row => row.promFound)
        .every(
          row =>
            normalized(row.promName) ===
            normalized(row.supplierName)
        ),

    rows
  };

  return result;
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "PrimeTac Sync",
    version: "1.0.1",
    mode: "READ_ONLY",
    running: state.running,
    lastFinishedAt:
      state.lastFinishedAt
  });
});

app.get("/api/status", (_req, res) => {
  res.json({
    service: "PrimeTac Sync",
    version: "1.0.1",
    mode: "READ_ONLY",
    config: publicConfig(),
    state
  });
});

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
      res.status(500).json({
        ok: false,
        error:
          err?.message ||
          String(err)
      });
    }
  }
);

app.post("/api/audit", async (_req, res) => {
  try {
    const report =
      await startAudit("manual");

    res.json({
      ok: true,
      report
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error:
        err?.message ||
        String(err)
    });
  }
});

app.get("/api/audit", async (_req, res) => {
  try {
    const report =
      await startAudit("manual-get");

    res.json({
      ok: true,
      report
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error:
        err?.message ||
        String(err)
    });
  }
});

app.get("/", (_req, res) => {
  res
    .type("html")
    .send(
      renderDashboard({
        state,
        config: publicConfig()
      })
    );
});

app.listen(config.port, () => {
  console.log(
    `[PrimeTac Sync] v1.0.1 READ_ONLY listening on :${config.port}`
  );

  console.log(
    `[PrimeTac Sync] audit interval: ${config.syncIntervalHours}h`
  );

  if (config.autoAudit) {
    setTimeout(() => {
      startAudit("startup")
        .catch(err => {
          console.error(
            "[PrimeTac Sync] startup audit failed:",
            err.message
          );
        });
    }, 3000);

    setInterval(() => {
      startAudit("scheduled")
        .catch(err => {
          console.error(
            "[PrimeTac Sync] scheduled audit failed:",
            err.message
          );
        });
    }, config.syncIntervalHours * 60 * 60 * 1000);
  }

  setTimeout(async () => {
    try {
      const family =
        await inspectFamily(
          "BEZET",
          "118147"
        );

      console.log(
        "[FAMILY_CHECK_BEZET_118147]"
      );

      console.log(
        JSON.stringify(family)
      );
    } catch (err) {
      console.error(
        "[FAMILY_CHECK_ERROR]",
        err.message
      );
    }
  }, 12000);
});
