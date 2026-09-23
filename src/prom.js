const { config } = require("./config");

function ensurePromConfigured() {
  if (!config.promToken) throw new Error("PROM_TOKEN is not configured");
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.httpTimeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.promToken}`
      }
    });

    const text = await response.text();
    let body = null;

    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    if (!response.ok) {
      const details =
        typeof body === "string"
          ? body.slice(0, 500)
          : JSON.stringify(body);

      throw new Error(
        `Prom API ${response.status} ${response.statusText}: ${details}`
      );
    }

    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function listAll(endpoint, arrayKey, limit = 100) {
  ensurePromConfigured();

  const out = [];
  let lastId = null;
  let guard = 0;

  while (guard++ < 200) {
    const url =
      new URL(
        `${config.promApiBase}/${endpoint}`
      );

    url.searchParams.set(
      "limit",
      String(limit)
    );

    if (lastId != null) {
      url.searchParams.set(
        "last_id",
        String(lastId)
      );
    }

    const body =
      await fetchJson(
        url.toString()
      );

    const batch =
      Array.isArray(body?.[arrayKey])
        ? body[arrayKey]
        : [];

    out.push(...batch);

    if (batch.length < limit) {
      break;
    }

    const nextId =
      batch[
        batch.length - 1
      ]?.id;

    if (
      nextId == null ||
      String(nextId) ===
        String(lastId)
    ) {
      break;
    }

    lastId = nextId;
  }

  return out;
}

async function listProducts() {
  return listAll(
    "products/list",
    "products",
    100
  );
}

async function listGroups() {
  return listAll(
    "groups/list",
    "groups",
    100
  );
}

function groupParentId(group) {
  return (
    group?.parent_group_id ??
    group?.parent_id ??
    group?.parent?.id ??
    null
  );
}

function groupName(group) {
  return String(
    group?.name ??
    group?.title ??
    ""
  ).trim();
}

async function auditGroups() {
  const groups =
    await listGroups();

  const clean =
    groups.map(group => ({
      id:
        group?.id ??
        group?.group_id ??
        null,

      name:
        groupName(group),

      parentId:
        groupParentId(group)
    }));

  const byId =
    new Map(
      clean
        .filter(
          group =>
            group.id != null
        )
        .map(
          group => [
            String(group.id),
            group
          ]
        )
    );

  function fullPath(group) {
    const names = [];
    const seen = new Set();
    let current = group;

    while (
      current &&
      current.id != null &&
      !seen.has(
        String(current.id)
      )
    ) {
      seen.add(
        String(current.id)
      );

      if (current.name) {
        names.unshift(
          current.name
        );
      }

      if (
        current.parentId == null
      ) {
        break;
      }

      current =
        byId.get(
          String(
            current.parentId
          )
        ) ||
        null;
    }

    return names.join(
      " > "
    );
  }

  const result =
    clean
      .map(group => ({
        ...group,
        path:
          fullPath(group)
      }))
      .sort(
        (a, b) =>
          String(
            a.path ||
            a.name
          ).localeCompare(
            String(
              b.path ||
              b.name
            ),
            "uk"
          )
      );

  return result;
}

// Один безопасный аудит после запуска.
// Только чтение. Никаких изменений в Prom.
setTimeout(
  async () => {
    try {
      if (!config.promToken) {
        console.log(
          "[PROM_GROUPS_AUDIT_SKIP] PROM_TOKEN is not configured"
        );
        return;
      }

      const groups =
        await auditGroups();

      console.log(
        "[PROM_GROUPS_AUDIT]"
      );

      console.log(
        JSON.stringify({
          count:
            groups.length,
          groups
        })
      );
    } catch (err) {
      console.error(
        "[PROM_GROUPS_AUDIT_ERROR]",
        err?.message ||
        String(err)
      );
    }
  },
  8000
);

module.exports = {
  listProducts,
  listGroups,
  auditGroups
};
