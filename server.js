
'use strict';

const express = require('express');
const https = require('https');

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT || 3000);
const PROM_TOKEN = String(process.env.PROM_TOKEN || '').trim();

function norm(v){ return String(v || '').replace(/\s+/g,' ').trim(); }
function parseKeywords(v){
  if(Array.isArray(v)) return v.flatMap(parseKeywords).filter(Boolean);
  if(typeof v !== 'string') return [];
  return v.split(/[,;\n]/u).map(x=>x.trim()).filter(Boolean);
}
function uniq(arr){
  const seen=new Set(), out=[];
  for(const x of arr){
    const s=norm(x);
    if(!s) continue;
    const k=s.toLowerCase();
    if(seen.has(k)) continue;
    seen.add(k); out.push(s);
  }
  return out;
}

const RULES = [
  [/\b(куртка|jacket|ветровка|вітровка|парка|анорак)\b/i,
    ['тактична куртка','чоловіча тактична куртка','військова куртка']],
  [/\b(фліс|флис|fleece)\b/i,
    ['тактична фліска','флісова кофта чоловіча','військова фліска']],
  [/\b(штани|брюки|pants)\b/i,
    ['тактичні штани','чоловічі тактичні штани','військові штани']],
  [/\b(рюкзак|backpack)\b/i,
    ['тактичний рюкзак','військовий рюкзак','рюкзак MOLLE']],
  [/\b(черевики|ботинки|берці|берцы|boots)\b/i,
    ['тактичні черевики','військові черевики','берці тактичні']]
];

const BRANDS=['BEZET','Propper','Kiborg','Helikon-Tex','Helikon','Salomon','LOWA','Belleville','M-Tac','Mil-Tec','Pentagon'];

function findBrand(name){
  const low=String(name||'').toLowerCase();
  return BRANDS.find(b=>low.includes(b.toLowerCase()))||'';
}

function generateKeywords(product, translatedName){
  const name=norm(translatedName || product.name);
  const rule=RULES.find(([re])=>re.test(name));
  const brand=findBrand(name);
  const out=[];

  if(rule) out.push(...rule[1]);

  const words=name.split(/\s+/).filter(Boolean);
  if(words.length>=2) out.push(words.slice(0,6).join(' '));

  if(rule && brand) out.push(`${rule[1][0]} ${brand}`);

  if(!rule){
    if(words.length) out.push(words.slice(0,5).join(' '));
    out.push('тактичне спорядження');
  }

  return uniq(out).slice(0,7);
}

function promRequest(method,path,body=null){
  if(!PROM_TOKEN) return Promise.reject(new Error('PROM_TOKEN не задан'));

  return new Promise((resolve,reject)=>{
    const payload=body===null?null:JSON.stringify(body);

    const headers={
      'Authorization':`Bearer ${PROM_TOKEN}`,
      'Accept':'application/json',
      'X-LANGUAGE':'uk'
    };

    if(payload){
      headers['Content-Type']='application/json';
      headers['Content-Length']=Buffer.byteLength(payload);
    }

    const req=https.request({
      hostname:'my.prom.ua',
      port:443,
      path:'/api/v1'+path,
      method,
      headers,
      timeout:45000
    },res=>{
      let raw='';
      res.setEncoding('utf8');
      res.on('data',c=>raw+=c);
      res.on('end',()=>{
        let data={};
        try{ data=raw?JSON.parse(raw):{}; }catch{ data={raw}; }

        // Prom иногда возвращает HTTP 200, но ошибку кладет в JSON body.
        const bodyError =
          data && typeof data === 'object' &&
          (data.error || data.errors || data.message && /required|error|invalid/i.test(String(data.message)));

        if(res.statusCode>=200 && res.statusCode<300 && !bodyError){
          return resolve({status:res.statusCode,data});
        }

        const errText =
          data?.error ||
          data?.message ||
          (data?.errors ? JSON.stringify(data.errors) : '') ||
          raw ||
          `HTTP ${res.statusCode}`;

        const e=new Error(String(errText));
        e.status=res.statusCode;
        e.data=data;
        reject(e);
      });
    });

    req.on('timeout',()=>req.destroy(new Error('Prom API timeout')));
    req.on('error',reject);

    if(payload) req.write(payload);
    req.end();
  });
}

