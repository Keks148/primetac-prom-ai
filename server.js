/**
 * PrimeTac Group — UA Keywords Writer v1.4 TEST
 *
 * Цель: проверить запись ИМЕННО в украинские "Пошукові запити".
 * Массовой записи НЕТ. За одно нажатие меняется только 1 товар.
 *
 * Используется официальный endpoint:
 * GET  /products/translation/{id}?lang=uk
 * PUT  /products/translation
 *
 * Запрос PUT:
 * {
 *   id,
 *   lang: "uk",
 *   name: <существующий украинский name, если есть>,
 *   description: <существующий украинский description, если есть>,
 *   keywords: "..."
 * }
 *
 * После PUT программа повторно читает translation и показывает ДО/ПОСЛЕ.
 */

'use strict';

const express = require('express');
const https = require('https');

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT || 3000);
const PROM_TOKEN = String(process.env.PROM_TOKEN || '').trim();

const API_HOST = 'my.prom.ua';
const API_PREFIX = '/api/v1';

function norm(v) {
  return String(v || '').replace(/\s+/g, ' ').trim();
}

function uniq(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const s = norm(x).replace(/[#!?]/g, '');
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    if (k.split(/\s+/).length > 7) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function parseKeywords(v) {
  if (Array.isArray(v)) return v.flatMap(parseKeywords).filter(Boolean);
  if (typeof v !== 'string') return [];
  return v.split(/[,;\n]/u).map(x => x.trim()).filter(Boolean);
}

const RULES = [
  [/\b(куртка|ветровка|вітровка|парка|анорак|jacket)\b/i,
    ['тактична куртка','чоловіча тактична куртка','військова куртка']],
  [/\b(фліс|флис|фліска|флиска|fleece)\b/i,
    ['тактична фліска','флісова кофта чоловіча','військова фліска']],
  [/\b(штани|брюки|pants|джогери|джоггеры)\b/i,
    ['тактичні штани','чоловічі тактичні штани','військові штани']],
  [/\b(футболка|t-shirt|tshirt)\b/i,
    ['тактична футболка','чоловіча тактична футболка','військова футболка']],
  [/\b(поло|polo)\b/i,
    ['тактичне поло','чоловіче поло','військове поло']],
  [/\b(худі|худи|hoodie)\b/i,
    ['тактичне худі','чоловіче тактичне худі','військове худі']],
  [/\b(сорочка|рубашка|ubacs|combat shirt)\b/i,
    ['тактична сорочка','військова сорочка','сорочка UBACS']],
  [/\b(шорти|шорты|shorts)\b/i,
    ['тактичні шорти','чоловічі тактичні шорти','військові шорти']],
  [/\b(термобілизна|термобелье|термокомплект)\b/i,
    ['тактична термобілизна','чоловіча термобілизна','військова термобілизна']],
  [/\b(кепка|бейсболка|cap)\b/i,
    ['тактична кепка','військова кепка','чоловіча кепка']],
  [/\b(панама|boonie)\b/i,
    ['тактична панама','військова панама','панама тактична']],
  [/\b(балаклава|підшоломник|подшлемник)\b/i,
    ['тактична балаклава','військова балаклава','підшоломник тактичний']],
  [/\b(рукавички|перчатки|gloves)\b/i,
    ['тактичні рукавички','військові рукавички','рукавички для військових']],
  [/\b(кросівки|кроссовки|sneakers)\b/i,
    ['тактичні кросівки','військові кросівки','чоловічі тактичні кросівки']],
  [/\b(черевики|ботинки|берці|берцы|boots)\b/i,
    ['тактичні черевики','військові черевики','берці тактичні']],
  [/\b(рюкзак|backpack)\b/i,
    ['тактичний рюкзак','військовий рюкзак','рюкзак MOLLE']],
  [/\b(сумка|баул)\b/i,
    ['тактична сумка','військова сумка','сумка для спорядження']],
  [/\b(підсумок|подсумок|pouch)\b/i,
    ['тактичний підсумок','військовий підсумок','підсумок MOLLE']],
  [/\b(плитоноска|plate carrier)\b/i,
    ['тактична плитоноска','військова плитоноска','плитоноска MOLLE']],
  [/\b(бронежилет)\b/i,
    ['тактичний бронежилет','військовий бронежилет','бронежилет MOLLE']],
  [/\b(бронеплита|бронепластина)\b/i,
    ['бронеплита','бронеплита для бронежилета','військова бронеплита']],
];

const BRANDS = [
  'BEZET','YINREN','Kiborg','Helikon-Tex','Helikon','Salomon','LOWA',
  'Belleville','M-Tac','Mil-Tec','Pentagon','Propper'
];

const COLORS = [
  ['чорн','чорний'],['черн','чорний'],['black','чорний'],
  ['хакі','хакі'],['хаки','хакі'],['khaki','хакі'],
  ['койот','койот'],['coyote','койот'],['tan','койот'],
  ['олив','олива'],['olive','олива'],['foliage green','foliage green'],
  ['сір','сірий'],['сер','сірий'],['gray','сірий'],['grey','сірий'],
  ['мультикам','мультикам'],['multicam','мультикам'],
  ['помаранч','помаранчевий'],['оранж','помаранчевий']
];

function findBrand(name) {
  const low = name.toLowerCase();
  return BRANDS.find(b => low.includes(b.toLowerCase())) || '';
}

function findColor(name) {
  const low = name.toLowerCase();
  const hit = COLORS.find(([needle]) => low.includes(needle));
  return hit ? hit[1] : '';
}

function generateKeywords(product, translatedName) {
  const name = norm(translatedName || product.name);
  const rule = RULES.find(([re]) => re.test(name));
  const brand = findBrand(name);
  const color = findColor(name);
  const out = [];

  if (rule) out.push(...rule[1]);

  const words = name.split(/\s+/).filter(Boolean);
  if (words.length >= 2) out.push(words.slice(0, 6).join(' '));

  if (rule && brand) out.push(`${rule[1][0]} ${brand}`);
  if (rule && color) out.push(`${rule[1][0]} ${color}`);

  if (/дем[іи]сезон/i.test(name) && /куртк/i.test(name)) {
    out.push('демісезонна тактична куртка');
  }

  if (!rule) {
    if (brand && words.length) out.push(`${words[0]} ${brand}`);
    out.push('тактичне спорядження');
  }

  return uniq(out).slice(0, 7);
}

function promRequest(method, path, body = null) {
  if (!PROM_TOKEN) {
    return Promise.reject(new Error('PROM_TOKEN не задан в Render Environment'));
  }

  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);

    const headers = {
      'Authorization': `Bearer ${PROM_TOKEN}`,
      'Accept': 'application/json',
      'X-LANGUAGE': 'uk'
    };

    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = https.request({
      hostname: API_HOST,
      port: 443,
      path: API_PREFIX + path,
      method,
      headers,
      timeout: 45000
    }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', c => raw += c);
      res.on('end', () => {
        let data;
        try { data = raw ? JSON.parse(raw) : {}; }
        catch { data = { raw }; }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          return resolve({
            ok: true,
            status: res.statusCode,
            data,
            raw
          });
        }

        const err = new Error(`Prom API ${res.statusCode}: ${raw.slice(0, 1500)}`);
        err.status = res.statusCode;
        err.data = data;
        err.raw = raw;
        reject(err);
      });
    });

    req.on('timeout', () => req.destroy(new Error('Prom API timeout')));
    req.on('error', reject);

    if (payload) req.write(payload);
    req.end();
  });
}

