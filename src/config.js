function asBool(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function asInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const config = {
  port: asInt(process.env.PORT, 3000),
  promToken: String(process.env.PROM_TOKEN || "").trim(),
  promApiBase: String(process.env.PROM_API_BASE || "https://my.prom.ua/api/v1").replace(/\/+$/, ""),
  bezetXmlUrl: String(process.env.BEZET_XML_URL || "").trim(),
  militarisXmlUrl: String(process.env.MILITARIS_XML_URL || "").trim(),
  syncIntervalHours: asInt(process.env.SYNC_INTERVAL_HOURS, 5),
  autoAudit: asBool(process.env.AUTO_AUDIT, true),
  httpTimeoutMs: asInt(process.env.HTTP_TIMEOUT_MS, 60000)
};

function publicConfig() {
  return {
    promApiBase: config.promApiBase,
    hasPromToken: Boolean(config.promToken),
    hasBezetXmlUrl: Boolean(config.bezetXmlUrl),
    hasMilitarisXmlUrl: Boolean(config.militarisXmlUrl),
    syncIntervalHours: config.syncIntervalHours,
    autoAudit: config.autoAudit,
    httpTimeoutMs: config.httpTimeoutMs
  };
}

module.exports = { config, publicConfig };
