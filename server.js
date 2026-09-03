/**
 * PrimeTac Group — Prom Keywords Diagnostic v1.2
 *
 * READ-ONLY diagnostics.
 * НИЧЕГО в Prom не записывает.
 *
 * Проверяет у нескольких реальных товаров:
 * 1) /products/list -> keywords/search_keywords/searchKeywords
 * 2) /products/{id} -> keywords/search_keywords/searchKeywords
 * 3) /products/translation/{id}?lang=uk -> keywords
 * 4) /products/translation/{id}?lang=ru -> keywords
 *
 * Цель: точно выяснить, где Prom хранит поле "Пошукові запити".
 */

'use strict';

const express = require('express');
const https = require('https');

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT || 3000);
const PROM_TOKEN = String(process.env.PROM_TOKEN || '').trim();

const PROM_HOST = 'my.prom.ua';
const API_PREFIX = '/api/v1';

function promRequest(method, path, body = null, language = null) {
  if (!PROM_TOKEN) {
    return Promise.reject(new Error('PROM_TOKEN не задан в Render Environment'));
  }

  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);

    const headers = {
      'Authorization': `Bearer ${PROM_TOKEN}`,
      'Accept': 'application/json'
    };

    if (language) headers['X-LANGUAGE'] = language;

    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = https.request({
      hostname: PROM_HOST,
      port: 443,
      path: API_PREFIX + path,
      method,
      headers,
      timeout: 45000
    }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        let data = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          data = { raw };
        }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          return resolve(data);
        }

        const err = new Error(`Prom API ${res.statusCode}: ${raw.slice(0, 1200)}`);
        err.statusCode = res.statusCode;
        err.data = data;
        reject(err);
      });
    });

    req.on('timeout', () => req.destroy(new Error('Prom API timeout')));
    req.on('error', reject);

    if (payload) req.write(payload);
    req.end();
  });
}

function compact(value) {
  if (value === undefined) return { exists: false, type: 'undefined', value: null };
  if (value === null) return { exists: true, type: 'null', value: null };
  if (Array.isArray(value)) return { exists: true, type: 'array', value };
  return { exists: true, type: typeof value, value };
}

function keywordSnapshot(obj) {
  const target = obj && typeof obj === 'object' ? obj : {};
  return {
    keywords: compact(target.keywords),
    search_keywords: compact(target.search_keywords),
    searchKeywords: compact(target.searchKeywords)
  };
}

async function listProducts(limit = 10) {
  const data = await promRequest('GET', `/products/list?limit=${limit}`, null, 'uk');
  return Array.isArray(data.products) ? data.products : [];
}

async function getProduct(id, lang) {
  try {
    const data = await promRequest('GET', `/products/${encodeURIComponent(id)}`, null, lang);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: error.message || String(error),
      statusCode: error.statusCode || 500,
      data: error.data || null
    };
  }
}

async function getTranslation(id, lang) {
  try {
    const data = await promRequest(
      'GET',
      `/products/translation/${encodeURIComponent(id)}?lang=${encodeURIComponent(lang)}`,
      null,
      lang
    );
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: error.message || String(error),
      statusCode: error.statusCode || 500,
      data: error.data || null
    };
  }
}

function unwrapProduct(data) {
  if (!data || typeof data !== 'object') return {};
  if (data.product && typeof data.product === 'object') return data.product;
  return data;
}

async function diagnoseProduct(product) {
  const id = product.id;

  const [detailUk, detailRu, trUk, trRu] = await Promise.all([
    getProduct(id, 'uk'),
    getProduct(id, 'ru'),
    getTranslation(id, 'uk'),
    getTranslation(id, 'ru')
  ]);

  const detailUkProduct = detailUk.ok ? unwrapProduct(detailUk.data) : {};
  const detailRuProduct = detailRu.ok ? unwrapProduct(detailRu.data) : {};

  return {
    id,
    name: product.name || '',
    external_id: product.external_id || '',
    sku: product.sku || '',
    list: {
      keyword_fields: keywordSnapshot(product),
      raw_keys: Object.keys(product || {}).sort()
    },
    detail_uk: detailUk.ok ? {
      ok: true,
      name: detailUkProduct.name || '',
      keyword_fields: keywordSnapshot(detailUkProduct),
      raw_keys: Object.keys(detailUkProduct || {}).sort()
    } : detailUk,
    detail_ru: detailRu.ok ? {
      ok: true,
      name: detailRuProduct.name || '',
      keyword_fields: keywordSnapshot(detailRuProduct),
      raw_keys: Object.keys(detailRuProduct || {}).sort()
    } : detailRu,
    translation_uk: trUk.ok ? {
      ok: true,
      keywords: compact(trUk.data?.keywords),
      name: compact(trUk.data?.name),
      raw_keys: Object.keys(trUk.data || {}).sort(),
      raw: trUk.data
    } : trUk,
    translation_ru: trRu.ok ? {
      ok: true,
      keywords: compact(trRu.data?.keywords),
      name: compact(trRu.data?.name),
      raw_keys: Object.keys(trRu.data || {}).sort(),
      raw: trRu.data
    } : trRu
  };
}

