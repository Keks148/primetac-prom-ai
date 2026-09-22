const express = require("express");
const { config, publicConfig } = require("./src/config");
const { runAudit } = require("./src/audit");
const { renderDashboard } = require("./src/ui");

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
      state.lastError = err?.stack || err?.message || String(err);
      throw err;
    } finally {
      state.running = false;
      auditPromise = null;
    }
  })();

  return auditPromise;
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "PrimeTac Sync",
    version: "1.0.0",
    mode: "READ_ONLY",
    running: state.running,
    lastFinishedAt: state.lastFinishedAt
  });
});

app.get("/api/status", (_req, res) => {
  res.json({
    service: "PrimeTac Sync",
    version: "1.0.0",
    mode: "READ_ONLY",
    config: publicConfig(),
    state
  });
});

app.get("/api/audit", async (_req, res) => {
  try {
    const report = await startAudit("manual-get");
    res.json({ ok: true, report });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.post("/api/audit", async (_req, res) => {
  try {
    const report = await startAudit("manual");
    res.json({ ok: true, report });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.get("/", (_req, res) => {
  res.type("html").send(renderDashboard({
    state,
    config: publicConfig()
  }));
});

app.listen(config.port, () => {
  console.log(`[PrimeTac Sync] v1.0.0 READ_ONLY listening on :${config.port}`);
  console.log(`[PrimeTac Sync] audit interval: ${config.syncIntervalHours}h`);

  if (config.autoAudit) {
    setTimeout(() => {
      startAudit("startup").catch(err => {
        console.error("[PrimeTac Sync] startup audit failed:", err.message);
      });
    }, 3000);

    setInterval(() => {
      startAudit("scheduled").catch(err => {
        console.error("[PrimeTac Sync] scheduled audit failed:", err.message);
      });
    }, config.syncIntervalHours * 60 * 60 * 1000);
  }
});