async function listProducts(limit = 50) {
  const r = await promRequest('GET', `/products/list?limit=${limit}`);
  return Array.isArray(r.data?.products) ? r.data.products : [];
}

async function translation(id) {
  const r = await promRequest(
    'GET',
    `/products/translation/${encodeURIComponent(id)}?lang=uk`
  );
  return r;
}

function unwrapTranslation(data) {
  if (!data || typeof data !== 'object') return {};
  if (data.translation && typeof data.translation === 'object') return data.translation;
  if (data.product && typeof data.product === 'object') return data.product;
  return data;
}

async function findCandidate() {
  const products = await listProducts(100);

  // Ищем товар, у которого украинские keywords реально пустые/отсутствуют.
  for (const p of products) {
    try {
      const trRes = await translation(p.id);
      const tr = unwrapTranslation(trRes.data);
      const current = parseKeywords(tr.keywords);

      if (current.length < 3) {
        return {
          product: p,
          translation: tr,
          translation_raw: trRes.data,
          current_keywords: current,
          proposed_keywords: generateKeywords(p, tr.name)
        };
      }
    } catch (_) {
      // Пропускаем отдельный товар и продолжаем.
    }
  }

  // Если в первых 100 не нашли, возвращаем первый для ручной проверки.
  const p = products[0];
  if (!p) throw new Error('Prom не вернул товары');
  const trRes = await translation(p.id);
  const tr = unwrapTranslation(trRes.data);

  return {
    product: p,
    translation: tr,
    translation_raw: trRes.data,
    current_keywords: parseKeywords(tr.keywords),
    proposed_keywords: generateKeywords(p, tr.name)
  };
}