function humanValue(x) {
  if (!x) return '—';
  if (x.exists === false) return 'поле отсутствует';
  if (x.type === 'string') return x.value && String(x.value).trim() ? String(x.value) : '(пустая строка)';
  if (x.type === 'array') return x.value.length ? JSON.stringify(x.value) : '[]';
  if (x.type === 'null') return 'null';
  if (x.type === 'object') return JSON.stringify(x.value);
  return String(x.value);
}

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PrimeTac Prom Keywords Diagnostic v1.2</title>
<style>
:root{
  color-scheme:dark;
  --bg:#0c100e;--card:#151b18;--line:#2a342e;--text:#eef4ef;
  --muted:#99a59d;--good:#91d37e;--warn:#e3bf70;--bad:#ff8d83;--blue:#8eb5ff
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:1100px;margin:auto;padding:16px}
h1{font-size:23px;margin:2px 0 6px}
.sub{color:var(--muted);line-height:1.45;margin-bottom:15px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin:11px 0}
.row{display:flex;gap:9px;flex-wrap:wrap;align-items:center}
button,input{font:inherit;border-radius:10px;border:1px solid #415149;padding:11px 13px;background:#203028;color:white}
button{font-weight:750;cursor:pointer}
button.secondary{background:#1c2621}
.pill{font-size:12px;padding:6px 9px;border-radius:999px;border:1px solid var(--line)}
.good{color:var(--good)}.warn{color:var(--warn)}.bad{color:var(--bad)}.blue{color:var(--blue)}
.small{font-size:12px;color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{text-align:left;padding:9px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:#c7d0c9}
.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-word}
.section{font-weight:800;margin:12px 0 6px}
pre{white-space:pre-wrap;word-break:break-word;background:#0d120f;border:1px solid var(--line);border-radius:10px;padding:10px;font-size:11px}
details{margin-top:8px}
summary{cursor:pointer;color:#b8c7bb}
@media(max-width:760px){
  table{font-size:11px}
  th:nth-child(1),td:nth-child(1){display:none}
}
</style>
</head>
<body>
<div class="wrap">
  <h1>🧪 PrimeTac Prom Keywords Diagnostic <span class="small">v1.2 READ ONLY</span></h1>
  <div class="sub">
    Эта версия ничего не записывает в Prom. Она сравнивает 4 места, где могут храниться поисковые фразы:
    список товаров, карточка товара, украинский перевод и русский перевод.
  </div>

  <div class="card">
    <div class="row">
      <span id="prom" class="pill">Prom: ...</span>
      <button onclick="autoTest()">Проверить 3 товара</button>
      <input id="productId" placeholder="ID товара Prom">
      <button class="secondary" onclick="testOne()">Проверить ID</button>
    </div>
    <div id="status" class="small" style="margin-top:10px">Готово к проверке.</div>
  </div>

  <div id="results"></div>
</div>

<script>
const $ = id => document.getElementById(id);

async function api(url){
  const r = await fetch(url);
  const d = await r.json();
  if(!r.ok) throw new Error(d.error || JSON.stringify(d));
  return d;
}

function esc(v){
  return String(v ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;')
    .replaceAll('>','&gt;').replaceAll('"','&quot;');
}

function hv(x){
  if(!x) return '—';
  if(x.exists === false) return '<span class="bad">поле отсутствует</span>';
  if(x.type === 'string'){
    return x.value && String(x.value).trim()
      ? '<span class="good">'+esc(x.value)+'</span>'
      : '<span class="warn">(пустая строка)</span>';
  }
  if(x.type === 'array'){
    return x.value.length
      ? '<span class="good">'+esc(JSON.stringify(x.value))+'</span>'
      : '<span class="warn">[]</span>';
  }
  if(x.type === 'null') return '<span class="warn">null</span>';
  if(x.type === 'object') return '<span class="blue">'+esc(JSON.stringify(x.value))+'</span>';
  return esc(x.value);
}

function fieldBlock(title, data){
  if(!data || data.ok === false){
    return '<div class="card"><b>'+esc(title)+'</b><div class="bad small">'+esc(data?.error || 'ошибка')+'</div></div>';
  }

  if(title.startsWith('Translation')){
    return \`
      <div class="section">\${esc(title)}</div>
      <table>
        <tr><th>keywords</th><td class="code">\${hv(data.keywords)}</td></tr>
        <tr><th>name</th><td class="code">\${hv(data.name)}</td></tr>
      </table>
      <details><summary>Показать raw JSON</summary><pre>\${esc(JSON.stringify(data.raw,null,2))}</pre></details>
    \`;
  }

  const k = data.keyword_fields || {};
  return \`
    <div class="section">\${esc(title)}</div>
    <table>
      <tr><th>keywords</th><td class="code">\${hv(k.keywords)}</td></tr>
      <tr><th>search_keywords</th><td class="code">\${hv(k.search_keywords)}</td></tr>
      <tr><th>searchKeywords</th><td class="code">\${hv(k.searchKeywords)}</td></tr>
    </table>
    <details><summary>Поля ответа API</summary><pre>\${esc(JSON.stringify(data.raw_keys || [],null,2))}</pre></details>
  \`;
}

function renderProduct(p){
  return \`
    <div class="card">
      <div style="font-weight:850;font-size:16px">\${esc(p.name || 'Без названия')}</div>
      <div class="small">Prom ID: \${esc(p.id)} • SKU: \${esc(p.sku || '—')}</div>

      \${fieldBlock('1. products/list', p.list)}
      \${fieldBlock('2. Product detail UK', p.detail_uk)}
      \${fieldBlock('3. Product detail RU', p.detail_ru)}
      \${fieldBlock('4. Translation UK', p.translation_uk)}
      \${fieldBlock('5. Translation RU', p.translation_ru)}
    </div>
  \`;
}

function render(data){
  const arr = data.products || [];
  $('results').innerHTML = arr.map(renderProduct).join('');
  $('status').textContent='Проверено товаров: '+arr.length+'. Ничего не изменено.';
}

async function autoTest(){
  $('status').textContent='Читаю данные Prom...';
  $('results').innerHTML='';
  try{
    render(await api('/api/diagnose?limit=3'));
  }catch(e){
    $('status').textContent='Ошибка: '+e.message;
  }
}

async function testOne(){
  const id=$('productId').value.trim();
  if(!id){ $('status').textContent='Введи ID товара Prom.'; return; }
  $('status').textContent='Проверяю товар '+id+'...';
  $('results').innerHTML='';
  try{
    render(await api('/api/diagnose/'+encodeURIComponent(id)));
  }catch(e){
    $('status').textContent='Ошибка: '+e.message;
  }
}

(async()=>{
  try{
    const s=await api('/api/status');
    $('prom').textContent='Prom: '+(s.prom_connected?'подключен':'нет токена');
    $('prom').className='pill '+(s.prom_connected?'good':'bad');
  }catch(e){
    $('prom').textContent='Prom: ошибка';
    $('prom').className='pill bad';
  }
})();
</script>
</body>
</html>`;

app.get('/', (_req, res) => res.type('html').send(html));

app.get('/health', (_req, res) => {
  res.json({ ok: true, app: 'PrimeTac Prom Keywords Diagnostic v1.2', readonly: true, time: new Date().toISOString() });
});

app.get('/api/status', (_req, res) => {
  res.json({ ok: true, prom_connected: Boolean(PROM_TOKEN), readonly: true });
});

app.get('/api/diagnose', async (req, res) => {
  try {
    const requested = Number(req.query.limit || 3);
    const limit = Math.max(1, Math.min(10, requested));

    const products = await listProducts(Math.max(limit, 10));

    // Стараемся взять несколько разных названий/моделей, а не 3 варианта одного товара.
    const selected = [];
    const seenRoots = new Set();

    for (const p of products) {
      const root = String(p.name || '')
        .toLowerCase()
        .replace(/\b(чорний|чорна|сірий|сіра|хакі|койот|помаранчевий|black|gray|grey|orange)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 70);

      if (seenRoots.has(root)) continue;
      seenRoots.add(root);
      selected.push(p);
      if (selected.length >= limit) break;
    }

    while (selected.length < limit && products[selected.length]) {
      selected.push(products[selected.length]);
    }

    const diagnosed = [];
    for (const product of selected) {
      diagnosed.push(await diagnoseProduct(product));
    }

    res.json({ ok: true, readonly: true, products: diagnosed });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      error: error.message || String(error),
      data: error.data || null
    });
  }
});

app.get('/api/diagnose/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!/^\d+$/.test(id)) {
      return res.status(400).json({ error: 'Нужен числовой Prom ID товара' });
    }

    const products = await listProducts(100);
    let product = products.find(p => String(p.id) === id);

    if (!product) {
      const detail = await getProduct(id, 'uk');
      if (!detail.ok) {
        return res.status(detail.statusCode || 404).json({ error: detail.error || 'Товар не найден' });
      }
      product = unwrapProduct(detail.data);
    }

    res.json({
      ok: true,
      readonly: true,
      products: [await diagnoseProduct(product)]
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      error: error.message || String(error),
      data: error.data || null
    });
  }
});

app.listen(PORT, () => {
  console.log(`PrimeTac Prom Keywords Diagnostic v1.2 started on ${PORT} (READ ONLY)`);
});
