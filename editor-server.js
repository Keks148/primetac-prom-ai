const express = require("express");
const {
  runPromEditor,
  buildPromEditorPlan,
  EDITOR_VERSION
} = require("./src/prom-editor");
const {
  buildEnrichmentFeed,
  submitEnrichmentImport,
  canSubmitByGap
} = require("./src/enrichment-import");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT || 10000);

const ENABLED =
  /^(1|true|yes|on)$/i.test(
    String(process.env.PROM_EDITOR_ENABLED || "false")
  );

const APPLY =
  /^(1|true|yes|on)$/i.test(
    String(process.env.PROM_EDITOR_APPLY || "false")
  );

const INTERVAL_MINUTES =
  Math.max(
    15,
    Number(process.env.PROM_EDITOR_INTERVAL_MINUTES || 30)
  );

const START_DELAY_SECONDS =
  Math.max(
    30,
    Number(process.env.PROM_EDITOR_START_DELAY_SECONDS || 120)
  );

const ENRICH_ENABLED =
  /^(1|true|yes|on)$/i.test(
    String(process.env.PROM_ENRICH_IMPORT_ENABLED || "true")
  );

const ENRICH_APPLY =
  /^(1|true|yes|on)$/i.test(
    String(process.env.PROM_ENRICH_IMPORT_APPLY || "false")
  );

const ENRICH_INTERVAL_MINUTES =
  Math.max(
    60,
    Number(process.env.PROM_ENRICH_IMPORT_INTERVAL_MINUTES || 240)
  );

const ENRICH_START_DELAY_SECONDS =
  Math.max(
    300,
    Number(process.env.PROM_ENRICH_IMPORT_START_DELAY_SECONDS || 900)
  );

const state = {
  version: EDITOR_VERSION,
  enabled: ENABLED,
  apply: APPLY,
  intervalMinutes: INTERVAL_MINUTES,
  enrichEnabled: ENRICH_ENABLED,
  enrichApply: ENRICH_APPLY,
  enrichIntervalMinutes: ENRICH_INTERVAL_MINUTES,
  running: false,
  enrichRunning: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastError: null,
  lastResult: null,
  lastEnrichResult: null,
  lastEnrichError: null
};

let runningPromise = null;
let enrichPromise = null;

async function run(reason) {
  if (runningPromise) return runningPromise;

  state.running = true;
  state.lastStartedAt = new Date().toISOString();
  state.lastError = null;

  runningPromise = (async () => {
    try {
      const result = await runPromEditor({ apply: APPLY, reason });
      state.lastResult = result;
      state.lastFinishedAt = new Date().toISOString();
      return result;
    } catch (err) {
      state.lastError = err?.stack || err?.message || String(err);
      console.error("[PROM_EDITOR_ERROR]", state.lastError);
      throw err;
    } finally {
      state.running = false;
      runningPromise = null;
    }
  })();

  return runningPromise;
}

async function runEnrichment(reason) {
  if (enrichPromise) return enrichPromise;

  state.enrichRunning = true;
  state.lastEnrichError = null;

  enrichPromise = (async () => {
    try {
      const feed = await buildEnrichmentFeed();

      if (!ENRICH_APPLY) {
        const result = {
          reason,
          apply: false,
          summary: feed.summary,
          preview: feed.preview.slice(0, 40)
        };
        state.lastEnrichResult = result;
        console.log("[PROM_ENRICH_DRY_RUN]");
        console.log(JSON.stringify(result));
        return result;
      }

      if (!canSubmitByGap(180)) {
        const result = {
          reason,
          apply: true,
          skipped: true,
          why: "minimum_180_min_gap",
          summary: feed.summary
        };
        state.lastEnrichResult = result;
        console.log("[PROM_ENRICH_IMPORT_SKIP]");
        console.log(JSON.stringify(result));
        return result;
      }

      const result = await submitEnrichmentImport();
      state.lastEnrichResult = { reason, apply: true, ...result };
      return state.lastEnrichResult;
    } catch (err) {
      state.lastEnrichError = err?.stack || err?.message || String(err);
      console.error("[PROM_ENRICH_ERROR]", state.lastEnrichError);
      throw err;
    } finally {
      state.enrichRunning = false;
      enrichPromise = null;
    }
  })();

  return enrichPromise;
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "PrimeTac Post-Import Editor",
    version: EDITOR_VERSION,
    enabled: ENABLED,
    apply: APPLY,
    enrichEnabled: ENRICH_ENABLED,
    enrichApply: ENRICH_APPLY,
    running: state.running,
    enrichRunning: state.enrichRunning,
    lastFinishedAt: state.lastFinishedAt,
    lastError: state.lastError,
    lastEnrichError: state.lastEnrichError
  });
});

