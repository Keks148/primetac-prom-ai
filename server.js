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

const WRITE_ENABLED = String(process.env.WRITE_ENABLED || "false").toLowerCase() === "true";
const WRITE_PIN = process.env.WRITE_PIN || "";
const OPENAI_WEB_MODEL = process.env.OPENAI_WEB_MODEL || "gpt-4.1-mini";
const SELF_PROM_DOMAIN = process.env.SELF_PROM_DOMAIN || "cs4221574.prom.ua";

let militarisCache = {
  loadedAt: null,
  items: [],
  bySku: new Map(),
  rawCount: 0,
  error: null
};

let catalogCache = {
  loadedAt: null,
  report: [],
  summary: null
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
    description: scalar(first(x,["description","g:description","desc","full_description"])),
    price: cleanNumber(first(x,["price","g:price","priceuah","price_ua"]))
  };
}
async function refreshMilitaris(){
  const r=await fetch(MILITARIS_XML_URL,{headers:{"User-Agent":"PrimeTacPromAI/7.0"}});
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
  catalogCache={loadedAt:null,report:[],summary:null};
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
    supplierDescription:match.item.description||null,
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

async function getCatalogReport(force=false){
  if(!force && catalogCache.report.length) return catalogCache;
  if(!militarisCache.items.length) await refreshMilitaris();

  const products=await fetchAllPromProducts();
  const report=enrichReport(products.map(p=>{
    const match=findMilitarisMatch(p);
    return {
      product:{
        id:p.id,
        name:p.name,
        price:p.price,
        currency:p.currency||"UAH",
        external_id:p.external_id||null,
        sku:p.sku||p.article||p.code||null,
        description:p.description||"",
        keywords:p.keywords||"",
        category:p.category_name||p.category||""
      },
      ...metrics(p,match)
    };
  }));

  catalogCache={
    loadedAt:new Date().toISOString(),
    report,
    summary:summarize(report)
  };
  return catalogCache;
}

function orderArray(data){
  return Array.isArray(data)?data:(Array.isArray(data?.orders)?data.orders:[]);
}

function getOrderItems(order){
  if(!order || typeof order!=="object") return [];
  for(const key of ["products","items","order_products","products_data"]){
    if(Array.isArray(order[key])) return order[key];
  }
  return [];
}

function itemName(item){
  return scalar(first(item,["name","product_name","title"])) ||
    scalar(first(item?.product||{},["name","title"]));
}

function itemQty(item){
  return cleanNumber(first(item,["quantity","qty","count"])) || 1;
}

function itemPrice(item){
  return cleanNumber(first(item,["price","unit_price","price_with_discount","final_price","sale_price"]));
}

function buildCatalogLookups(report){
  const byId=new Map();
  const byExternal=new Map();
  const bySku=new Map();
  const byName=new Map();

  for(const x of report){
    if(x?.product?.id!=null) byId.set(String(x.product.id),x);
    if(x?.product?.external_id) byExternal.set(norm(x.product.external_id),x);
    if(x?.product?.sku) bySku.set(norm(x.product.sku),x);
    if(x?.product?.name) byName.set(norm(x.product.name),x);
  }
  return {byId,byExternal,bySku,byName};
}

function resolveOrderItem(item,lookups){
  const ids=[
    first(item,["product_id","id"]),
    first(item?.product||{},["id","product_id"])
  ].filter(v=>v!=null).map(String);

  for(const id of ids){
    if(lookups.byId.has(id)) return lookups.byId.get(id);
  }

  const external=[
    first(item,["external_id","product_external_id"]),
    first(item?.product||{},["external_id"])
  ].map(scalar).map(norm).filter(Boolean);

  for(const v of external){
    if(lookups.byExternal.has(v)) return lookups.byExternal.get(v);
  }

  const skus=[
    first(item,["sku","article","code"]),
    first(item?.product||{},["sku","article","code"])
  ].map(scalar).map(norm).filter(Boolean);

  for(const v of skus){
    if(lookups.bySku.has(v)) return lookups.bySku.get(v);
  }

  const name=norm(itemName(item));
  if(name && lookups.byName.has(name)) return lookups.byName.get(name);

  return null;
}

async function hydrateOrders(orders){
  const result=[];
  const batchSize=5;

  for(let i=0;i<orders.length;i+=batchSize){
    const slice=orders.slice(i,i+batchSize);
    const hydrated=await Promise.all(slice.map(async o=>{
      if(getOrderItems(o).length || !o?.id) return o;
      try{
        const detail=await promRequest(`/orders/${encodeURIComponent(o.id)}`);
        return detail?.order || detail || o;
      }catch{
        return o;
      }
    }));
    result.push(...hydrated);
  }
  return result;
}

function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }

