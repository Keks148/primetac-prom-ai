'use strict';

const https = require('https');

const PROM_TOKEN = process.env.PROM_TOKEN || '';
const WRITE_ENABLED = String(process.env.WRITE_ENABLED || '').toLowerCase() === 'true';
const WRITE_PIN = String(process.env.WRITE_PIN || '');
const SEO_AUTORUN = String(process.env.SEO_AUTORUN || '').toLowerCase() === 'true';
const SEO_AUTORUN_MODE = String(process.env.SEO_AUTORUN_MODE || 'missing').toLowerCase();
const SEO_INTERVAL_HOURS = Math.max(1, Number(process.env.SEO_INTERVAL_HOURS || 12));
const SEO_MAX_PRODUCTS = Math.max(1, Number(process.env.SEO_MAX_PRODUCTS || 5000));

const TYPE_RULES = [
  [/\b(куртка|куртки)\b/i, ['тактична куртка','чоловіча тактична куртка','військова куртка']],
  [/\b(штани|брюки)\b/i, ['тактичні штани','чоловічі тактичні штани','військові штани']],
  [/\b(футболка|футболки)\b/i, ['тактична футболка','чоловіча футболка','військова футболка']],
  [/\b(худі|худи|hoodie)\b/i, ['тактичне худі','чоловіче худі','військове худі']],
  [/\b(фліс|флис|фліска|флиска)\b/i, ['тактична фліска','флісова кофта','військова фліска']],
  [/\b(кофта|світшот|свитшот)\b/i, ['тактична кофта','чоловіча кофта','військова кофта']],
  [/\b(сорочка|рубашка|ubacs)\b/i, ['тактична сорочка','військова сорочка','сорочка UBACS']],
  [/\b(шорти|шорты)\b/i, ['тактичні шорти','чоловічі шорти','військові шорти']],
  [/\b(термобілизна|термобелье)\b/i, ['тактична термобілизна','чоловіча термобілизна','військова термобілизна']],
  [/\b(кепка|бейсболка)\b/i, ['тактична кепка','військова кепка','чоловіча кепка']],
  [/\bпанама\b/i, ['тактична панама','військова панама','панама для військових']],
  [/\bбалаклава\b/i, ['тактична балаклава','військова балаклава','балаклава чоловіча']],
  [/\b(рукавички|перчатки)\b/i, ['тактичні рукавички','військові рукавички','рукавички для військових']],
  [/\b(кросівки|кроссовки)\b/i, ['тактичні кросівки','військові кросівки','чоловічі тактичні кросівки']],
  [/\b(черевики|ботинки|берці|берцы)\b/i, ['тактичні черевики','військові черевики','берці тактичні']],
  [/\bрюкзак\b/i, ['тактичний рюкзак','військовий рюкзак','рюкзак MOLLE']],
  [/\b(сумка|баул)\b/i, ['тактична сумка','військова сумка','сумка для спорядження']],
  [/\b(пончо|дощовик|дождевик)\b/i, ['тактичне пончо','пончо дощовик','військовий дощовик']],
  [/\b(ремінь|ремень)\b/i, ['тактичний ремінь','військовий ремінь','чоловічий тактичний ремінь']],
  [/\b(підсумок|подсумок)\b/i, ['тактичний підсумок','військовий підсумок','підсумок MOLLE']]
];

const BRANDS = ['BEZET','YINREN','KIBORG','Kiborg','Helikon','Helikon-Tex','Salomon','LOWA','Belleville','ESDY','Walker','Mil-Tec','M-Tac','M-TAC','Pentagon','Defcon 5'];
const COLORS = [['чорн','чорний'],['черн','чорний'],['black','чорний'],['хакі','хакі'],['хаки','хакі'],['khaki','хакі'],['койот','койот'],['coyote','койот'],['олив','олива'],['olive','олива'],['сір','сірий'],['сер','сірий'],['gray','сірий'],['grey','сірий'],['піксел','піксель'],['пиксел','піксель'],['мультикам','мультикам'],['multicam','мультикам'],['помаранч','помаранчевий'],['оранж','помаранчевий'],['беж','бежевий']];
const BAD = new Set(['купити','купить','замовити','заказать','доставка','україна','украина','акція','акция','дешево']);

