const express = require("express");
const { runPromEditor, buildPromEditorPlan, EDITOR_VERSION } = require("./src/prom-editor");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT || 10000);
const ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.PROM_EDITOR_ENABLED || "false"));
const APPLY = /^(1|true|yes|on)$/i.test(String(process.env.PROM_EDITOR_APPLY || "false"));
const INTERVAL_MINUTES = Math.max(15, Number(process.env.PROM_EDITOR_INTERVAL_MINUTES || 30));
const START_DELAY_SECONDS = Math.max(30, Number(process.env.PROM_EDITOR_START_DELAY_SECONDS || 120));

const state = {
  version: EDITOR_VERSION,
  enabled: ENABLED,
  apply: APPLY,
  intervalMinutes: INTERVAL_MINUTES,
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastError: null,
  lastResult: null
};

let runningPromise = null;

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

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "PrimeTac Post-Import Editor",
    version: EDITOR_VERSION,
    enabled: ENABLED,
    apply: APPLY,
    running: state.running,
    lastFinishedAt: state.lastFinishedAt,
    lastError: state.lastError
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
      emptyGroups: plan.emptyGroups.slice(0, 100)
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
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

app.get("/", (_req, res) => {
  res.type("html").send(
    "<h1>PrimeTac Post-Import Editor " + EDITOR_VERSION + "</h1>" +
    "<p>Enabled: <strong>" + ENABLED + "</strong></p>" +
    "<p>Apply changes: <strong>" + APPLY + "</strong></p>" +
    "<p>Interval: <strong>" + INTERVAL_MINUTES + " min</strong></p>" +
    "<p><a href='/api/editor/plan'>Editor plan</a> · <a href='/api/editor/status'>Status</a></p>"
  );
});

app.listen(PORT, () => {
  console.log("[PrimeTac Editor] v" + EDITOR_VERSION + " listening on :" + PORT);
  console.log("[PrimeTac Editor] enabled=" + ENABLED + " apply=" + APPLY + " interval=" + INTERVAL_MINUTES + "m");

  if (!ENABLED) {
    console.log("[PrimeTac Editor] scheduler disabled");
    return;
  }

  setTimeout(() => {
    run("startup-delay").catch(() => {});
  }, START_DELAY_SECONDS * 1000);

  setInterval(() => {
    run("scheduled-" + new Date().toISOString()).catch(() => {});
  }, INTERVAL_MINUTES * 60 * 1000);
});