function adStatusFromMarket(x, market){
  if(!x?.matched || !x?.buyPrice){
    return {color:"red",label:"НЕ РЕКЛАМИРОВАТЬ",reason:"Нет надёжной закупочной цены",score:0};
  }
  const margin=Number(market?.expectedMargin ?? x.marginPct ?? 0);
  const competitorCount=(market?.competitors||[]).filter(c=>c.match==="exact").length;
  const recommended=Number(market?.recommendedPrice||0);
  const current=Number(x.promPrice||0);
  const profit=Number(market?.expectedProfit ?? x.grossProfit ?? 0);
  const competitive=market?.competitive;
  let score=0;
  score += clamp(margin,0,35)*2.0;
  score += clamp(profit/100,0,20);
  score += clamp(competitorCount*2,0,10);
  if(competitive===false) score-=25;
  if(margin<10) score-=30;
  if(profit<100) score-=10;
  if(recommended && current && recommended>current*1.25) score-=10;
  score=Math.round(clamp(score,0,100));
  if(competitive===true && margin>=15 && profit>=150 && competitorCount>=2){
    return {color:"green",label:"РЕКЛАМИРОВАТЬ",reason:"Конкурентная цена и нормальная прибыль",score};
  }
  if(margin>=10 && profit>0){
    return {color:"yellow",label:"ОСТАВИТЬ ОРГАНИЧЕСКИ",reason:competitive===false?"При безопасной марже цена выше основной части рынка":"Маржа/прибыль средняя — реклама под вопросом",score};
  }
  return {color:"red",label:"НЕ РЕКЛАМИРОВАТЬ",reason:"Слишком низкая маржа или слабая конкурентоспособность",score};
}

function preAdScore(x){
  if(!x?.matched) return 0;
  let score=0;
  const m=Number(x.marginPct||0);
  const p=Number(x.grossProfit||0);
  score += clamp(m,0,35)*1.8;
  score += clamp(p/100,0,25);
  if(x.matchMethod==="sku+name") score+=8;
  if(x.matchMethod==="name_strong") score-=5;
  return Math.round(clamp(score,0,100));
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
    const d=await getCatalogReport(true);
    res.json({loadedAt:d.loadedAt,summary:d.summary,report:d.report});
  }catch(e){
    res.status(e.status||500).json({error:e.message,details:e.data||null});
  }
});

