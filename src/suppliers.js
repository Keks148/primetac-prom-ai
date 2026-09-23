const { XMLParser } = require("fast-xml-parser");
const { config } = require("./config");
const http = require("http");
const https = require("https");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true
});

const SNAPSHOT_TTL_MS =
  15 * 60 * 1000;

let snapshot = null;
let snapshotAt = 0;
let snapshotPromise = null;

function arr(value) {
  if (value == null) return [];
  return Array.isArray(value)
    ? value
    : [value];
}

function valueOf(obj, keys) {
  for (const key of keys) {
    if (
      obj &&
      obj[key] != null &&
      String(obj[key]).trim() !== ""
    ) {
      return String(obj[key]).trim();
    }
  }

  return "";
}

function findOfferArrays(
  node,
  depth = 0
) {
  if (
    !node ||
    typeof node !== "object" ||
    depth > 12
  ) {
    return [];
  }

  const found = [];

  for (
    const [k, v]
    of Object.entries(node)
  ) {
    const lower =
      k.toLowerCase();

    if (
      [
        "offer",
        "item",
        "product"
      ].includes(lower)
    ) {
      if (Array.isArray(v)) {
        found.push(v);
      } else if (
        v &&
        typeof v === "object"
      ) {
        found.push([v]);
      }
    }

    if (
      v &&
      typeof v === "object"
    ) {
      found.push(
        ...findOfferArrays(
          v,
          depth + 1
        )
      );
    }
  }

  return found;
}

function chooseOffers(parsed) {
  const candidates =
    findOfferArrays(parsed)
      .filter(
        list =>
          list.length > 0
      )
      .sort(
        (a, b) =>
          b.length -
          a.length
      );

  return candidates[0] || [];
}


function findCategoryArrays(
  node,
  depth = 0
) {
  if (
    !node ||
    typeof node !== "object" ||
    depth > 12
  ) {
    return [];
  }

  const found = [];

  for (
    const [key, value]
    of Object.entries(node)
  ) {
    const lower =
      key.toLowerCase();

    if (
      lower === "category"
    ) {
      if (
        Array.isArray(value)
      ) {
        found.push(value);
      } else if (
        value &&
        typeof value === "object"
      ) {
        found.push([value]);
      }
    }

    if (
      value &&
      typeof value === "object"
    ) {
      found.push(
        ...findCategoryArrays(
          value,
          depth + 1
        )
      );
    }
  }

  return found;
}

function normalizeCategory(
  raw
) {
  if (
    !raw ||
    typeof raw !== "object"
  ) {
    return null;
  }

  const id =
    valueOf(
      raw,
      [
        "@id",
        "id",
        "category_id",
        "@category_id"
      ]
    );

  const parentId =
    valueOf(
      raw,
      [
        "@parentId",
        "@parent_id",
        "parentId",
        "parent_id"
      ]
    );

  const name =
    valueOf(
      raw,
      [
        "#text",
        "name",
        "title"
      ]
    );

  if (!id) {
    return null;
  }

  return {
    id,
    parentId:
      parentId || null,
    name:
      name || ""
  };
}

function chooseCategories(
  parsed
) {
  const candidates =
    findCategoryArrays(parsed)
      .filter(
        list =>
          list.length > 0
      )
      .sort(
        (a, b) =>
          b.length -
          a.length
      );

  const raw =
    candidates[0] || [];

  const categories =
    raw
      .map(
        normalizeCategory
      )
      .filter(Boolean);

  const seen =
    new Set();

  return categories.filter(
    category => {
      const key =
        String(
          category.id
        );

      if (
        seen.has(key)
      ) {
        return false;
      }

      seen.add(key);
      return true;
    }
  );
}

