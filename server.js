/**
 * PrimeTac Group — SEO AUTO ONLY v1.1 FIX
 *
 * Исправлено:
 * 1) Не считает [object Object] как заполненные ключевые слова.
 * 2) Проверяет keywords / search_keywords / searchKeywords только если там реально строка/массив.
 * 3) Проверяет errors и processed_ids в ответе Prom после /products/edit.
 * 4) После записи делает повторную проверку каталога.
 *
 * Эта версия НЕ меняет цены, остатки, описания, фото, названия и поставщика.
 */

'use strict';

const express = require('express');
const https = require('https');

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT || 3000);
const PROM_TOKEN = String(process.env.PROM_TOKEN || '').trim();
const WRITE_ENABLED = String(process.env.WRITE_ENABLED || '').toLowerCase() === 'true';
const SEO_AUTORUN = String(process.env.SEO_AUTORUN || 'true').toLowerCase() !== 'false';
const SEO_INTERVAL_HOURS = Math.max(1, Number(process.env.SEO_INTERVAL_HOURS || 6));
const SEO_MAX_PRODUCTS = Math.max(100, Number(process.env.SEO_MAX_PRODUCTS || 5000));

const PROM_HOST = 'my.prom.ua';
const API_PREFIX = '/api/v1';

let running = false;
let lastRun = null;
let lastScan = null;

// ------------------------------
// Keyword parsing FIX
// ------------------------------

function parseKeywordValue(value) {
  if (Array.isArray(value)) {
    return value.flatMap(parseKeywordValue).filter(Boolean);
  }

  if (typeof value !== 'string') {
    // КРИТИЧЕСКИЙ FIX:
    // объект {}, null, number и т.п. НЕ считаем ключевыми словами.
    return [];
  }

  return value
    .split(/[,;\n]/u)
    .map(x => x.trim())
    .filter(Boolean);
}

function extractProductKeywords(product) {
  // Проверяем все известные варианты поля. Не используем ??,
  // потому что keywords может быть объектом и тогда ошибочно перекрывает search_keywords.
  const candidates = [
    product?.keywords,
    product?.search_keywords,
    product?.searchKeywords
  ];

  for (const candidate of candidates) {
    const parsed = parseKeywordValue(candidate);
    if (parsed.length) return parsed;
  }

  return [];
}

function keywordSource(product) {
  const fields = [
    ['keywords', product?.keywords],
    ['search_keywords', product?.search_keywords],
    ['searchKeywords', product?.searchKeywords]
  ];

  for (const [name, value] of fields) {
    const parsed = parseKeywordValue(value);
    if (parsed.length) return { field: name, type: Array.isArray(value) ? 'array' : typeof value, count: parsed.length };
  }

  const rawTypes = fields
    .filter(([,v]) => v !== undefined)
    .map(([name,v]) => `${name}:${Array.isArray(v) ? 'array' : typeof v}`)
    .join(', ');

  return { field: '', type: rawTypes || 'absent', count: 0 };
}

// ------------------------------
// Rules
// ------------------------------