app.get("/api/orders/analytics",requirePromToken,async(req,res)=>{
  try{
    // Главное исправление v4.1: используем готовый кэш каталога,
    // а не пересчитываем все 1144 × 7993 сопоставления при каждом клике «Продажи».
    const catalog=await getCatalogReport(false);
    const lookups=buildCatalogLookups(catalog.report);

    const raw=await promRequest("/orders/list?limit=100");
    const baseOrders=orderArray(raw);
    const orders=await hydrateOrders(baseOrders);

    let revenue=0;
    let estimatedGross=0;
    let units=0;
    let matchedUnits=0;
    let ordersWithItems=0;

    const productSales=new Map();

    for(const o of orders){
      const items=getOrderItems(o);
      if(items.length) ordersWithItems++;

      let orderLinesRevenue=0;

      for(const op of items){
        const qty=itemQty(op);
        const x=resolveOrderItem(op,lookups);
        let unitPrice=itemPrice(op);

        if(!unitPrice && x?.promPrice) unitPrice=Number(x.promPrice);
        const sale=unitPrice*qty;

        units+=qty;
        revenue+=sale;
        orderLinesRevenue+=sale;

        let lineGross=0;
        if(x?.matched){
          matchedUnits+=qty;
          lineGross=(unitPrice-Number(x.buyPrice||0))*qty;
          estimatedGross+=lineGross;
        }

        const key=String(
          first(op,["product_id","id"]) ||
          first(op?.product||{},["id"]) ||
          itemName(op) ||
          "unknown"
        );

        const cur=productSales.get(key)||{
          name:itemName(op)||x?.product?.name||key,
          qty:0,
          revenue:0,
          estimatedGross:0,
          matched:Boolean(x?.matched)
        };

        cur.qty+=qty;
        cur.revenue+=sale;
        cur.estimatedGross+=lineGross;
        cur.matched=cur.matched||Boolean(x?.matched);
        productSales.set(key,cur);
      }

      // Если API списка/деталей заказа не отдал товарные строки,
      // всё равно учитываем сумму заказа в обороте, но не выдумываем прибыль.
      if(!items.length){
        const total=cleanNumber(first(o,[
          "full_price","total_price","price","amount","total","payment_amount"
        ]));
        revenue+=total;
      }
    }

    res.json({
      orders:orders.length,
      ordersWithItems,
      units,
      revenue:round2(revenue),
      estimatedGross:round2(estimatedGross),
      matchedUnits,
      catalogCachedAt:catalog.loadedAt,
      note:"Расчёт по последним 100 заказам Prom. Прибыль считается только по товарным строкам, которые удалось сопоставить с каталогом.",
      top:[...productSales.values()]
        .sort((a,b)=>b.estimatedGross-a.estimatedGross||b.revenue-a.revenue)
        .slice(0,30)
    });
  }catch(e){
    res.status(e.status||500).json({error:e.message,details:e.data||null});
  }
});

app.get("/api/orders",requirePromToken,async(req,res)=>{
  try{ res.json(await promRequest("/orders/list")); }
  catch(e){ res.status(e.status||500).json({error:e.message,details:e.data||null}); }
});

function requireWritePin(req,res,next){
  if(!WRITE_ENABLED){
    return res.status(403).json({error:"WRITE_ENABLED=false. Запись в Prom отключена."});
  }
  if(!WRITE_PIN){
    return res.status(500).json({error:"WRITE_PIN не задан в Render Environment."});
  }
  const pin=String(req.headers["x-write-pin"]||"");
  if(pin!==WRITE_PIN){
    return res.status(401).json({error:"Неверный WRITE_PIN"});
  }
  next();
}

async function currentCatalogItem(productId){
  const data=await getCatalogReport(false);
  return data.report.find(x=>String(x?.product?.id)===String(productId))||null;
}

async function promEditProduct(payload){
  // Документация Prom подтверждает POST /products/edit.
  // В этой версии отправляем массив изменяемых товаров.
  const r=await fetch(`${PROM_BASE}/products/edit`,{
    method:"POST",
    headers:{
      Authorization:`Bearer ${process.env.PROM_TOKEN}`,
      Accept:"application/json",
      "Content-Type":"application/json"
    },
    body:JSON.stringify([payload])
  });
  const text=await r.text();
  let data;
  try{data=JSON.parse(text)}catch{data={raw:text}}
  if(!r.ok){
    const e=new Error(`Prom edit API: ${r.status}`);
    e.status=r.status;
    e.data=data;
    throw e;
  }
  return data;
}