app.get("/api/editor/status", (_req, res) => {
  res.json({ ok: true, state });
});

app.get("/api/editor/plan", async (_req, res) => {
  try {
    const plan = await buildPromEditorPlan();
    res.json({
      ok: true,
      version: plan.version,
      generatedAt: plan.generatedAt,
      policy: plan.policy,
      counts: plan.counts,
      remove: plan.remove.slice(0, 100),
      review: plan.review.slice(0, 100),
      groupFixes: plan.groupFixes.slice(0, 100),
      emptyGroups: plan.emptyGroups.slice(0, 100)
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.get("/api/editor/enrichment-plan", async (_req, res) => {
  try {
    const feed = await buildEnrichmentFeed();
    res.json({
      ok: true,
      version: EDITOR_VERSION,
      summary: feed.summary,
      preview: feed.preview.slice(0, 100)
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.get("/feeds/editor-enrichment.csv", async (_req, res) => {
  try {
    const feed = await buildEnrichmentFeed();
    console.log("[PROM_ENRICH_FEED_REQUEST]");
    console.log(JSON.stringify(feed.summary));
    res
      .status(200)
      .set("Content-Type", "text/csv; charset=utf-8")
      .set("Cache-Control", "no-store")
      .send("\uFEFF" + feed.csv);
  } catch (err) {
    res.status(500).type("text/plain").send(err?.message || String(err));
  }
});

app.post("/api/editor/run", async (req, res) => {
  try {
    const requestedApply = Boolean(req.body && req.body.apply);
    if (requestedApply && !APPLY) {
      return res.status(409).json({
        ok: false,
        error: "PROM_EDITOR_APPLY is disabled on Render"
      });
    }
    const result = await run(req.body?.reason || "manual-api");
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.post("/api/editor/enrichment-run", async (req, res) => {
  try {
    const requestedApply = Boolean(req.body && req.body.apply);
    if (requestedApply && !ENRICH_APPLY) {
      return res.status(409).json({
        ok: false,
        error: "PROM_ENRICH_IMPORT_APPLY is disabled on Render"
      });
    }
    const result = await runEnrichment(
      req.body?.reason || "manual-enrichment-api"
    );
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.get("/", (_req, res) => {
  res.type("html").send(
    "<h1>PrimeTac Post-Import Editor " + EDITOR_VERSION + "</h1>" +
    "<p>Editor apply: <strong>" + APPLY + "</strong></p>" +
    "<p>Editor interval: <strong>" + INTERVAL_MINUTES + " min</strong></p>" +
    "<p>Enrichment apply: <strong>" + ENRICH_APPLY + "</strong></p>" +
    "<p>Enrichment interval: <strong>" + ENRICH_INTERVAL_MINUTES + " min</strong></p>" +
    "<p><a href='/api/editor/plan'>Editor plan</a> · " +
    "<a href='/api/editor/enrichment-plan'>Enrichment plan</a> · " +
    "<a href='/feeds/editor-enrichment.csv'>Enrichment CSV</a> · " +
    "<a href='/api/editor/status'>Status</a></p>"
  );
});

app.listen(PORT, () => {
  console.log("[PrimeTac Editor] v" + EDITOR_VERSION + " listening on :" + PORT);
  console.log(
    "[PrimeTac Editor] enabled=" + ENABLED +
    " apply=" + APPLY +
    " interval=" + INTERVAL_MINUTES + "m"
  );
  console.log(
    "[PrimeTac Enrichment] enabled=" + ENRICH_ENABLED +
    " apply=" + ENRICH_APPLY +
    " interval=" + ENRICH_INTERVAL_MINUTES + "m"
  );

  if (ENABLED) {
    setTimeout(() => {
      run("startup-delay").catch(() => {});
    }, START_DELAY_SECONDS * 1000);

    setInterval(() => {
      run("scheduled-" + new Date().toISOString()).catch(() => {});
    }, INTERVAL_MINUTES * 60 * 1000);
  }

  if (ENRICH_ENABLED) {
    setTimeout(() => {
      runEnrichment("startup-enrichment-delay").catch(() => {});
    }, ENRICH_START_DELAY_SECONDS * 1000);

    setInterval(() => {
      runEnrichment("scheduled-enrichment-" + new Date().toISOString())
        .catch(() => {});
    }, ENRICH_INTERVAL_MINUTES * 60 * 1000);
  }
});