const TYPE_RULES = [
  { re: /\b(куртка|куртки|ветровка|вітровка|парка|анорак)\b/i, generic: ['тактична куртка','чоловіча тактична куртка','військова куртка'] },
  { re: /\b(штани|брюки|pants|джогери|джоггеры)\b/i, generic: ['тактичні штани','чоловічі тактичні штани','військові штани'] },
  { re: /\b(футболка|футболки|t-shirt|tshirt)\b/i, generic: ['тактична футболка','чоловіча футболка','військова футболка'] },
  { re: /\b(поло|polo)\b/i, generic: ['тактичне поло','чоловіче поло','військове поло'] },
  { re: /\b(худі|худи|hoodie)\b/i, generic: ['тактичне худі','чоловіче худі','військове худі'] },
  { re: /\b(фліс|флис|фліска|флиска|fleece)\b/i, generic: ['тактична фліска','флісова кофта','військова фліска'] },
  { re: /\b(кофта|світшот|свитшот|светр|свитер)\b/i, generic: ['тактична кофта','чоловіча кофта','військова кофта'] },
  { re: /\b(сорочка|рубашка|ubacs|combat shirt)\b/i, generic: ['тактична сорочка','військова сорочка','сорочка UBACS'] },
  { re: /\b(шорти|шорты|shorts)\b/i, generic: ['тактичні шорти','чоловічі шорти','військові шорти'] },
  { re: /\b(термобілизна|термобелье|термокомплект)\b/i, generic: ['тактична термобілизна','чоловіча термобілизна','військова термобілизна'] },
  { re: /\b(шкарпетки|носки|термошкарпетки)\b/i, generic: ['тактичні шкарпетки','військові шкарпетки','термошкарпетки'] },
  { re: /\b(кепка|бейсболка|cap)\b/i, generic: ['тактична кепка','військова кепка','чоловіча кепка'] },
  { re: /\b(панама|boonie)\b/i, generic: ['тактична панама','військова панама','панама тактична'] },
  { re: /\b(шапка|beanie)\b/i, generic: ['тактична шапка','військова шапка','чоловіча шапка'] },
  { re: /\b(балаклава|підшоломник|подшлемник)\b/i, generic: ['тактична балаклава','військова балаклава','підшоломник тактичний'] },
  { re: /\b(рукавички|перчатки|gloves)\b/i, generic: ['тактичні рукавички','військові рукавички','рукавички для військових'] },
  { re: /\b(кросівки|кроссовки|sneakers)\b/i, generic: ['тактичні кросівки','військові кросівки','чоловічі тактичні кросівки'] },
  { re: /\b(черевики|ботинки|берці|берцы|boots)\b/i, generic: ['тактичні черевики','військові черевики','берці тактичні'] },
  { re: /\b(рюкзак|backpack)\b/i, generic: ['тактичний рюкзак','військовий рюкзак','рюкзак MOLLE'] },
  { re: /\b(сумка|баул|сумка-баул)\b/i, generic: ['тактична сумка','військова сумка','сумка для спорядження'] },
  { re: /\b(пончо|дощовик|дождевик)\b/i, generic: ['тактичне пончо','пончо дощовик','військовий дощовик'] },
  { re: /\b(ремінь|ремень|belt)\b/i, generic: ['тактичний ремінь','військовий ремінь','чоловічий тактичний ремінь'] },
  { re: /\b(підсумок|подсумок|pouch)\b/i, generic: ['тактичний підсумок','військовий підсумок','підсумок MOLLE'] },
  { re: /\b(плитоноска|plate carrier|плейт керріер|плейт керриер)\b/i, generic: ['тактична плитоноска','військова плитоноска','плитоноска MOLLE'] },
  { re: /\b(бронежилет|бронежилети)\b/i, generic: ['тактичний бронежилет','військовий бронежилет','бронежилет з MOLLE'] },
  { re: /\b(бронеплита|бронеплити|бронепластина)\b/i, generic: ['бронеплита','бронеплита для бронежилета','військова бронеплита'] },
  { re: /\b(розвантаження|разгрузка|рпс|РПС)\b/i, generic: ['тактична РПС','військова розвантажувальна система','тактичне розвантаження'] },
  { re: /\b(шолом|шлем|helmet)\b/i, generic: ['тактичний шолом','військовий шолом','шолом для військових'] },
  { re: /\b(окуляри|очки|goggles)\b/i, generic: ['тактичні окуляри','захисні окуляри','військові окуляри'] },
  { re: /\b(ліхтар|фонарь|фонарик|flashlight)\b/i, generic: ['тактичний ліхтар','військовий ліхтар','ліхтар для спорядження'] },
  { re: /\b(спальник|спальний мішок|спальный мешок)\b/i, generic: ['тактичний спальний мішок','військовий спальник','спальний мішок'] },
  { re: /\b(каремат|килимок|коврик)\b/i, generic: ['тактичний каремат','військовий каремат','туристичний каремат'] },
  { re: /\b(намет|палатка)\b/i, generic: ['тактичний намет','військовий намет','туристичний намет'] },
];