function decodeBasicEntities(s){
  return String(s||"")
    .replace(/&lt;/gi,"<")
    .replace(/&gt;/gi,">")
    .replace(/&quot;/gi,'"')
    .replace(/&#39;/gi,"'")
    .replace(/&amp;/gi,"&");
}

function cleanHtmlText(s){
  let out=decodeBasicEntities(String(s||""))
    .replace(/```html/gi,"")
    .replace(/```/g,"")
    .replace(/<script[\s\S]*?<\/script>/gi,"")
    .replace(/<style[\s\S]*?<\/style>/gi,"")
    .trim();

  // Оставляем только безопасные простые теги для карточки товара.
  out=out.replace(/<(?!\/?(?:p|ul|li|strong|br)\b)[^>]*>/gi,"");
  return out;
}

function stripHtml(s){
  return decodeBasicEntities(String(s||""))
    .replace(/<[^>]+>/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function parseJsonText(text){
  const raw=String(text||"").trim()
    .replace(/^```json\s*/i,"")
    .replace(/^```\s*/,"")
    .replace(/\s*```$/,"");
  try{return JSON.parse(raw)}catch{}
  const start=raw.indexOf("{"), end=raw.lastIndexOf("}");
  if(start>=0 && end>start){
    try{return JSON.parse(raw.slice(start,end+1))}catch{}
  }
  return null;
}

function median(nums){
  const a=[...nums].sort((x,y)=>x-y);
  if(!a.length) return null;
  const m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
}

function lowerQuartile(nums){
  const a=[...nums].sort((x,y)=>x-y);
  if(!a.length) return null;
  const idx=Math.max(0,Math.floor((a.length-1)*0.25));
  return a[idx];
}

app.post("/api/editor/propose",requirePromToken,async(req,res)=>{
  try{
    const productId=req.body?.productId;
    if(!productId) return res.status(400).json({error:"productId обязателен"});

    const x=await currentCatalogItem(productId);
    if(!x) return res.status(404).json({error:"Товар не найден. Сначала нажми «Анализ всего каталога»."});

    const targetMargin=Math.max(5,Math.min(Number(req.body?.targetMargin||20),50));
    const changePrice=req.body?.changePrice!==false;
    const changeDescription=req.body?.changeDescription!==false;
    const changeName=req.body?.changeName!==false;

    let proposedPrice=null;
    if(changePrice && x.matched && x.buyPrice){
      proposedPrice=priceForMargin(Number(x.buyPrice),targetMargin);
    }

    let proposedDescription=null;
    let proposedName=null;

    if(changeDescription || changeName){
      if(!process.env.OPENAI_API_KEY){
        return res.status(400).json({error:"OPENAI_API_KEY не задан"});
      }

      const model=process.env.OPENAI_MODEL||"gpt-5-mini";
      const prompt=`
Ты редактор карточек украинского магазина PrimeTac Group на Prom.ua.

Нужно вернуть ТОЛЬКО JSON:
{
  "name": "новое название на украинском",
  "description": "HTML-описание"
}

Правила:
- Используй ТОЛЬКО факты, которые буквально или однозначно присутствуют в SOURCE FACTS ниже.
- Для технических характеристик единственный источник истины — supplierDescription из XML Militaris.
- ЗАПРЕЩЕНО выводить характеристики из названия товара, категории или общих знаний о похожих товарах.
- Любой конкретный материал, процент состава, технология, мембрана, класс защиты, плотность, размер, страна, комплектность или особенность конструкции разрешены ТОЛЬКО если они явно есть в SOURCE FACTS.
- Если технических фактов мало, делай короткое аккуратное описание без характеристик вместо догадок.
- Название: понятное, поисковое, без спама; бренд + модель + тип товара + цвет только если это реально указано.
- Описание: украинский язык. При малом количестве фактов 250–700 символов, при достаточном 700–1600.
- HTML: только <p>, <ul>, <li>, <strong>, <br>.
- Не пиши «даних немає», «надайте інформацію», «уточніть».
- Не добавляй цену.

SOURCE FACTS:
${JSON.stringify({
  promName:x.product.name,
  supplierName:x.supplierName||"",
  supplierBrand:x.supplierBrand||"",
  supplierDescription:stripHtml(x.supplierDescription||"")
},null,2)}

ВАЖНО:
- promName можно использовать только как идентификатор модели/цвета.
- Технические характеристики разрешены ТОЛЬКО из supplierDescription.
- Если supplierDescription пустое или почти пустое, НЕ добавляй технические характеристики вообще.
`.trim();

      const rr=await fetch("https://api.openai.com/v1/responses",{
        method:"POST",
        headers:{
          Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type":"application/json"
        },
        body:JSON.stringify({model,input:prompt})
      });
      const data=await rr.json();
      if(!rr.ok) return res.status(rr.status).json({error:"OpenAI API error",details:data});

      const text=
        data.output_text ||
        (data.output||[]).flatMap(i=>i.content||[]).filter(c=>c.type==="output_text").map(c=>c.text).join("\n") ||
        "";

      const parsed=parseJsonText(text);
      if(parsed){
        if(changeName) proposedName=String(parsed.name||"").trim();
        if(changeDescription) proposedDescription=cleanHtmlText(parsed.description||"");
      }else{
        if(changeDescription) proposedDescription=cleanHtmlText(text);
      }
    }

    res.json({
      productId:x.product.id,
      name:x.product.name,
      currentName:x.product.name,
      currentPrice:Number(x.promPrice||0),
      currentDescription:x.product.description||"",
      buyPrice:x.buyPrice,
      marginPct:x.marginPct,
      targetMargin,
      proposedPrice,
      proposedName,
      proposedDescription,
      warning:"Цена пока техническая по марже. Для рыночной цены нажми «Проверить рынок Prom»."
    });
  }catch(e){
    res.status(e.status||500).json({error:e.message,details:e.data||null});
  }
});

app.post("/api/editor/apply",requirePromToken,requireWritePin,async(req,res)=>{
  try{
    const productId=req.body?.productId;
    const confirm=String(req.body?.confirm||"");
    if(confirm!=="APPLY"){
      return res.status(400).json({error:"Для записи confirm должен быть APPLY"});
    }

    const x=await currentCatalogItem(productId);
    if(!x) return res.status(404).json({error:"Товар не найден"});

    const edit={id:Number(productId)};
    const changes={};

    if(req.body?.price!=null){
      const price=Number(req.body.price);
      if(!Number.isFinite(price)||price<=0) return res.status(400).json({error:"Некорректная цена"});
      // Защита от случайной экстремальной цены
      const old=Number(x.promPrice||0);
      if(old>0 && (price<old*0.5 || price>old*1.8)){
        return res.status(400).json({error:"Цена отличается от текущей более чем на допустимый безопасный диапазон 50%–180%."});
      }
      edit.price=price;
      changes.price={from:old,to:price};
    }

    if(req.body?.name!=null){
      const name=String(req.body.name||"").trim();
      if(name.length<8) return res.status(400).json({error:"Название слишком короткое"});
      if(name.length>250) return res.status(400).json({error:"Название слишком длинное"});
      edit.name=name;
      changes.name={from:x.product.name,to:name};
    }

    if(req.body?.description!=null){
      const description=cleanHtmlText(req.body.description);
      if(description.length<40) return res.status(400).json({error:"Описание слишком короткое"});
      if(description.length>20000) return res.status(400).json({error:"Описание слишком длинное"});
      edit.description=description;
      changes.description=true;
    }

    if(Object.keys(changes).length===0){
      return res.status(400).json({error:"Нет изменений для записи"});
    }

    const result=await promEditProduct(edit);

    // Сбрасываем кэш, чтобы следующий анализ прочитал свежие данные Prom.
    if(typeof catalogCache!=="undefined"){
      catalogCache={loadedAt:null,report:[],summary:null};
    }

    res.json({
      ok:true,
      productId,
      changes,
      promResponse:result
    });
  }catch(e){
    res.status(e.status||500).json({error:e.message,details:e.data||null});
  }
});

app.post("/api/market/check",requirePromToken,async(req,res)=>{
  try{
    if(!process.env.OPENAI_API_KEY){
      return res.status(400).json({error:"OPENAI_API_KEY не задан"});
    }

    const productId=req.body?.productId;
    const minMargin=Math.max(5,Math.min(Number(req.body?.minMargin||12),40));
    const x=await currentCatalogItem(productId);

    if(!x) return res.status(404).json({error:"Товар не найден"});
    if(!x.matched || !x.buyPrice){
      return res.status(400).json({error:"Нет надёжной закупочной цены для расчёта"});
    }

    const floorPrice=priceForMargin(Number(x.buyPrice),minMargin);
    const prompt=`
Найди на Prom.ua текущие предложения ТОЧНО ЭТОЙ ЖЕ модели товара.

Товар продавца:
"${x.product.name}"

Данные поставщика:
бренд: "${x.supplierBrand||""}"
точное название: "${x.supplierName||""}"

Исключи магазин ${SELF_PROM_DOMAIN}.

Строгие правила сопоставления:
- exact = совпадает бренд + модель/линейка + тип товара; цвет может отличаться.
- close = похожий товар той же категории, но модель отличается.
- Если в названии есть номер модели, поколение, серия, GTX/Mid/Forces/Level и т.п. — exact допускается только при совпадении этих ключевых слов.
- Не помечай generic-футболки, generic-куртки и просто похожие товары как exact.
- Для расчёта рыночной цены мы будем использовать exact в приоритете.
- Если exact меньше 2, верни их как есть и добавь close, но не маскируй close под exact.

Верни ТОЛЬКО JSON:
{
  "competitors":[
    {
      "title":"...",
      "price":1234,
      "url":"https://...",
      "match":"exact",
      "reason":"почему exact или close"
    }
  ],
  "comment":"короткое замечание"
}

Нужно максимум 10 предложений. price только число в грн.
`.trim();

    async function runSearch(useFilter){
      const tool=useFilter
        ? {type:"web_search",filters:{allowed_domains:["prom.ua"]}}
        : {type:"web_search"};

      const searchPrompt=useFilter
        ? prompt
        : `${prompt}

ВАЖНО: ищи только страницы сайта prom.ua. Используй запросы вида site:prom.ua и не используй цены с других сайтов.`;

      const response=await fetch("https://api.openai.com/v1/responses",{
        method:"POST",
        headers:{
          Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type":"application/json"
        },
        body:JSON.stringify({
          model:OPENAI_WEB_MODEL,
          tools:[tool],
          tool_choice:"auto",
          include:["web_search_call.action.sources"],
          input:searchPrompt
        })
      });
      const body=await response.json();
      return {response,body};
    }

    // Основной поиск: жёсткий фильтр prom.ua.
    // Если API отклонит фильтр/параметр, делаем один резервный запрос без filters,
    // но с явным site:prom.ua в промпте.
    let attempt=await runSearch(true);
    let usedFallback=false;

    if(!attempt.response.ok){
      usedFallback=true;
      attempt=await runSearch(false);
    }

    const rr=attempt.response;
    const data=attempt.body
    if(!rr.ok){
      const apiError=data?.error||{};
      return res.status(rr.status).json({
        error:"OpenAI web search error",
        apiMessage:apiError.message||null,
        apiType:apiError.type||null,
        apiCode:apiError.code||null,
        details:data
      });
    }

    const outputText=
      data.output_text ||
      (data.output||[]).flatMap(i=>i.content||[]).filter(c=>c.type==="output_text").map(c=>c.text).join("\n") ||
      "";

    const parsed=parseJsonText(outputText)||{competitors:[],comment:outputText};

    let competitors=Array.isArray(parsed.competitors)?parsed.competitors:[];
    competitors=competitors
      .map(c=>({
        title:String(c.title||"").trim(),
        price:Number(c.price||0),
        url:String(c.url||"").trim(),
        match:String(c.match||"close").toLowerCase()==="exact"?"exact":"close",
        reason:String(c.reason||"").trim()
      }))
      .filter(c=>c.price>0 && c.url.includes("prom.ua") && !c.url.includes(SELF_PROM_DOMAIN));

    // Убираем явно аномальные результаты относительно нашей текущей цены.
    const current=Number(x.promPrice||0);
    competitors=competitors.filter(c=>{
      if(!current) return true;
      const ratio=Math.max(current,c.price)/Math.min(current,c.price);
      return ratio<=2.2;
    });

    const exact=competitors.filter(c=>c.match==="exact");
    const usable=exact.length>=3?exact:competitors;
    const prices=usable.map(c=>c.price).filter(Boolean).sort((a,b)=>a-b);

    const marketLow=prices[0]||null;
    const marketMedian=median(prices);
    const marketQ1=lowerQuartile(prices);

    // Цель: быть в нижней конкурентной части рынка, но не уходить ниже минимальной маржи.
    let marketTarget=null;
    if(prices.length>=4){
      marketTarget=marketQ1;
    }else if(prices.length>=2){
      marketTarget=prices[1]; // не ориентируемся на одиночный демпинг
    }else if(prices.length===1){
      marketTarget=prices[0];
    }

    let recommendedPrice=null;
    let competitive=null;
    let status="Недостаточно данных рынка";

    if(marketTarget){
      const desired=smartPrice(marketTarget*0.99);
      recommendedPrice=Math.max(Number(floorPrice||0),Number(desired||0));
      const expectedMargin=recommendedPrice
        ? ((recommendedPrice-Number(x.buyPrice))/recommendedPrice)*100
        : null;

      competitive = marketMedian ? recommendedPrice <= marketMedian*1.03 : true;

      if(!competitive){
        status="При безопасной марже цена выше основной части рынка — товар лучше не продвигать ценой";
      }else if(recommendedPrice <= (marketQ1||marketTarget)*1.03){
        status="Конкурентная цена: нижняя часть рынка при сохранении маржи";
      }else{
        status="Цена безопасна по марже, но не самая низкая";
      }

      const sources=[];
      for(const item of (data.output||[])){
        if(item?.type==="web_search_call"){
          for(const s of (item?.action?.sources||[])){
            if(s?.url && !sources.some(x=>x.url===s.url)){
              sources.push({url:s.url,title:s.title||s.url});
            }
          }
        }
      }

      const marketPayload={
        productId:x.product.id,
        name:x.product.name,
        currentPrice:current,
        buyPrice:x.buyPrice,
        minMargin,
        floorPrice,
        competitors,
        marketLow,
        marketMedian:marketMedian?round2(marketMedian):null,
        marketQ1:marketQ1?round2(marketQ1):null,
        recommendedPrice,
        expectedProfit:recommendedPrice?round2(recommendedPrice-Number(x.buyPrice)):null,
        expectedMargin:expectedMargin!=null?Math.round(expectedMargin*10)/10:null,
        competitive,
        status,
        comment:String(parsed.comment||""),
        usedFallback,
        sources:sources.slice(0,12)
      };
      marketPayload.adDecision=adStatusFromMarket(x,marketPayload);
      return res.json(marketPayload);
    }

    const marketPayload={
      productId:x.product.id,
      name:x.product.name,
      currentPrice:current,
      buyPrice:x.buyPrice,
      minMargin,
      floorPrice,
      competitors,
      marketLow,
      marketMedian,
      marketQ1,
      recommendedPrice:null,
      expectedProfit:null,
      expectedMargin:null,
      competitive:null,
      status,
      comment:String(parsed.comment||""),
      usedFallback,
      sources:[]
    };
    marketPayload.adDecision=adStatusFromMarket(x,marketPayload);
    return res.json(marketPayload);

  }catch(e){
    res.status(e.status||500).json({error:e.message,details:e.data||null});
  }
});

app.get("/api/ads/candidates",requirePromToken,async(req,res)=>{
  try{
    const limit=Math.max(5,Math.min(Number(req.query.limit)||30,100));
    const data=await getCatalogReport(false);
    const items=[...data.report]
      .filter(x=>x.matched && Number(x.grossProfit||0)>0)
      .map(x=>({...x,preScore:preAdScore(x)}))
      .sort((a,b)=>b.preScore-a.preScore || Number(b.grossProfit||0)-Number(a.grossProfit||0))
      .slice(0,limit);
    res.json({count:items.length,note:"Предварительный рейтинг без web search. Для финального зелёный/жёлтый/красный нужно проверить рынок конкретного товара.",items});
  }catch(e){
    res.status(e.status||500).json({error:e.message,details:e.data||null});
  }
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

app.listen(PORT,"0.0.0.0",()=>console.log(`PrimeTac Prom AI v7 running on ${PORT}`));
