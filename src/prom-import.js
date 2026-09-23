const fs = require("fs");
const path = require("path");

const {
  config
} = require("./config");

const {
  markPublished
} = require("./enrichment");

const STATE_PATH =
  process.env
    .PROM_IMPORT_STATE_PATH ||
  "/var/data/primetac-prom-import-state.json";

function ensureDir() {
  fs.mkdirSync(
    path.dirname(
      STATE_PATH
    ),
    {
      recursive: true
    }
  );
}

function readState() {
  try {
    return JSON.parse(
      fs.readFileSync(
        STATE_PATH,
        "utf8"
      )
    );
  } catch {
    return {
      controlTestV1:
        null
    };
  }
}

function writeState(
  state
) {
  ensureDir();

  const tmp =
    `${STATE_PATH}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(
      state,
      null,
      2
    ),
    "utf8"
  );

  fs.renameSync(
    tmp,
    STATE_PATH
  );
}

async function promJson(
  endpoint,
  {
    method = "GET",
    body = null
  } = {}
) {
  if (
    !config.promToken
  ) {
    throw new Error(
      "PROM_TOKEN is not configured"
    );
  }

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      config.httpTimeoutMs
    );

  try {
    const response =
      await fetch(
        `${config.promApiBase}/${endpoint}`,
        {
          method,
          signal:
            controller.signal,

          headers: {
            Accept:
              "application/json",

            Authorization:
              `Bearer ${config.promToken}`,

            ...(body
              ? {
                  "Content-Type":
                    "application/json"
                }
              : {})
          },

          ...(body
            ? {
                body:
                  JSON.stringify(
                    body
                  )
              }
            : {})
        }
      );

    const text =
      await response.text();

    let parsed =
      null;

    try {
      parsed =
        text
          ? JSON.parse(text)
          : null;
    } catch {
      parsed =
        text;
    }

    if (!response.ok) {
      throw new Error(
        `Prom API ${response.status}: ${
          typeof parsed ===
          "string"
            ? parsed.slice(
                0,
                800
              )
            : JSON.stringify(
                parsed
              )
        }`
      );
    }

    return parsed;
  } finally {
    clearTimeout(
      timeout
    );
  }
}

async function startImportUrl(
  feedUrl,
  {
    forceUpdate = true,
    markMissingProductAs =
      "none"
  } = {}
) {
  return promJson(
    "products/import_url",
    {
      method:
        "POST",

      body: {
        url:
          feedUrl,

        force_update:
          Boolean(
            forceUpdate
          ),

        only_available:
          false,

        only_update:
          false,

        mark_missing_product_as:
          markMissingProductAs
      }
    }
  );
}

async function getImportStatus(
  id
) {
  return promJson(
    `products/import/status/${encodeURIComponent(
      id
    )}`
  );
}

function statusName(
  value
) {
  return String(
    value ?? ""
  )
    .trim()
    .toUpperCase();
}

async function waitForImport(
  id,
  {
    timeoutMs =
      8 * 60 * 1000,

    intervalMs =
      5000
  } = {}
) {
  const started =
    Date.now();

  let last =
    null;

  while (
    Date.now() -
      started <
    timeoutMs
  ) {
    last =
      await getImportStatus(
        id
      );

    const status =
      statusName(
        last?.status
      );

    console.log(
      "[PROM_IMPORT_STATUS]",
      JSON.stringify({
        id,
        status,
        result:
          last
      })
    );

    if (
      [
        "SUCCESS",
        "DONE",
        "FINISHED",
        "COMPLETED"
      ].includes(status)
    ) {
      return {
        ok: true,
        result:
          last
      };
    }

    if (
      [
        "ERROR",
        "FAILED",
        "FAILURE",
        "CANCELED",
        "CANCELLED"
      ].includes(status)
    ) {
      return {
        ok: false,
        result:
          last
      };
    }

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          intervalMs
        )
    );
  }

  return {
    ok: false,
    timeout: true,
    result:
      last
  };
}

async function runControlTestOnce({
  enabled,
  feedUrl,
  familyKeys
}) {
  if (!enabled) {
    return {
      skipped: true,
      reason:
        "PROM_TEST_IMPORT_ON_START is disabled"
    };
  }

  const state =
    readState();

  if (
    state.controlTestV1
      ?.completed
  ) {
    return {
      skipped: true,
      reason:
        "control test v1 already completed",
      state:
        state.controlTestV1
    };
  }

  const startedAt =
    new Date()
      .toISOString();

  state.controlTestV1 = {
    completed:
      false,

    startedAt,
    feedUrl,

    familyKeys
  };

  writeState(state);

  try {
    const response =
      await startImportUrl(
        feedUrl,
        {
          forceUpdate:
            true,

          markMissingProductAs:
            "none"
        }
      );

    const id =
      response?.id ||
      response?.import_id ||
      response?.job_id ||
      null;

    if (!id) {
      throw new Error(
        `Prom import did not return job id: ${JSON.stringify(
          response
        )}`
      );
    }

    state.controlTestV1
      .importId =
      id;

    state.controlTestV1
      .startResponse =
      response;

    writeState(state);

    const final =
      await waitForImport(
        id
      );

    state.controlTestV1
      .finishedAt =
      new Date()
        .toISOString();

    state.controlTestV1
      .final =
      final;

    if (final.ok) {
      state.controlTestV1
        .completed =
        true;

      markPublished(
        familyKeys
      );
    } else {
      state.controlTestV1
        .completed =
        false;
    }

    writeState(state);

    return {
      skipped:
        false,
      id,
      ...final
    };
  } catch (err) {
    state.controlTestV1
      .finishedAt =
      new Date()
        .toISOString();

    state.controlTestV1
      .error =
      err?.message ||
      String(err);

    state.controlTestV1
      .completed =
      false;

    writeState(state);

    throw err;
  }
}

module.exports = {
  STATE_PATH,
  readState,
  startImportUrl,
  getImportStatus,
  waitForImport,
  runControlTestOnce
};