const BRANDS = [
  'BEZET','YINREN','Kiborg','KIBORG','Helikon-Tex','Helikon','Salomon','LOWA',
  'Belleville','M-Tac','M-TAC','Mil-Tec','Pentagon','Defcon 5','ESDY','Walker','Tarkus','Ranger'
];

const COLORS = [
  ['чорн','чорний'],['черн','чорний'],['black','чорний'],
  ['хакі','хакі'],['хаки','хакі'],['khaki','хакі'],
  ['койот','койот'],['coyote','койот'],['tan','койот'],
  ['олив','олива'],['olive','олива'],
  ['сір','сірий'],['сер','сірий'],['gray','сірий'],['grey','сірий'],
  ['піксел','піксель'],['пиксел','піксель'],
  ['мультикам','мультикам'],['multicam','мультикам'],
  ['помаранч','помаранчевий'],['оранж','помаранчевий'],
  ['беж','бежевий'],['син','синій'],['navy','темно-синій'],
  ['зел','зелений'],['green','зелений']
];

const BANNED = new Set([
  'купити','купить','замовити','заказать','доставка','україна','украина',
  'акція','акция','дешево','кращий','лучший','новинка','топ'
]);

function norm(v) {
  return String(v || '').replace(/\s+/g, ' ').trim();
}

function findBrand(name) {
  const low = String(name || '').toLowerCase();
  return BRANDS.find(b => low.includes(b.toLowerCase())) || '';
}

function findColor(name) {
  const low = String(name || '').toLowerCase();
  const hit = COLORS.find(([part]) => low.includes(part));
  return hit ? hit[1] : '';
}

function findType(name) {
  return TYPE_RULES.find(rule => rule.re.test(name)) || null;
}

