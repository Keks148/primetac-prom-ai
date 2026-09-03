
'use strict';
const express=require('express');
const https=require('https');
const app=express();
app.use(express.json({limit:'1mb'}));

const PORT=Number(process.env.PORT||3000);
const PROM_TOKEN=String(process.env.PROM_TOKEN||'').trim();
const WRITE_ENABLED=String(process.env.WRITE_ENABLED||'').toLowerCase()==='true';
const SEO_AUTORUN=String(process.env.SEO_AUTORUN||'true').toLowerCase()!=='false';
const SEO_INTERVAL_HOURS=Math.max(1,Number(process.env.SEO_INTERVAL_HOURS||6));
const SEO_MIN_KEYWORDS=Math.max(3,Math.min(7,Number(process.env.SEO_MIN_KEYWORDS||5)));
const SEO_MAX_PRODUCTS=Math.max(100,Number(process.env.SEO_MAX_PRODUCTS||5000));

let running=false,lastRun=null,lastScan=null;

function norm(v){return String(v||'').replace(/\s+/g,' ').trim()}
function parseKeywords(v){
  if(Array.isArray(v)) return v.flatMap(parseKeywords).filter(Boolean);
  if(typeof v!=='string') return [];
  return v.split(/[,;\n]/u).map(x=>x.trim()).filter(Boolean);
}
function uniq(arr){
  const seen=new Set(),out=[];
  for(const x of arr){
    const s=norm(x).replace(/[#!?]/g,'');
    if(!s) continue;
    const k=s.toLowerCase();
    if(seen.has(k)) continue;
    if(k.split(/\s+/).length>7) continue;
    seen.add(k); out.push(s);
  }
  return out;
}

const RULES=[
[/\b(куртка|ветровка|вітровка|парка|анорак|jacket)\b/i,['тактична куртка','чоловіча тактична куртка','військова куртка']],
[/\b(фліс|флис|фліска|флиска|fleece)\b/i,['тактична фліска','флісова кофта чоловіча','військова фліска']],
[/\b(штани|брюки|pants|джогери|джоггеры)\b/i,['тактичні штани','чоловічі тактичні штани','військові штани']],
[/\b(футболка|t-shirt|tshirt)\b/i,['тактична футболка','чоловіча тактична футболка','військова футболка']],
[/\b(поло|polo)\b/i,['тактичне поло','чоловіче поло','військове поло']],
[/\b(худі|худи|hoodie)\b/i,['тактичне худі','чоловіче тактичне худі','військове худі']],
[/\b(кофта|світшот|свитшот|светр|свитер)\b/i,['тактична кофта','чоловіча кофта','військова кофта']],
[/\b(сорочка|рубашка|ubacs|combat shirt)\b/i,['тактична сорочка','військова сорочка','сорочка UBACS']],
[/\b(шорти|шорты|shorts)\b/i,['тактичні шорти','чоловічі тактичні шорти','військові шорти']],
[/\b(термобілизна|термобелье|термокомплект)\b/i,['тактична термобілизна','чоловіча термобілизна','військова термобілизна']],
[/\b(кепка|бейсболка|cap)\b/i,['тактична кепка','військова кепка','чоловіча кепка']],
[/\b(панама|boonie)\b/i,['тактична панама','військова панама','панама тактична']],
[/\b(балаклава|підшоломник|подшлемник)\b/i,['тактична балаклава','військова балаклава','підшоломник тактичний']],
[/\b(рукавички|перчатки|gloves)\b/i,['тактичні рукавички','військові рукавички','рукавички для військових']],
[/\b(кросівки|кроссовки|sneakers)\b/i,['тактичні кросівки','військові кросівки','чоловічі тактичні кросівки']],
[/\b(черевики|ботинки|берці|берцы|boots)\b/i,['тактичні черевики','військові черевики','берці тактичні']],
[/\b(рюкзак|backpack)\b/i,['тактичний рюкзак','військовий рюкзак','рюкзак MOLLE']],
[/\b(сумка|баул)\b/i,['тактична сумка','військова сумка','сумка для спорядження']],
[/\b(пончо|дощовик|дождевик)\b/i,['тактичне пончо','пончо дощовик','військовий дощовик']],
[/\b(ремінь|ремень|belt)\b/i,['тактичний ремінь','військовий ремінь','чоловічий тактичний ремінь']],
[/\b(підсумок|подсумок|pouch)\b/i,['тактичний підсумок','військовий підсумок','підсумок MOLLE']],
[/\b(плитоноска|plate carrier)\b/i,['тактична плитоноска','військова плитоноска','плитоноска MOLLE']],
[/\b(бронежилет)\b/i,['тактичний бронежилет','військовий бронежилет','бронежилет MOLLE']],
[/\b(бронеплита|бронепластина)\b/i,['бронеплита','бронеплита для бронежилета','військова бронеплита']],
[/\b(шолом|шлем|helmet)\b/i,['тактичний шолом','військовий шолом','шолом для військових']]
];

const BRANDS=['BEZET','YINREN','Kiborg','Helikon-Tex','Helikon','Salomon','LOWA','Belleville','M-Tac','Mil-Tec','Pentagon','Propper'];
const COLORS=[['чорн','чорний'],['черн','чорний'],['black','чорний'],['хакі','хакі'],['хаки','хакі'],['khaki','хакі'],['койот','койот'],['coyote','койот'],['tan','койот'],['олив','олива'],['olive','олива'],['foliage green','foliage green'],['сір','сірий'],['сер','сірий'],['gray','сірий'],['grey','сірий'],['мультикам','мультикам'],['multicam','мультикам'],['помаранч','помаранчевий'],['оранж','помаранчевий']];

function typeRule(name){return RULES.find(([re])=>re.test(name))}
function brand(name){const l=name.toLowerCase();return BRANDS.find(b=>l.includes(b.toLowerCase()))||''}
function color(name){const l=name.toLowerCase();const hit=COLORS.find(([n])=>l.includes(n));return hit?hit[1]:''}

function generated(product){
  const name=norm(product.name),r=typeRule(name),b=brand(name),c=color(name),out=[];
  if(r) out.push(...r[1]);
  const words=name.split(/\s+/).filter(Boolean);
  if(words.length>=2) out.push(words.slice(0,6).join(' '));
  if(r&&b) out.push(`${r[1][0]} ${b}`);
  if(r&&c) out.push(`${r[1][0]} ${c}`);
  if(/дем[іи]сезон/i.test(name)&&/куртк/i.test(name)) out.push('демісезонна тактична куртка');
  if(/зим/i.test(name)&&/куртк/i.test(name)) out.push('зимова тактична куртка');
  if(!r){ if(b) out.push(`${words[0]||''} ${b}`); out.push('тактичне спорядження'); }
  return uniq(out);
}

function merged(product){
  const existing=parseKeywords(product.keywords);
  return {existing, merged:uniq([...existing,...generated(product)]).slice(0,7)};
}

function reqProm(method,path,body=null){
  if(!PROM_TOKEN) return Promise.reject(new Error('PROM_TOKEN не задан'));
  return new Promise((resolve,reject)=>{
    const payload=body===null?null:JSON.stringify(body);
    const headers={'Authorization':`Bearer ${PROM_TOKEN}`,'Accept':'application/json','Content-Type':'application/json','X-LANGUAGE':'uk'};
    if(payload) headers['Content-Length']=Buffer.byteLength(payload);
    const rq=https.request({hostname:'my.prom.ua',port:443,path:'/api/v1'+path,method,headers,timeout:45000},rs=>{
      let raw=''; rs.setEncoding('utf8'); rs.on('data',c=>raw+=c); rs.on('end',()=>{
        let data={}; try{data=raw?JSON.parse(raw):{}}catch{data={raw}}
        if(rs.statusCode>=200&&rs.statusCode<300) return resolve(data);
        const e=new Error(`Prom API ${rs.statusCode}: ${raw.slice(0,1000)}`); e.data=data; reject(e);
      });
    });
    rq.on('timeout',()=>rq.destroy(new Error('Prom API timeout'))); rq.on('error',reject);
    if(payload) rq.write(payload); rq.end();
  });
}

async function loadAll(){
  const all=[],seen=new Set(); let last=null;
  while(all.length<SEO_MAX_PRODUCTS){
    const lim=Math.min(100,SEO_MAX_PRODUCTS-all.length);
    const d=await reqProm('GET',`/products/list?limit=${lim}${last?`&last_id=${last}`:''}`);
    const batch=Array.isArray(d.products)?d.products:[];
    if(!batch.length) break;
    let added=0;
    for(const p of batch){const id=String(p.id);if(!seen.has(id)){seen.add(id);all.push(p);added++}}
    const next=d.last_id||batch[batch.length-1]?.id;
    if(!next||String(next)===String(last)||!added) break;
    last=next;
    if(batch.length<lim) break;
  }
  return all;
}

async function scan(){
  const products=await loadAll(),rows=[]; let good=0;
  for(const p of products){
    const m=merged(p);
    if(m.existing.length>=SEO_MIN_KEYWORDS){good++;continue}
    rows.push({id:p.id,name:p.name,before:m.existing,after:m.merged});
  }
  lastScan={at:new Date().toISOString(),total:products.length,good,weak:rows.length,min:SEO_MIN_KEYWORDS};
  return {...lastScan,rows};
}

async function edit(items){
  const d=await reqProm('POST','/products/edit',items);
  if(d&&d.errors&&Object.keys(d.errors).length){const e=new Error('Prom вернул errors');e.data=d;throw e}
  return d;
}

async function apply(edits){
  let sent=0,failed=0; const errors=[];
  for(let i=0;i<edits.length;i+=50){
    const batch=edits.slice(i,i+50);
    try{await edit(batch);sent+=batch.length}
    catch{
      for(const x of batch){
        try{await edit([x]);sent++}
        catch(e){failed++;errors.push({id:x.id,error:String(e.message||e).slice(0,300)})}
      }
    }
  }
  return {sent,failed,errors};
}

async function run(source='manual'){
  if(running) return {skipped:true};
  if(!WRITE_ENABLED) throw new Error('WRITE_ENABLED=false');
  running=true;
  try{
    const before=await scan();
    const edits=before.rows.map(x=>({id:Number(x.id),keywords:x.after.join(', ').slice(0,1024)}));
    const a=await apply(edits);
    await new Promise(r=>setTimeout(r,1500));
    const after=await scan();
    lastRun={at:new Date().toISOString(),source,before_weak:before.weak,planned:edits.length,sent:a.sent,failed:a.failed,after_weak:after.weak,verified_improved:Math.max(0,before.weak-after.weak),errors:a.errors};
    return lastRun;
  }finally{running=false}
}

const html=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PrimeTac SEO v1.3</title><style>
body{margin:0;background:#0c100e;color:#eef4ef;font-family:system-ui}.w{max-width:1000px;margin:auto;padding:16px}.c{background:#151b18;border:1px solid #2b352f;border-radius:14px;padding:14px;margin:11px 0}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.s{background:#101511;border:1px solid #2b352f;border-radius:12px;padding:12px}.n{font-size:28px;font-weight:800}.m{color:#9aa49d;font-size:12px}.ok{color:#8fd37c}.wa{color:#e4be6a}button{padding:11px 14px;border-radius:10px;border:1px solid #405148;background:#294428;color:#fff;font-weight:700;margin-right:8px}table{width:100%;border-collapse:collapse;font-size:12px}td,th{padding:8px;border-bottom:1px solid #2b352f;text-align:left;vertical-align:top}.a{color:#cbe2af}pre{white-space:pre-wrap;font-size:12px}@media(max-width:700px){.g{grid-template-columns:1fr 1fr}table{font-size:10px}}
</style></head><body><div class="w"><h2>🔎 PrimeTac SEO Auto <span class="m">v1.3</span></h2><div class="m">Сохраняет существующие keywords и добавляет релевантные фразы до 5–7. Цены и карточки не трогает.</div>
<div class="g c"><div class="s"><div class="m">Всего</div><div id="t" class="n">—</div></div><div class="s"><div class="m">Нормально</div><div id="g" class="n ok">—</div></div><div class="s"><div class="m">Нужно дополнить</div><div id="w" class="n wa">—</div></div></div>
<div class="c"><button onclick="scan()">Проверить</button><button onclick="run()">Дополнить ключи</button><pre id="log">Готово.</pre></div>
<div class="c" style="overflow:auto"><table><thead><tr><th>Товар</th><th>Сейчас</th><th>После</th></tr></thead><tbody id="rows"></tbody></table></div></div>
<script>
const E=id=>document.getElementById(id);async function A(u,o){const r=await fetch(u,o),d=await r.json();if(!r.ok)throw new Error(d.error||JSON.stringify(d));return d}
async function scan(){E('log').textContent='Проверяю...';try{const d=await A('/api/scan');E('t').textContent=d.total;E('g').textContent=d.good;E('w').textContent=d.weak;E('rows').innerHTML='';d.rows.slice(0,200).forEach(x=>{const tr=document.createElement('tr');tr.innerHTML='<td></td><td></td><td class="a"></td>';tr.children[0].textContent=x.name;tr.children[1].textContent=x.before.join(', ')||'—';tr.children[2].textContent=x.after.join(', ');E('rows').appendChild(tr)});E('log').textContent='Нужно дополнить: '+d.weak+'. Ничего не изменено.'}catch(e){E('log').textContent='Ошибка: '+e.message}}
async function run(){if(!confirm('Дополнить ключевые фразы?'))return;E('log').textContent='Записываю и перепроверяю...';try{const d=await A('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});E('log').textContent='До: '+d.before_weak+'\\nОтправлено: '+d.sent+'\\nПодтверждено улучшено: '+d.verified_improved+'\\nОсталось: '+d.after_weak+'\\nОшибок: '+d.failed;await scan()}catch(e){E('log').textContent='Ошибка: '+e.message}}
scan();
</script></body></html>`;

app.get('/',(_,res)=>res.type('html').send(html));
app.get('/api/scan',async(_,res)=>{try{res.json(await scan())}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/run',async(_,res)=>{try{res.json(await run('manual'))}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/status',(_,res)=>res.json({prom:Boolean(PROM_TOKEN),write:WRITE_ENABLED,autorun:SEO_AUTORUN,running,lastRun,lastScan}));

if(SEO_AUTORUN){
  const task=()=>run('auto').catch(e=>console.error(e));
  setTimeout(task,60000);
  setInterval(task,SEO_INTERVAL_HOURS*3600000);
}
app.listen(PORT,()=>console.log('PrimeTac SEO v1.3 on '+PORT));