async function writeOne(id) {
  const products = await listProducts(100);
  let p = products.find(x => String(x.id) === String(id));

  if (!p) {
    const detail = await promRequest('GET', `/products/${encodeURIComponent(id)}`);
    p = detail.data?.product || detail.data;
  }

  if (!p || !p.id) throw new Error('Не удалось получить товар');

  const beforeRes = await translation(p.id);
  const before = unwrapTranslation(beforeRes.data);

  const oldKeywords = parseKeywords(before.keywords);
  const generated = generateKeywords(p, before.name);
  const merged = uniq([...oldKeywords, ...generated]).slice(0, 7);
  const keywordString = merged.join(', ');

  if (merged.length < 3) {
    throw new Error('Не удалось безопасно сформировать минимум 3 ключевые фразы');
  }

  // ВАЖНО: отправляем существующие name/description обратно без изменений,
  // чтобы не затронуть перевод текста карточки.
  const payload = {
    id: p.id,
    lang: 'uk',
    keywords: keywordString
  };

  if (typeof before.name === 'string' && before.name.trim()) {
    payload.name = before.name;
  }
  if (typeof before.description === 'string') {
    payload.description = before.description;
  }

  let putResponse;
  try {
    putResponse = await promRequest('PUT', '/products/translation', payload);
  } catch (error) {
    return {
      ok: false,
      stage: 'PUT /products/translation',
      product: { id: p.id, name: p.name },
      before: beforeRes.data,
      payload,
      http_status: error.status || null,
      prom_error: error.data || error.raw || error.message
    };
  }

  // Даём Prom чуть времени.
  await new Promise(r => setTimeout(r, 1200));

  let afterRes;
  try {
    afterRes = await translation(p.id);
  } catch (error) {
    return {
      ok: false,
      stage: 'VERIFY GET translation',
      product: { id: p.id, name: p.name },
      payload,
      put_response: putResponse.data,
      verify_error: error.data || error.raw || error.message
    };
  }

  const after = unwrapTranslation(afterRes.data);
  const afterKeywords = parseKeywords(after.keywords);

  const verified =
    afterKeywords.length >= 3 &&
    afterKeywords.some(x => !oldKeywords.map(v => v.toLowerCase()).includes(x.toLowerCase()));

  return {
    ok: true,
    verified,
    product: { id: p.id, name: p.name },
    before_keywords: oldKeywords,
    sent_keywords: merged,
    after_keywords: afterKeywords,
    payload,
    put_status: putResponse.status,
    put_response: putResponse.data,
    after_raw: afterRes.data
  };
}

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PrimeTac UA Keywords Test v1.4</title>
<style>
:root{color-scheme:dark;--bg:#0c100e;--card:#151b18;--line:#2b352f;--text:#eff4ef;--muted:#9ca69f;--green:#91d37f;--red:#ff8d83;--yellow:#e3be6b}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.w{max-width:950px;margin:auto;padding:16px}
.c{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin:12px 0}
h2{margin:3px 0 5px}.m{font-size:12px;color:var(--muted);line-height:1.45}
button{border:1px solid #435449;background:#2c492c;color:#fff;padding:12px 14px;border-radius:10px;font:inherit;font-weight:750;cursor:pointer;margin:4px}
button.secondary{background:#1e2923}
button:disabled{opacity:.5}
.good{color:var(--green)}.bad{color:var(--red)}.warn{color:var(--yellow)}
pre{white-space:pre-wrap;word-break:break-word;background:#0d120f;border:1px solid var(--line);padding:11px;border-radius:10px;font-size:11px}
.k{padding:8px;border-bottom:1px solid var(--line)}
</style>
</head>
<body>
<div class="w">
  <h2>🧪 PrimeTac UA Keywords <span class="m">v1.4 TEST</span></h2>
  <div class="m">
    Эта версия тестирует запись именно в украинские «Пошукові запити».
    Массового режима нет: за одно нажатие меняется только ОДИН товар.
  </div>

  <div class="c">
    <button class="secondary" onclick="findOne()">Найти товар для теста</button>
    <button id="writeBtn" disabled onclick="writeOne()">ТЕСТ: записать 1 товар</button>
    <div id="summary" class="m" style="margin-top:10px">Сначала найди товар.</div>
  </div>

  <div class="c">
    <div><b>Товар</b></div>
    <div id="product">—</div>
    <div style="margin-top:10px"><b>Сейчас UA keywords</b></div>
    <div id="before" class="k warn">—</div>
    <div style="margin-top:10px"><b>Предлагаем записать</b></div>
    <div id="after" class="k good">—</div>
  </div>

  <div class="c">
    <b>Результат API</b>
    <pre id="log">Пока ничего не отправлялось.</pre>
  </div>
</div>

<script>
let currentId=null;

async function api(url,opt){
  const r=await fetch(url,opt);
  const d=await r.json();
  if(!r.ok)throw new Error(d.error||JSON.stringify(d));
  return d;
}

async function findOne(){
  document.getElementById('summary').textContent='Ищу товар с пустыми украинскими ключами...';
  document.getElementById('writeBtn').disabled=true;
  document.getElementById('log').textContent='Чтение Prom...';

  try{
    const d=await api('/api/candidate');
    currentId=d.product.id;

    document.getElementById('product').textContent=d.product.name+' | ID '+d.product.id;
    document.getElementById('before').textContent=(d.current_keywords||[]).join(', ')||'ПУСТО';
    document.getElementById('after').textContent=(d.proposed_keywords||[]).join(', ');
    document.getElementById('summary').textContent='Найден товар. Ничего не изменено.';
    document.getElementById('log').textContent=
      'Raw украинского translation:\\n'+JSON.stringify(d.translation_raw,null,2);
    document.getElementById('writeBtn').disabled=false;
  }catch(e){
    document.getElementById('summary').textContent='Ошибка: '+e.message;
    document.getElementById('log').textContent=e.message;
  }
}

async function writeOne(){
  if(!currentId)return;
  if(!confirm('Изменить украинские поисковые запросы ТОЛЬКО у этого одного товара?'))return;

  document.getElementById('writeBtn').disabled=true;
  document.getElementById('log').textContent='PUT /products/translation...';

  try{
    const d=await api('/api/write-one',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id:currentId})
    });

    document.getElementById('log').textContent=JSON.stringify(d,null,2);

    if(d.ok && d.verified){
      document.getElementById('summary').innerHTML='<span class="good"><b>ПОДТВЕРЖДЕНО:</b> Prom вернул новые украинские keywords после записи.</span>';
      document.getElementById('before').textContent=(d.before_keywords||[]).join(', ')||'ПУСТО';
      document.getElementById('after').textContent=(d.after_keywords||[]).join(', ');
    }else if(d.ok){
      document.getElementById('summary').innerHTML='<span class="bad"><b>НЕ ПОДТВЕРЖДЕНО:</b> PUT прошёл, но повторное чтение не показало новые keywords.</span>';
    }else{
      document.getElementById('summary').innerHTML='<span class="bad"><b>Prom отклонил запись.</b> Ниже показан точный ответ API.</span>';
    }
  }catch(e){
    document.getElementById('summary').textContent='Ошибка: '+e.message;
    document.getElementById('log').textContent=e.message;
  }finally{
    document.getElementById('writeBtn').disabled=false;
  }
}

findOne();
</script>
</body>
</html>`;

app.get('/', (_req,res) => res.type('html').send(html));

app.get('/health', (_req,res) => {
  res.json({ok:true, app:'PrimeTac UA Keywords Test v1.4', mass_write:false});
});

app.get('/api/candidate', async (_req,res) => {
  try {
    res.json(await findCandidate());
  } catch (e) {
    res.status(e.status || 500).json({
      error: e.message || String(e),
      prom: e.data || null
    });
  }
});

app.post('/api/write-one', async (req,res) => {
  try {
    const id = req.body?.id;
    if (!id) return res.status(400).json({error:'Нет id товара'});
    const result = await writeOne(id);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({
      error: e.message || String(e),
      prom: e.data || null
    });
  }
});

app.listen(PORT, () => {
  console.log(`PrimeTac UA Keywords Test v1.4 started on ${PORT}`);
});
