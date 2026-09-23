const crypto = require("crypto");

const { mapSelectedProduct } = require("./group-mapper");

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function num(value) {
  const raw = clean(value).replace(",", ".");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function isAvailable(offer) {
  const raw = clean(offer?.available).toLowerCase();
  if (["true","1","yes","available","in_stock","в наличии","в наявності"].includes(raw)) return true;
  if (["false","0","no","unavailable","out_of_stock","нет","немає"].includes(raw)) return false;
  const q = num(offer?.quantity);
  return q != null && q > 0;
}

function supplierData(suppliers, supplierName) {
  return supplierName === "BEZET" ? suppliers.bezet : suppliers.militaris;
}

function familyOffers(suppliers, row) {
  const data = supplierData(suppliers, row.supplier);
  return (data?.offers || [])
    .filter(offer => String(offer.groupId || offer.id || "") === String(row.groupId || ""))
    .sort((a,b) => String(a.id || "").localeCompare(String(b.id || ""), "en", {numeric:true}));
}

// Keep legacy external IDs from the first YML control import, so the same
// test positions are updated instead of duplicated.
function externalProductId(supplier, sourceOfferId) {
  const digits = String(sourceOfferId ?? "").replace(/\D+/g, "");
  const prefix = supplier === "BEZET" ? 1000000000 : 2000000000;
  if (digits && Number(digits) <= 899999999) return String(prefix + Number(digits));
  const h = crypto.createHash("sha1").update(`${supplier}:${sourceOfferId}`).digest().readUInt32BE(0);
  return String(prefix + (h % 899999999));
}

function additionalExternalProductId(supplier, key) {
  const h = crypto.createHash("sha256").update(`${supplier}:${key}`).digest().readUInt32BE(0);
  const prefix = supplier === "BEZET" ? 300000000 : 700000000;
  return String(prefix + (h % 199999999));
}

function variantGroupId(supplier, sourceGroupId) {
  const digits = String(sourceGroupId ?? "").replace(/\D+/g, "");
  const prefix = supplier === "BEZET" ? 100000000 : 500000000;
  if (digits && Number(digits) <= 399999999) return prefix + Number(digits);
  const h = crypto.createHash("sha1").update(`${supplier}:${sourceGroupId}`).digest().readUInt32BE(0);
  return prefix + (h % 399999999);
}

function csvCell(value) {
  const s = String(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}
function csvRow(values) { return values.map(csvCell).join(","); }

function paramMap(offer) {
  const out = new Map();
  for (const p of offer?.params || []) {
    const name = clean(p?.name), value = clean(p?.value);
    if (name && value) out.set(name.toLowerCase(), {name,value});
  }
  return out;
}

function chooseVariantParams(offers) {
  if (!offers || offers.length <= 1) return [];
  const data = new Map();
  for (const offer of offers) {
    for (const [lower,pair] of paramMap(offer)) {
      if (!data.has(lower)) data.set(lower, {name:pair.name, values:new Set(), present:0});
      const e = data.get(lower); e.values.add(pair.value); e.present++;
    }
  }
  const hints = ["розмір","размер","size","колір","цвет","color","colour","зріст","рост","об'єм","объем","volume","довжина","длина","length","ширина","width"];
  const identityHints = ["артикул","код товар","код товара","sku","product id","offer id","ідентифікатор","идентификатор"];
  return [...data.entries()]
    .map(([lower,e]) => ({
      lower,
      ...e,
      complete:e.present===offers.length,
      varies:e.values.size>1,
      identity:identityHints.some(h=>lower.includes(h)),
      rank:hints.findIndex(h=>lower.includes(h))
    }))
    .filter(e=>e.complete && e.varies && !e.identity)
    .sort((a,b)=>(a.rank<0?99:a.rank)-(b.rank<0?99:b.rank) || b.values.size-a.values.size)
    .slice(0,3).map(e=>e.name);
}

function variantSignature(offer,names) {
  const m=paramMap(offer);
  return names.map(name=>m.get(name.toLowerCase())?.value || "").join("|");
}

function dedupeVariants(offers,names) {
  if (!names.length) return offers.length ? [offers[0]] : [];
  const seen=new Set(), out=[];
  for (const offer of [...offers].sort((a,b)=>Number(isAvailable(b))-Number(isAvailable(a)))) {
    const sig=variantSignature(offer,names);
    if (!sig || seen.has(sig)) continue;
    seen.add(sig); out.push(offer);
  }
  return out;
}

function cloneComparable(offer) {
  const params=(offer?.params||[])
    .map(p=>[clean(p?.name).toLowerCase(),clean(p?.value).toLowerCase()])
    .filter(([name,value])=>name && value)
    .filter(([name])=>!["артикул","код товар","код товара","sku","product id","offer id","ідентифікатор","идентификатор"].some(h=>name.includes(h)))
    .sort((a,b)=>a[0].localeCompare(b[0],"uk") || a[1].localeCompare(b[1],"uk"));
  return JSON.stringify({
    name:clean(offer?.name).toLowerCase(),
    vendor:clean(offer?.vendor).toLowerCase(),
    categoryId:clean(offer?.categoryId),
    price:num(offer?.price),
    currency:clean(offer?.currency || offer?.currencyId).toUpperCase(),
    available:isAvailable(offer),
    quantity:num(offer?.quantity),
    country:clean(offer?.country).toLowerCase(),
    pictures:(offer?.pictures||[]).map(clean).filter(Boolean).slice(0,10),
    params
  });
}

function areCodeOnlyClones(offers) {
  if (!offers || offers.length <= 1) return false;
  const first=cloneComparable(offers[0]);
  return offers.every(offer=>cloneComparable(offer)===first);
}

function familyVariantMode(offers) {
  if (!offers || offers.length <= 1) return {mode:"single",variantNames:[]};
  const variantNames=chooseVariantParams(offers);
  if (variantNames.length) return {mode:"real",variantNames};
  if (areCodeOnlyClones(offers)) return {mode:"collapsed_code_only",variantNames:[]};
  return {mode:"ambiguous",variantNames:[]};
}

function pictures(offer,fallback) {
  const out=[], seen=new Set();
  for (const raw of [...(offer?.pictures||[]),...(fallback||[])]) {
    const v=clean(raw); if(!v || seen.has(v)) continue;
    seen.add(v); out.push(v); if(out.length>=10) break;
  }
  return out;
}

function enrichmentMap(items) { return new Map((items||[]).map(i=>[i.familyKey,i])); }

function chooseTestRows(rows,suppliers,limit=20) {
  const candidates=(rows||[]).map(row=>{
    const mapping=mapSelectedProduct(row), offers=familyOffers(suppliers,row), variant=familyVariantMode(offers);
    return {row,mapping,offers,variant,score:(variant.mode==="real"?200:(variant.mode==="collapsed_code_only"?100:0))+offers.filter(isAvailable).length};
  }).filter(x=>x.mapping.status==="MAPPED" && x.mapping.groupId && x.offers.length && x.variant.mode!=="ambiguous")
    .sort((a,b)=>b.score-a.score || a.row.familyKey.localeCompare(b.row.familyKey,"en",{numeric:true}));
  const chosen=[], usedGroups=new Set();
  for (const item of candidates) {
    const g=String(item.mapping.groupId); if(usedGroups.has(g)) continue;
    chosen.push(item.row); usedGroups.add(g); if(chosen.length>=limit) return chosen;
  }
  for (const item of candidates) {
    if(chosen.some(r=>r.familyKey===item.row.familyKey)) continue;
    chosen.push(item.row); if(chosen.length>=limit) break;
  }
  return chosen;
}

function quantityFor(offer) {
  if (!isAvailable(offer)) return 0;
  const q=num(offer?.quantity);
  return q == null || q <= 0 ? 1 : Math.max(1,Math.floor(q));
}

function staticParams(offer,variantNames) {
  const set=new Set(variantNames.map(n=>n.toLowerCase()));
  return (offer?.params||[]).map(p=>({name:clean(p?.name),value:clean(p?.value)}))
    .filter(p=>p.name && p.value && !set.has(p.name.toLowerCase())).slice(0,5);
}

function uniqueProductCode(offer, supplier, externalId, usedCodes) {
  let base = clean(offer?.sku).replace(/[^A-Za-zА-Яа-яІіЇїЄєҐґ0-9._-]+/gu, "-").slice(0,25);
  if(!base) base = `${supplier === "BEZET" ? "B" : "M"}-${externalId}`.slice(0,25);
  let code = base;
  if(usedCodes.has(code)) {
    const tail = String(externalId).slice(-6);
    code = `${base.slice(0,Math.max(1,24-tail.length))}-${tail}`;
  }
  let i=2;
  while(usedCodes.has(code)) {
    const suffix=`-${i++}`;
    code=`${base.slice(0,25-suffix.length)}${suffix}`;
  }
  usedCodes.add(code);
  return code;
}

function buildCsvFeed({mode,suppliers,selectedRows,enrichmentItems,promGroups,testLimit=20}) {
  const eMap=enrichmentMap(enrichmentItems);
  const allowed=new Set((promGroups||[]).map(g=>String(g?.id)));
  const rows=mode==="test" ? chooseTestRows(selectedRows,suppliers,testLimit) : (selectedRows||[]);
  const triples=Array.from({length:8},()=>["Назва_Характеристики","Одиниця_виміру_Характеристики","Значення_Характеристики"]).flat();
  const headers=[
    "Код_товару","Назва_позиції","Назва_позиції_укр","Пошукові_запити","Пошукові_запити_укр",
    "Опис","Опис_укр","Тип_товару","Ціна","Валюта","Одиниця_виміру","Кількість","Посилання_зображення",
    "Наявність","Виробник","Країна_виробник","HTML_заголовок","HTML_заголовок_укр","HTML_опис","HTML_опис_укр",
    "Номер_групи","Код_маркування_(GTIN)","Ідентифікатор_товару","ID_групи_різновидів",...triples
  ];
  const csvRows=[csvRow(headers)], preview=[], familyKeys=[], externalIds=[], productCodes=[];
  const usedExternalIds=new Set(), usedCodes=new Set();
  let resolvedExternalIdCollisions=0, realVariantFamilies=0, collapsedCodeOnlyFamilies=0, skippedAmbiguousFamilies=0, singleFamilies=0;
  for (const row of rows) {
    const mapping=mapSelectedProduct(row), target=String(mapping.groupId||"");
    if(mapping.status!=="MAPPED" || !allowed.has(target)) continue;
    const enrich=eMap.get(row.familyKey);
    if(!enrich?.content?.descriptionRu || !enrich?.content?.descriptionUa) continue;
    const allOffers=familyOffers(suppliers,row); if(!allOffers.length) continue;
    const variant=familyVariantMode(allOffers);
    if(variant.mode==="ambiguous") { skippedAmbiguousFamilies++; continue; }
    const variantNames=variant.variantNames;
    const offers=variant.mode==="real" ? dedupeVariants(allOffers,variantNames) : [allOffers[0]];
    if(variant.mode==="real") realVariantFamilies++;
    else if(variant.mode==="collapsed_code_only") collapsedCodeOnlyFamilies++;
    else singleFamilies++;
    let emitted=0;
    for (let variantIndex=0; variantIndex<offers.length; variantIndex++) {
      const offer=offers[variantIndex];
      const price=num(offer?.price), pics=pictures(offer,enrich.dynamic?.pictures||[]);
      const sourceName=clean(enrich.content.titleRu || row.name || offer.name), uaName=clean(enrich.content.titleUa || sourceName);
      if(!sourceName || price==null || price<=0 || !pics.length) continue;
      const sourceKey=offer.id || `${row.groupId}-${offer.sku}`;
      let extId=externalProductId(row.supplier,sourceKey);
      if(usedExternalIds.has(extId)) {
        resolvedExternalIdCollisions++;
        const baseKey=`${row.familyKey}|${sourceKey}|${clean(offer.sku)}|${variantIndex}`;
        extId=additionalExternalProductId(row.supplier,baseKey);
        let salt=2;
        while(usedExternalIds.has(extId)) extId=additionalExternalProductId(row.supplier,`${baseKey}|${salt++}`);
      }
      usedExternalIds.add(extId);
      const sku=uniqueProductCode(offer,row.supplier,extId,usedCodes), available=isAvailable(offer), vm=paramMap(offer);
      const params=[];
      for(const name of variantNames){
        const pair=vm.get(name.toLowerCase()); if(pair) params.push(pair);
      }
      params.push(...staticParams(offer,variantNames)); while(params.length<8) params.push({name:"",value:""});
      const charCells=params.slice(0,8).flatMap(p=>[p.name,"",p.value]);
      const brand=clean(offer.vendor || enrich.content?.source?.brand), country=clean(offer.country || enrich.content?.source?.country), gtin=clean(offer.barcode || enrich.content?.source?.barcode);
      csvRows.push(csvRow([
        sku,sourceName.slice(0,110),uaName.slice(0,130),(enrich.content.keywordsRu||[]).join(", ").slice(0,1024),
        (enrich.content.keywordsUa||[]).join(", ").slice(0,1024),String(enrich.content.descriptionRu).slice(0,12160),
        String(enrich.content.descriptionUa).slice(0,12160),"r",price,"UAH","шт.",quantityFor(offer),pics.join(", "),available?"+":"-",
        brand,country,enrich.content?.seo?.titleRu||"",enrich.content?.seo?.titleUa||"",enrich.content?.seo?.descriptionRu||"",enrich.content?.seo?.descriptionUa||"",
        target,gtin,extId,variantNames.length?variantGroupId(row.supplier,row.groupId):"",...charCells
      ]));
      externalIds.push(extId); productCodes.push(sku); emitted++;
    }
    if(emitted){familyKeys.push(row.familyKey); preview.push({familyKey:row.familyKey,supplier:row.supplier,name:enrich.content.titleRu||row.name,targetGroupId:Number(target),sourceVariants:allOffers.length,exportedRows:emitted,variantMode:variant.mode,variantParams:variantNames});}
  }
  const csv="\ufeff"+csvRows.join("\r\n");
  const externalIdsUnique=new Set(externalIds).size===externalIds.length;
  const productCodesUnique=new Set(productCodes).size===productCodes.length;
  const summary={mode,requestedFamilies:rows.length,exportedFamilies:familyKeys.length,exportedRows:csvRows.length-1,csvBytes:Buffer.byteLength(csv,"utf8"),targetGroups:[...new Set(preview.map(x=>x.targetGroupId))],allTargetsExist:preview.every(x=>allowed.has(String(x.targetGroupId))),externalIdsUnique,productCodesUnique,resolvedExternalIdCollisions,realVariantFamilies,collapsedCodeOnlyFamilies,skippedAmbiguousFamilies,singleFamilies,familyKeys,externalIds,preview};
  if(summary.exportedFamilies<=0 || summary.exportedRows<=0 || !summary.allTargetsExist || !summary.externalIdsUnique || !summary.productCodesUnique) throw new Error(`PROM CSV validation failed: ${JSON.stringify(summary)}`);
  return {csv,summary};
}

module.exports={buildCsvFeed,externalProductId,variantGroupId};