function unwrap(data){
  if(!data || typeof data!=='object') return {};
  if(data.translation && typeof data.translation==='object') return data.translation;
  if(data.product && typeof data.product==='object') return data.product;
  return data;
}

async function listProducts(limit=100){
  const r=await promRequest('GET',`/products/list?limit=${limit}`);
  return Array.isArray(r.data?.products)?r.data.products:[];
}

async function getTranslation(productId,lang='uk'){
  const r=await promRequest('GET',`/products/translation/${encodeURIComponent(productId)}?lang=${encodeURIComponent(lang)}`);
  return { raw:r.data, tr:unwrap(r.data) };
}

async function candidate(){
  const products=await listProducts(100);

  for(const p of products){
    try{
      const {raw,tr}=await getTranslation(p.id,'uk');
      const current=parseKeywords(tr.keywords);
      if(current.length<5){
        return {
          product:p,
          translation_raw:raw,
          current_keywords:current,
          proposed_keywords:uniq([...current,...generateKeywords(p,tr.name)]).slice(0,7)
        };
      }
    }catch(_){}
  }

  throw new Error('Не нашёл товар с менее чем 5 украинскими ключами в первых 100 товарах');
}

async function writeOne(productId){
  const products=await listProducts(100);
  let p=products.find(x=>String(x.id)===String(productId));

  if(!p){
    const d=await promRequest('GET',`/products/${encodeURIComponent(productId)}`);
    p=unwrap(d.data);
  }

  if(!p || !p.id) throw new Error('Не удалось получить товар');

  const beforeRes=await getTranslation(p.id,'uk');
  const before=beforeRes.tr;

  const oldKeywords=parseKeywords(before.keywords);
  const proposed=uniq([...oldKeywords,...generateKeywords(p,before.name)]).slice(0,7);

  const payload={
    product_id:Number(p.id),
    lang:'uk',
    keywords:proposed.join(', ')
  };

  if(typeof before.name==='string' && before.name.trim()){
    payload.name=before.name;
  }
  if(typeof before.description==='string'){
    payload.description=before.description;
  }

  let put;
  try{
    put=await promRequest('PUT','/products/translation',payload);
  }catch(e){
    return {
      ok:false,
      verified:false,
      stage:'PUT /products/translation',
      product:{id:p.id,name:p.name},
      before_keywords:oldKeywords,
      sent_keywords:proposed,
      payload,
      prom_error:e.data || e.message
    };
  }

  await new Promise(r=>setTimeout(r,1500));

  const afterRes=await getTranslation(p.id,'uk');
  const after=afterRes.tr;
  const afterKeywords=parseKeywords(after.keywords);

  const oldSet=new Set(oldKeywords.map(x=>x.toLowerCase()));
  const added=afterKeywords.filter(x=>!oldSet.has(x.toLowerCase()));

  return {
    ok:true,
    verified:added.length>0,
    product:{id:p.id,name:p.name},
    before_keywords:oldKeywords,
    sent_keywords:proposed,
    after_keywords:afterKeywords,
    added_keywords:added,
    payload,
    put_status:put.status,
    put_response:put.data,
    after_raw:afterRes.raw
  };
}