function withCategoryPaths(
  categories
) {
  const byId =
    new Map(
      (categories || [])
        .map(
          category => [
            String(
              category.id
            ),
            category
          ]
        )
    );

  function pathOf(
    category
  ) {
    const names = [];
    const seen =
      new Set();

    let current =
      category;

    while (
      current &&
      current.id &&
      !seen.has(
        String(
          current.id
        )
      )
    ) {
      seen.add(
        String(
          current.id
        )
      );

      if (
        current.name
      ) {
        names.unshift(
          current.name
        );
      }

      if (
        !current.parentId
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

  return (categories || [])
    .map(
      category => ({
        ...category,
        path:
          pathOf(category)
      })
    );
}

function textValue(value) {
  if (value == null) {
    return "";
  }

  if (
    typeof value === "string" ||
    typeof value === "number"
  ) {
    return String(value).trim();
  }

  if (
    typeof value === "object"
  ) {
    return valueOf(
      value,
      [
        "#text",
        "@url",
        "url",
        "@src",
        "src",
        "value"
      ]
    );
  }

  return "";
}

function extractPictures(raw) {
  const values = [
    ...arr(raw?.picture),
    ...arr(raw?.pictures?.picture),
    ...arr(raw?.image),
    ...arr(raw?.images?.image),
    ...arr(raw?.photo),
    ...arr(raw?.photos?.photo)
  ];

  const out = [];
  const seen = new Set();

  for (const item of values) {
    const value =
      textValue(item);

    if (!value) {
      continue;
    }

    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    out.push(value);
  }

  return out;
}

function extractParams(raw) {
  const params = [];

  const direct = [
    ...arr(raw?.param),
    ...arr(raw?.params?.param),
    ...arr(raw?.parameter),
    ...arr(
      raw?.parameters?.parameter
    )
  ];

  for (const p of direct) {
    if (
      !p ||
      typeof p !== "object"
    ) {
      continue;
    }

    const name =
      valueOf(
        p,
        [
          "@name",
          "name",
          "@id",
          "id"
        ]
      );

    const value =
      valueOf(
        p,
        [
          "#text",
          "value",
          "@value"
        ]
      );

    if (name || value) {
      params.push({
        name,
        value
      });
    }
  }

  return params;
}

function normalizeOffer(
  raw,
  supplier
) {
  return {
    supplier,

    id:
      valueOf(
        raw,
        [
          "@id",
          "id",
          "offer_id",
          "offerId"
        ]
      ),

    groupId:
      valueOf(
        raw,
        [
          "@group_id",
          "@groupId",
          "group_id",
          "groupId",
          "variation_group_id",
          "variationGroupId"
        ]
      ),

    sku:
      valueOf(
        raw,
        [
          "vendorCode",
          "vendor_code",
          "sku",
          "SKU",
          "article",
          "articul",
          "code",
          "@sku"
        ]
      ),

    name:
      valueOf(
        raw,
        [
          "name",
          "model",
          "title"
        ]
      ),

    vendor:
      valueOf(
        raw,
        [
          "vendor",
          "brand",
          "manufacturer"
        ]
      ),

    categoryId:
      valueOf(
        raw,
        [
          "categoryId",
          "category_id",
          "@category_id"
        ]
      ),

    price:
      valueOf(
        raw,
        [
          "price",
          "@price"
        ]
      ),

    quantity:
      valueOf(
        raw,
        [
          "quantity",
          "stock_quantity",
          "stock",
          "count"
        ]
      ),

    available:
      valueOf(
        raw,
        [
          "@available",
          "available",
          "in_stock",
          "presence"
        ]
      ),

    pictures:
      extractPictures(raw),

    params:
      extractParams(raw)
  };
}

function sleep(ms) {
  return new Promise(
    resolve =>
      setTimeout(resolve, ms)
  );
}

function errorDetails(err) {
  const cause =
    err?.cause;

  return {
    message:
      err?.message ||
      String(err),

    name:
      err?.name ||
      null,

    causeMessage:
      cause?.message ||
      null,

    causeCode:
      cause?.code ||
      null,

    causeName:
      cause?.name ||
      null,

    causeErrno:
      cause?.errno ||
      null,

    causeSyscall:
      cause?.syscall ||
      null,

    causeHostname:
      cause?.hostname ||
      null,

    causeAddress:
      cause?.address ||
      null,

    causePort:
      cause?.port ||
      null
  };
}

function refererFor(
  supplierName
) {
  return supplierName ===
    "MILITARIS"
      ? "https://militaris.com.ua/"
      : "https://www.bezet.com.ua/";
}

async function fetchTextNative(
  url,
  supplierName
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      config.httpTimeoutMs
    );

  try {
    const response =
      await fetch(
        url,
        {
          signal:
            controller.signal,

          redirect:
            "follow",

          headers: {
            Accept:
              "application/xml,text/xml,text/plain;q=0.9,*/*;q=0.8",

            "Accept-Language":
              "uk-UA,uk;q=0.9,ru;q=0.8,en;q=0.7",

            "Cache-Control":
              "no-cache",

            Pragma:
              "no-cache",

            Referer:
              refererFor(
                supplierName
              ),

            "User-Agent":
              "Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 " +
              "(KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36"
          }
        }
      );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} ${response.statusText}`
      );
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function fetchTextHttp(
  url,
  supplierName,
  redirectsLeft = 5
) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      let parsed;

      try {
        parsed =
          new URL(url);
      } catch (err) {
        reject(err);
        return;
      }

      const client =
        parsed.protocol ===
          "http:"
          ? http
          : https;

      const request =
        client.get(
          parsed,
          {
            headers: {
              Accept:
                "application/xml,text/xml,text/plain;q=0.9,*/*;q=0.8",

              "Accept-Language":
                "uk-UA,uk;q=0.9,ru;q=0.8,en;q=0.7",

              "Cache-Control":
                "no-cache",

              Pragma:
                "no-cache",

              Referer:
                refererFor(
                  supplierName
                ),

              "User-Agent":
                "Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36"
            }
          },
          response => {
            const status =
              Number(
                response.statusCode ||
                0
              );

            if (
              status >= 300 &&
              status < 400 &&
              response.headers.location
            ) {
              response.resume();

              if (
                redirectsLeft <= 0
              ) {
                reject(
                  new Error(
                    "Too many redirects"
                  )
                );
                return;
              }

              const nextUrl =
                new URL(
                  response.headers.location,
                  parsed
                ).toString();

              fetchTextHttp(
                nextUrl,
                supplierName,
                redirectsLeft - 1
              ).then(
                resolve,
                reject
              );

              return;
            }

            if (
              status < 200 ||
              status >= 300
            ) {
              response.resume();

              reject(
                new Error(
                  `HTTP ${status} ${response.statusMessage || ""}`.trim()
                )
              );

              return;
            }

            response.setEncoding(
              "utf8"
            );

            let body = "";

            response.on(
              "data",
              chunk => {
                body += chunk;
              }
            );

            response.on(
              "end",
              () =>
                resolve(body)
            );
          }
        );

      request.setTimeout(
        config.httpTimeoutMs,
        () => {
          request.destroy(
            new Error(
              `Request timeout after ${config.httpTimeoutMs}ms`
            )
          );
        }
      );

      request.on(
        "error",
        reject
      );
    }
  );
}

async function fetchText(
  url,
  supplierName
) {
  let lastError = null;

  for (
    let attempt = 1;
    attempt <= 3;
    attempt++
  ) {
    try {
      console.log(
        `[${supplierName}_FETCH_ATTEMPT]`,
        JSON.stringify({
          attempt,
          method:
            "fetch",
          url
        })
      );

      return await fetchTextNative(
        url,
        supplierName
      );
    } catch (err) {
      lastError = err;

      console.error(
        `[${supplierName}_FETCH_ATTEMPT_ERROR]`,
        JSON.stringify({
          attempt,
          method:
            "fetch",
          ...errorDetails(err)
        })
      );

      if (attempt < 3) {
        await sleep(
          attempt *
          1500
        );
      }
    }
  }

  try {
    console.log(
      `[${supplierName}_FETCH_FALLBACK]`,
      JSON.stringify({
        method:
          "https/http",
        url
      })
    );

    return await fetchTextHttp(
      url,
      supplierName
    );
  } catch (err) {
    lastError = err;

    console.error(
      `[${supplierName}_FETCH_FALLBACK_ERROR]`,
      JSON.stringify({
        method:
          "https/http",
        ...errorDetails(err)
      })
    );
  }

  throw lastError;
}

async function loadSupplier(
  name,
  url
) {
  if (!url) {
    return {
      supplier: name,
      configured: false,
      ok: false,
      error:
        `${name} XML URL is not configured`,
      categories: [],
      offers: []
    };
  }

  try {
    const xml =
      await fetchText(
        url,
        name
      );

    const parsed =
      parser.parse(xml);

    const rawOffers =
      chooseOffers(parsed);

    const categories =
      withCategoryPaths(
        chooseCategories(
          parsed
        )
      );

    console.log(
      `[${name}_XML_OK]`,
      JSON.stringify({
        bytes:
          Buffer.byteLength(
            xml,
            "utf8"
          ),
        offers:
          rawOffers.length,
        categories:
          categories.length
      })
    );

    return {
      supplier:
        name,

      configured:
        true,

      ok:
        true,

      error:
        null,

      categories,

      offers:
        rawOffers.map(
          item =>
            normalizeOffer(
              item,
              name
            )
        )
    };
  } catch (err) {
    const details =
      errorDetails(err);

    console.error(
      `[${name}_FETCH_ERROR]`,
      JSON.stringify({
        url,
        ...details
      })
    );

    return {
      supplier:
        name,

      configured:
        true,

      ok:
        false,

      error:
        [
          details.message,
          details.causeCode,
          details.causeMessage
        ]
          .filter(Boolean)
          .join(" | "),

      categories: [],
      offers: []
    };
  }
}

async function fetchSnapshot() {
  const [bezet, militaris] =
    await Promise.all([
      loadSupplier(
        "BEZET",
        config.bezetXmlUrl
      ),

      loadSupplier(
        "MILITARIS",
        config.militarisXmlUrl
      )
    ]);

  const result = {
    bezet,
    militaris
  };

  // Даже если один поставщик временно ошибся,
  // короткий кэш лучше, чем долбить 85 МБ XML
  // четырьмя параллельными аудитами.
  snapshot =
    result;

  snapshotAt =
    Date.now();

  console.log(
    "[SUPPLIERS_SNAPSHOT_READY]",
    JSON.stringify({
      ttlMinutes:
        SNAPSHOT_TTL_MS /
        60000,
      bezetOffers:
        bezet.offers.length,
      militarisOffers:
        militaris.offers.length
    })
  );

  return result;
}

async function loadSuppliers(
  options = {}
) {
  const forceRefresh =
    Boolean(
      options.forceRefresh
    );

  const age =
    Date.now() -
    snapshotAt;

  if (
    !forceRefresh &&
    snapshot &&
    age >= 0 &&
    age < SNAPSHOT_TTL_MS
  ) {
    console.log(
      "[SUPPLIERS_CACHE_HIT]",
      JSON.stringify({
        ageSeconds:
          Math.floor(
            age / 1000
          )
      })
    );

    return snapshot;
  }

  if (
    snapshotPromise
  ) {
    console.log(
      "[SUPPLIERS_CACHE_JOIN]"
    );

    return snapshotPromise;
  }

  snapshotPromise =
    fetchSnapshot();

  try {
    return await snapshotPromise;
  } finally {
    snapshotPromise =
      null;
  }
}

function clearSupplierCache() {
  snapshot = null;
  snapshotAt = 0;
}

module.exports = {
  loadSuppliers,
  clearSupplierCache
};