function norm(s){ return String(s||'').replace(/\s+/g,' ').trim(); }
function brandOf(name){ return BRANDS.find(b => new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i').test(name)) || ''; }
function colorOf(name){ const x=String(name||'').toLowerCase(); const hit=COLORS.find(([k])=>x.includes(k)); return hit ? hit[1] : ''; }
function typeOf(name){ const hit=TYPE_RULES.find(([re])=>re.test(name)); return hit ? hit[1] : null; }
function clean(s){
  const x=norm(s).replace(/[#!?]/g,'');
  if(!x) return '';
  const w=x.toLowerCase().split(/\s+/);
  if(w.some(v=>BAD.has(v)) || w.length>7) return '';
  return x;
}
function uniq(arr){ const seen=new Set(); return arr.map(clean).filter(Boolean).filter(x=>{const k=x.toLowerCase(); if(seen.has(k)) return false; seen.add(k); return true;}); }
function nameCore(name){ return norm(name).replace(/\b(чорний|черный|black|хакі|хаки|khaki|койот|coyote|олива|olive|сірий|серый|gray|grey|піксель|пиксель|мультикам|multicam|помаранчевий|оранжевый)\b/ig,'').replace(/\s+/g,' ').trim(); }

function generateKeywords(product){
  const name=norm(product.name);
  const base=typeOf(name);
  const brand=brandOf(name);
  const color=colorOf(name);
  const out=[];
  if(base) out.push(...base);
  const core=nameCore(name);
  const words=core.split(/\s+/).filter(Boolean);
  if(words.length>=2) out.push(words.slice(0,6).join(' '));
  if(base && brand) out.push(`${base[0]} ${brand}`);
  if(base && color) out.push(`${base[0]} ${color}`);
  if(/дем[іи]сезон/i.test(name) && /куртк/i.test(name)) out.push('демісезонна тактична куртка');
  if(!base){
    if(words.length) out.push(words.slice(0,5).join(' '));
    if(brand && words.length) out.push(`${words[0]} ${brand}`);
    out.push('тактичне спорядження');
  }
  let final=uniq(out).slice(0,7);
  if(final.length<3){ if(brand) final.push(`${brand} тактичний одяг`); final.push('тактичний одяг'); }
  return uniq(final).slice(0,7);
}

function kwCount(v){ return String(v||'').split(',').map(x=>x.trim()).filter(Boolean).length; }
function shouldUpdate(p,mode){ const n=kwCount(p.keywords); return mode==='all' ? true : mode==='weak' ? n<3 : n===0; }

function prom(method,path,body){
  if(!PROM_TOKEN) return Promise.reject(new Error('PROM_TOKEN is not configured'));
  return new Promise((resolve,reject)=>{
    const payload=body==null?null:JSON.stringify(body);
    const headers={'Authorization':`Bearer ${PROM_TOKEN}`,'Accept':'application/json','Content-Type':'application/json','X-LANGUAGE':'uk'};
    if(payload) headers['Content-Length']=Buffer.byteLength(payload);
    const req=https.request({hostname:'my.prom.ua',port:443,path:'/api/v1'+path,method,headers,timeout:45000},res=>{
      let raw=''; res.setEncoding('utf8'); res.on('data',c=>raw+=c); res.on('end',()=>{
        let data={}; try{data=raw?JSON.parse(raw):{}}catch{data={raw}};
        if(res.statusCode>=200&&res.statusCode<300) resolve(data);
        else { const e=new Error(`Prom API ${res.statusCode}: ${raw.slice(0,900)}`); e.statusCode=res.statusCode; e.data=data; reject(e); }
      });
    });
    req.on('timeout',()=>req.destroy(new Error('Prom API timeout'))); req.on('error',reject); if(payload) req.write(payload); req.end();
  });
}

async function getAllProducts(){
  const all=[]; let lastId=null; let guard=0;
  while(all.length<SEO_MAX_PRODUCTS && guard++<100){
    const limit=Math.min(100,SEO_MAX_PRODUCTS-all.length);
    const data=await prom('GET',`/products/list?limit=${limit}${lastId?`&last_id=${encodeURIComponent(lastId)}`:''}`);
    const products=Array.isArray(data.products)?data.products:[];
    if(!products.length) break;
    const known=new Set(all.map(p=>String(p.id))); let added=0;
    for(const p of products){ if(!known.has(String(p.id))){all.push(p);known.add(String(p.id));added++;} }
    const next=data.last_id || products[products.length-1]?.id;
    if(!next || String(next)===String(lastId) || !added) break;
    lastId=next; if(products.length<limit) break;
  }
  return all;
}

async function editBatch(edits){
  try { return await prom('POST','/products/edit',edits); }
  catch(e){ if(![400,422].includes(e.statusCode)) throw e; return prom('POST','/products/edit',{products:edits}); }
}

async function applyEdits(edits){
  const result={changed:0,failed:0,errors:[]};
  for(let i=0;i<edits.length;i+=50){
    const batch=edits.slice(i,i+50);
    try{ await editBatch(batch); result.changed+=batch.length; }
    catch{
      for(const item of batch){
        try{ await editBatch([item]); result.changed++; }
        catch(err){ result.failed++; result.errors.push({id:item.id,error:String(err.message||err).slice(0,400)}); }
      }
    }
  }
  return result;
}

async function preview(mode='missing'){
  const products=await getAllProducts(); const rows=[];
  for(const p of products){
    if(!shouldUpdate(p,mode)) continue;
    const keywords=generateKeywords(p); const next=keywords.join(', ');
    if(next && next!==norm(p.keywords)) rows.push({id:p.id,name:p.name,current_keywords:norm(p.keywords),keywords,keywords_string:next});
  }
  return {mode,total_products:products.length,to_update:rows.length,rows};
}

function verifyWrite(req){
  if(!WRITE_ENABLED){ const e=new Error('WRITE_ENABLED is not true'); e.statusCode=403; throw e; }
  if(WRITE_PIN){ const pin=String(req.headers['x-write-pin'] || req.body?.pin || ''); if(pin!==WRITE_PIN){ const e=new Error('Wrong WRITE_PIN'); e.statusCode=403; throw e; } }
}

let running=false, lastRun=null;
async function run(mode='missing'){
  if(running) return {skipped:true,reason:'already_running'};
  running=true;
  try{ const p=await preview(mode); const edits=p.rows.map(r=>({id:r.id,keywords:r.keywords_string})); const r=await applyEdits(edits); lastRun={at:new Date().toISOString(),mode,scanned:p.total_products,planned:edits.length,...r}; return lastRun; }
  finally{ running=false; }
}

function html(){ return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PrimeTac SEO</title><style>body{margin:0;background:#0d1110;color:#eef2ee;font-family:system-ui}.w{max-width:1100px;margin:auto;padding:18px}.c{background:#151b18;border:1px solid #29322d;border-radius:14px;padding:16px;margin:12px 0}.r{display:flex;gap:10px;flex-wrap:wrap;align-items:center}button,select,input{font:inherit;border-radius:10px;border:1px solid #344039;padding:11px 13px;background:#1e2722;color:#fff}button{cursor:pointer;background:#374c32;font-weight:700}.danger{background:#69322e}.muted{color:#94a098}.stat{font-size:28px;font-weight:800}.ok{color:#8bd37d}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:9px;border-bottom:1px solid #29322d;vertical-align:top}.kw{color:#c7d8a8}@media(max-width:700px){th:first-child,td:first-child{display:none}}</style></head><body><div class="w"><h1>🔎 PrimeTac SEO Manager</h1><div class="muted">Заполняет поисковые фразы Prom.ua. Цены, остатки, фото и описания не трогает.</div><div class="c"><div class="r"><select id="mode"><option value="missing">Только без ключевых фраз</option><option value="weak">Пустые + меньше 3</option><option value="all">Пересоздать всем</option></select><button onclick="check()">Проверить товары</button><input id="pin" type="password" placeholder="WRITE_PIN"><button class="danger" onclick="apply()">Применить</button></div><p class="muted">Первый запуск: оставь режим «Только без ключевых фраз».</p></div><div class="c"><div class="r"><div><div class="muted">Проверено</div><div id="total" class="stat">—</div></div><div><div class="muted">Будет обновлено</div><div id="upd" class="stat ok">—</div></div></div><pre id="msg" class="muted"></pre></div><div class="c" style="overflow:auto"><table><thead><tr><th>ID</th><th>Товар</th><th>Сейчас</th><th>Новые фразы</th></tr></thead><tbody id="tb"></tbody></table></div></div><script>let data=null;async function check(){msg.textContent='Загружаю товары Prom...';const r=await fetch('/api/seo-keywords/preview?mode='+mode.value);const d=await r.json();if(!r.ok){msg.textContent=d.error||'Ошибка';return}data=d;total.textContent=d.total_products;upd.textContent=d.to_update;msg.textContent='Предпросмотр готов. На Prom пока ничего не изменено.';tb.innerHTML='';d.rows.slice(0,250).forEach(x=>{const tr=document.createElement('tr');tr.innerHTML='<td>'+x.id+'</td><td></td><td></td><td class="kw"></td>';tr.children[1].textContent=x.name||'';tr.children[2].textContent=x.current_keywords||'—';tr.children[3].textContent=(x.keywords||[]).join(', ');tb.appendChild(tr)})}async function apply(){if(!data){alert('Сначала нажми Проверить товары');return}if(!confirm('Обновить '+data.to_update+' товаров?'))return;msg.textContent='Обновляю...';const r=await fetch('/api/seo-keywords/apply',{method:'POST',headers:{'Content-Type':'application/json','x-write-pin':pin.value},body:JSON.stringify({mode:mode.value,pin:pin.value})});const d=await r.json();msg.textContent=r.ok?'Готово. Изменено: '+d.changed+'; ошибок: '+d.failed+(d.errors?.length?'\n'+JSON.stringify(d.errors.slice(0,10),null,2):''):'Ошибка: '+(d.error||JSON.stringify(d));if(r.ok)await check()}</script></body></html>`; }

module.exports=function installPrimeTacSeo(app){
  if(!app?.get || !app?.post) throw new Error('Express app instance is required');
  app.get('/seo-keywords',(req,res)=>res.type('html').send(html()));
  app.get('/api/seo-keywords/status',(req,res)=>res.json({ok:true,prom_token:Boolean(PROM_TOKEN),write_enabled:WRITE_ENABLED,autorun:SEO_AUTORUN,autorun_mode:SEO_AUTORUN_MODE,interval_hours:SEO_INTERVAL_HOURS,running,last_run:lastRun}));
  app.get('/api/seo-keywords/preview',async(req,res)=>{try{const mode=['missing','weak','all'].includes(String(req.query.mode))?String(req.query.mode):'missing';res.json(await preview(mode));}catch(e){console.error('[SEO preview]',e);res.status(e.statusCode||500).json({error:e.message||String(e)});}});
  app.post('/api/seo-keywords/apply',async(req,res)=>{try{verifyWrite(req);if(running)return res.status(409).json({error:'SEO update already running'});const mode=['missing','weak','all'].includes(String(req.body?.mode))?String(req.body.mode):'missing';res.json(await run(mode));}catch(e){console.error('[SEO apply]',e);res.status(e.statusCode||500).json({error:e.message||String(e),data:e.data||null});}});
  if(SEO_AUTORUN){
    const task=()=>{if(!WRITE_ENABLED)return console.warn('[PrimeTac SEO] WRITE_ENABLED=false; autorun skipped');run(['missing','weak','all'].includes(SEO_AUTORUN_MODE)?SEO_AUTORUN_MODE:'missing').then(r=>console.log('[PrimeTac SEO] autorun',r)).catch(e=>console.error('[PrimeTac SEO] autorun error',e));};
    setTimeout(task,90000); setInterval(task,SEO_INTERVAL_HOURS*3600000);
  }
  console.log('[PrimeTac SEO] installed: /seo-keywords');
  return {generateKeywords,preview,run};
};
