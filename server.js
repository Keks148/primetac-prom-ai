import express from "express";
import { XMLParser } from "fast-xml-parser";

const app = express();
app.use(express.json({ limit: "3mb" }));
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const PROM_BASE = "https://my.prom.ua/api/v1";
const MILITARIS_XML_URL =
  process.env.MILITARIS_XML_URL ||
  "https://militaris.com.ua/content/export/04658108dda3987543769e4a63b496ca.xml";

let militarisCache = {
  loadedAt: null,
  items: [],
  bySku: new Map(),
  rawCount: 0,
  error: null
};

function requirePromToken(req, res, next) {
  if (!process.env.PROM_TOKEN) return res.status(500).json({ error: "PROM_TOKEN не задан" });
  next();
}

async function promRequest(path) {
  const r = await fetch(`${PROM_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.PROM_TOKEN}`,
      Accept: "application/json"
    }
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!r.ok) {
    const e = new Error(`Prom API: ${r.status}`);
    e.status = r.status;
    e.data = data;
    throw e;
  }
  return data;
}

function arr(v){ return v == null ? [] : (Array.isArray(v) ? v : [v]); }
function first(obj,names){
  if(!obj || typeof obj!=="object") return undefined;
  for(const name of names){
    if(obj[name]!=null) return obj[name];
    const k = Object.keys(obj).find(x=>x.toLowerCase()===name.toLowerCase());
    if(k && obj[k]!=null) return obj[k];
  }
}
function scalar(v){
  if(v==null) return "";
  if(typeof v==="string" || typeof v==="number") return String(v);
  if(typeof v==="object"){
    if(v["#text"]!=null) return String(v["#text"]);
    if(v["@_value"]!=null) return String(v["@_value"]);
  }
  return "";
}
function cleanNumber(v){
  const s=scalar(v).replace(/\s/g,"").replace(",",".");
  const m=s.match(/-?\d+(?:\.\d+)?/);
  return m?Number(m[0]):0;
}
function norm(s){
  return String(s||"").toLowerCase()
    .replace(/<[^>]*>/g," ")
    .replace(/&[a-z0-9#]+;/gi," ")
    .replace(/[^a-zа-яіїєґ0-9]+/gi," ")
    .replace(/\s+/g," ").trim();
}
function tok(s){
  return new Set(norm(s).split(" ").filter(x=>x.length>=3));
}
function overlap(a,b){
  const A=tok(a),B=tok(b);
  if(!A.size || !B.size) return 0;
  let inter=0;
  for(const x of A) if(B.has(x)) inter++;
  return inter / Math.max(A.size,B.size);
}
function exactish(a,b){
  const A=norm(a),B=norm(b);
  return A && B && (A===B || A.includes(B) || B.includes(A));
}
function brandDiscount(s){
  const n=norm(s);
  if(n.includes("salomon")) return 0.20;
  if(n.includes("helikon")) return 0.10;
  if(n.includes("lowa")) return 0.05;
  if(n.includes("belleville")) return 0.15;
  return 0.15;
}
function discountGroup(s){
  const n=norm(s);
  if(n.includes("salomon")) return "Salomon";
  if(n.includes("helikon")) return "Helikon-Tex";
  if(n.includes("lowa")) return "LOWA";
  if(n.includes("belleville")) return "Belleville";
  return "Остальные";
}
function walk(node,out=[]){
  if(!node || typeof node!=="object") return out;
  for(const [k,v] of Object.entries(node)){
    const kl=k.toLowerCase();
    if(["item","offer","product"].includes(kl)){
      for(const x of arr(v)) if(x && typeof x==="object") out.push(x);
    } else if(typeof v==="object") walk(v,out);
  }
  return out;
}
function normalizeItem(x){
  return {
    id: scalar(first(x,["id","g:id","offer_id","external_id","@_id"])),
    sku: scalar(first(x,["sku","vendorCode","g:mpn","article","articul","code"])),
    name: scalar(first(x,["name","title","g:title"])),
    brand: scalar(first(x,["brand","vendor","g:brand"])),
    url: scalar(first(x,["url","link","g:link"])),
    price: cleanNumber(first(x,["price","g:price","priceuah","price_ua"]))
  };
}
async function refreshMilitaris(){
  const r=await fetch(MILITARIS_XML_URL,{headers:{"User-Agent":"PrimeTacPromAI/4.0"}});
  if(!r.ok) throw new Error(`Militaris XML: HTTP ${r.status}`);
  const xml=await r.text();
  const parser=new XMLParser({
    ignoreAttributes:false,
    attributeNamePrefix:"@_",
    textNodeName:"#text",
    processEntities:true,
    trimValues:true
  });
  const raw=walk(parser.parse(xml));
  const items=raw.map(normalizeItem).filter(x=>(x.name||x.sku) && x.price>0);
  const bySku=new Map();
  for(const x of items){
    const s=norm(x.sku);
    if(s && s.length>=3){
      if(!bySku.has(s)) bySku.set(s,[]);
      bySku.get(s).push(x);
    }
  }
  militarisCache={loadedAt:new Date().toISOString(),items,bySku,rawCount:raw.length,error:null};
  return {loadedAt:militarisCache.loadedAt,count:items.length,rawCount:raw.length};
}
function promProducts(d){ return Array.isArray(d)?d:(Array.isArray(d?.products)?d.products:[]); }
async function fetchAllPromProducts(maxPages=30){
  const all=[]; let lastId=null;
  for(let p=0;p<maxPages;p++){
    const suffix=lastId?`&last_id=${encodeURIComponent(lastId)}`:"";
    const d=await promRequest(`/products/list?limit=100${suffix}`);
    const batch=promProducts(d);
    if(!batch.length) break;
    all.push(...batch);
    if(batch.length<100) break;
    const newLast=batch[batch.length-1]?.id;
    if(!newLast || String(newLast)===String(lastId)) break;
    lastId=newLast;
  }
  return all;
}
function detectBrandFromName(s){
  const n=norm(s);
  for(const b of ["salomon","helikon","lowa","belleville","snugpak","mil-tec","kiborg","ragnarok","mf h","mfh"]){
    if(n.includes(b)) return b;
  }
  return "";
}
function categoryWords(s){
  const n=norm(s);
  const groups = [
    ["футбол","t shirt","tee"],
    ["курт","jacket","parka"],
    ["бронеплит","plate"],
    ["брю","штани","pants","trousers"],
    ["рюкзак","backpack"],
    ["ботин","черев","boots","shoe","крос"],
    ["штурмовк","storm"],
    ["термокомплект","thermal"],
    ["плитоноск","plate carrier"],
    ["ремень","belt"],
    ["перчат","glove"],
    ["шап","beanie","hat"]
  ];
  const found=[];
  for(const g of groups){
    if(g.some(w=>n.includes(norm(w)))) found.push(g[0]);
  }
  return found;
}
function compatibleCategory(a,b){
  const A=categoryWords(a), B=categoryWords(b);
  if(!A.length || !B.length) return true;
  return A.some(x=>B.includes(x));
}
function priceRatioOkay(promPrice,supplierPrice){
  if(!promPrice || !supplierPrice) return true;
  const r = Math.max(promPrice,supplierPrice)/Math.min(promPrice,supplierPrice);
  return r <= 3.0;
}
function findMilitarisMatch(p){
  if(!militarisCache.items.length) return null;

  const pName=p.name||"";
  const pBrand=detectBrandFromName(pName);
  const pSkuCandidates=[p.external_id,p.sku,p.article,p.code].map(norm).filter(x=>x && x.length>=3);

  // SKU match only if name/category also make sense.
  for(const sku of pSkuCandidates){
    const list=militarisCache.bySku.get(sku)||[];
    for(const m of list){
      const nameScore=overlap(pName,m.name);
      const mBrand=detectBrandFromName(`${m.brand} ${m.name}`);
      const brandOk=!pBrand || !mBrand || pBrand===mBrand;
      const catOk=compatibleCategory(pName,m.name);
      const priceOk=priceRatioOkay(Number(p.price||0),m.price);
      if(brandOk && catOk && priceOk && (nameScore>=0.35 || exactish(pName,m.name))){
        return {item:m,method:"sku+name",confidence:Number(Math.max(nameScore,0.75).toFixed(3))};
      }
    }
  }

  // Strong name match only.
  let best=null, bestScore=0;
  for(const m of militarisCache.items){
    const mBrand=detectBrandFromName(`${m.brand} ${m.name}`);
    if(pBrand && mBrand && pBrand!==mBrand) continue;
    if(!compatibleCategory(pName,m.name)) continue;
    if(!priceRatioOkay(Number(p.price||0),m.price)) continue;

    const score=overlap(pName,m.name);
    const exact=exactish(pName,m.name);
    const finalScore=exact ? Math.max(score,0.90) : score;

    if(finalScore>bestScore){
      bestScore=finalScore;
      best=m;
    }
  }
  if(best && bestScore>=0.72){
    return {item:best,method:"name_strong",confidence:Number(bestScore.toFixed(3))};
  }

  return null;
}
function round2(v){ return Math.round(v*100)/100; }
function smartPrice(v){
  if(!Number.isFinite(v)||v<=0) return null;
  const n=Math.ceil(v);
  if(n<300) return Math.ceil(n/10)*10-1;
  if(n<1500) return Math.ceil(n/20)*20-1;
  if(n<5000) return Math.ceil(n/50)*50-1;
  return Math.ceil(n/100)*100-10;
}
function priceForMargin(buy,m){
  const x=m/100;
  if(!buy||x<=0||x>=1) return null;
  return smartPrice(buy/(1-x));
}
function metrics(p,match){
  const promPrice=Number(p.price||0);
  if(!match?.item?.price){
    return {
      matched:false,promPrice,supplierPrice:null,buyPrice:null,grossProfit:null,marginPct:null,
      discountPct:null,discountGroup:null,recommended20:null,flags:["Нет надёжного сопоставления"]
    };
  }
  const src=`${match.item.brand||""} ${match.item.name||""} ${p.name||""}`;
  const d=brandDiscount(src);
  const supplierPrice=Number(match.item.price);
  const buyPrice=supplierPrice*(1-d);
  const grossProfit=promPrice-buyPrice;
  const marginPct=promPrice?(grossProfit/promPrice)*100:null;
  const flags=[];
  if(match.method==="name_strong") flags.push("Проверить match");
  if(promPrice<buyPrice) flags.push("Цена ниже закупки");
  if(marginPct!=null && marginPct<10) flags.push("Маржа <10%");
  return {
    matched:true,
    promPrice,
    supplierPrice:round2(supplierPrice),
    buyPrice:round2(buyPrice),
    grossProfit:round2(grossProfit),
    marginPct:marginPct==null?null:Math.round(marginPct*10)/10,
    discountPct:Math.round(d*100),
    discountGroup:discountGroup(src),
    matchMethod:match.method,
    matchConfidence:match.confidence,
    supplierName:match.item.name,
    supplierBrand:match.item.brand||null,
    supplierSku:match.item.sku||null,
    supplierUrl:match.item.url||null,
    recommended20:priceForMargin(buyPrice,20),
    flags
  };
}
function decisionFor(x){
  if(!x.matched) return {decision:"unmatched",label:"Сопоставить вручную",score:0};
  const m=Number(x.marginPct||0), profit=Number(x.grossProfit||0), price=Number(x.promPrice||0);
  let decision="keep", label="Оставить цену";
  if(profit<=0 || m<10){ decision="raise"; label="Поднять цену"; }
  else if(m>=30){ decision="test_lower"; label="Можно тестировать снижение"; }
  const confidence=Number(x.matchConfidence||0);
  const score=Math.max(0,Math.round((Math.min(m,40)*2)+(Math.min(profit/100,30))+(confidence*20)-(x.matchMethod==="name_strong"?15:0)));
  return {decision,label,score};
}
function enrichReport(report){
  return report.map(x=>({...x,...decisionFor(x)}));
}
function summarize(report){
  const matched=report.filter(x=>x.matched);
  return {
    total:report.length,
    matched:matched.length,
    unmatched:report.length-matched.length,
    highMargin:matched.filter(x=>(x.marginPct??-999)>=20).length,
    lowMargin:matched.filter(x=>(x.marginPct??999)<10).length,
    loss:matched.filter(x=>(x.grossProfit??1)<=0).length,
    approximateMatches:matched.filter(x=>x.matchMethod==="name_strong").length,
    oneUnitGross:round2(matched.reduce((s,x)=>s+(x.grossProfit||0),0)),
    raisePrice:matched.filter(x=>x.decision==="raise").length,
    keepPrice:matched.filter(x=>x.decision==="keep").length,
    testLower:matched.filter(x=>x.decision==="test_lower").length
  };
}

app.get("/api/health",(req,res)=>{
  res.json({
    ok:true,
    promConfigured:Boolean(process.env.PROM_TOKEN),
    aiConfigured:Boolean(process.env.OPENAI_API_KEY),
    militaris:{loadedAt:militarisCache.loadedAt,count:militarisCache.items.length,error:militarisCache.error}
  });
});

app.post("/api/militaris/refresh",async(req,res)=>{
  try{ res.json({ok:true,...await refreshMilitaris()}); }
  catch(e){ militarisCache.error=e.message; res.status(500).json({error:e.message}); }
});

app.get("/api/catalog/report-all",requirePromToken,async(req,res)=>{
  try{
    if(!militarisCache.items.length) await refreshMilitaris();
    const products=await fetchAllPromProducts();
    const report=enrichReport(products.map(p=>{
      const match=findMilitarisMatch(p);
      return {
        product:{id:p.id,name:p.name,price:p.price,currency:p.currency||"UAH",external_id:p.external_id||null,sku:p.sku||p.article||p.code||null},
        ...metrics(p,match)
      };
    }));
    res.json({loadedAt:militarisCache.loadedAt,summary:summarize(report),report});
  }catch(e){
    res.status(e.status||500).json({error:e.message,details:e.data||null});
  }
});

app.get("/api/orders/analytics",requirePromToken,async(req,res)=>{
  try{
    if(!militarisCache.items.length) await refreshMilitaris();
    const products=enrichReport((await fetchAllPromProducts()).map(p=>({product:{id:p.id,name:p.name,price:p.price,currency:p.currency||"UAH",external_id:p.external_id||null,sku:p.sku||p.article||p.code||null},...metrics(p,findMilitarisMatch(p))})));
    const byId=new Map(products.map(x=>[String(x.product.id),x]));
    const od=await promRequest("/orders/list?limit=100");
    const orders=Array.isArray(od)?od:(Array.isArray(od?.orders)?od.orders:[]);
    let revenue=0, estimatedGross=0, units=0, matchedUnits=0;
    const productSales=new Map();
    for(const o of orders){
      const ps=Array.isArray(o.products)?o.products:[];
      for(const op of ps){
        const qty=Number(op.quantity||1); const sale=Number(op.price||0)*qty; units+=qty; revenue+=sale;
        const x=byId.get(String(op.id||op.product_id||""));
        if(x?.matched){ matchedUnits+=qty; estimatedGross+=(Number(op.price||x.promPrice)-Number(x.buyPrice||0))*qty; }
        const key=String(op.id||op.product_id||op.name||"unknown");
        const cur=productSales.get(key)||{name:op.name||x?.product?.name||key,qty:0,revenue:0,estimatedGross:0,matched:Boolean(x?.matched)};
        cur.qty+=qty;cur.revenue+=sale;if(x?.matched)cur.estimatedGross+=(Number(op.price||x.promPrice)-Number(x.buyPrice||0))*qty;productSales.set(key,cur);
      }
    }
    res.json({orders:orders.length,units,revenue:round2(revenue),estimatedGross:round2(estimatedGross),matchedUnits,top:[...productSales.values()].sort((a,b)=>b.estimatedGross-a.estimatedGross||b.revenue-a.revenue).slice(0,30)});
  }catch(e){res.status(e.status||500).json({error:e.message,details:e.data||null});}
});

app.get("/api/orders",requirePromToken,async(req,res)=>{
  try{ res.json(await promRequest("/orders/list")); }
  catch(e){ res.status(e.status||500).json({error:e.message,details:e.data||null}); }
});

app.post("/api/analyze",async(req,res)=>{
  try{
    if(!process.env.OPENAI_API_KEY) return res.status(400).json({error:"OPENAI_API_KEY не задан"});
    const model=process.env.OPENAI_MODEL||"gpt-5-mini";
    const payload=req.body||{};
    const prompt=`
Ты аналитик PrimeTac Group.
Используй только переданные данные.
Если matched=false — закупку и маржу не придумывай.
Если matchMethod=name_strong — обязательно отметь, что совпадение нужно проверить вручную.
Не придумывай цены конкурентов и спрос.

Ответ:
1) текущая прибыль/маржа;
2) безопасна ли цена;
3) техническая цена для ~20% валовой маржи;
4) стоит ли товар рассматривать для продвижения;
5) риск сопоставления;
6) улучшенное украинское название.

Данные:
${JSON.stringify(payload,null,2)}
`.trim();

    const r=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify({model,input:prompt})
    });
    const data=await r.json();
    if(!r.ok) return res.status(r.status).json({error:"OpenAI API error",details:data});
    const text=data.output_text ||
      (data.output||[]).flatMap(i=>i.content||[]).filter(c=>c.type==="output_text").map(c=>c.text).join("\n") ||
      "Нет текста.";
    res.json({text});
  }catch(e){res.status(500).json({error:e.message});}
});

app.listen(PORT,"0.0.0.0",()=>console.log(`PrimeTac Prom AI v4 running on ${PORT}`));
