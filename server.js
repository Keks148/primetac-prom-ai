
'use strict';

const express = require('express');
const https = require('https');

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = Number(process.env.PORT || 3000);
const PROM_TOKEN = String(process.env.PROM_TOKEN || '').trim();
const WRITE_ENABLED = String(process.env.WRITE_ENABLED || '').toLowerCase() === 'true';
const MAX_PRODUCTS = Math.max(100, Number(process.env.MAX_PRODUCTS || 5000));
const KEYWORD_MIN = Math.max(3, Math.min(7, Number(process.env.KEYWORD_MIN || 5)));
const SCAN_CONCURRENCY = Math.max(1, Math.min(10, Number(process.env.SCAN_CONCURRENCY || 5)));
const BATCH_SIZE = Math.max(1, Math.min(50, Number(process.env.BATCH_SIZE || 25)));

const API_HOST = 'my.prom.ua';
const API_PREFIX = '/api/v1';

let scanState = {
  running: false,
  started_at: null,
  finished_at: null,
  total: 0,
  processed: 0,
  errors: 0,
  rows: [],
  summary: null
};

let fixState = {
  running: false,
  started_at: null,
  finished_at: null,
  planned: 0,
  processed: 0,
  verified: 0,
  failed: 0,
  errors: []
};

function norm(v){ return String(v || '').replace(/\s+/g, ' ').trim(); }
function stripHtml(v){
  return String(v || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
function parseKeywords(v){
  if(Array.isArray(v)) return v.flatMap(parseKeywords).filter(Boolean);
  if(typeof v !== 'string') return [];
  return v.split(/[,;\n]/u).map(x => x.trim()).filter(Boolean);
}
function uniq(arr){
  const seen = new Set(), out = [];
  for(const x of arr){
    const s = norm(x).replace(/[#!?]/g, '');
    if(!s) continue;
    const k = s.toLowerCase();
    if(seen.has(k)) continue;
    if(k.split(/\s+/).length > 7) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

const BRANDS = [
  'BEZET','YINREN','Kiborg','KIBORG','Propper','Helikon-Tex','Helikon',
  'Salomon','LOWA','Belleville','M-Tac','M-TAC','Mil-Tec','Pentagon',
  'Defcon 5','ESDY','Walker','Tarkus','Ranger','5.11','Condor'
];

const COLORS = [
  ['чорн','Чорний'],['черн','Чорний'],['black','Чорний'],
  ['сір','Сірий'],['сер','Сірий'],['gray','Сірий'],['grey','Сірий'],
  ['хакі','Хакі'],['хаки','Хакі'],['khaki','Хакі'],
  ['койот','Койот'],['coyote','Койот'],['tan','Койот'],
  ['олив','Олива'],['olive','Олива'],
  ['foliage green','Foliage Green'],
  ['мультикам','Multicam'],['multicam','Multicam'],
  ['піксел','Піксель'],['пиксел','Піксель'],
  ['помаранч','Помаранчевий'],['оранж','Помаранчевий'],
  ['беж','Бежевий'],['зел','Зелений'],['green','Зелений'],
  ['син','Синій'],['navy','Темно-синій'],['white','Білий'],['білий','Білий']
];

const TYPES = [
  [/\b(куртка|jacket|ветровка|вітровка|парка|анорак)\b/i,'Куртка'],
  [/\b(фліс|флис|fleece)\b/i,'Флісова кофта'],
  [/\b(штани|брюки|pants|джогери|джоггеры)\b/i,'Тактичні штани'],
  [/\b(футболка|t-shirt|tshirt)\b/i,'Футболка'],
  [/\b(поло|polo)\b/i,'Поло'],
  [/\b(худі|худи|hoodie)\b/i,'Худі'],
  [/\b(кофта|світшот|свитшот|светр|свитер)\b/i,'Кофта'],
  [/\b(сорочка|рубашка|ubacs|combat shirt)\b/i,'Тактична сорочка'],
  [/\b(шорти|шорты|shorts)\b/i,'Шорти'],
  [/\b(термобілизна|термобелье|термокомплект)\b/i,'Термобілизна'],
  [/\b(кепка|бейсболка|cap)\b/i,'Кепка'],
  [/\b(панама|boonie)\b/i,'Панама'],
  [/\b(балаклава|підшоломник|подшлемник)\b/i,'Балаклава'],
  [/\b(рукавички|перчатки|gloves)\b/i,'Тактичні рукавички'],
  [/\b(кросівки|кроссовки|sneakers)\b/i,'Тактичні кросівки'],
  [/\b(черевики|ботинки|берці|берцы|boots)\b/i,'Тактичне взуття'],
  [/\b(рюкзак|backpack)\b/i,'Тактичний рюкзак'],
  [/\b(сумка|баул)\b/i,'Тактична сумка'],
  [/\b(пончо|дощовик|дождевик)\b/i,'Пончо / дощовик'],
  [/\b(ремінь|ремень|belt)\b/i,'Тактичний ремінь'],
  [/\b(підсумок|подсумок|pouch)\b/i,'Підсумок'],
  [/\b(плитоноска|plate carrier)\b/i,'Плитоноска'],
  [/\b(бронежилет)\b/i,'Бронежилет'],
  [/\b(бронеплита|бронепластина)\b/i,'Бронеплита'],
  [/\b(шолом|шлем|helmet)\b/i,'Шолом'],
  [/\b(окуляри|очки|goggles)\b/i,'Тактичні окуляри'],
  [/\b(ліхтар|фонарь|фонарик|flashlight)\b/i,'Тактичний ліхтар'],
  [/\b(спальник|спальний мішок|спальный мешок)\b/i,'Спальний мішок'],
  [/\b(каремат|килимок|коврик)\b/i,'Каремат'],
  [/\b(намет|палатка)\b/i,'Намет']
];

function findBrand(text){
  const low = String(text || '').toLowerCase();
  return BRANDS.find(b => low.includes(b.toLowerCase())) || '';
}
function findColor(text){
  const low = String(text || '').toLowerCase();
  const h = COLORS.find(([needle]) => low.includes(needle));
  return h ? h[1] : '';
}
function findType(text){
  const h = TYPES.find(([re]) => re.test(text || ''));
  return h ? h[1] : '';
}
function detectSizes(text){
  const src = String(text || '').toUpperCase();
  const out = [];

  for(const s of ['XS','S','M','L','XL','2XL','3XL','4XL','5XL','6XL']){
    const esc = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if(new RegExp(`(^|[^A-Z0-9])${esc}([^A-Z0-9]|$)`, 'i').test(src)) out.push(s);
  }

  for(const m of src.matchAll(/\b(3[8-9]|4[0-9]|5[0-9]|6[0-2])\b/g)){
    out.push(m[1]);
  }

  return uniq(out);
}
function countPhotos(p){
  const raw = [];
  for(const key of ['images','image_urls','photos','pictures']){
    if(Array.isArray(p[key])) raw.push(...p[key]);
  }
  if(p.main_image) raw.push(p.main_image);
  if(p.image) raw.push(p.image);
  return new Set(raw.map(x => typeof x === 'string' ? x : JSON.stringify(x))).size;
}
function getProducer(p){
  return norm(
    p.producer || p.manufacturer || p.brand || p.vendor ||
    p.producer_name || p.manufacturer_name || ''
  );
}
function getColor(p){
  return norm(p.color || p.colour || '');
}
function getProductType(p){
  return norm(p.type || p.product_type || p.jacket_type || '');
}
function getCategory(p){
  if(typeof p.category === 'string' || typeof p.category === 'number') return String(p.category);
  if(p.category && typeof p.category === 'object') return norm(p.category.name || p.category.title || p.category.id);
  return norm(p.category_name || p.marketplace_category || p.category_id || '');
}
function getWeight(p){
  for(const key of ['weight','weight_kg','weight_g','mass']){
    if(p[key] !== undefined && p[key] !== null && String(p[key]).trim() !== ''){
      return String(p[key]);
    }
  }
  return '';
}
function getStatus(p){
  return norm(p.status || p.presence || p.available || '');
}

function keywordSuggestions(p, uaName){
  const name = norm(uaName || p.name);
  const type = findType(name);
  const brand = findBrand(name);
  const color = findColor(name);
  const out = [];

  const map = {
    'Куртка':['тактична куртка','чоловіча тактична куртка','військова куртка'],
    'Флісова кофта':['тактична фліска','флісова кофта чоловіча','військова фліска'],
    'Тактичні штани':['тактичні штани','чоловічі тактичні штани','військові штани'],
    'Футболка':['тактична футболка','чоловіча тактична футболка','військова футболка'],
    'Поло':['тактичне поло','чоловіче поло','військове поло'],
    'Худі':['тактичне худі','чоловіче тактичне худі','військове худі'],
    'Тактична сорочка':['тактична сорочка','військова сорочка','сорочка UBACS'],
    'Тактичний рюкзак':['тактичний рюкзак','військовий рюкзак','рюкзак MOLLE'],
    'Тактична сумка':['тактична сумка','військова сумка','сумка для спорядження'],
    'Тактичне взуття':['тактичне взуття','військове взуття','чоловіче тактичне взуття'],
    'Тактичні кросівки':['тактичні кросівки','військові кросівки','чоловічі тактичні кросівки'],
    'Плитоноска':['тактична плитоноска','військова плитоноска','плитоноска MOLLE'],
    'Підсумок':['тактичний підсумок','військовий підсумок','підсумок MOLLE']
  };

  if(map[type]) out.push(...map[type]);
  else if(type) out.push(`${type.toLowerCase()} тактичний`, `${type} для військових`);

  const words = name.split(/\s+/).filter(Boolean);
  if(words.length >= 2) out.push(words.slice(0,6).join(' '));

  if(type && brand) out.push(`${type.toLowerCase()} ${brand}`);
  if(type && color) out.push(`${type.toLowerCase()} ${color.toLowerCase()}`);

  if(/дем[іи]сезон/i.test(name) && type === 'Куртка') out.push('демісезонна тактична куртка');
  if(/зим/i.test(name) && type === 'Куртка') out.push('зимова тактична куртка');

  if(!type) out.push('тактичне спорядження');

  return uniq(out).slice(0,7);
}

function promRequest(method,path,body=null){
  if(!PROM_TOKEN) return Promise.reject(new Error('PROM_TOKEN не задан в Render Environment'));

  return new Promise((resolve,reject)=>{
    const payload = body === null ? null : JSON.stringify(body);

    const headers = {
      'Authorization': `Bearer ${PROM_TOKEN}`,
      'Accept': 'application/json',
      'X-LANGUAGE': 'uk'
    };

    if(payload){
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
        let data = {};
        try{ data = raw ? JSON.parse(raw) : {}; }
        catch{ data = { raw }; }

        const bodyError =
          data && typeof data === 'object' &&
          (data.error || data.errors ||
           (data.message && /required|invalid|error/i.test(String(data.message))));

        if(res.statusCode >= 200 && res.statusCode < 300 && !bodyError){
          return resolve({ status: res.statusCode, data });
        }

        const errText =
          data?.error ||
          data?.message ||
          (data?.errors ? JSON.stringify(data.errors) : '') ||
          raw ||
          `HTTP ${res.statusCode}`;

        const e = new Error(String(errText));
        e.status = res.statusCode;
        e.data = data;
        reject(e);
      });
    });

    req.on('timeout', () => req.destroy(new Error('Prom API timeout')));
    req.on('error', reject);

    if(payload) req.write(payload);
    req.end();
  });
}

function unwrap(data){
  if(!data || typeof data !== 'object') return {};
  if(data.translation && typeof data.translation === 'object') return data.translation;
  if(data.product && typeof data.product === 'object') return data.product;
  return data;
}

async function listAllProducts(){
  const all = [];
  const seen = new Set();
  let lastId = null;
  let guard = 0;

  while(all.length < MAX_PRODUCTS && guard++ < 100){
    const limit = Math.min(100, MAX_PRODUCTS - all.length);
    const path = `/products/list?limit=${limit}${lastId ? `&last_id=${encodeURIComponent(lastId)}` : ''}`;
    const d = (await promRequest('GET', path)).data;
    const batch = Array.isArray(d.products) ? d.products : [];

    if(!batch.length) break;

    let added = 0;
    for(const p of batch){
      const id = String(p.id);
      if(!seen.has(id)){
        seen.add(id);
        all.push(p);
        added++;
      }
    }

    const next = d.last_id || batch[batch.length - 1]?.id;
    if(!next || String(next) === String(lastId) || !added) break;
    lastId = next;

    if(batch.length < limit) break;
  }

  return all;
}

async function getProduct(id){
  try{
    return unwrap((await promRequest('GET', `/products/${encodeURIComponent(id)}`)).data);
  }catch(_){
    return null;
  }
}

async function getTranslation(id, lang='uk'){
  try{
    return unwrap((await promRequest(
      'GET',
      `/products/translation/${encodeURIComponent(id)}?lang=${encodeURIComponent(lang)}`
    )).data);
  }catch(e){
    return { __error: e.message };
  }
}

function buildAudit(p, ua){
  const name = norm((ua && !ua.__error && ua.name) || p.name);
  const description = stripHtml((ua && !ua.__error && ua.description) || p.description || '');
  const existingKeywords = parseKeywords(ua && !ua.__error ? ua.keywords : '');
  const suggestions = keywordSuggestions(p, name);
  const mergedKeywords = uniq([...existingKeywords, ...suggestions]).slice(0,7);

  const combined = `${name} ${description}`;

  const existingProducer = getProducer(p);
  const detectedProducer = findBrand(combined);

  const existingType = getProductType(p);
  const detectedType = findType(combined);

  const existingColor = getColor(p);
  const detectedColor = findColor(combined);

  let sizes = [];
  sizes.push(...detectSizes(combined));

  for(const key of ['variants','modifications','modification','sizes']){
    if(Array.isArray(p[key])){
      sizes.push(...detectSizes(JSON.stringify(p[key])));
    }
  }
  sizes = uniq(sizes);

  const category = getCategory(p);
  const weight = getWeight(p);
  const photos = countPhotos(p);

  const fields = {
    title: {
      ok: name.length >= 12,
      value: name || 'Пусто',
      suggestion: name.length >= 12 ? '' : 'Уточнить тип + бренд + модель'
    },
    description: {
      ok: description.length >= 250,
      value: description.length ? `${description.length} символов` : 'Пусто',
      suggestion: description.length >= 250 ? '' : 'Дополнить только подтверждёнными данными'
    },
    keywords: {
      ok: existingKeywords.length >= KEYWORD_MIN,
      value: existingKeywords.length ? existingKeywords.join(', ') : 'Пусто',
      suggestion: mergedKeywords.join(', ')
    },
    producer: {
      ok: Boolean(existingProducer || detectedProducer),
      value: existingProducer || detectedProducer || 'Пусто',
      suggestion: !existingProducer && detectedProducer ? `Можно поставить: ${detectedProducer}` : ''
    },
    type: {
      ok: Boolean(existingType || detectedType),
      value: existingType || detectedType || 'Пусто',
      suggestion: !existingType && detectedType ? `Можно поставить: ${detectedType}` : ''
    },
    color: {
      ok: Boolean(existingColor || detectedColor),
      value: existingColor || detectedColor || 'Пусто',
      suggestion: !existingColor && detectedColor ? `Можно поставить: ${detectedColor}` : ''
    },
    size: {
      ok: sizes.length > 0,
      value: sizes.length ? sizes.join(', ') : 'Пусто',
      suggestion: sizes.length ? '' : 'Нет подтверждённых размеров в данных'
    },
    category: {
      ok: Boolean(category),
      value: category || 'Пусто',
      suggestion: category ? '' : 'Проверить вручную'
    },
    weight: {
      ok: Boolean(weight),
      value: weight || 'Нет данных',
      suggestion: weight ? '' : 'Не заполнять без данных поставщика'
    },
    photos: {
      ok: photos >= 3,
      value: String(photos),
      suggestion: photos >= 3 ? '' : 'Желательно минимум 3 фото'
    }
  };

  const scoreKeys = ['title','description','keywords','producer','type','color','size','category','photos'];
  const score = Math.round(scoreKeys.filter(k => fields[k].ok).length / scoreKeys.length * 100);

  return {
    id: p.id,
    name,
    score,
    fields,
    status: getStatus(p),
    safe: {
      can_fix_ua_keywords: mergedKeywords.length > existingKeywords.length,
      ua_keywords_before: existingKeywords,
      ua_keywords_after: mergedKeywords
    }
  };
}

async function auditOneFromListProduct(p){
  const ua = await getTranslation(p.id, 'uk');
  return buildAudit(p, ua && !ua.__error ? ua : null);
}

async function poolMap(items, concurrency, worker, progressCb){
  const results = new Array(items.length);
  let index = 0;

  async function runner(){
    while(true){
      const i = index++;
      if(i >= items.length) break;
      try{
        results[i] = await worker(items[i], i);
      }catch(e){
        results[i] = { __error: e.message || String(e), id: items[i]?.id };
      }
      if(progressCb) progressCb(i, results[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
  return results;
}

function summarize(rows){
  const valid = rows.filter(r => r && !r.__error);
  const fields = ['title','description','keywords','producer','type','color','size','category','weight','photos'];
  const missing = {};
  for(const f of fields){
    missing[f] = valid.filter(r => !r.fields[f].ok).length;
  }

  return {
    total: rows.length,
    valid: valid.length,
    errors: rows.length - valid.length,
    average_score: valid.length
      ? Math.round(valid.reduce((s,r)=>s+r.score,0)/valid.length)
      : 0,
    need_safe_fix: valid.filter(r => r.safe.can_fix_ua_keywords).length,
    missing
  };
}

async function startScan(){
  if(scanState.running) return;

  scanState = {
    running: true,
    started_at: new Date().toISOString(),
    finished_at: null,
    total: 0,
    processed: 0,
    errors: 0,
    rows: [],
    summary: null
  };

  try{
    const products = await listAllProducts();
    scanState.total = products.length;

    const rows = await poolMap(
      products,
      SCAN_CONCURRENCY,
      async (p) => auditOneFromListProduct(p),
      (_i, result) => {
        scanState.processed++;
        if(result && result.__error) scanState.errors++;
      }
    );

    scanState.rows = rows.filter(Boolean);
    scanState.summary = summarize(scanState.rows);
    scanState.finished_at = new Date().toISOString();
  }catch(e){
    scanState.errors++;
    scanState.summary = {
      total: scanState.total,
      valid: 0,
      errors: scanState.errors,
      average_score: 0,
      need_safe_fix: 0,
      missing: {}
    };
  }finally{
    scanState.running = false;
  }
}

async function fixUaKeywordsForProduct(id){
  if(!WRITE_ENABLED) throw new Error('WRITE_ENABLED=false');

  let p = await getProduct(id);
  if(!p){
    const all = scanState.rows || [];
    const cached = all.find(r => String(r.id) === String(id));
    if(!cached) throw new Error('Не удалось получить товар');
    p = { id: cached.id, name: cached.name };
  }

  const before = await getTranslation(id, 'uk');
  if(before.__error) throw new Error(before.__error);

  const oldKeywords = parseKeywords(before.keywords);
  const proposed = uniq([...oldKeywords, ...keywordSuggestions(p, before.name || p.name)]).slice(0,7);

  if(proposed.length <= oldKeywords.length){
    return {
      ok: true,
      skipped: true,
      verified: oldKeywords.length >= KEYWORD_MIN,
      before: oldKeywords,
      after: oldKeywords
    };
  }

  const payload = {
    product_id: Number(id),
    lang: 'uk',
    keywords: proposed.join(', ')
  };

  if(typeof before.name === 'string' && before.name.trim()) payload.name = before.name;
  if(typeof before.description === 'string') payload.description = before.description;

  await promRequest('PUT', '/products/translation', payload);
  await new Promise(r => setTimeout(r, 700));

  const after = await getTranslation(id, 'uk');
  const afterKeywords = parseKeywords(after.keywords);

  const beforeSet = new Set(oldKeywords.map(x => x.toLowerCase()));
  const added = afterKeywords.filter(x => !beforeSet.has(x.toLowerCase()));

  return {
    ok: true,
    skipped: false,
    verified: added.length > 0,
    before: oldKeywords,
    sent: proposed,
    after: afterKeywords,
    added
  };
}

async function startBatchFix(limit=BATCH_SIZE){
  if(fixState.running) return;

  const candidates = (scanState.rows || [])
    .filter(r => r && !r.__error && r.safe?.can_fix_ua_keywords)
    .slice(0, limit);

  fixState = {
    running: true,
    started_at: new Date().toISOString(),
    finished_at: null,
    planned: candidates.length,
    processed: 0,
    verified: 0,
    failed: 0,
    errors: []
  };

  try{
    for(const row of candidates){
      try{
        const result = await fixUaKeywordsForProduct(row.id);
        fixState.processed++;

        if(result.verified) fixState.verified++;
        else if(!result.skipped){
          fixState.failed++;
          fixState.errors.push({ id: row.id, name: row.name, error: 'Prom не подтвердил новые UA keywords' });
        }
      }catch(e){
        fixState.processed++;
        fixState.failed++;
        fixState.errors.push({ id: row.id, name: row.name, error: e.message || String(e) });
      }
    }

    // Обновляем только обработанные строки в кеше
    const ids = new Set(candidates.map(x => String(x.id)));
    for(let i=0;i<scanState.rows.length;i++){
      const row = scanState.rows[i];
      if(!row || !ids.has(String(row.id))) continue;

      try{
        const p = await getProduct(row.id) || { id: row.id, name: row.name };
        const ua = await getTranslation(row.id, 'uk');
        scanState.rows[i] = buildAudit(p, ua && !ua.__error ? ua : null);
      }catch(_){}
    }

    scanState.summary = summarize(scanState.rows);
  }finally{
    fixState.finished_at = new Date().toISOString();
    fixState.running = false;
  }
}

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PrimeTac Card Manager v1.6</title>
<style>
:root{color-scheme:dark;--bg:#0b100d;--card:#151b18;--line:#2b352f;--text:#eef4ef;--muted:#9aa49d;--green:#8fd37c;--yellow:#e4be6a;--red:#ff8c83}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}.w{max-width:1180px;margin:auto;padding:16px}.c{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin:12px 0}.m{font-size:12px;color:var(--muted);line-height:1.45}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}button,input,select{font:inherit;border-radius:10px;border:1px solid #405148;padding:10px 12px;background:#1e2923;color:#fff}button{font-weight:750;background:#2d472d;cursor:pointer}button.secondary{background:#1d2822}button:disabled{opacity:.45}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.stat{background:#101511;border:1px solid var(--line);border-radius:12px;padding:12px}.n{font-size:28px;font-weight:850}.good{color:var(--green)}.warn{color:var(--yellow)}.bad{color:var(--red)}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}.pill{padding:4px 7px;border:1px solid var(--line);border-radius:999px;font-size:11px}.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.fbox{border:1px solid var(--line);border-radius:10px;padding:8px;margin:6px 0}.suggest{font-size:11px;color:#c8d7c8;margin-top:4px}.bar{height:8px;background:#202823;border-radius:999px;overflow:hidden}.bar>div{height:100%;background:#8fd37c;width:0}.detail{display:none}.detail.open{display:block}@media(max-width:800px){.grid{grid-template-columns:1fr 1fr}table{font-size:10px}.hide-mobile{display:none}}
</style>
</head>
<body><div class="w">
<h2>🧰 PrimeTac Card Manager <span class="m">v1.6</span></h2>
<div class="m">Рабочая запись UA keywords встроена. Остальные поля пока только проверяются и рекомендуются, чтобы не испортить категорийные характеристики Prom.</div>

<div class="c">
  <div class="row">
    <button onclick="startScan()">🔎 Сканировать весь каталог</button>
    <button class="secondary" onclick="refresh()">Обновить статус</button>
    <button id="fix25" onclick="fixBatch()" disabled>✅ Исправить безопасно ${BATCH_SIZE} товаров</button>
  </div>
  <div class="m" id="statusText" style="margin-top:9px">Готово.</div>
  <div class="bar" style="margin-top:9px"><div id="progressBar"></div></div>
</div>

<div class="grid">
  <div class="stat"><div class="m">Всего</div><div id="total" class="n">—</div></div>
  <div class="stat"><div class="m">Среднее заполнение</div><div id="avg" class="n">—</div></div>
  <div class="stat"><div class="m">Нужно безопасно исправить</div><div id="need" class="n warn">—</div></div>
  <div class="stat"><div class="m">Ошибок сканирования</div><div id="errs" class="n bad">—</div></div>
</div>

<div class="c">
  <div class="toolbar">
    <input id="q" placeholder="Поиск по товару..." oninput="renderTable()">
    <select id="filter" onchange="renderTable()">
      <option value="all">Все товары</option>
      <option value="keywords">Нет нормальных UA ключей</option>
      <option value="producer">Нет производителя</option>
      <option value="type">Нет типа</option>
      <option value="color">Нет цвета</option>
      <option value="size">Нет размера</option>
      <option value="category">Нет категории</option>
      <option value="weight">Нет веса</option>
      <option value="photos">Мало фото</option>
      <option value="low">Заполнение ≤ 60%</option>
    </select>
  </div>
</div>

<div class="c" style="overflow:auto">
  <table>
    <thead>
      <tr><th>Товар</th><th>Заполнение</th><th>Ключи UA</th><th class="hide-mobile">Произв.</th><th class="hide-mobile">Тип</th><th class="hide-mobile">Цвет</th><th class="hide-mobile">Размер</th><th>Действие</th></tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
</div>

<div id="detail" class="c detail"></div>

<div class="c">
  <b>Последняя безопасная обработка</b>
  <pre id="fixLog" class="m">Ещё не запускалась.</pre>
</div>
</div>

<script>
let DATA={rows:[],summary:null};
let scanRunning=false, fixRunning=false;

const LABELS={
 title:'Название',description:'Описание',keywords:'Ключевые слова (UA)',
 producer:'Производитель',type:'Вид товара',color:'Цвет',size:'Размер',
 category:'Категория',weight:'Вес',photos:'Фото'
};

async function api(u,o){
  const r=await fetch(u,o);
  const d=await r.json();
  if(!r.ok) throw new Error(d.error||JSON.stringify(d));
  return d;
}
function esc(v){
  return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
}
function okIcon(v){return v?'✅':'❌'}

function rowMatches(r){
  const q=document.getElementById('q').value.trim().toLowerCase();
  if(q && !String(r.name||'').toLowerCase().includes(q)) return false;
  const f=document.getElementById('filter').value;
  if(f==='all') return true;
  if(f==='low') return r.score<=60;
  if(r.fields && r.fields[f]) return !r.fields[f].ok;
  return true;
}
function renderTable(){
  const tb=document.getElementById('rows');
  tb.innerHTML='';
  const rows=(DATA.rows||[]).filter(r=>r && !r.__error && rowMatches(r)).slice(0,500);

  for(const r of rows){
    const tr=document.createElement('tr');
    const cls=r.score>=80?'good':(r.score>=60?'warn':'bad');
    tr.innerHTML=
      '<td>'+esc(r.name)+'</td>'+
      '<td><b class="'+cls+'">'+r.score+'%</b></td>'+
      '<td>'+okIcon(r.fields.keywords.ok)+' '+esc((r.safe.ua_keywords_before||[]).length)+'</td>'+
      '<td class="hide-mobile">'+okIcon(r.fields.producer.ok)+' '+esc(r.fields.producer.value)+'</td>'+
      '<td class="hide-mobile">'+okIcon(r.fields.type.ok)+' '+esc(r.fields.type.value)+'</td>'+
      '<td class="hide-mobile">'+okIcon(r.fields.color.ok)+' '+esc(r.fields.color.value)+'</td>'+
      '<td class="hide-mobile">'+okIcon(r.fields.size.ok)+' '+esc(r.fields.size.value)+'</td>'+
      '<td><button class="secondary" data-id="'+esc(r.id)+'">Открыть</button></td>';
    const btn=tr.querySelector('button[data-id]');
    if(btn) btn.addEventListener('click',()=>showDetail(btn.getAttribute('data-id')));
    tb.appendChild(tr);
  }
}

function showDetail(id){
  const r=(DATA.rows||[]).find(x=>String(x.id)===String(id));
  if(!r)return;

  const d=document.getElementById('detail');
  d.className='c detail open';

  let html='<h3>'+esc(r.name)+'</h3><div class="m">Prom ID: '+esc(r.id)+' • Заполнение: <b>'+r.score+'%</b></div>';
  for(const [k,f] of Object.entries(r.fields)){
    html+='<div class="fbox"><b>'+okIcon(f.ok)+' '+(LABELS[k]||k)+'</b><div>'+esc(f.value)+'</div>';
    if(f.suggestion) html+='<div class="suggest">→ '+esc(f.suggestion)+'</div>';
    html+='</div>';
  }

  if(r.safe.can_fix_ua_keywords){
    html+='<button id="fixOneBtn">Исправить UA ключи у этого товара</button>';
  }else{
    html+='<div class="good">✅ Безопасных исправлений сейчас не требуется.</div>';
  }

  d.innerHTML=html;
  const fixBtn=document.getElementById('fixOneBtn');
  if(fixBtn) fixBtn.addEventListener('click',()=>fixOne(String(r.id)));
  d.scrollIntoView({behavior:'smooth',block:'start'});
}

async function startScan(){
  try{
    await api('/api/scan/start',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    document.getElementById('statusText').textContent='Сканирование запущено...';
    poll();
  }catch(e){document.getElementById('statusText').textContent='Ошибка: '+e.message}
}

async function refresh(){
  try{
    const d=await api('/api/state');
    DATA.rows=d.scan.rows||[];
    DATA.summary=d.scan.summary||null;
    scanRunning=d.scan.running;
    fixRunning=d.fix.running;

    const total=d.scan.total||0, processed=d.scan.processed||0;
    document.getElementById('total').textContent=DATA.summary?.total ?? total ?? '—';
    document.getElementById('avg').textContent=DATA.summary ? DATA.summary.average_score+'%' : '—';
    document.getElementById('need').textContent=DATA.summary?.need_safe_fix ?? '—';
    document.getElementById('errs').textContent=DATA.summary?.errors ?? d.scan.errors ?? 0;

    const pct=total?Math.round(processed/total*100):0;
    document.getElementById('progressBar').style.width=pct+'%';

    if(d.scan.running){
      document.getElementById('statusText').textContent='Сканирую: '+processed+'/'+total+' ('+pct+'%)';
    }else if(DATA.summary){
      document.getElementById('statusText').textContent='Готово. Проверено '+DATA.summary.valid+' товаров.';
    }

    document.getElementById('fix25').disabled=
      !DATA.summary || !DATA.summary.need_safe_fix || d.scan.running || d.fix.running;

    if(d.fix.started_at){
      document.getElementById('fixLog').textContent=
        'Запланировано: '+d.fix.planned+
        '\\nОбработано: '+d.fix.processed+
        '\\nПодтверждено Prom: '+d.fix.verified+
        '\\nОшибок: '+d.fix.failed+
        (d.fix.errors?.length?'\\n\\n'+JSON.stringify(d.fix.errors.slice(0,10),null,2):'');
    }

    renderTable();
  }catch(e){
    document.getElementById('statusText').textContent='Ошибка статуса: '+e.message;
  }
}

async function poll(){
  await refresh();
  if(scanRunning || fixRunning) setTimeout(poll,1500);
}

async function fixBatch(){
  if(!confirm('Безопасно дополнить украинские поисковые запросы у следующих ${BATCH_SIZE} товаров? Остальные поля не изменяются.'))return;
  try{
    await api('/api/fix/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({limit:${BATCH_SIZE}})});
    document.getElementById('statusText').textContent='Запущена безопасная обработка...';
    poll();
  }catch(e){document.getElementById('statusText').textContent='Ошибка: '+e.message}
}

async function fixOne(id){
  if(!confirm('Дополнить только украинские поисковые запросы этого товара?'))return;
  try{
    const d=await api('/api/fix/'+encodeURIComponent(id),{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    alert(d.verified?'✅ Prom подтвердил изменение.':'⚠ Запись не подтверждена.');
    await refresh();
    showDetail(id);
  }catch(e){alert('Ошибка: '+e.message)}
}

refresh();
</script>
</body></html>`;

app.get('/', (_req,res) => res.type('html').send(html));

app.get('/health', (_req,res) => {
  res.json({
    ok: true,
    app: 'PrimeTac Card Manager v1.6',
    prom_connected: Boolean(PROM_TOKEN),
    write_enabled: WRITE_ENABLED
  });
});

app.get('/api/state', (_req,res) => {
  res.json({ scan: scanState, fix: fixState });
});

app.post('/api/scan/start', (_req,res) => {
  if(scanState.running) return res.json({ ok:true, already_running:true });
  startScan().catch(()=>{});
  res.json({ ok:true, started:true });
});

app.post('/api/fix/start', (req,res) => {
  if(!WRITE_ENABLED) return res.status(400).json({ error:'WRITE_ENABLED=false' });
  if(fixState.running) return res.json({ ok:true, already_running:true });

  const limit = Math.max(1, Math.min(50, Number(req.body?.limit || BATCH_SIZE)));
  startBatchFix(limit).catch(()=>{});
  res.json({ ok:true, started:true, limit });
});

app.post('/api/fix/:id', async (req,res) => {
  try{
    const result = await fixUaKeywordsForProduct(req.params.id);

    // обновляем строку в кеше
    const idx = scanState.rows.findIndex(r => r && String(r.id) === String(req.params.id));
    if(idx >= 0){
      const p = await getProduct(req.params.id) || { id:req.params.id, name:scanState.rows[idx].name };
      const ua = await getTranslation(req.params.id,'uk');
      scanState.rows[idx] = buildAudit(p, ua && !ua.__error ? ua : null);
      scanState.summary = summarize(scanState.rows);
    }

    res.json(result);
  }catch(e){
    res.status(e.status || 500).json({ error:e.message || String(e), prom:e.data || null });
  }
});

app.get('/api/card/:id', async (req,res) => {
  try{
    const p = await getProduct(req.params.id);
    if(!p) throw new Error('Товар не найден');
    const ua = await getTranslation(req.params.id,'uk');
    res.json(buildAudit(p, ua && !ua.__error ? ua : null));
  }catch(e){
    res.status(e.status || 500).json({ error:e.message || String(e), prom:e.data || null });
  }
});

app.listen(PORT, () => {
  console.log(`PrimeTac Card Manager v1.6 started on ${PORT}`);
});