function cleanPhrase(value) {
  const x = norm(value).replace(/[#!?]/g, '');
  if (!x) return '';

  const words = x.toLowerCase().split(/\s+/);
  if (words.length > 7) return '';
  if (words.some(w => BANNED.has(w))) return '';

  return x;
}

function uniq(items) {
  const seen = new Set();
  const out = [];

  for (const item of items) {
    const clean = cleanPhrase(item);
    if (!clean) continue;

    const key = clean.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(clean);
  }

  return out;
}

function titleCore(name) {
  return norm(name)
    .replace(/\b(чорний|черный|black|хакі|хаки|khaki|койот|coyote|tan|олива|olive|сірий|серый|gray|grey|піксель|пиксель|мультикам|multicam|помаранчевий|оранжевый|бежевий|синій|зелений)\b/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function generateKeywords(product) {
  const name = norm(product.name);
  const type = findType(name);
  const brand = findBrand(name);
  const color = findColor(name);
  const result = [];

  if (type) result.push(...type.generic);

  const core = titleCore(name);
  const words = core.split(/\s+/).filter(Boolean);
  if (words.length >= 2) result.push(words.slice(0, 6).join(' '));

  if (type && brand) result.push(`${type.generic[0]} ${brand}`);
  if (type && color) result.push(`${type.generic[0]} ${color}`);

  if (/дем[іи]сезон/i.test(name) && /куртк/i.test(name)) result.push('демісезонна тактична куртка');
  if (/зим/i.test(name) && /куртк/i.test(name)) result.push('зимова тактична куртка');
  if (/літн|летн/i.test(name) && /(штани|брюк)/i.test(name)) result.push('літні тактичні штани');
  if (/soft\s?shell|софтшел/i.test(name)) result.push('тактичний софтшел');
  if (/rip[\s-]?stop|ріп[\s-]?стоп|рип[\s-]?стоп/i.test(name)) result.push('тактичний одяг rip stop');

  if (!type) {
    if (words.length) result.push(words.slice(0, 5).join(' '));
    if (brand && words.length) result.push(`${words[0]} ${brand}`);
    result.push('тактичне спорядження');
  }

  let final = uniq(result).slice(0, 7);

  if (final.length < 3) {
    if (brand) final.push(`${brand} тактичний одяг`);
    final.push('тактичний одяг');
    final = uniq(final).slice(0, 7);
  }

  return final;
}

// ------------------------------
// Prom API
// ------------------------------

function promRequest(method, path, body = null) {
  if (!PROM_TOKEN) {
    return Promise.reject(new Error('PROM_TOKEN не задан в Render Environment'));
  }

  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);

    const headers = {
      'Authorization': `Bearer ${PROM_TOKEN}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-LANGUAGE': 'uk'
    };

    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

    const request = https.request({
      hostname: PROM_HOST,
      port: 443,
      path: API_PREFIX + path,
      method,
      headers,
      timeout: 45000
    }, response => {
      let raw = '';
      response.setEncoding('utf8');

      response.on('data', chunk => raw += chunk);

      response.on('end', () => {
        let data = {};

        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          data = { raw };
        }

        if (response.statusCode >= 200 && response.statusCode < 300) {
          return resolve(data);
        }

        const error = new Error(`Prom API ${response.statusCode}: ${raw.slice(0, 1000)}`);
        error.statusCode = response.statusCode;
        error.data = data;
        reject(error);
      });
    });

    request.on('timeout', () => request.destroy(new Error('Prom API timeout')));
    request.on('error', reject);

    if (payload) request.write(payload);
    request.end();
  });
}

async function loadAllProducts() {
  const products = [];
  const ids = new Set();

  let lastId = null;
  let pages = 0;

  while (products.length < SEO_MAX_PRODUCTS && pages++ < 100) {
    const limit = Math.min(100, SEO_MAX_PRODUCTS - products.length);

    const path =
      `/products/list?limit=${limit}` +
      (lastId ? `&last_id=${encodeURIComponent(lastId)}` : '');

    const data = await promRequest('GET', path);
    const batch = Array.isArray(data.products) ? data.products : [];

    if (!batch.length) break;

    let added = 0;

    for (const product of batch) {
      const key = String(product.id);

      if (!ids.has(key)) {
        ids.add(key);
        products.push(product);
        added++;
      }
    }

    const nextLastId = data.last_id || batch[batch.length - 1]?.id;

    if (!nextLastId) break;
    if (String(nextLastId) === String(lastId)) break;
    if (!added) break;

    lastId = nextLastId;

    if (batch.length < limit) break;
  }

  return products;
}

function hasPromEditErrors(errors) {
  if (!errors) return false;
  if (typeof errors === 'string') return errors.trim().length > 0;
  if (Array.isArray(errors)) return errors.length > 0;
  if (typeof errors === 'object') return Object.keys(errors).length > 0;
  return Boolean(errors);
}

async function editBatch(items) {
  if (!items.length) return { processed_ids: [] };

  const result = await promRequest('POST', '/products/edit', items);

  if (hasPromEditErrors(result?.errors)) {
    const error = new Error('Prom вернул ошибки при редактировании');
    error.statusCode = 400;
    error.data = result;
    throw error;
  }

  return result;
}

async function applyInBatches(edits) {
  const result = {
    changed: 0,
    failed: 0,
    errors: []
  };

  const batchSize = 50;

  for (let i = 0; i < edits.length; i += batchSize) {
    const batch = edits.slice(i, i + batchSize);

    try {
      const response = await editBatch(batch);
      const processed = Array.isArray(response?.processed_ids)
        ? response.processed_ids.map(String)
        : [];

      // Если processed_ids есть — считаем только реально обработанные.
      if (processed.length) {
        const processedSet = new Set(processed);
        for (const item of batch) {
          if (processedSet.has(String(item.id))) {
            result.changed++;
          } else {
            result.failed++;
            result.errors.push({ id: item.id, error: 'Prom не подтвердил id в processed_ids' });
          }
        }
      } else {
        // Некоторые ответы Prom не содержат processed_ids.
        // Тогда 2xx без errors считаем успешным, но ниже будет повторный scan.
        result.changed += batch.length;
      }
    } catch (batchError) {
      // При ошибке пакета пробуем по одному, чтобы увидеть конкретные проблемные товары.
      for (const item of batch) {
        try {
          const response = await editBatch([item]);
          const processed = Array.isArray(response?.processed_ids)
            ? response.processed_ids.map(String)
            : [];

          if (!processed.length || processed.includes(String(item.id))) {
            result.changed++;
          } else {
            result.failed++;
            result.errors.push({ id: item.id, error: 'Prom не подтвердил обработку товара' });
          }
        } catch (error) {
          result.failed++;
          result.errors.push({
            id: item.id,
            error: String(error.message || error).slice(0, 400),
            prom: error.data || null
          });
        }
      }
    }
  }

  return result;
}

// ------------------------------
// SEO scan
// ------------------------------

async function scanProducts() {
  const products = await loadAllProducts();

  const missing = [];
  let withKeywords = 0;
  let weirdKeywordField = 0;

  for (const product of products) {
    const currentKeywords = extractProductKeywords(product);
    const src = keywordSource(product);

    if (src.count === 0 && src.type !== 'absent') {
      // Поле существует, но это был object/null/пустой массив и т.п.
      weirdKeywordField++;
    }

    if (currentKeywords.length === 0) {
      const keywords = generateKeywords(product);

      missing.push({
        id: product.id,
        name: product.name,
        keywords,
        keywords_string: keywords.join(', '),
        raw_keyword_type: src.type
      });
    } else {
      withKeywords++;
    }
  }

  lastScan = {
    at: new Date().toISOString(),
    total: products.length,
    with_keywords: withKeywords,
    missing: missing.length,
    weird_keyword_field: weirdKeywordField
  };

  return {
    ...lastScan,
    rows: missing
  };
}

async function runSeoAuto(source = 'manual') {
  if (running) {
    return {
      skipped: true,
      reason: 'already_running',
      last_run: lastRun
    };
  }

  if (!WRITE_ENABLED) {
    throw new Error('WRITE_ENABLED=false. В Render Environment поставь WRITE_ENABLED=true');
  }

  running = true;

  try {
    const before = await scanProducts();

    const edits = before.rows.map(row => ({
      id: Number(row.id),
      keywords: row.keywords_string.slice(0, 1024)
    }));

    const applied = await applyInBatches(edits);

    // Короткая пауза и повторная проверка данных API.
    await new Promise(resolve => setTimeout(resolve, 1200));
    const after = await scanProducts();

    const verifiedAdded = Math.max(0, before.missing - after.missing);

    lastRun = {
      at: new Date().toISOString(),
      source,
      scanned: before.total,
      before_missing: before.missing,
      planned: edits.length,
      api_reported_changed: applied.changed,
      verified_added: verifiedAdded,
      after_missing: after.missing,
      failed: applied.failed,
      errors: applied.errors
    };

    console.log('[SEO AUTO v1.1]', lastRun);
    return lastRun;
  } finally {
    running = false;
  }
}

// ------------------------------
// UI
// ------------------------------

const dashboardHtml = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PrimeTac SEO Auto v1.1</title>
<style>
:root{
  color-scheme:dark;
  --bg:#0d100e;--card:#151b17;--line:#29332d;--text:#eff5ef;
  --muted:#95a098;--green:#8fcf77;--amber:#e2bb68;--red:#ff8d83
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:980px;margin:auto;padding:18px}
h1{font-size:25px;margin:2px 0 5px}.subtitle{color:var(--muted);margin-bottom:18px;line-height:1.4}
.card{background:var(--card);border:1px solid var(--line);border-radius:15px;padding:16px;margin:12px 0}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.stat{background:#101511;border:1px solid var(--line);border-radius:12px;padding:13px}
.big{font-size:27px;font-weight:800;margin-top:4px}.muted{color:var(--muted);font-size:13px}
.good{color:var(--green)}.warn{color:var(--amber)}.bad{color:var(--red)}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
button{border:1px solid #425443;background:#2e472d;color:#fff;border-radius:11px;padding:12px 15px;font:inherit;font-weight:750;cursor:pointer}
button.secondary{background:#1e2922}button:disabled{opacity:.5}
.pill{padding:6px 10px;border:1px solid var(--line);border-radius:999px;font-size:12px}
pre{white-space:pre-wrap;word-break:break-word;font-size:12px;color:#cbd3cc}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:9px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}.kw{color:#c9dcae}
@media(max-width:700px){.grid{grid-template-columns:repeat(2,1fr)}th:first-child,td:first-child{display:none}table{font-size:12px}}
</style>
</head>
<body>
<div class="wrap">
  <h1>🔎 PrimeTac SEO Auto <span class="muted">v1.1 FIX</span></h1>
  <div class="subtitle">
    Исправлена проверка поля ключевых слов. Объект/пустое значение больше не считается «ключами».
  </div>

  <div class="card">
    <div class="row">
      <span id="prom" class="pill">Prom: ...</span>
      <span id="write" class="pill">Запись: ...</span>
      <span id="auto" class="pill">Авто: ...</span>
      <span id="runState" class="pill">Статус: ...</span>
    </div>
  </div>

  <div class="grid">
    <div class="stat"><div class="muted">Всего товаров</div><div id="total" class="big">—</div></div>
    <div class="stat"><div class="muted">Реально с ключами</div><div id="have" class="big good">—</div></div>
    <div class="stat"><div class="muted">Без ключей</div><div id="missing" class="big warn">—</div></div>
    <div class="stat"><div class="muted">Странное поле API</div><div id="weird" class="big bad">—</div></div>
  </div>

  <div class="card">
    <div class="row">
      <button id="scanBtn" class="secondary" onclick="scan()">Проверить сейчас</button>
      <button id="runBtn" onclick="runNow()">Заполнить недостающие ключи</button>
    </div>
    <p class="muted">
      После записи программа повторно читает каталог Prom и показывает, сколько ключей реально появилось через API.
    </p>
    <pre id="log">Загрузка статуса...</pre>
  </div>

  <div class="card" style="overflow:auto">
    <div style="font-weight:750;margin-bottom:9px">Предпросмотр товаров без ключей</div>
    <table>
      <thead><tr><th>ID</th><th>Товар</th><th>Будут добавлены фразы</th><th>Тип поля API</th></tr></thead>
      <tbody id="preview"></tbody>
    </table>
  </div>
</div>

<script>
const el=id=>document.getElementById(id);

async function jsonFetch(url,options){
  const r=await fetch(url,options);
  const d=await r.json();
  if(!r.ok)throw new Error(d.error||JSON.stringify(d));
  return d;
}

async function status(){
  try{
    const d=await jsonFetch('/api/status');

    el('prom').textContent='Prom: '+(d.prom_connected?'подключен':'нет токена');
    el('prom').className='pill '+(d.prom_connected?'good':'bad');

    el('write').textContent='Запись: '+(d.write_enabled?'ВКЛ':'ВЫКЛ');
    el('write').className='pill '+(d.write_enabled?'good':'bad');

    el('auto').textContent='Авто: '+(d.autorun?'ВКЛ':'ВЫКЛ')+' / '+d.interval_hours+' ч';
    el('auto').className='pill '+(d.autorun?'good':'warn');

    el('runState').textContent='Статус: '+(d.running?'работает':'ожидание');

    if(d.last_scan){
      el('total').textContent=d.last_scan.total ?? '—';
      el('have').textContent=d.last_scan.with_keywords ?? '—';
      el('missing').textContent=d.last_scan.missing ?? '—';
      el('weird').textContent=d.last_scan.weird_keyword_field ?? '—';
    }

    if(d.last_run){
      el('log').textContent=
        'Последний запуск: '+d.last_run.at+
        '\\nИсточник: '+d.last_run.source+
        '\\nДо запуска без ключей: '+d.last_run.before_missing+
        '\\nОтправлено на Prom: '+d.last_run.planned+
        '\\nAPI сообщил обработано: '+d.last_run.api_reported_changed+
        '\\nПодтверждено повторным чтением: '+d.last_run.verified_added+
        '\\nПосле запуска без ключей: '+d.last_run.after_missing+
        '\\nОшибок: '+d.last_run.failed;
    }else{
      el('log').textContent='Ещё не запускалось.';
    }
  }catch(e){
    el('log').textContent='Ошибка статуса: '+e.message;
  }
}

async function scan(){
  el('scanBtn').disabled=true;
  el('runBtn').disabled=true;
  el('log').textContent='Проверяю товары Prom...';

  try{
    const d=await jsonFetch('/api/scan');

    el('total').textContent=d.total;
    el('have').textContent=d.with_keywords;
    el('missing').textContent=d.missing;
    el('weird').textContent=d.weird_keyword_field;

    const tb=el('preview');
    tb.innerHTML='';

    d.rows.slice(0,200).forEach(x=>{
      const tr=document.createElement('tr');
      tr.innerHTML='<td></td><td></td><td class="kw"></td><td></td>';
      tr.children[0].textContent=x.id;
      tr.children[1].textContent=x.name||'';
      tr.children[2].textContent=(x.keywords||[]).join(', ');
      tr.children[3].textContent=x.raw_keyword_type||'—';
      tb.appendChild(tr);
    });

    el('log').textContent=
      'Готово. Реально без ключей: '+d.missing+
      '.\\nСтранное/пустое поле API: '+d.weird_keyword_field+
      '.\\nНа Prom пока ничего не изменено.';
  }catch(e){
    el('log').textContent='Ошибка: '+e.message;
  }finally{
    el('scanBtn').disabled=false;
    el('runBtn').disabled=false;
    status();
  }
}

async function runNow(){
  if(!confirm('Заполнить ключевые фразы у всех товаров, где они реально пустые?'))return;

  el('scanBtn').disabled=true;
  el('runBtn').disabled=true;
  el('log').textContent='Отправляю ключевые фразы на Prom и затем перепроверю...';

  try{
    const d=await jsonFetch('/api/run',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:'{}'
    });

    el('log').textContent=
      'Готово.'+
      '\\nДо запуска без ключей: '+d.before_missing+
      '\\nОтправлено: '+d.planned+
      '\\nAPI сообщил обработано: '+d.api_reported_changed+
      '\\nПодтверждено повторным чтением: '+d.verified_added+
      '\\nПосле запуска без ключей: '+d.after_missing+
      '\\nОшибок: '+d.failed+
      (d.errors?.length?'\\n\\n'+JSON.stringify(d.errors.slice(0,10),null,2):'');

    await scan();
  }catch(e){
    el('log').textContent='Ошибка: '+e.message;
  }finally{
    el('scanBtn').disabled=false;
    el('runBtn').disabled=false;
    status();
  }
}

status();
setInterval(status,15000);
</script>
</body>
</html>`;

// ------------------------------
// Routes
// ------------------------------

app.get('/', (req,res) => res.type('html').send(dashboardHtml));

app.get('/health', (req,res) => {
  res.json({ ok:true, app:'PrimeTac SEO Auto v1.1', time:new Date().toISOString() });
});

app.get('/api/status', (req,res) => {
  res.json({
    ok:true,
    prom_connected:Boolean(PROM_TOKEN),
    write_enabled:WRITE_ENABLED,
    autorun:SEO_AUTORUN,
    interval_hours:SEO_INTERVAL_HOURS,
    running,
    last_scan:lastScan,
    last_run:lastRun
  });
});

app.get('/api/scan', async (req,res) => {
  try {
    res.json(await scanProducts());
  } catch(error) {
    console.error('[SCAN]', error);
    res.status(error.statusCode || 500).json({ error:error.message || String(error) });
  }
});

app.post('/api/run', async (req,res) => {
  try {
    res.json(await runSeoAuto('manual'));
  } catch(error) {
    console.error('[RUN]', error);
    res.status(error.statusCode || 500).json({
      error:error.message || String(error),
      prom:error.data || null
    });
  }
});

if (SEO_AUTORUN) {
  const intervalMs = SEO_INTERVAL_HOURS * 60 * 60 * 1000;

  const autoTask = async () => {
    if (!WRITE_ENABLED) {
      console.warn('[SEO AUTO] WRITE_ENABLED=false, skip');
      return;
    }

    try {
      await runSeoAuto('auto');
    } catch(error) {
      console.error('[SEO AUTO ERROR]', error);
    }
  };

  setTimeout(autoTask, 60 * 1000);
  setInterval(autoTask, intervalMs);
}

app.listen(PORT, () => {
  console.log(`PrimeTac SEO Auto v1.1 FIX started on port ${PORT}`);
});