const html=`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PrimeTac UA Keywords v1.4.1 FIX</title>
<style>
body{margin:0;background:#0c100e;color:#eef4ef;font-family:system-ui}.w{max-width:900px;margin:auto;padding:16px}.c{background:#151b18;border:1px solid #2b352f;border-radius:14px;padding:14px;margin:12px 0}.m{font-size:12px;color:#9aa49d}.good{color:#8fd37c}.bad{color:#ff8c83}.warn{color:#e4be6a}button{padding:11px 14px;border-radius:10px;border:1px solid #405148;background:#294428;color:white;font-weight:750;margin-right:7px}button:disabled{opacity:.5}pre{white-space:pre-wrap;word-break:break-word;background:#0d120f;padding:10px;border-radius:10px;font-size:11px}
</style>
</head>
<body><div class="w">
<h2>🧪 PrimeTac UA Keywords <span class="m">v1.4.1 FIX</span></h2>
<div class="m">Исправлено главное: PUT теперь отправляет <b>product_id</b>, а не id. Также HTTP 200 с JSON-ошибкой больше не считается успехом.</div>

<div class="c">
<button onclick="findOne()">Найти товар</button>
<button id="write" onclick="writeOne()" disabled>ТЕСТ: записать 1 товар</button>
<div id="status" class="m" style="margin-top:10px">Ищу товар...</div>
</div>

<div class="c">
<b id="product">—</b>
<div class="m" style="margin-top:10px">Сейчас UA keywords</div>
<div id="before" class="warn">—</div>
<div class="m" style="margin-top:10px">Будет отправлено</div>
<div id="after" class="good">—</div>
</div>

<div class="c">
<b>Результат API</b>
<pre id="log">—</pre>
</div>
</div>
<script>
let currentId=null;
async function api(u,o){
  const r=await fetch(u,o);
  const d=await r.json();
  if(!r.ok) throw new Error(d.error||JSON.stringify(d));
  return d;
}
async function findOne(){
  document.getElementById('write').disabled=true;
  document.getElementById('status').textContent='Ищу...';
  try{
    const d=await api('/api/candidate');
    currentId=d.product.id;
    document.getElementById('product').textContent=d.product.name+' | ID '+d.product.id;
    document.getElementById('before').textContent=(d.current_keywords||[]).join(', ')||'ПУСТО';
    document.getElementById('after').textContent=(d.proposed_keywords||[]).join(', ');
    document.getElementById('log').textContent=JSON.stringify(d.translation_raw,null,2);
    document.getElementById('status').textContent='Найден. Ничего не изменено.';
    document.getElementById('write').disabled=false;
  }catch(e){
    document.getElementById('status').textContent='Ошибка: '+e.message;
  }
}
async function writeOne(){
  if(!currentId)return;
  if(!confirm('Изменить UA keywords только у одного товара?'))return;
  document.getElementById('write').disabled=true;
  document.getElementById('status').textContent='Отправляю product_id + lang + keywords...';
  try{
    const d=await api('/api/write-one',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id:currentId})
    });
    document.getElementById('log').textContent=JSON.stringify(d,null,2);
    if(d.ok && d.verified){
      document.getElementById('status').innerHTML='<span class="good"><b>✅ ПОДТВЕРЖДЕНО:</b> Prom после PUT вернул новые UA keywords.</span>';
      document.getElementById('before').textContent=(d.before_keywords||[]).join(', ')||'ПУСТО';
      document.getElementById('after').textContent=(d.after_keywords||[]).join(', ');
    }else{
      document.getElementById('status').innerHTML='<span class="bad"><b>❌ НЕ ЗАПИСАНО.</b> Смотри точный ответ Prom ниже.</span>';
    }
  }catch(e){
    document.getElementById('status').textContent='Ошибка: '+e.message;
  }finally{
    document.getElementById('write').disabled=false;
  }
}
findOne();
</script>
</body></html>`;

app.get('/',(_req,res)=>res.type('html').send(html));

app.get('/api/candidate',async(_req,res)=>{
  try{res.json(await candidate())}
  catch(e){res.status(e.status||500).json({error:e.message||String(e),prom:e.data||null})}
});

app.post('/api/write-one',async(req,res)=>{
  try{
    const id=req.body?.id;
    if(!id) return res.status(400).json({error:'Нет id'});
    res.json(await writeOne(id));
  }catch(e){
    res.status(e.status||500).json({error:e.message||String(e),prom:e.data||null});
  }
});

app.get('/health',(_req,res)=>res.json({ok:true,app:'PrimeTac UA Keywords v1.4.1 FIX'}));

app.listen(PORT,()=>console.log('PrimeTac UA Keywords v1.4.1 FIX on '+PORT));
