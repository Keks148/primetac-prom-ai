
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');
const https = require('https');
const { XMLParser } = require('fast-xml-parser');
const cheerio = require('cheerio');

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = Number(process.env.PORT || 3000);
const PROM_TOKEN = String(process.env.PROM_TOKEN || '').trim();
const WRITE_ENABLED = String(process.env.WRITE_ENABLED || '').toLowerCase() === 'true';
const MAX_PRODUCTS = Math.max(100, Number(process.env.MAX_PRODUCTS || 5000));
const KEYWORD_MIN = Math.max(3, Math.min(7, Number(process.env.KEYWORD_MIN || 5)));
const SCAN_CONCURRENCY = Math.max(1, Math.min(10, Number(process.env.SCAN_CONCURRENCY || 5)));
const BATCH_SIZE = Math.max(1, Math.min(50, Number(process.env.BATCH_SIZE || 25)));
const FIX_CONCURRENCY = Math.max(1, Math.min(3, Number(process.env.FIX_CONCURRENCY || 2)));
const VERIFY_DELAY_MS = Math.max(300, Number(process.env.VERIFY_DELAY_MS || 700));
const KEYWORD_ACCEPT_MIN = Math.max(3, Math.min(7, Number(process.env.KEYWORD_ACCEPT_MIN || 4)));
const ENRICH_CONCURRENCY = Math.max(1, Math.min(2, Number(process.env.ENRICH_CONCURRENCY || 1)));
const AUTO_INTERVAL_HOURS = Math.max(1, Number(process.env.AUTO_INTERVAL_HOURS || 4));
const AUTO_ON_START = String(process.env.AUTO_ON_START || 'false').toLowerCase() === 'true';
const AUTO_IMPORT_STATUS_MAX_MIN = Math.max(5, Number(process.env.AUTO_IMPORT_STATUS_MAX_MIN || 15));
const AUTO_STATUS_POLL_SEC = Math.max(10, Number(process.env.AUTO_STATUS_POLL_SEC || 20));
const AUTO_STATUS_VERIFY_SEC = Math.max(30, Number(process.env.AUTO_STATUS_VERIFY_SEC || 60));
const AUTO_BACKGROUND_WATCH_MAX_MIN = Math.max(15, Number(process.env.AUTO_BACKGROUND_WATCH_MAX_MIN || 120));
const AUTO_LOCK_STALE_HOURS = Math.max(2, Number(process.env.AUTO_LOCK_STALE_HOURS || 12));
const AUTO_STARTUP_SAFE_DELAY_MIN = Math.max(5, Number(process.env.AUTO_STARTUP_SAFE_DELAY_MIN || 30));
const AUTO_STATE_PATH = String(process.env.AUTO_STATE_PATH || (fs.existsSync('/var/data') ? '/var/data/primetac-auto-state.json' : '/tmp/primetac-auto-state.json'));
const STOCK_MONITOR_ENABLED = String(process.env.STOCK_MONITOR_ENABLED || 'true').toLowerCase() !== 'false';
const STOCK_WRITE_ENABLED = String(process.env.STOCK_WRITE_ENABLED || 'false').toLowerCase() === 'true';
const STOCK_INTERVAL_HOURS = Math.max(1, Number(process.env.STOCK_INTERVAL_HOURS || 4));
const STOCK_LOW_THRESHOLD = Math.max(1, Number(process.env.STOCK_LOW_THRESHOLD || 3));
const STOCK_MAX_WRITES = Math.max(10, Number(process.env.STOCK_MAX_WRITES || 250));
const STOCK_ALLOW_MASS = String(process.env.STOCK_ALLOW_MASS || 'false').toLowerCase() === 'true';
const STOCK_BATCH_SIZE = Math.max(1, Math.min(50, Number(process.env.STOCK_BATCH_SIZE || 40)));
const STOCK_START_DELAY_SEC = Math.max(15, Number(process.env.STOCK_START_DELAY_SEC || 90));
const STOCK_SNAPSHOT_PATH = String(process.env.STOCK_SNAPSHOT_PATH || '/tmp/primetac-stock-snapshot.json');


const SUPPLIER_FEED_ATTEMPTS = Math.max(2, Math.min(6, Number(process.env.SUPPLIER_FEED_ATTEMPTS || 4)));
const SUPPLIER_FEED_TIMEOUT_MS = Math.max(30000, Number(process.env.SUPPLIER_FEED_TIMEOUT_MS || 90000));
const SUPPLIER_FEED_RETRY_SEC = Math.max(2, Number(process.env.SUPPLIER_FEED_RETRY_SEC || 8));
// v3.2: feed download uses native streaming with an IDLE timeout, not a hard 90s abort.
// These have new names on purpose, so an old SUPPLIER_FEED_TIMEOUT_MS=90000 in Render cannot kill BEZET again.
const FEED_IDLE_TIMEOUT_MS = Math.max(120000, Number(process.env.FEED_IDLE_TIMEOUT_MS || 300000));
const FEED_TOTAL_TIMEOUT_MS = Math.max(300000, Number(process.env.FEED_TOTAL_TIMEOUT_MS || 1200000));
const FEED_CACHE_HOURS = Math.max(1, Number(process.env.FEED_CACHE_HOURS || 24));
const FEED_CACHE_DIR = String(process.env.FEED_CACHE_DIR || '/tmp/primetac-feed-cache');


const SUPPLIER_CONFIG = {
  bezet: {
    key: 'bezet',
    name: 'BEZET',
    feedUrl: String(process.env.BEZET_FEED_URL || 'https://www.bezet.com.ua/sync/prom-second').trim(),
    siteUrl: String(process.env.BEZET_SITE_URL || 'https://www.bezet.com.ua').trim()
  },
  militaris: {
    key: 'militaris',
    name: 'Militaris',
    feedUrl: String(process.env.MILITARIS_FEED_URL || 'https://militaris.com.ua/content/export/04658108dda3987543769e4a63b496ca.xml').trim(),
    siteUrl: String(process.env.MILITARIS_SITE_URL || 'https://militaris.com.ua').trim()
  }
};

const MANAGED_GROUPS_PATH = path.join(__dirname,'groups.json');
const MANAGED_GROUPS = JSON.parse(fs.readFileSync(MANAGED_GROUPS_PATH,'utf8'));
const MANAGED_GROUP_NAMES = new Set(MANAGED_GROUPS.map(g=>norm(g.name).toLowerCase()));
const MANAGED_LEAVES = MANAGED_GROUPS.filter(g=>Array.isArray(g.keywords) && g.keywords.length);
const FALLBACK_GROUP = MANAGED_GROUPS.find(g=>g.fallback) || MANAGED_GROUPS[MANAGED_GROUPS.length-1];

function managedGroupText(p,match){
  const r=match?.record||{};
  const params=Object.entries(r.params||{}).map(([k,v])=>`${k} ${v}`).join(' ');
  return norm([
    p?.name,
    p?.category_name,
    typeof p?.category==='object' ? (p.category?.name||p.category?.title) : p?.category,
    r.name,
    r.description,
    params
  ].filter(Boolean).join(' ')).toLowerCase();
}
function classifyManagedGroup(p,match){
  const text=' '+managedGroupText(p,match)+' ';
  let best=null;
  for(const g of MANAGED_LEAVES){
    let score=0;
    for(const raw of g.keywords||[]){
      const k=String(raw||'').toLowerCase().trim();
      if(!k) continue;
      if(text.includes(k)){
        score += k.includes(' ') ? 4 : 2;
        if(k.length>=8) score += 1;
      }
    }
    if(score>0 && (!best || score>best.score)) best={group:g,score};
  }
  return best?.group || FALLBACK_GROUP;
}
function managedCategoriesXml(){
  return MANAGED_GROUPS.map(g=>{
    const parent=g.parent?` parentId="${autoEscXml(g.parent)}"`:'';
    return `<category id="${autoEscXml(g.id)}"${parent}>${autoEscXml(g.name)}</category>`;
  }).join('\n');
}

let supplierState = {
  loading: false,
  matching: false,
  updated_at: null,
  match_updated_at: null,
  sources: {},
  matched_products: 0,
  unmatched_products: 0,
  match_total: 0,
  match_processed: 0,
  errors: [],
  fillable_products: 0,
  fillable_fields: 0,
  fillable_by_field: {}
};

let supplierRecords = { bezet: [], militaris: [] };
let supplierIndexes = { bezet: null, militaris: null };
let supplierMatches = new Map();
let promRawCache = new Map();
let rejectedKeywordIds = new Set();


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
  summary: null,
  last_error: null
};

let fixState = {
  running: false,
  started_at: null,
  finished_at: null,
  planned: 0,
  processed: 0,
  verified: 0,
  failed: 0,
  errors: [],
  mode: null,
  stop_requested: false
};

let enrichState = {
  running:false, mode:null, started_at:null, finished_at:null, planned:0, processed:0, verified:0, failed:0, changed_fields:0, errors:[], stop_requested:false, attribute_probe:null
};

let autoState = {
  running:false,
  stop_requested:false,
  started_at:null,
  finished_at:null,
  next_run_at:null,
  phase:'Ожидание',
  progress:0,
  keywords_checked:0,
  keywords_planned:0,
  keywords_changed:0,
  descriptions_checked:0,
  descriptions_planned:0,
  descriptions_changed:0,
  attributes_planned:0,
  attributes_imported:0,
  import_id:null,
  import_status:null,
  import_error:null,
  skipped_no_external_id:0,
  skipped_no_group_id:0,
  errors:[],
  last_run_reason:null,
  current:0,
  current_total:0,
  seo_errors:0,
  group_assignments_planned:0,
  groups_imported:0,
  groups_audited:0,
  legacy_groups:0,
  empty_legacy_groups:0,
  group_cleanup_candidates:[],
  group_distribution:{},
  cover_candidates:{},
  import_elapsed_sec:0,
  import_poll_count:0,
  import_last_status_payload:null,
  feed_progress:{},
  feed_download_source:{},
  import_background:false,
  import_terminal_confirmed:false,
  import_baseline_groups:0,
  managed_groups_verified:0,
  managed_groups_total:0,
  managed_group_nodes_found:0,
  attributes_verified:0,
  attributes_verifiable:0,
  status_endpoint_errors:0,
  status_last_error:null,
  status_last_http:null,
  status_last_path:null,
  import_accepted_at:null,
  import_fingerprint:null,
  persistent_lock:false,
  persistent_state_path:AUTO_STATE_PATH,
  persistent_state_saved_at:null,
  restored_after_restart:false,
  restored_lock_age_sec:0
};

let stockState = {
  running:false,
  started_at:null,
  finished_at:null,
  next_run_at:null,
  last_run_reason:null,
  phase:'Ожидание',
  progress:0,
  prom_total:0,
  matched:0,
  unmatched:0,
  stock_known:0,
  stock_unknown:0,
  in_stock:0,
  low_stock:0,
  out_of_stock:0,
  planned_changes:0,
  applied_changes:0,
  failed_changes:0,
  skipped_stale_source:0,
  skipped_unsafe_match:0,
  missing_from_feed:0,
  new_supplier_skus:0,
  safety_blocked:false,
  write_enabled:STOCK_WRITE_ENABLED,
  sources:{},
  changes:[],
  errors:[]
};


let lastStockPlans=[];
let stockDiag={
  running:false,
  at:null,
  product:null,
  request:null,
  http_status:null,
  response:null,
  error:null,
  verified:null,
  after:null
};

let lastAutoImportXml='';
let lastAutoImportPlan=[];
let autoImportWatchTimer=null;
let autoImportWatchStartedAt=0;
let restoredImportLock=false;
const SERVER_BOOTED_AT=Date.now();
const AUTO_BOOT_GUARD_UNTIL=SERVER_BOOTED_AT + AUTO_STARTUP_SAFE_DELAY_MIN*60*1000;
let autoBootGuardSatisfiedByRestoredTerminal=false;

function autoPlanFingerprint(plan=lastAutoImportPlan){
  try{
    const stable=(plan||[]).map(x=>({
      id:String(x?.id||''),
      external_id:String(x?.external_id||''),
      group_id:String(x?.group_id||''),
      group_name:String(x?.group_name||''),
      attrs:Array.isArray(x?.attrs)?x.attrs:[]
    }));
    return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0,20);
  }catch{return '';}
}

function ensureAutoStateDir(){
  const dir=path.dirname(AUTO_STATE_PATH);
  try{ fs.mkdirSync(dir,{recursive:true}); return true; }
  catch(e){ autoState.errors?.unshift?.({where:'state-dir',error:safeText(e)}); return false; }
}

function persistImportLock(reason='update'){
  try{
    if(!ensureAutoStateDir()) return false;
    const payload={
      version:2,
      pending:Boolean(autoState.import_background),
      reason,
      saved_at:new Date().toISOString(),
      import_id:autoState.import_id||null,
      import_status:autoState.import_status||null,
      import_accepted_at:autoState.import_accepted_at||autoState.started_at||null,
      import_fingerprint:autoState.import_fingerprint||autoPlanFingerprint(),
      import_baseline_groups:Number(autoState.import_baseline_groups||0),
      group_assignments_planned:Number(autoState.group_assignments_planned||lastAutoImportPlan.length||0),
      attributes_planned:Number(autoState.attributes_planned||0),
      managed_groups_verified:Number(autoState.managed_groups_verified||0),
      managed_groups_total:Number(autoState.managed_groups_total||lastAutoImportPlan.length||0),
      import_poll_count:Number(autoState.import_poll_count||0),
      status_endpoint_errors:Number(autoState.status_endpoint_errors||0),
      status_last_error:autoState.status_last_error||null,
      plan:lastAutoImportPlan
    };
    const tmp=AUTO_STATE_PATH+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify(payload),'utf8');
    fs.renameSync(tmp,AUTO_STATE_PATH);
    autoState.persistent_lock=Boolean(payload.pending);
    autoState.persistent_state_saved_at=payload.saved_at;
    autoState.persistent_state_path=AUTO_STATE_PATH;
    return true;
  }catch(e){
    autoState.errors?.unshift?.({where:'state-save',error:safeText(e)});
    return false;
  }
}

function clearImportLock(reason='terminal'){
  try{ if(fs.existsSync(AUTO_STATE_PATH)) fs.unlinkSync(AUTO_STATE_PATH); }catch(e){ autoState.errors?.unshift?.({where:'state-clear',error:safeText(e)}); }
  autoState.persistent_lock=false;
  autoState.persistent_state_saved_at=new Date().toISOString();
  return reason;
}

function restoreImportLock(){
  try{
    if(!fs.existsSync(AUTO_STATE_PATH)) return false;
    const raw=fs.readFileSync(AUTO_STATE_PATH,'utf8');
    const saved=JSON.parse(raw||'{}');
    if(!saved?.pending) return false;

    lastAutoImportPlan=Array.isArray(saved.plan)?saved.plan:[];
    const accepted=saved.import_accepted_at||saved.saved_at||new Date().toISOString();
    const acceptedMs=Date.parse(accepted);
    const ageMs=Number.isFinite(acceptedMs)?Math.max(0,Date.now()-acceptedMs):0;
    const ageSec=Math.round(ageMs/1000);

    Object.assign(autoState,{
      running:false,
      stop_requested:false,
      started_at:accepted,
      finished_at:null,
      phase:`♻️ Восстановлена блокировка незавершённого импорта Prom. ID ${saved.import_id||'неизвестен'}`,
      progress:95,
      import_id:saved.import_id||null,
      import_status:saved.import_status||'RESTORED_PENDING',
      import_error:'После перезапуска новый импорт заблокирован. Сначала проверяется ранее отправленная задача.',
      import_accepted_at:accepted,
      import_fingerprint:saved.import_fingerprint||autoPlanFingerprint(lastAutoImportPlan),
      import_baseline_groups:Number(saved.import_baseline_groups||0),
      group_assignments_planned:Number(saved.group_assignments_planned||lastAutoImportPlan.length||0),
      attributes_planned:Number(saved.attributes_planned||0),
      managed_groups_verified:Number(saved.managed_groups_verified||0),
      managed_groups_total:Number(saved.managed_groups_total||lastAutoImportPlan.length||0),
      import_poll_count:Number(saved.import_poll_count||0),
      status_endpoint_errors:Number(saved.status_endpoint_errors||0),
      status_last_error:saved.status_last_error||null,
      import_background:true,
      import_terminal_confirmed:false,
      persistent_lock:true,
      persistent_state_path:AUTO_STATE_PATH,
      persistent_state_saved_at:saved.saved_at||null,
      restored_after_restart:true,
      restored_lock_age_sec:ageSec,
      import_elapsed_sec:ageSec
    });
    autoImportWatchStartedAt=Number.isFinite(acceptedMs)?acceptedMs:Date.now();

    if(ageMs > AUTO_LOCK_STALE_HOURS*3600*1000){
      autoState.phase=`⚠️ Восстановлена старая блокировка импорта (${Math.round(ageMs/3600000)} ч). Новый импорт НЕ запускается до ручной проверки`;
      autoState.import_status='RESTORED_STALE_LOCK';
    }
    return true;
  }catch(e){
    autoState.errors?.unshift?.({where:'state-restore',error:safeText(e)});
    return false;
  }
}

function recordStatusEndpointError(e,statusPath){
  autoState.status_endpoint_errors++;
  autoState.status_last_http=Number(e?.status||0)||null;
  autoState.status_last_path=statusPath||null;
  autoState.status_last_error={
    at:new Date().toISOString(),
    http_status:Number(e?.status||0)||null,
    path:statusPath||null,
    message:safeText(e),
    data:e?.data||null
  };
  autoState.import_error='Status API временно не отвечает: '+safeText(e);
  if(autoState.import_background) persistImportLock('status-error');
}


function norm(v){ return String(v || '').replace(/\s+/g, ' ').trim(); }

function safeText(v){
  if(v===undefined || v===null) return '';
  if(typeof v==='string') return v;
  if(v instanceof Error) return v.message || String(v);
  if(typeof v==='number' || typeof v==='boolean') return String(v);
  if(Array.isArray(v)) return v.map(safeText).filter(Boolean).join('; ');
  if(typeof v==='object'){
    for(const k of ['message','error_description','description','detail','reason']){
      if(v[k]!==undefined && v[k]!==null){
        const t=safeText(v[k]);
        if(t) return t;
      }
    }
    if(v.error!==undefined){
      const t=safeText(v.error);
      if(t) return t;
    }
    if(v.errors!==undefined){
      const t=safeText(v.errors);
      if(t) return t;
    }
    try{return JSON.stringify(v);}
    catch{return '[не удалось прочитать объект ошибки]';}
  }
  return String(v);
}

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

  if(/\b(ONE\s*SIZE|ONESIZE|UNISIZE|УНІВЕРСАЛЬНИЙ|УНИВЕРСАЛЬНЫЙ)\b/i.test(src)) out.push('One size');

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


function attrString(v){
  if(Array.isArray(v)) return v.map(attrString).filter(Boolean).join(', ');
  if(v && typeof v==='object'){
    return attrString(v.value ?? v.name ?? v.caption ?? v.title ?? v.text ?? '');
  }
  return v===undefined || v===null ? '' : norm(v);
}

function promAttributes(p){
  return Array.isArray(p?.attributes) ? p.attributes.filter(x=>x && typeof x==='object') : [];
}

function attrName(a){ return attrString(a?.name ?? a?.caption ?? a?.title ?? a?.label ?? ''); }
function attrValue(a){ return attrString(a?.value ?? a?.values ?? a?.value_list ?? a?.options ?? a?.text ?? ''); }

const ATTR_LABELS={
  producer:['виробник','производитель','бренд'],
  type:['вид виробу','вид товара','вид товару','тип виробу','тип товара','тип товару','вид куртки','тип куртки'],
  color:['колір','цвет'],
  size:['розмір','размер','міжнародний розмір','международный размер','size'],
  material:['матеріал','материал','склад','состав'],
  season:['сезон'],
  country:['країна виробник','країна-виробник','страна производитель','країна','страна'],
  purpose:['призначення','назначение'],
  features:['особливості товару','особливості','особенности товара','особенности'],
  membrane:['мембрана'],
  insulation:['утеплювач','утеплитель'],
  zipper:['блискавка','молния','застібка','застежка'],
  weight:['вага','вес']
};

function findPromAttribute(p, labels){
  const normalized=(labels||[]).map(normalizeLabel);
  for(const a of promAttributes(p)){
    const n=normalizeLabel(attrName(a));
    if(n && normalized.some(x=>n===x || n.includes(x) || x.includes(n))) return a;
  }
  return null;
}

function actualAttrValue(p, key){
  const a=findPromAttribute(p,ATTR_LABELS[key]||[]);
  return a ? attrValue(a) : '';
}

function setAttributeValue(a, value){
  const out=JSON.parse(JSON.stringify(a));
  if(Object.prototype.hasOwnProperty.call(out,'value')) out.value=value;
  else if(Object.prototype.hasOwnProperty.call(out,'values')) out.values=Array.isArray(out.values)?[value]:value;
  else if(Object.prototype.hasOwnProperty.call(out,'value_list')) out.value_list=Array.isArray(out.value_list)?[value]:value;
  else if(Object.prototype.hasOwnProperty.call(out,'options')) out.options=Array.isArray(out.options)?[value]:value;
  else if(Object.prototype.hasOwnProperty.call(out,'text')) out.text=value;
  else out.value=value;
  return out;
}

function supplierValueForKey(details,key){
  if(!details) return '';
  if(key==='size'){
    const xs=uniq(details.sizes||[]);
    return xs.length===1 ? xs[0] : '';
  }
  return norm(details[key]||'');
}

function buildAttributePatch(p, details){
  const attrs=promAttributes(p);
  if(!attrs.length) return {attributes:null, changes:[], reason:'Prom API не вернул attributes для этого товара'};
  const next=attrs.map(x=>JSON.parse(JSON.stringify(x)));
  const changes=[];
  const keys=['producer','type','color','size','material','season','country','purpose','features','membrane','insulation','zipper','weight'];
  for(const key of keys){
    const target=findPromAttribute(p,ATTR_LABELS[key]);
    if(!target) continue; // не создаём неизвестные характеристики
    const before=attrValue(target);
    if(before) continue;
    const value=supplierValueForKey(details,key);
    if(!value) continue;
    const idx=attrs.indexOf(target);
    if(idx<0) continue;
    next[idx]=setAttributeValue(target,value);
    changes.push({key,name:attrName(target),before:'',after:value});
  }
  return {attributes:next,changes,reason:changes.length?'':'Нет пустых существующих характеристик Prom, подтверждённых поставщиком'};
}

function getActualProducer(p){ return getProducer(p) || actualAttrValue(p,'producer'); }
function getActualType(p){ return getProductType(p) || actualAttrValue(p,'type'); }
function getActualColor(p){ return getColor(p) || actualAttrValue(p,'color'); }
function getActualWeight(p){ return getWeight(p) || actualAttrValue(p,'weight'); }
function getActualSizes(p){
  const out=[];
  const av=actualAttrValue(p,'size');
  if(av) out.push(...detectSizes(av),...av.split(/[,;\/]/).map(norm).filter(Boolean));
  for(const key of ['variants','modifications','modification','sizes']){
    if(Array.isArray(p?.[key])) out.push(...detectSizes(JSON.stringify(p[key])));
  }
  return uniq(out);
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


function cleanSku(v){
  return norm(v).toUpperCase().replace(/[^A-ZА-ЯІЇЄҐ0-9_-]+/giu,'');
}

function normalizeNameForMatch(v){
  return norm(v)
    .toLowerCase()
    .replace(/\b(чорний|черный|black|сірий|серый|grey|gray|хакі|хаки|khaki|койот|coyote|tan|олива|olive|зелений|зеленый|green|помаранчевий|оранжевый|orange|білий|белый|white|синій|синий|blue|multicam|мультикам|піксель|пиксель|foliage)\b/giu,' ')
    .replace(/[^a-zа-яіїєґ0-9]+/giu,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function nameTokens(v){
  return new Set(normalizeNameForMatch(v).split(' ').filter(x=>x.length>=2));
}

function jaccardName(a,b){
  const A=nameTokens(a), B=nameTokens(b);
  if(!A.size || !B.size) return 0;
  let inter=0;
  for(const x of A) if(B.has(x)) inter++;
  const union=new Set([...A,...B]).size;
  return union ? inter/union : 0;
}

async function fetchText(url, timeoutMs=45000){
  if(!/^https?:\/\//i.test(url)) throw new Error('Некорректный URL');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(), timeoutMs);
  try{
    const r=await fetch(url,{
      redirect:'follow',
      signal:controller.signal,
      headers:{
        'User-Agent':'Mozilla/5.0 (PrimeTac Card Manager Supplier Enrichment)',
        'Accept':'text/html,application/xml,text/xml,application/xhtml+xml,*/*'
      }
    });
    if(!r.ok) throw new Error('HTTP '+r.status+' '+r.statusText);
    return await r.text();
  }finally{
    clearTimeout(timer);
  }
}


function feedUrlVariants(url){
  const out=[];
  const add=v=>{ if(v && !out.includes(v)) out.push(v); };
  add(url);
  try{
    const u=new URL(url);
    if(u.hostname.startsWith('www.')){
      const x=new URL(url);
      x.hostname=x.hostname.replace(/^www\./i,'');
      add(x.toString());
    }else{
      const x=new URL(url);
      x.hostname='www.'+x.hostname;
      add(x.toString());
    }
  }catch{}
  return out;
}

function feedCachePath(key){
  return path.join(FEED_CACHE_DIR, `${String(key).replace(/[^a-z0-9_-]/gi,'_')}.xml`);
}
function writeFeedCache(key,text){
  try{
    fs.mkdirSync(FEED_CACHE_DIR,{recursive:true});
    fs.writeFileSync(feedCachePath(key),text,'utf8');
  }catch{}
}
function readFeedCache(key){
  try{
    const p=feedCachePath(key);
    const st=fs.statSync(p);
    const ageHours=(Date.now()-st.mtimeMs)/3600000;
    if(ageHours>FEED_CACHE_HOURS) return null;
    const text=fs.readFileSync(p,'utf8');
    if(!text || text.length<1000) return null;
    return {text,ageHours,path:p};
  }catch{
    return null;
  }
}

function decodeFeedResponse(res){
  const enc=String(res.headers['content-encoding']||'').toLowerCase();
  if(enc.includes('gzip')) return res.pipe(zlib.createGunzip());
  if(enc.includes('deflate')) return res.pipe(zlib.createInflate());
  if(enc.includes('br') && typeof zlib.createBrotliDecompress==='function') return res.pipe(zlib.createBrotliDecompress());
  return res;
}

function fetchFeedStream(url,label='фид',redirects=0){
  if(redirects>6) return Promise.reject(new Error(`${label}: слишком много редиректов`));

  return new Promise((resolve,reject)=>{
    let settled=false;
    let totalTimer=null;
    let req=null;

    const finishError=(e)=>{
      if(settled) return;
      settled=true;
      if(totalTimer) clearTimeout(totalTimer);
      try{ req?.destroy(); }catch{}
      reject(e instanceof Error ? e : new Error(safeText(e)));
    };

    let u;
    try{ u=new URL(url); }
    catch{ return finishError(new Error(`${label}: некорректный URL`)); }

    const lib=u.protocol==='http:' ? http : https;
    const started=Date.now();

    const options={
      protocol:u.protocol,
      hostname:u.hostname,
      port:u.port || undefined,
      path:u.pathname+u.search,
      method:'GET',
      headers:{
        'User-Agent':'Mozilla/5.0 (PrimeTac AUTO Supplier Feed)',
        'Accept':'application/xml,text/xml,text/plain,*/*',
        'Accept-Encoding':'gzip, deflate, br',
        'Connection':'close'
      }
    };

    req=lib.request(options,res=>{
      const status=Number(res.statusCode||0);

      if([301,302,303,307,308].includes(status) && res.headers.location){
        const next=new URL(res.headers.location,url).toString();
        res.resume();
        settled=true;
        if(totalTimer) clearTimeout(totalTimer);
        return resolve(fetchFeedStream(next,label,redirects+1));
      }

      if(status<200 || status>=300){
        const parts=[];
        res.on('data',c=>{ if(Buffer.concat(parts).length<8192) parts.push(c); });
        res.on('end',()=>{
          finishError(new Error(`${label}: HTTP ${status} ${Buffer.concat(parts).toString('utf8').slice(0,500)}`));
        });
        return;
      }

      const stream=decodeFeedResponse(res);
      const chunks=[];
      let bytes=0;
      let lastUi=0;

      const idleReset=()=>{
        try{
          req.setTimeout(FEED_IDLE_TIMEOUT_MS,()=>{
            finishError(new Error(`${label}: сервер не передавал данные ${Math.round(FEED_IDLE_TIMEOUT_MS/1000)} сек`));
          });
        }catch{}
      };
      idleReset();

      stream.on('data',chunk=>{
        const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
        chunks.push(b);
        bytes+=b.length;
        const now=Date.now();

        if(autoState?.running && now-lastUi>900){
          lastUi=now;
          const mb=(bytes/1024/1024).toFixed(1);
          autoState.feed_progress[label]={bytes,mb,url,elapsed_sec:Math.round((now-started)/1000)};
          autoState.phase=`2/5 Загружаю ${label}: ${mb} МБ`;
        }
        idleReset();
      });

      stream.on('error',finishError);
      stream.on('end',()=>{
        if(settled) return;
        settled=true;
        if(totalTimer) clearTimeout(totalTimer);

        const buf=Buffer.concat(chunks);
        const text=buf.toString('utf8');
        if(text.length<1000){
          return reject(new Error(`${label}: ответ слишком маленький (${buf.length} байт)`));
        }

        const elapsed=Math.max(1,Math.round((Date.now()-started)/1000));
        autoState.feed_progress[label]={bytes:buf.length,mb:(buf.length/1024/1024).toFixed(1),url,elapsed_sec:elapsed,done:true};
        resolve({text,url,bytes:buf.length,elapsed_sec:elapsed});
      });
    });

    req.on('error',finishError);

    // Total cap is generous. Unlike old v3.1 this does NOT abort at 90 seconds.
    totalTimer=setTimeout(()=>{
      finishError(new Error(`${label}: загрузка превысила ${Math.round(FEED_TOTAL_TIMEOUT_MS/60000)} мин`));
    },FEED_TOTAL_TIMEOUT_MS);

    req.end();
  });
}

async function fetchSupplierFeedStable(cfg,key){
  const variants=feedUrlVariants(cfg.feedUrl);
  const attempts=Math.max(1,Math.min(3,SUPPLIER_FEED_ATTEMPTS));
  let last=null;

  for(let attempt=1;attempt<=attempts;attempt++){
    const url=variants[(attempt-1)%variants.length];

    try{
      if(autoState?.running){
        autoState.phase=`2/5 Загружаю ${cfg.name}: попытка ${attempt}/${attempts}`;
      }
      const r=await fetchFeedStream(url,cfg.name);
      writeFeedCache(key,r.text);
      autoState.feed_download_source[key]={
        mode:'fresh',
        url:r.url,
        bytes:r.bytes,
        elapsed_sec:r.elapsed_sec
      };
      return r.text;
    }catch(e){
      last=e;
      supplierState.errors.push({supplier:key,attempt,url,error:safeText(e)});

      if(autoState?.stop_requested) throw new Error('Остановлено пользователем');

      if(attempt<attempts){
        const delay=Math.min(30000,SUPPLIER_FEED_RETRY_SEC*1000*attempt);
        if(autoState?.running){
          autoState.phase=`2/5 ${cfg.name}: ${safeText(e)}. Повтор через ${Math.round(delay/1000)} сек`;
        }
        await interruptibleSleep(delay);
      }
    }
  }

  const cached=readFeedCache(key);
  if(cached){
    autoState.feed_download_source[key]={
      mode:'cache',
      age_hours:Number(cached.ageHours.toFixed(2)),
      path:cached.path
    };
    if(autoState?.running){
      autoState.phase=`2/5 ${cfg.name}: свежий фид недоступен, использую успешный кеш ${cached.ageHours.toFixed(1)} ч`;
    }
    return cached.text;
  }

  throw last || new Error(`${cfg.name}: фид не загрузился`);
}

async function fetchTextRetry(url,label='фид'){
  let last=null;
  for(let attempt=1;attempt<=SUPPLIER_FEED_ATTEMPTS;attempt++){
    try{
      if(autoState && autoState.running){
        autoState.phase=`2/5 Загружаю ${label}: попытка ${attempt}/${SUPPLIER_FEED_ATTEMPTS}`;
      }
      return await fetchText(url,SUPPLIER_FEED_TIMEOUT_MS);
    }catch(e){
      last=e;
      if(attempt>=SUPPLIER_FEED_ATTEMPTS) break;
      if(autoState && autoState.stop_requested) throw new Error('Остановлено пользователем');
      const delay=SUPPLIER_FEED_RETRY_SEC*1000*attempt;
      if(autoState && autoState.running){
        autoState.phase=`2/5 ${label} временно недоступен. Повтор через ${Math.round(delay/1000)} сек`;
      }
      await new Promise(r=>setTimeout(r,delay));
    }
  }
  throw last || new Error(label+' не загрузился');
}

function arr(v){ return v===undefined || v===null ? [] : (Array.isArray(v)?v:[v]); }
function primitive(v){
  if(v===undefined || v===null) return '';
  if(typeof v==='string' || typeof v==='number' || typeof v==='boolean') return String(v);
  if(typeof v==='object') return primitive(v['#text'] ?? v['@_value'] ?? v.value ?? v.name ?? '');
  return '';
}

function findOfferArrays(obj, out=[], depth=0){
  if(!obj || depth>12) return out;
  if(Array.isArray(obj)){
    for(const x of obj) findOfferArrays(x,out,depth+1);
    return out;
  }
  if(typeof obj!=='object') return out;
  for(const [k,v] of Object.entries(obj)){
    const low=k.toLowerCase();
    if(['offer','product','item'].includes(low)){
      const xs=arr(v).filter(x=>x && typeof x==='object');
      if(xs.length) out.push(xs);
    }
    findOfferArrays(v,out,depth+1);
  }
  return out;
}

function paramMapFromNode(n){
  const map={};
  const seen=new Set();

  function walk(x, depth=0){
    if(!x || depth>6) return;
    if(Array.isArray(x)){ x.forEach(v=>walk(v,depth+1)); return; }
    if(typeof x!=='object') return;

    const name=norm(x['@_name'] || x['@_key'] || x.name || x.key || x.title || '');
    const value=norm(primitive(x));
    if(name && value && name.length<120 && value.length<1000){
      const k=normalizeLabel(name);
      if(k && !seen.has(k)){ map[name]=value; seen.add(k); }
    }

    for(const [k,v] of Object.entries(x)){
      if(['description','desc','annotation','picture','pictures','image','images'].includes(String(k).toLowerCase())) continue;
      if(v && typeof v==='object') walk(v,depth+1);
    }
  }

  for(const key of ['param','params','parameter','parameters','property','properties','characteristic','characteristics','attributes','attribute']){
    if(n && n[key]!==undefined) walk(n[key],0);
  }
  return map;
}

function supplierRecordFromNode(n, supplier){
  const params=paramMapFromNode(n);
  const name=norm(primitive(n.name || n.title || n.model || n.productName));
  const sku=norm(primitive(n.vendorCode || n.vendor_code || n.sku || n.article || n.code || n['@_id'] || n.id));
  const brand=norm(primitive(n.vendor || n.brand || n.manufacturer || params['Бренд'] || params['Виробник'] || params['Производитель']));
  const url=norm(primitive(n.url || n.link || n.product_url || n['@_url']));
  const description=stripHtml(primitive(n.description || n.desc || n.annotation));
  const pictures=uniq(arr(n.picture || n.pictures || n.image || n.images).flatMap(x=>arr(x)).map(primitive).filter(Boolean));
  const price=norm(primitive(n.price || n.priceRUAH || n.cost));
  const category=norm(primitive(n.categoryId || n.category || n.category_id));
  const stock=stockInfoFromNode(n);
  const available=norm(primitive(n['@_available'] ?? n.available ?? n.presence ?? n.stock ?? n.quantity));
  const id=norm(primitive(n['@_id'] || n.id || sku || name));
  return {supplier,id,sku,name,brand,url,description,pictures,price,category,available,stock,params,raw_hint:Object.keys(n).slice(0,30)};
}

function parseSupplierFeed(xml, supplier){
  const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',textNodeName:'#text',trimValues:true,parseTagValue:false});
  const parsed=parser.parse(xml);
  const arrays=findOfferArrays(parsed);
  if(!arrays.length) return [];
  arrays.sort((a,b)=>b.length-a.length);
  const best=arrays[0];
  const records=[];
  const seen=new Set();
  for(const n of best){
    const r=supplierRecordFromNode(n,supplier);
    if(!r.name && !r.sku) continue;
    const k=(r.sku?cleanSku(r.sku):'')+'|'+normalizeNameForMatch(r.name);
    if(seen.has(k)) continue;
    seen.add(k); records.push(r);
  }
  return records;
}


function parseNumberish(v){
  if(v===undefined || v===null) return null;
  const t=norm(primitive(v)).replace(/\s/g,'').replace(',','.');
  if(!t) return null;
  const m=t.match(/-?\d+(?:\.\d+)?/);
  if(!m) return null;
  const n=Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function parseAvailableBool(v){
  if(v===undefined || v===null) return null;
  const t=norm(primitive(v)).toLowerCase();
  if(!t) return null;

  if(['true','1','yes','y','available','in_stock','instock','!','+','в наличии','в наявності','есть','є'].includes(t)) return true;
  if(['false','0','no','n','not_available','out_of_stock','outofstock','-','нет','немає','відсутній','отсутствует'].includes(t)) return false;

  if(/немає|нет в наличии|не в наличии|out.?of.?stock|not.?available|відсут/.test(t)) return false;
  if(/в наявності|в наличии|available|готово/.test(t)) return true;
  return null;
}

function stockInfoFromNode(n){
  const qCandidates=[
    n?.quantity_in_stock,
    n?.stock_quantity,
    n?.quantity,
    n?.stock,
    n?.remains,
    n?.balance,
    n?.rest
  ];
  let quantity=null;
  let quantityRaw='';
  for(const x of qCandidates){
    const q=parseNumberish(x);
    if(q!==null){
      quantity=Math.max(0,Math.floor(q));
      quantityRaw=norm(primitive(x));
      break;
    }
  }

  const aCandidates=[
    n?.['@_available'],
    n?.available,
    n?.in_stock,
    n?.presence,
    n?.status
  ];
  let available=null;
  let availableRaw='';
  for(const x of aCandidates){
    const b=parseAvailableBool(x);
    if(b!==null){
      available=b;
      availableRaw=norm(primitive(x));
      break;
    }
  }

  if(quantity!==null) available=quantity>0;

  return {
    known: quantity!==null || available!==null,
    quantity,
    available,
    quantity_raw:quantityRaw,
    available_raw:availableRaw
  };
}

function promQuantity(p){
  for(const k of ['quantity_in_stock','stock_quantity','quantity','stock']){
    if(p && p[k]!==undefined && p[k]!==null){
      const n=Number(p[k]);
      if(Number.isFinite(n)) return Math.max(0,Math.floor(n));
    }
  }
  return null;
}

function promPresence(p){
  return norm(p?.presence ?? p?.status ?? '').toLowerCase();
}

function isBezetPromProduct(p){
  const text=norm([
    p?.name,
    p?.brand,
    p?.vendor,
    p?.manufacturer,
    findBrand(p?.name||'')
  ].filter(Boolean).join(' ')).toLowerCase();
  return text.includes('bezet');
}

function sourceIsFresh(key){
  const src=supplierState.sources?.[key];
  if(!src?.ok) return false;
  const mode=src?.download?.mode;
  // Old feeds without diagnostics are treated as fresh only if no error is present.
  return mode ? mode==='fresh' : !src.error;
}

function exactStockMatch(p){
  const skus=promSkuCandidates(p);
  if(!skus.length) return null;

  const preferred=isBezetPromProduct(p)
    ? ['bezet','militaris']
    : ['militaris','bezet'];

  for(const key of preferred){
    const idx=supplierIndexes[key];
    if(!idx) continue;

    for(const sku of skus){
      const rows=idx.sku.get(sku)||[];
      if(!rows.length) continue;

      // Exact SKU only. Stock is too important for fuzzy matching.
      const r=rows[0];
      return {
        supplier:key,
        supplier_name:SUPPLIER_CONFIG[key].name,
        record:r,
        reason:'SKU/артикул',
        score:100
      };
    }
  }
  return null;
}

function readStockSnapshot(){
  try{
    const d=JSON.parse(fs.readFileSync(STOCK_SNAPSHOT_PATH,'utf8'));
    return d && typeof d==='object' ? d : {products:{}};
  }catch{
    return {products:{}};
  }
}

function writeStockSnapshot(data){
  try{
    fs.writeFileSync(STOCK_SNAPSHOT_PATH,JSON.stringify(data,null,2),'utf8');
  }catch(e){
    stockState.errors.unshift({where:'snapshot',error:safeText(e)});
  }
}

function productStockPlan(p,match){
  if(!match?.record?.stock?.known) return null;

  const st=match.record.stock;
  const currentQty=promQuantity(p);
  const currentPresence=promPresence(p);

  const desiredPresence=st.available===true
    ? 'available'
    : st.available===false
      ? 'not_available'
      : null;

  const payload={id:Number(p.id)};
  const changes=[];

  if(st.quantity!==null){
    if(currentQty===null || currentQty!==st.quantity){
      payload.quantity_in_stock=st.quantity;
      changes.push({field:'quantity_in_stock',before:currentQty,after:st.quantity});
    }
  }

  if(desiredPresence){
    const curAvailable=/^available$|in_stock|ready|готов/.test(currentPresence);
    const curNot=/not_available|out_of_stock|нет|немає/.test(currentPresence);

    if((desiredPresence==='available' && !curAvailable) ||
       (desiredPresence==='not_available' && !curNot)){
      payload.presence=desiredPresence;
      payload.in_stock=(desiredPresence==='available');
      changes.push({field:'presence',before:currentPresence||null,after:desiredPresence});
    }
  }

  if(!changes.length) return null;
  return {payload,changes,stock:st};
}


async function runOneStockDiagnostic(){
  if(stockDiag.running) return stockDiag;
  stockDiag={running:true,at:new Date().toISOString(),product:null,request:null,http_status:null,response:null,error:null,verified:null,after:null};
  try{
    // If there is no current plan (e.g. just after deploy), build a fresh preview first.
    if(!lastStockPlans.length){
      await runStockMonitor('diagnostic-preview');
    }
    if(!lastStockPlans.length) throw new Error('Нет запланированных изменений склада для теста');

    // Prefer the simplest case: quantity only, without presence switch.
    const plan=lastStockPlans.find(x=>Array.isArray(x.changes) && x.changes.length===1 && x.changes[0].field==='quantity_in_stock') || lastStockPlans[0];
    const payload=JSON.parse(JSON.stringify(plan.payload));
    stockDiag.product={id:plan.id,name:plan.name,sku:plan.sku,supplier:plan.supplier,changes:plan.changes};
    stockDiag.request={method:'POST',path:'/products/edit',body:[payload]};

    let result;
    try{
      result=await promRequest('POST','/products/edit',[payload]);
      stockDiag.http_status=result?.status ?? 200;
      stockDiag.response=result?.data ?? result;
    }catch(e){
      stockDiag.http_status=e?.status ?? null;
      stockDiag.response=e?.data ?? null;
      stockDiag.error={message:e?.message||String(e),status:e?.status??null,data:e?.data??null};
      return stockDiag;
    }

    await new Promise(r=>setTimeout(r,2500));
    const after=await getProduct(plan.id);
    stockDiag.after=after?{
      id:after.id,
      quantity_in_stock:after.quantity_in_stock ?? after.stock_quantity ?? after.quantity ?? null,
      presence:after.presence ?? after.status ?? null
    }:null;

    const wantQ=payload.quantity_in_stock;
    const gotQ=stockDiag.after?.quantity_in_stock;
    const wantP=payload.presence;
    const gotP=String(stockDiag.after?.presence||'').toLowerCase();
    const qOk=wantQ===undefined || Number(gotQ)===Number(wantQ);
    const pOk=wantP===undefined || gotP===String(wantP).toLowerCase();
    stockDiag.verified=Boolean(after && qOk && pOk);
    return stockDiag;
  }finally{
    stockDiag.running=false;
    stockDiag.at=new Date().toISOString();
  }
}

async function applyStockBatch(plans){
  if(!plans.length) return {ok:true,count:0};
  const payload=plans.map(x=>x.payload);
  const r=await promRequest('POST','/products/edit',payload);
  return {ok:true,count:plans.length,result:r};
}

async function runStockMonitor(reason='manual'){
  if(stockState.running) return;
  if(!STOCK_MONITOR_ENABLED && reason!=='manual') return;
  if(!PROM_TOKEN) throw new Error('PROM_TOKEN не задан');

  Object.assign(stockState,{
    running:true,
    started_at:new Date().toISOString(),
    finished_at:null,
    last_run_reason:reason,
    phase:'1/4 Загружаю каталог Prom',
    progress:5,
    prom_total:0,
    matched:0,
    unmatched:0,
    stock_known:0,
    stock_unknown:0,
    in_stock:0,
    low_stock:0,
    out_of_stock:0,
    planned_changes:0,
    applied_changes:0,
    failed_changes:0,
    skipped_stale_source:0,
    skipped_unsafe_match:0,
    missing_from_feed:0,
    new_supplier_skus:0,
    safety_blocked:false,
    write_enabled:STOCK_WRITE_ENABLED,
    sources:{},
    changes:[],
    errors:[]
  });

  try{
    const products=await listAllProducts();
    stockState.prom_total=products.length;
    promRawCache=new Map(products.map(p=>[String(p.id),p]));

    stockState.phase='2/4 Загружаю XML BEZET + Militaris';
    stockState.progress=20;

    // refreshSupplierFeeds handles retries/cache itself.
    // For stock WRITES we later require a FRESH source, never stale cache.
    await refreshSupplierFeeds();

    stockState.sources={
      bezet:{
        ok:Boolean(supplierState.sources?.bezet?.ok),
        fresh:sourceIsFresh('bezet'),
        count:Number(supplierState.sources?.bezet?.count||0),
        error:safeText(supplierState.sources?.bezet?.error||'')
      },
      militaris:{
        ok:Boolean(supplierState.sources?.militaris?.ok),
        fresh:sourceIsFresh('militaris'),
        count:Number(supplierState.sources?.militaris?.count||0),
        error:safeText(supplierState.sources?.militaris?.error||'')
      }
    };

    stockState.phase='3/4 Сравниваю остатки';
    stockState.progress=45;

    const snapshot=readStockSnapshot();
    const previous=snapshot.products||{};
    const nextProducts={};
    const plans=[];

    const promSkuSet=new Set();
    for(const p of products){
      for(const sku of promSkuCandidates(p)) promSkuSet.add(sku);
    }

    // Count supplier SKUs not present in Prom. Informational only.
    const supplierUnique=new Set();
    for(const key of ['bezet','militaris']){
      for(const r of supplierRecords[key]||[]){
        const sku=cleanSku(r.sku);
        if(sku) supplierUnique.add(key+'|'+sku);
      }
    }
    let newSupplier=0;
    for(const token of supplierUnique){
      const sku=token.split('|').slice(1).join('|');
      if(sku && !promSkuSet.has(sku)) newSupplier++;
    }
    stockState.new_supplier_skus=newSupplier;

    for(const p of products){
      const match=exactStockMatch(p);

      if(!match){
        stockState.unmatched++;
        stockState.skipped_unsafe_match++;
        continue;
      }

      stockState.matched++;
      const key=match.supplier;
      const st=match.record.stock||{known:false};

      nextProducts[String(p.id)]={
        supplier:key,
        sku:cleanSku(match.record.sku)||promSkuCandidates(p)[0]||'',
        name:p.name||'',
        stock:st,
        seen_at:new Date().toISOString()
      };

      if(!st.known){
        stockState.stock_unknown++;
        continue;
      }

      stockState.stock_known++;

      if(st.quantity!==null){
        if(st.quantity===0) stockState.out_of_stock++;
        else if(st.quantity<=STOCK_LOW_THRESHOLD) stockState.low_stock++;
        else stockState.in_stock++;
      }else if(st.available===false){
        stockState.out_of_stock++;
      }else if(st.available===true){
        stockState.in_stock++;
      }

      const plan=productStockPlan(p,match);
      if(!plan) continue;

      // Never write from a stale cache or failed source.
      if(!sourceIsFresh(key)){
        stockState.skipped_stale_source++;
        continue;
      }

      plans.push({
        id:String(p.id),
        name:p.name||'',
        supplier:key,
        sku:cleanSku(match.record.sku)||'',
        ...plan
      });
    }

    // Products that were previously mapped but are absent now are only reported.
    // They are NOT automatically set out-of-stock. This prevents one bad feed from killing sales.
    let missing=0;
    for(const [pid,old] of Object.entries(previous)){
      if(!old?.supplier || !old?.sku) continue;
      const idx=supplierIndexes[old.supplier];
      if(!idx || !sourceIsFresh(old.supplier)) continue;
      if(!(idx.sku.get(cleanSku(old.sku))||[]).length) missing++;
    }
    stockState.missing_from_feed=missing;

    stockState.planned_changes=plans.length;
    lastStockPlans=plans;
    stockState.changes=plans.slice(0,100).map(x=>({
      id:x.id,
      name:x.name,
      supplier:x.supplier,
      sku:x.sku,
      changes:x.changes
    }));

    writeStockSnapshot({
      updated_at:new Date().toISOString(),
      products:nextProducts
    });

    stockState.phase='4/4 Обновляю Prom';
    stockState.progress=75;

    if(!STOCK_WRITE_ENABLED){
      stockState.phase='✅ Проверено. Режим предварительного просмотра: запись в Prom выключена';
      stockState.progress=100;
      return;
    }

    if(plans.length>STOCK_MAX_WRITES && !STOCK_ALLOW_MASS){
      stockState.safety_blocked=true;
      stockState.phase=`⚠️ Защита остановила массовую запись: ${plans.length} изменений > лимита ${STOCK_MAX_WRITES}`;
      stockState.progress=100;
      return;
    }

    for(let i=0;i<plans.length;i+=STOCK_BATCH_SIZE){
      const part=plans.slice(i,i+STOCK_BATCH_SIZE);
      try{
        await applyStockBatch(part);
        stockState.applied_changes+=part.length;
      }catch(e){
        stockState.failed_changes+=part.length;
        stockState.errors.unshift({
          where:'stock-write',
          batch:`${i+1}-${i+part.length}`,
          error:safeText(e)
        });
      }
      stockState.progress=Math.min(99,75+Math.round(24*((i+part.length)/Math.max(1,plans.length))));
    }

    stockState.phase=stockState.failed_changes
      ? `⚠️ Готово: обновлено ${stockState.applied_changes}, ошибок ${stockState.failed_changes}`
      : `✅ Склад обновлён: ${stockState.applied_changes} товаров`;
    stockState.progress=100;

  }catch(e){
    stockState.phase='Ошибка';
    stockState.errors.unshift({where:'stock-monitor',error:safeText(e)});
  }finally{
    stockState.running=false;
    stockState.finished_at=new Date().toISOString();
    stockState.next_run_at=new Date(Date.now()+STOCK_INTERVAL_HOURS*3600*1000).toISOString();
  }
}

function buildSupplierIndex(records){
  const sku=new Map(), name=new Map(), token=new Map();
  const tokensByRecord=new Map();

  for(const r of records){
    if(r.sku){
      const k=cleanSku(r.sku);
      if(k){ if(!sku.has(k)) sku.set(k,[]); sku.get(k).push(r); }
    }
    if(r.name){
      const k=normalizeNameForMatch(r.name);
      if(k){ if(!name.has(k)) name.set(k,[]); name.get(k).push(r); }

      const toks=[...nameTokens(r.name)];
      tokensByRecord.set(r,toks);
      for(const t of toks){
        if(!token.has(t)) token.set(t,[]);
        token.get(t).push(r);
      }
    }
  }
  return {sku,name,token,tokensByRecord};
}

function promSkuCandidates(p){
  const vals=[];
  for(const k of ['sku','article','vendor_code','vendorCode','code','external_id','externalId','presence_sku']){
    if(p && p[k]!==undefined && p[k]!==null) vals.push(primitive(p[k]));
  }
  return uniq(vals.map(cleanSku).filter(Boolean));
}

function supplierScore(p,r){
  const pSkus=promSkuCandidates(p);
  const rSku=cleanSku(r.sku);
  if(rSku && pSkus.includes(rSku)) return {score:100,reason:'SKU/артикул'};
  const pn=normalizeNameForMatch(p.name), rn=normalizeNameForMatch(r.name);
  if(pn && rn && pn===rn) return {score:96,reason:'точное название'};
  const jac=jaccardName(p.name,r.name);
  let score=Math.round(jac*90);
  const pb=findBrand(p.name), rb=findBrand(r.name+' '+r.brand);
  if(pb && rb && pb.toLowerCase()===rb.toLowerCase()) score+=5;
  const pc=findColor(p.name), rc=findColor(r.name);
  if(pc && rc && pc===rc) score+=3;
  return {score:Math.min(94,score),reason:'сходство названия'};
}

function bestSupplierMatch(p){
  let best=null;

  for(const key of ['bezet','militaris']){
    const idx=supplierIndexes[key];
    if(!idx) continue;

    let candidates=[];

    // 1. SKU / артикул
    for(const sku of promSkuCandidates(p)){
      if(idx.sku.has(sku)) candidates.push(...idx.sku.get(sku));
    }

    // 2. Точное нормализованное название
    const nk=normalizeNameForMatch(p.name);
    if(idx.name.has(nk)) candidates.push(...idx.name.get(nk));

    // 3. Быстрый индекс по словам, без полного перебора всего фида
    if(!candidates.length){
      const toks=[...nameTokens(p.name)];
      const hits=new Map();
      for(const t of toks){
        for(const r of (idx.token.get(t)||[])) hits.set(r,(hits.get(r)||0)+1);
      }
      const minHit=Math.min(3,Math.max(2,toks.length));
      candidates=[...hits.entries()]
        .filter(([_r,n])=>n>=minHit)
        .sort((a,b)=>b[1]-a[1])
        .slice(0,120)
        .map(([r])=>r);
    }

    const uniqCandidates=[...new Map(candidates.map(r=>[(r.id||r.sku||r.name),r])).values()];

    for(const r of uniqCandidates){
      const sc=supplierScore(p,r);
      if(sc.score<62) continue;
      const m={supplier:key,supplier_name:SUPPLIER_CONFIG[key].name,score:sc.score,reason:sc.reason,record:r};
      if(!best || m.score>best.score) best=m;
    }
  }

  return best;
}

function normalizeLabel(v){
  return norm(v).toLowerCase().replace(/[.:]/g,'').replace(/\s+/g,' ');
}

function fieldFromLabels(map, labels){
  for(const [k,v] of Object.entries(map||{})){
    const nk=normalizeLabel(k);
    if(labels.some(x=>nk.includes(x))) return norm(v);
  }
  return '';
}

function parseSupplierPage(html, url){
  const $=cheerio.load(html);
  $('script,style,noscript,svg').not('script[type="application/ld+json"]').remove();
  const characteristics={};
  let jsonProduct=null;

  $('script[type="application/ld+json"]').each((_i,el)=>{
    try{
      const data=JSON.parse($(el).text());
      const items=Array.isArray(data)?data:[data];
      const walk=(x)=>{
        if(!x || typeof x!=='object') return;
        if(String(x['@type']||'').toLowerCase()==='product' && !jsonProduct) jsonProduct=x;
        for(const v of Object.values(x)){
          if(Array.isArray(v)) v.forEach(walk); else if(v && typeof v==='object') walk(v);
        }
      };
      items.forEach(walk);
    }catch(_){ }
  });

  $('tr').each((_i,tr)=>{
    const cells=$(tr).find('th,td').map((_j,c)=>norm($(c).text())).get().filter(Boolean);
    if(cells.length>=2 && cells[0].length<80) characteristics[cells[0]]=cells.slice(1).join(' ');
  });
  $('dt').each((_i,dt)=>{
    const k=norm($(dt).text()); const v=norm($(dt).next('dd').text());
    if(k&&v) characteristics[k]=v;
  });

  // Пары "лейбл — значение" в блоках характеристик, как на BEZET.
  $('[class*=character], [class*=spec], [class*=property], [class*=attr]').each((_i,el)=>{
    const txt=norm($(el).text());
    const m=txt.match(/^(Бренд|Артикул|Країна виробник|Страна производитель|Колір|Цвет|Матеріал|Материал|Сезон|Особливості товару|Особенности товара|Призначення|Назначение|Догляд за речами|Уход|Мембрана|Утеплювач|Утеплитель|Блискавка|Молния|Склад|Состав|Вага|Вес)\s*[:\-]?\s*(.+)$/i);
    if(m && m[2] && m[2].length<300) characteristics[m[1]]=m[2];
  });

  const bodyText=norm($('body').text());
  const known=['Бренд','Артикул','Країна виробник','Колір','Матеріал','Сезон','Особливості товару','Призначення','Догляд за речами','Мембрана','Утеплювач','Блискавка','Склад','Вага'];
  for(const label of known){
    if(fieldFromLabels(characteristics,[normalizeLabel(label)])) continue;
    const re=new RegExp(label+'\\s*[:\\-]?\\s*([^\\n|]{1,120})','i');
    const m=bodyText.match(re); if(m) characteristics[label]=norm(m[1]);
  }

  const sizes=uniq(
    $('button,input,label,option').map((_i,el)=>norm($(el).attr('value')||$(el).text())).get()
      .flatMap(x=>detectSizes(x))
  );

  const title=norm(jsonProduct?.name || $('h1').first().text() || $('title').text());
  const description=stripHtml(jsonProduct?.description || $('meta[name="description"]').attr('content') || '');
  const sku=norm(jsonProduct?.sku || fieldFromLabels(characteristics,['артикул','sku','код']));
  let brand='';
  if(jsonProduct?.brand){ brand=norm(typeof jsonProduct.brand==='string'?jsonProduct.brand:jsonProduct.brand.name); }
  if(!brand) brand=fieldFromLabels(characteristics,['бренд','виробник','производитель']);
  const price=norm(jsonProduct?.offers?.price || jsonProduct?.offers?.lowPrice || '');

  return {url,title,description,sku,brand,price,sizes,characteristics,body_sample:bodyText.slice(0,1200)};
}

function feedDetails(r){
  const pm=r?.params||{};
  const combined=(r?.name||'')+' '+(r?.description||'');
  return {
    producer: r?.brand || fieldFromLabels(pm,['бренд','виробник','производитель']) || findBrand(combined),
    type: fieldFromLabels(pm,['вид виробу','вид товара','тип виробу','тип товара','категорія']) || findType(combined),
    color: fieldFromLabels(pm,['колір','цвет']) || findColor(combined),
    sizes: uniq(Object.entries(pm).filter(([k])=>/розмір|размер|size/i.test(k)).flatMap(([_k,v])=>detectSizes(v)).concat(detectSizes(combined))),
    material: fieldFromLabels(pm,['матеріал','материал','склад','состав']),
    season: fieldFromLabels(pm,['сезон']),
    country: fieldFromLabels(pm,['країна','страна']),
    purpose: fieldFromLabels(pm,['призначення','назначение']),
    features: fieldFromLabels(pm,['особливості','особенности']),
    membrane: fieldFromLabels(pm,['мембрана']),
    insulation: fieldFromLabels(pm,['утеплювач','утеплитель']),
    zipper: fieldFromLabels(pm,['блискавка','молния']),
    weight: fieldFromLabels(pm,['вага','вес'])
  };
}

function pageDetails(page){
  const c=page?.characteristics||{};
  const combined=(page?.title||'')+' '+(page?.description||'');
  return {
    producer: page?.brand || fieldFromLabels(c,['бренд','виробник','производитель']) || findBrand(combined),
    type: fieldFromLabels(c,['вид виробу','вид товара','тип виробу','тип товара']) || findType(combined),
    color: fieldFromLabels(c,['колір','цвет']) || findColor(combined),
    sizes: uniq([...(page?.sizes||[]),...detectSizes(combined)]),
    material: fieldFromLabels(c,['матеріал','материал','склад','состав']),
    season: fieldFromLabels(c,['сезон']),
    country: fieldFromLabels(c,['країна','страна']),
    purpose: fieldFromLabels(c,['призначення','назначение']),
    features: fieldFromLabels(c,['особливості','особенности']),
    care: fieldFromLabels(c,['догляд','уход']),
    membrane: fieldFromLabels(c,['мембрана']),
    insulation: fieldFromLabels(c,['утеплювач','утеплитель']),
    zipper: fieldFromLabels(c,['блискавка','молния']),
    weight: fieldFromLabels(c,['вага','вес'])
  };
}

function mergeSupplierDetails(feed, page){
  const out={};
  for(const k of ['producer','type','color','material','season','country','purpose','features','care','membrane','insulation','zipper','weight']){
    out[k]=norm(page?.[k] || feed?.[k] || '');
  }
  out.sizes=uniq([...(page?.sizes||[]),...(feed?.sizes||[])]);
  return out;
}


function supplierPlanForRawProduct(p, match){
  if(!p || !match) return {changes:[],details:null};
  const details=feedDetails(match.record);
  const patch=buildAttributePatch(p,details);
  return {changes:patch.changes||[],details,patch};
}

function recalcSupplierFillable(){
  const by={}; let products=0, fields=0;
  for(const [id,match] of supplierMatches.entries()){
    const p=promRawCache.get(String(id));
    if(!p) continue;
    const plan=supplierPlanForRawProduct(p,match);
    if(plan.changes.length){
      products++; fields+=plan.changes.length;
      for(const c of plan.changes) by[c.key]=(by[c.key]||0)+1;
    }
  }
  supplierState.fillable_products=products;
  supplierState.fillable_fields=fields;
  supplierState.fillable_by_field=by;
}

async function refreshSupplierFeeds(){
  if(supplierState.loading) return;
  supplierState.loading=true;
  supplierState.errors=[];
  try{
    for(const key of ['bezet','militaris']){
      const cfg=SUPPLIER_CONFIG[key];
      try{
        const xml=await fetchSupplierFeedStable(cfg,key);
        const records=parseSupplierFeed(xml,key);
        if(!records.length) throw new Error('Фид загрузился, но товары не распознаны. Проверьте формат фида.');
        supplierRecords[key]=records;
        supplierIndexes[key]=buildSupplierIndex(records);
        supplierState.sources[key]={
          ok:true,
          name:cfg.name,
          count:records.length,
          feed_url:cfg.feedUrl,
          site_url:cfg.siteUrl,
          error:null,
          download:autoState.feed_download_source[key]||null
        };
      }catch(e){
        supplierState.sources[key]={ok:false,name:cfg.name,count:0,feed_url:cfg.feedUrl,site_url:cfg.siteUrl,error:safeText(e)};
        supplierState.errors.push({supplier:key,error:safeText(e)});
      }
    }
    supplierState.updated_at=new Date().toISOString();
  }finally{
    supplierState.loading=false;
  }
}

async function matchSupplierCatalog(){
  if(supplierState.matching) return;
  supplierState.matching=true;
  supplierState.match_processed=0;
  supplierState.match_total=0;
  try{
    let products=[...promRawCache.values()];
    if(!products.length){
      products=await listAllProducts();
      promRawCache=new Map(products.map(p=>[String(p.id),p]));
    }

    supplierState.match_total=products.length;
    supplierMatches.clear();
    let matched=0;

    for(let i=0;i<products.length;i++){
      const p=products[i];
      const m=bestSupplierMatch(p);
      if(m){ supplierMatches.set(String(p.id),m); matched++; }
      supplierState.match_processed=i+1;

      // Отдаём управление event loop, чтобы интерфейс и /state не зависали.
      if((i+1)%25===0) await new Promise(r=>setTimeout(r,0));
    }

    supplierState.matched_products=matched;
    supplierState.unmatched_products=Math.max(0,products.length-matched);
    recalcSupplierFillable();
    supplierState.match_updated_at=new Date().toISOString();
  }finally{
    supplierState.matching=false;
  }
}

async function syncSuppliers(){
  await refreshSupplierFeeds();

  const missing=[];
  for(const key of ['bezet','militaris']){
    const src=supplierState.sources?.[key];
    if(!src?.ok){
      missing.push(`${SUPPLIER_CONFIG[key].name}: ${safeText(src?.error)||'не загрузился'}`);
    }
  }

  if(missing.length){
    supplierMatches.clear();
    supplierState.matched_products=0;
    supplierState.unmatched_products=Number(scanState.total||promRawCache.size||0);
    throw new Error(
      'Не продолжаю частичную обработку. Не загрузились все поставщики: '+
      missing.join(' | ')
    );
  }

  await matchSupplierCatalog();
}

async function getSupplierEnrichmentForProm(id, loadPage=false){
  let p=promRawCache.get(String(id));
  if(!p){
    p=await getProduct(id);
    if(p) promRawCache.set(String(id),p);
  }
  if(!p) throw new Error('Товар Prom не найден');
  let match=supplierMatches.get(String(id));
  if(!match){ match=bestSupplierMatch(p); if(match) supplierMatches.set(String(id),match); }
  if(!match) return {ok:true,prom:{id:p.id,name:p.name},matched:false};
  const feed=feedDetails(match.record);
  let page=null, pageError=null;
  if(loadPage && match.record.url){
    try{ page=parseSupplierPage(await fetchText(match.record.url,45000),match.record.url); }
    catch(e){ pageError=e.message||String(e); }
  }
  const pageD=page?pageDetails(page):null;
  const merged=mergeSupplierDetails(feed,pageD);
  return {
    ok:true,
    prom:{id:p.id,name:p.name,sku:promSkuCandidates(p)},
    matched:true,
    match:{supplier:match.supplier,supplier_name:match.supplier_name,score:match.score,reason:match.reason},
    supplier_product:{id:match.record.id,sku:match.record.sku,name:match.record.name,url:match.record.url,brand:match.record.brand,price:match.record.price,params:match.record.params},
    feed_details:feed,
    page_loaded:Boolean(page),
    page_error:pageError,
    page:page,
    merged
  };
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

        const hasApiErrorValue = v => {
          if(v === undefined || v === null || v === false) return false;
          if(Array.isArray(v)) return v.length > 0;
          if(typeof v === 'object') return Object.keys(v).length > 0;
          if(typeof v === 'string') return v.trim().length > 0;
          return Boolean(v);
        };
        const bodyError =
          data && typeof data === 'object' &&
          (hasApiErrorValue(data.error) ||
           hasApiErrorValue(data.errors) ||
           (hasApiErrorValue(data.message) && /required|invalid|error/i.test(String(data.message))));

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

  const existingProducer = getActualProducer(p);
  const detectedProducer = findBrand(combined);

  const existingType = getActualType(p);
  const detectedType = findType(combined);

  const existingColor = getActualColor(p);
  const detectedColor = findColor(combined);

  const sizes = getActualSizes(p);
  const suggestedSizes = detectSizes(combined);

  const category = getCategory(p);
  const weight = getActualWeight(p);
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
      ok: existingKeywords.length >= KEYWORD_ACCEPT_MIN,
      value: existingKeywords.length ? existingKeywords.join(', ') : 'Пусто',
      suggestion: mergedKeywords.join(', ')
    },
    producer: {
      ok: Boolean(existingProducer),
      value: existingProducer || 'Пусто',
      suggestion: !existingProducer && detectedProducer ? `Можно поставить: ${detectedProducer}` : ''
    },
    type: {
      ok: Boolean(existingType),
      value: existingType || 'Пусто',
      suggestion: !existingType && detectedType ? `Можно поставить: ${detectedType}` : ''
    },
    color: {
      ok: Boolean(existingColor),
      value: existingColor || 'Пусто',
      suggestion: !existingColor && detectedColor ? `Можно поставить: ${detectedColor}` : ''
    },
    size: {
      ok: sizes.length > 0,
      value: sizes.length ? sizes.join(', ') : 'Пусто',
      suggestion: sizes.length ? '' : (suggestedSizes.length ? ('Можно предположить из названия: '+suggestedSizes.join(', ')) : 'Нет подтверждённых размеров в Prom')
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
      can_fix_ua_keywords: existingKeywords.length < KEYWORD_ACCEPT_MIN && mergedKeywords.length > existingKeywords.length,
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
    missing_fields_total: Object.values(missing).reduce((a,b)=>a+b,0),
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
    summary: null,
    last_error: null
  };

  try{
    const products = await listAllProducts();
    promRawCache = new Map(products.map(p => [String(p.id), p]));
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
    scanState.last_error = e && e.message ? e.message : String(e);
    scanState.finished_at = new Date().toISOString();
    scanState.summary = {
      total: scanState.total,
      valid: 0,
      errors: scanState.errors,
      average_score: 0,
      need_safe_fix: 0,
      missing: {}
    };
    console.error('[SCAN ERROR]', scanState.last_error);
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
      verified: oldKeywords.length >= KEYWORD_ACCEPT_MIN,
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
  await new Promise(r => setTimeout(r, VERIFY_DELAY_MS));

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

async function startBatchFix(limit=BATCH_SIZE, mode='batch'){
  if(fixState.running) return;

  const allCandidates = (scanState.rows || [])
    .filter(r => r && !r.__error && r.safe?.can_fix_ua_keywords && !rejectedKeywordIds.has(String(r.id)));

  const candidates = limit === 'all'
    ? allCandidates
    : allCandidates.slice(0, Math.max(1, Number(limit || BATCH_SIZE)));

  fixState = {
    running: true,
    started_at: new Date().toISOString(),
    finished_at: null,
    planned: candidates.length,
    processed: 0,
    verified: 0,
    failed: 0,
    errors: [],
    mode,
    stop_requested: false
  };

  try{
    let cursor = 0;

    async function worker(){
      while(true){
        if(fixState.stop_requested) break;

        const i = cursor++;
        if(i >= candidates.length) break;

        const row = candidates[i];

        try{
          const result = await fixUaKeywordsForProduct(row.id);
          fixState.processed++;

          if(result.verified || result.skipped){
            fixState.verified++;
          }else{
            rejectedKeywordIds.add(String(row.id));
            fixState.failed++;
            fixState.errors.push({
              id: row.id,
              name: row.name,
              error: 'Prom не подтвердил новые UA keywords'
            });
          }

          // Обновляем строку сразу после каждого товара
          const idx = scanState.rows.findIndex(r => r && String(r.id) === String(row.id));
          if(idx >= 0){
            try{
              const p = await getProduct(row.id) || { id: row.id, name: row.name };
              const ua = await getTranslation(row.id, 'uk');
              scanState.rows[idx] = buildAudit(p, ua && !ua.__error ? ua : null);
            }catch(_){}
          }
        }catch(e){
          fixState.processed++;
          fixState.failed++;
          fixState.errors.push({
            id: row.id,
            name: row.name,
            error: e.message || String(e)
          });
        }
      }
    }

    await Promise.all(
      Array.from(
        { length: Math.min(FIX_CONCURRENCY, Math.max(1, candidates.length)) },
        worker
      )
    );

    scanState.summary = summarize(scanState.rows);
  }finally{
    fixState.finished_at = new Date().toISOString();
    fixState.running = false;
  }
}


async function editPromAttributes(id, details){
  if(!WRITE_ENABLED) throw new Error('WRITE_ENABLED=false');
  let p=await getProduct(id);
  if(!p) throw new Error('Prom товар не найден');
  const patch=buildAttributePatch(p,details);
  if(!patch.changes.length) return {ok:true,skipped:true,verified:false,reason:patch.reason,changes:[]};
  const payload={id:Number(id),attributes:patch.attributes};
  if(p.presence) payload.presence=p.presence;
  else if(p.status && ['available','not_available','preorder'].includes(String(p.status))) payload.presence=p.status;
  const result=await promRequest('POST','/products/edit',[payload]);
  await new Promise(r=>setTimeout(r,VERIFY_DELAY_MS));
  const after=await getProduct(id);
  const verified=[];
  for(const c of patch.changes){
    const a=findPromAttribute(after,ATTR_LABELS[c.key]||[]);
    if(a && norm(attrValue(a)).toLowerCase()===norm(c.after).toLowerCase()) verified.push(c);
  }
  if(after) promRawCache.set(String(id),after);
  return {ok:true,skipped:false,verified:verified.length>0,verified_changes:verified,planned_changes:patch.changes,result};
}

async function testOneAttributeWrite(id=null){
  if(!supplierMatches.size) throw new Error('Сначала загрузите и сопоставьте поставщиков');

  // ВАЖНО: раньше тест последовательно обходил весь каталог.
  // Если Prom API не отдавал ни одной записываемой характеристики,
  // это выглядело как вечное зависание.
  recalcSupplierFillable();

  if(!id && Number(supplierState.fillable_fields||0) === 0){
    throw new Error(
      'Тест не запускается: Prom API не отдал ни одной пустой характеристики для записи (0 товаров / 0 полей). ' +
      'Данные BEZET/Militaris найдены, но характеристики нужно обновлять через импорт Prom, а не products/edit.'
    );
  }

  let candidates=[];
  if(id){
    candidates=[String(id)];
  }else{
    // Берём только товары, для которых уже по кешу реально есть план изменения.
    for(const [pid,match] of supplierMatches.entries()){
      const cached=promRawCache.get(String(pid));
      if(!cached) continue;
      const plan=supplierPlanForRawProduct(cached,match);
      if(plan && plan.changes && plan.changes.length){
        candidates.push(String(pid));
        break; // для теста нужен только один товар
      }
    }
  }

  if(!candidates.length){
    throw new Error(
      'Нет товара для теста: Prom API не предоставляет записываемые пустые category attributes. ' +
      'Используйте импорт характеристик.'
    );
  }

  const pid=candidates[0];
  const match=supplierMatches.get(String(pid));
  if(!match) throw new Error('Товар поставщика не найден для теста');

  let p=promRawCache.get(String(pid)) || await getProduct(pid);
  if(!p) throw new Error('Товар Prom не найден');

  const details=feedDetails(match.record);
  const patch=buildAttributePatch(p,details);
  if(!patch.changes.length){
    throw new Error('У выбранного товара нет характеристики, которую Prom API позволяет заполнить');
  }

  const one=patch.changes[0];
  const currentAttrs=promAttributes(p);
  const attrs=currentAttrs.map(x=>JSON.parse(JSON.stringify(x)));
  const target=findPromAttribute(p,ATTR_LABELS[one.key]||[]);
  const idx=currentAttrs.indexOf(target);
  if(idx<0) throw new Error('Prom не вернул нужную характеристику в attributes');

  attrs[idx]=setAttributeValue(target,one.after);
  const payload={id:Number(pid),attributes:attrs};
  if(p.presence) payload.presence=p.presence;
  else if(p.status && ['available','not_available','preorder'].includes(String(p.status))) payload.presence=p.status;

  const result=await promRequest('POST','/products/edit',[payload]);
  await new Promise(r=>setTimeout(r,VERIFY_DELAY_MS));

  const after=await getProduct(pid);
  const aa=findPromAttribute(after,ATTR_LABELS[one.key]||[]);
  const verified=Boolean(
    aa && norm(attrValue(aa)).toLowerCase()===norm(one.after).toLowerCase()
  );

  enrichState.attribute_probe={
    at:new Date().toISOString(),
    id:pid,
    name:p.name,
    field:one.name,
    value:one.after,
    verified,
    result
  };

  if(after) promRawCache.set(String(pid),after);
  return enrichState.attribute_probe;
}

async function enrichAttributesMass(limit='all'){
  if(enrichState.running) return;
  if(!enrichState.attribute_probe?.verified) throw new Error('Сначала нужен успешный тест записи 1 характеристики');
  let ids=[...supplierMatches.keys()];
  if(limit!=='all') ids=ids.slice(0,Math.max(1,Number(limit)||25));
  enrichState={...enrichState,running:true,mode:'attributes',started_at:new Date().toISOString(),finished_at:null,planned:ids.length,processed:0,verified:0,failed:0,changed_fields:0,errors:[],stop_requested:false};
  try{
    let cursor=0;
    async function worker(){
      while(true){
        if(enrichState.stop_requested) break;
        const i=cursor++; if(i>=ids.length) break;
        const id=ids[i], match=supplierMatches.get(String(id));
        try{
          const details=feedDetails(match.record);
          const r=await editPromAttributes(id,details);
          enrichState.processed++;
          if(r.skipped) continue;
          if(r.verified){ enrichState.verified++; enrichState.changed_fields+=(r.verified_changes||[]).length; }
          else { enrichState.failed++; enrichState.errors.push({id,error:'Prom не подтвердил запись характеристик',planned:r.planned_changes}); }
        }catch(e){ enrichState.processed++; enrichState.failed++; enrichState.errors.push({id,error:safeText(e)}); }
      }
    }
    await Promise.all(Array.from({length:Math.min(ENRICH_CONCURRENCY,Math.max(1,ids.length))},worker));
    recalcSupplierFillable();
  }finally{ enrichState.running=false; enrichState.finished_at=new Date().toISOString(); }
}

async function enrichDescriptionsMass(limit='all'){
  if(enrichState.running) return;
  let ids=[...supplierMatches.keys()];
  if(limit!=='all') ids=ids.slice(0,Math.max(1,Number(limit)||25));
  enrichState={...enrichState,running:true,mode:'descriptions',started_at:new Date().toISOString(),finished_at:null,planned:ids.length,processed:0,verified:0,failed:0,changed_fields:0,errors:[],stop_requested:false};
  try{
    for(const id of ids){
      if(enrichState.stop_requested) break;
      const match=supplierMatches.get(String(id));
      try{
        const before=await getTranslation(id,'uk');
        const src=stripHtml(match?.record?.description||'');
        const old=stripHtml(before?.description||'');
        if(src.length<220 || old.length>=220 || src.length<=old.length+80){ enrichState.processed++; continue; }
        const payload={product_id:Number(id),lang:'uk',description:match.record.description};
        if(before?.name) payload.name=before.name;
        if(before?.keywords!==undefined) payload.keywords=before.keywords;
        await promRequest('PUT','/products/translation',payload);
        await new Promise(r=>setTimeout(r,VERIFY_DELAY_MS));
        const after=await getTranslation(id,'uk');
        const ok=stripHtml(after?.description||'').length>=Math.min(220,src.length);
        enrichState.processed++;
        if(ok){enrichState.verified++;enrichState.changed_fields++;} else {enrichState.failed++;enrichState.errors.push({id,error:'Prom не подтвердил новое описание'});}
      }catch(e){enrichState.processed++;enrichState.failed++;enrichState.errors.push({id,error:safeText(e)});}
    }
  }finally{ enrichState.running=false; enrichState.finished_at=new Date().toISOString(); }
}

let serverActionNotice = '';

function autoEscHtml(v){
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function autoEscXml(v){
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
function autoCdata(v){ return '<![CDATA['+String(v ?? '').replace(/]]>/g,']]]]><![CDATA[>')+']]>'; }

async function autoSeoOneFast(p){
  const id=String(p.id);
  const match=supplierMatches.get(id)||null;

  const ua=await getTranslation(p.id,'uk');
  if(ua && ua.__error) throw new Error(ua.__error);

  const oldKeywords=parseKeywords(ua?.keywords||'');
  const suggestions=keywordSuggestions(p,ua?.name||p.name);
  const proposed=uniq([...oldKeywords,...suggestions]).slice(0,7);
  const needKeywords=oldKeywords.length<KEYWORD_ACCEPT_MIN && proposed.length>oldKeywords.length;

  const currentDescription=stripHtml(ua?.description || p.description || '');
  const supplierDescription=stripHtml(match?.record?.description || '');
  const needDescription=Boolean(
    match &&
    currentDescription.length<320 &&
    supplierDescription.length>=260 &&
    supplierDescription.length>currentDescription.length+80
  );

  if(needKeywords) autoState.keywords_planned++;
  if(needDescription) autoState.descriptions_planned++;
  if(!needKeywords && !needDescription) return {changed:false};

  const payload={
    product_id:Number(p.id),
    lang:'uk',
    name:norm(ua?.name||p.name||''),
    description:needDescription ? supplierDescription : String(ua?.description ?? p.description ?? ''),
    keywords:(needKeywords ? proposed : oldKeywords).join(', ')
  };

  await promRequest('PUT','/products/translation',payload);

  if(needKeywords) autoState.keywords_changed++;
  if(needDescription) autoState.descriptions_changed++;

  return {changed:true,keywords:needKeywords,description:needDescription};
}

async function runFastSeoPass(products){
  autoState.current=0;
  autoState.current_total=products.length;
  autoState.seo_errors=0;

  let index=0;
  const concurrency=Math.max(2,Math.min(8,Number(process.env.AUTO_SEO_CONCURRENCY||5)));

  async function runner(){
    while(true){
      if(autoState.stop_requested) return;
      const i=index++;
      if(i>=products.length) return;
      const p=products[i];
      try{
        await autoSeoOneFast(p);
      }catch(e){
        autoState.seo_errors++;
        if(autoState.errors.length<30){
          autoState.errors.push({
            where:'ключи/описание',
            id:p?.id,
            name:p?.name,
            error:safeText(e)
          });
        }
      }finally{
        autoState.current++;
        autoState.keywords_checked=autoState.current;
        autoState.descriptions_checked=autoState.current;
        const ratio=autoState.current/Math.max(1,autoState.current_total);
        autoState.progress=Math.round(35 + ratio*40);
        autoState.phase=`3/5 Ключи + описания ${autoState.current}/${autoState.current_total}`;
      }

      // Give Render event loop a chance to answer the status page.
      if(autoState.current%10===0) await new Promise(r=>setTimeout(r,0));
    }
  }

  await Promise.all(Array.from({length:Math.min(concurrency,products.length)},runner));
}

function autoExternalId(p){ return norm(p?.external_id ?? p?.externalId ?? ''); }
function autoGroupId(p){
  return norm(
    p?.group_id ?? p?.groupId ??
    (p?.group && typeof p.group==='object' ? (p.group.id ?? p.group.external_id ?? p.group.externalId) : '') ??
    p?.category_id ?? (p?.category && typeof p.category==='object' ? p.category.id : '') ?? ''
  );
}
function autoPresence(p){
  const x=String(p?.presence ?? p?.status ?? '').toLowerCase();
  return !/not_available|out|нет|немає|false/.test(x);
}
function autoImportAttributes(match,p){
  const map=new Map();
  const raw=match?.record?.params || {};
  for(const [k0,v0] of Object.entries(raw)){
    const k=norm(k0),v=norm(v0);
    if(!k || !v || k.length>90 || v.length>500) continue;
    if(/ціна|цена|price|артикул|sku|код товар|наявн|налич|кількість|количество/i.test(k)) continue;
    map.set(k,v);
    if(map.size>=28) break;
  }
  const d=feedDetails(match?.record||{});
  const put=(k,v)=>{v=norm(v); if(v && !map.has(k)) map.set(k,v);};
  put('Виробник',d.producer);
  put(d.type==='Куртка'?'Вид куртки':'Вид виробу',d.type);
  put('Колір',d.color);
  const sizes=uniq(d.sizes||[]); if(sizes.length===1) put('Міжнародний розмір',sizes[0]);
  put('Матеріал',d.material);
  put('Сезон',d.season);
  put('Країна виробник',d.country);
  put('Призначення',d.purpose);
  put('Особливості товару',d.features);
  put('Мембрана',d.membrane);
  put('Утеплювач',d.insulation);
  put('Блискавка',d.zipper);
  put('Вага',d.weight);
  return [...map.entries()].filter(([,v])=>norm(v));
}

function buildAutoYml(items){
  const catXml=managedCategoriesXml();
  const offers=items.map(({p,match,attrs,managedGroup})=>{
    const ext=autoExternalId(p);
    const gid=String(managedGroup?.id || FALLBACK_GROUP.id);
    const vendor=norm(match?.record?.brand || feedDetails(match?.record||{}).producer || '');
    const params=(attrs||[]).map(([k,v])=>`<param name="${autoEscXml(k)}">${autoEscXml(v)}</param>`).join('\n');
    return `<offer id="${autoEscXml(ext)}" available="${autoPresence(p)?'true':'false'}">
<name>${autoEscXml(p.name||match?.record?.name||'Товар')}</name>
<categoryId>${autoEscXml(gid)}</categoryId>
${vendor?`<vendor>${autoEscXml(vendor)}</vendor>`:''}
${params}
</offer>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE yml_catalog SYSTEM "shops.dtd">
<yml_catalog date="${new Date().toISOString().slice(0,16).replace('T',' ')}">
<shop>
<name>PrimeTac Group Managed Catalog</name>
<company>PrimeTac Group</company>
<url>https://primetacgroup.pro</url>
<currencies><currency id="UAH" rate="1"/></currencies>
<categories>
${catXml}
</categories>
<offers>
${offers}
</offers>
</shop>
</yml_catalog>`;
}

function promImportFile(xmlText,settings){
  if(!PROM_TOKEN) return Promise.reject(new Error('PROM_TOKEN не задан'));
  return new Promise((resolve,reject)=>{
    const boundary='----PrimeTac'+Date.now().toString(16)+Math.random().toString(16).slice(2);
    const chunks=[];
    const add=x=>chunks.push(Buffer.isBuffer(x)?x:Buffer.from(String(x),'utf8'));
    add(`--${boundary}\r\nContent-Disposition: form-data; name="data"\r\n\r\n${JSON.stringify(settings)}\r\n`);
    add(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="primetac-attributes.xml"\r\nContent-Type: application/xml\r\n\r\n`);
    add(Buffer.from(xmlText,'utf8'));
    add(`\r\n--${boundary}--\r\n`);
    const body=Buffer.concat(chunks);

    const req=https.request({
      hostname:API_HOST,
      port:443,
      path:API_PREFIX+'/products/import_file',
      method:'POST',
      headers:{
        'Authorization':`Bearer ${PROM_TOKEN}`,
        'Accept':'application/json',
        'Content-Type':`multipart/form-data; boundary=${boundary}`,
        'Content-Length':body.length
      },
      timeout:120000
    },res=>{
      const bufs=[];
      res.on('data',c=>bufs.push(c));
      res.on('end',()=>{
        const raw=Buffer.concat(bufs).toString('utf8');
        let data={};
        try{ data=raw?JSON.parse(raw):{}; }catch{ data={raw}; }

        if(res.statusCode>=200 && res.statusCode<300){
          return resolve({status:res.statusCode,data,raw});
        }

        const msg=
          safeText(data?.error) ||
          safeText(data?.message) ||
          safeText(data?.errors) ||
          safeText(data) ||
          raw ||
          ('HTTP '+res.statusCode);

        const e=new Error(String(msg));
        e.status=Number(res.statusCode||0);
        e.data=data;
        e.raw=raw;
        reject(e);
      });
    });

    req.on('timeout',()=>{
      const e=new Error('Prom import request timeout');
      e.code='REQUEST_TIMEOUT';
      req.destroy(e);
    });
    req.on('error',reject);
    req.write(body);
    req.end();
  });
}

function isConcurrentImportError(e){
  const text=[
    safeText(e?.message),
    safeText(e?.data),
    safeText(e?.raw)
  ].filter(Boolean).join(' ').toLowerCase();

  return Number(e?.status)===400 && (
    text.includes('одновременн') ||
    text.includes('одночасн') ||
    text.includes('concurrent') ||
    text.includes('simultaneous') ||
    text.includes('попереднього імпорту') ||
    text.includes('предыдущего импорта') ||
    (text.includes('импорт') && text.includes('огранич'))
  );
}

async function interruptibleSleep(ms){
  const step=1000;
  let left=ms;
  while(left>0){
    if(autoState.stop_requested) throw new Error('Остановлено пользователем');
    const x=Math.min(step,left);
    await new Promise(r=>setTimeout(r,x));
    left-=x;
  }
}

async function promImportFileQueued(xmlText,settings,batchText=''){
  if(autoState.stop_requested) throw new Error('Остановлено пользователем');

  try{
    autoState.import_error=null;
    return await promImportFile(xmlText,settings);
  }catch(e){
    if(!isConcurrentImportError(e)) throw e;

    // Safety first: if Prom already has an import in progress, do NOT queue a
    // second identical import after it. We cannot know that previous import ID,
    // so we watch the real catalog instead of blindly resubmitting.
    autoState.import_status='PREVIOUS_IMPORT_ACTIVE';
    autoState.import_background=true;
    autoState.phase=
      `4/5 Prom уже выполняет предыдущий импорт${batchText?` (${batchText})`:''}. `+
      `Новый импорт НЕ запускаю, проверяю результат предыдущего`;
    autoState.import_error=
      'Prom запретил одновременный импорт. Защита от дубля сработала: второй импорт не будет отправлен.';
    autoState.progress=90;
    autoState.import_accepted_at=autoState.import_accepted_at||new Date().toISOString();
    autoState.import_fingerprint=autoState.import_fingerprint||autoPlanFingerprint();
    autoState.persistent_lock=true;
    persistImportLock('previous-import-active');
    autoImportWatchStartedAt=Date.parse(autoState.import_accepted_at)||Date.now();
    scheduleBackgroundImportWatcher(null,lastAutoImportPlan.length);

    return {
      status:202,
      data:{status:'PREVIOUS_IMPORT_ACTIVE'},
      previous_active:true
    };
  }
}

function autoImportId(data){ return data?.id ?? data?.processed_id ?? data?.processedId ?? data?.import_id ?? data?.importId ?? data?.process_id ?? data?.task_id ?? data?.uuid ?? data?.data?.id ?? data?.data?.processed_id ?? data?.data?.import_id ?? null; }

function findImportStatusDeep(v,depth=0){
  if(depth>5 || v===null || v===undefined) return '';
  if(typeof v==='string'){
    const x=v.trim().toUpperCase();
    if(/^(SUCCESS|DONE|FINISH|FINISHED|COMPLETE|COMPLETED|ERROR|FAIL|FAILED|CANCEL|CANCELED|CANCELLED|ACCEPTED|NEW|QUEUED|WAIT|AWAIT|PROCESSING|STARTED|IN_PROGRESS|RUNNING)$/.test(x)) return x;
    return '';
  }
  if(Array.isArray(v)){
    for(const x of v){
      const st=findImportStatusDeep(x,depth+1);
      if(st) return st;
    }
    return '';
  }
  if(typeof v==='object'){
    for(const k of ['status','state','result','import_status','task_status']){
      if(v[k]!==undefined){
        const st=findImportStatusDeep(v[k],depth+1);
        if(st) return st;
        const raw=String(v[k]??'').trim().toUpperCase();
        if(raw) return raw;
      }
    }
    for(const x of Object.values(v)){
      const st=findImportStatusDeep(x,depth+1);
      if(st) return st;
    }
  }
  return '';
}

function importCountersDeep(v,depth=0,out={}){
  if(depth>5 || v===null || v===undefined) return out;
  if(Array.isArray(v)){
    for(const x of v) importCountersDeep(x,depth+1,out);
    return out;
  }
  if(typeof v!=='object') return out;

  const aliases={
    processed:['processed','processed_items','processed_count','handled','handled_items'],
    total:['total','total_items','items_count','count'],
    updated:['updated','updated_items','updated_count'],
    created:['created','created_items','created_count'],
    not_changed:['not_changed','not_changed_items','not_changed_count','unchanged','unchanged_count'],
    errors:['errors_count','failed','failed_count','error_count','with_errors_count']
  };
  for(const [dst,keys] of Object.entries(aliases)){
    for(const k of keys){
      if(out[dst]===undefined && Number.isFinite(Number(v[k]))) out[dst]=Number(v[k]);
    }
  }
  for(const x of Object.values(v)) importCountersDeep(x,depth+1,out);
  return out;
}

const MANAGED_GROUP_IDS = new Set(MANAGED_GROUPS.map(g=>String(g.id)));

function autoAttributeMatches(p,name,value){
  const wantName=normalizeLabel(name);
  const wantValue=norm(value).toLowerCase();
  if(!wantName || !wantValue) return false;
  for(const a of promAttributes(p)){
    const gotName=normalizeLabel(attrName(a));
    if(!gotName) continue;
    if(!(gotName===wantName || gotName.includes(wantName) || wantName.includes(gotName))) continue;
    const gotValue=norm(attrValue(a)).toLowerCase();
    if(!gotValue) continue;
    if(gotValue===wantValue || gotValue.includes(wantValue) || wantValue.includes(gotValue)) return true;
  }
  return false;
}

async function verifyLastImportNow(){
  try{
    const [products,groups]=await Promise.all([listAllProducts(),getPromGroups().catch(()=>[])]);
    const byId=new Map(products.map(p=>[String(p.id),p]));
    const maps=promGroupMaps(groups);
    const managedNames=new Set(MANAGED_GROUPS.map(g=>norm(g.name).toLowerCase()).filter(Boolean));
    autoState.managed_group_nodes_found=[...managedNames].filter(n=>maps.idsByName.has(n)).length;

    if(!lastAutoImportPlan.length){
      let managed=0;
      for(const p of products){
        const name=productGroupName(p,maps).toLowerCase();
        if(name && managedNames.has(name)) managed++;
      }
      autoState.managed_groups_verified=managed;
      autoState.managed_groups_total=products.length;
      autoState.groups_imported=managed;
      return {
        ok:true,
        managed,
        total:products.length,
        groups_complete:false,
        managed_group_nodes_found:autoState.managed_group_nodes_found,
        attributes_verified:0,
        attributes_verifiable:0,
        attributes_planned:autoState.attributes_planned||0
      };
    }

    let groupsMatched=0;
    let attrPlannedProducts=0;
    let attrReadableProducts=0;
    let attrVerifiedProducts=0;

    for(const plan of lastAutoImportPlan){
      const product=byId.get(String(plan.id));
      if(!product) continue;

      const actualId=String(autoGroupId(product)||'');
      const actualName=productGroupName(product,maps).toLowerCase();
      const desiredName=norm(plan.group_name||MANAGED_GROUPS.find(g=>String(g.id)===String(plan.group_id||''))?.name||'').toLowerCase();
      const desiredIds=desiredName ? maps.idsByName.get(desiredName) : null;
      // YML category IDs are identifiers inside the import file. Prom may assign a different
      // internal group ID, so verify by the real Prom group name/ID mapping, not only 910xxx.
      if(
        (desiredName && actualName===desiredName) ||
        (actualId && desiredIds && desiredIds.has(actualId)) ||
        (actualId && actualId===String(plan.group_id||''))
      ) groupsMatched++;

      if(Array.isArray(plan.attrs) && plan.attrs.length){
        attrPlannedProducts++;
        if(promAttributes(product).length){
          attrReadableProducts++;
          if(plan.attrs.every(([name,value])=>autoAttributeMatches(product,name,value))){
            attrVerifiedProducts++;
          }
        }
      }
    }

    autoState.managed_groups_verified=groupsMatched;
    autoState.managed_groups_total=lastAutoImportPlan.length;
    autoState.groups_imported=groupsMatched;
    autoState.attributes_verifiable=attrReadableProducts;
    autoState.attributes_verified=attrVerifiedProducts;
    if(attrReadableProducts>0) autoState.attributes_imported=attrVerifiedProducts;

    return {
      ok:true,
      managed:groupsMatched,
      total:lastAutoImportPlan.length,
      groups_complete:lastAutoImportPlan.length>0 && groupsMatched===lastAutoImportPlan.length,
      managed_group_nodes_found:autoState.managed_group_nodes_found,
      attributes_verified:attrVerifiedProducts,
      attributes_verifiable:attrReadableProducts,
      attributes_planned:attrPlannedProducts,
      attributes_complete:attrPlannedProducts===0 || (attrReadableProducts===attrPlannedProducts && attrVerifiedProducts===attrPlannedProducts)
    };
  }catch(e){
    autoState.errors.unshift({where:'verify-import',error:safeText(e)});
    return {ok:false,managed:0,total:lastAutoImportPlan.length||0,error:safeText(e)};
  }
}

async function verifyManagedGroupsNow(){
  return verifyLastImportNow();
}

async function pollAutoImportStatusOnce(id,totalItems=0){
  if(!id) return {status:'NO_IMPORT_ID',data:null,counters:{}};
  const statusPath='/products/import/status/'+encodeURIComponent(id);
  const r=await promRequest('GET',statusPath);
  autoState.status_last_http=Number(r.status||200);
  autoState.status_last_path=statusPath;
  autoState.status_last_error=null;
  const data=r.data||{};
  const status=findImportStatusDeep(data) || 'PROCESSING';
  const counters=importCountersDeep(data);
  autoState.import_last_status_payload=data;
  autoState.import_status_counters=counters;
  autoState.import_status=status;

  const processed=Number.isFinite(counters.processed) ? counters.processed : null;
  const total=Number.isFinite(counters.total) ? counters.total : (totalItems||null);
  const countText=(processed!==null && total!==null) ? ` · Prom: ${processed}/${total}` : '';
  const mm=Math.floor((autoState.import_elapsed_sec||0)/60);
  const ss=String((autoState.import_elapsed_sec||0)%60).padStart(2,'0');
  autoState.phase=`4/5 Prom обрабатывает импорт · ${status}${countText} · ${mm}:${ss}`;

  return {status,data,counters};
}

function importSucceeded(status){
  return /SUCCESS|DONE|FINISH|FINISHED|COMPLETE|COMPLETED/.test(String(status||'').toUpperCase());
}
function importFailed(status){
  return /ERROR|FAIL|FAILED|CANCEL|CANCELED|CANCELLED/.test(String(status||'').toUpperCase());
}

function statusReportsNoEffect(counters){
  const c=counters||{};
  const hasCreated=Number.isFinite(Number(c.created));
  const hasUpdated=Number.isFinite(Number(c.updated));
  if(!hasCreated && !hasUpdated) return false;
  const created=hasCreated?Number(c.created):0;
  const updated=hasUpdated?Number(c.updated):0;
  const errors=Number.isFinite(Number(c.errors))?Number(c.errors):0;
  return created===0 && updated===0 && errors===0;
}

function catalogProvesImport(verify){
  if(!verify || !verify.ok) return false;
  const total=Number(verify.total||0);
  const baseline=Number(autoState.import_baseline_groups||0);
  const groupsProgressed=Boolean(verify.groups_complete && total>0 && baseline<total);
  const attrsProved=Boolean(
    Number(verify.attributes_planned||0)>0 &&
    Number(verify.attributes_verifiable||0)===Number(verify.attributes_planned||0) &&
    verify.attributes_complete
  );
  return groupsProgressed || attrsProved;
}

function catalogAcceptsImport(verify,status=''){
  if(catalogProvesImport(verify)) return true;
  if(!verify || !verify.ok || !importSucceeded(status)) return false;
  const total=Number(verify.total||0);
  const baseline=Number(autoState.import_baseline_groups||0);
  const managed=Number(verify.managed||0);
  // If every planned group was already correct before the import, terminal SUCCESS is enough.
  return total>0 && baseline>=total && managed>=total;
}

function scheduleBackgroundImportWatcher(id,totalItems=0){
  if(autoImportWatchTimer) clearTimeout(autoImportWatchTimer);
  if(!autoImportWatchStartedAt) autoImportWatchStartedAt=Date.now();

  const tick=async()=>{
    autoImportWatchTimer=null;
    if(!autoState.import_background) return;

    const elapsed=Date.now()-autoImportWatchStartedAt;
    autoState.import_elapsed_sec=Math.round(elapsed/1000);
    if(elapsed > AUTO_BACKGROUND_WATCH_MAX_MIN*60*1000){
      if(autoState.import_status==='PREVIOUS_IMPORT_ACTIVE'){
        autoState.import_background=true;
        autoState.persistent_lock=true;
        autoState.phase=`⚠️ Предыдущий импорт не подтвердил наш план за ${AUTO_BACKGROUND_WATCH_MAX_MIN} мин. Блокировка СОХРАНЕНА, новый импорт не отправляется`;
        autoState.import_error='Не удалось связать предыдущий импорт с текущим планом. Для защиты от дублей автомат не снимает блокировку сам.';
        autoState.progress=95;
        persistImportLock('previous-import-timeout');
        return;
      }
      autoState.phase=`⚠️ Импорт Prom всё ещё не подтверждён спустя ${AUTO_BACKGROUND_WATCH_MAX_MIN} мин. Новый импорт заблокирован до проверки`;
      autoState.progress=95;
      autoState.persistent_lock=true;
      persistImportLock('background-timeout');
      return;
    }

    let terminal='';
    if(id){
      try{
        autoState.import_poll_count++;
        const r=await pollAutoImportStatusOnce(id,totalItems);
        terminal=r.status;
        if(importFailed(terminal)){
          autoState.import_background=false;
          autoState.import_terminal_confirmed=true;
          autoState.import_error='Prom завершил импорт со статусом '+terminal;
          autoState.phase='Ошибка импорта Prom: '+terminal;
          autoState.progress=100;
          clearImportLock('failed');
          return;
        }
      }catch(e){
        recordStatusEndpointError(e,'/products/import/status/'+encodeURIComponent(id));
      }
    }

    const verify=await verifyLastImportNow();
    if(catalogAcceptsImport(verify,terminal)){
      autoState.import_background=false;
      autoState.import_terminal_confirmed=importSucceeded(terminal);
      autoState.import_status=importSucceeded(terminal) ? terminal : 'VERIFIED_BY_CATALOG';
      autoState.import_error=null;
      await auditManagedGroups();
      autoState.phase=importSucceeded(terminal)
        ? '✅ Готово. Prom подтвердил импорт и каталог совпал с планом'
        : '✅ Готово. Импорт подтверждён по фактическим группам каталога';
      autoState.progress=100;
      autoState.finished_at=new Date().toISOString();
      autoState.next_run_at=new Date(Date.now()+AUTO_INTERVAL_HOURS*3600*1000).toISOString();
      if(autoState.restored_after_restart) autoBootGuardSatisfiedByRestoredTerminal=true;
      clearImportLock('verified');
      return;
    }

    if(importSucceeded(terminal) && statusReportsNoEffect(autoState.import_status_counters) && !catalogProvesImport(verify)){
      autoState.import_background=false;
      autoState.import_terminal_confirmed=true;
      autoState.import_status='SUCCESS_NO_EFFECT';
      autoState.import_error='Prom завершил задачу со статусом SUCCESS, но сообщил 0 созданных и 0 обновлённых товаров, а группы каталога не изменились. Блокировка снята. v3.4.7 проверяет результат по реальным группам Prom, а не по служебным YML categoryId.';
      autoState.phase='⚠️ Prom завершил импорт без изменений. Следующий запуск будет принудительным (только группы + характеристики)';
      autoState.progress=100;
      autoState.finished_at=new Date().toISOString();
      if(autoState.restored_after_restart) autoBootGuardSatisfiedByRestoredTerminal=true;
      clearImportLock('success-no-effect');
      return;
    }

    if(importSucceeded(terminal)){
      autoState.import_status='SUCCESS_WAIT_CATALOG';
      autoState.import_terminal_confirmed=true;
      autoState.import_error='Prom сообщает SUCCESS, но фактические группы каталога ещё не совпали с планом. Блокировка сохраняется.';
      autoState.phase=`⏳ Prom сообщил SUCCESS, жду подтверждение каталога: группы ${verify.managed||0}/${verify.total||totalItems||0}`;
    }else{
      autoState.phase=`⏳ Prom ещё обрабатывает импорт. Подтверждено групп ${verify.managed||0}/${verify.total||totalItems||0}`;
    }
    autoState.progress=95;
    autoState.persistent_lock=true;
    persistImportLock('background-watch');
    autoImportWatchTimer=setTimeout(tick,AUTO_STATUS_VERIFY_SEC*1000);
  };

  autoImportWatchTimer=setTimeout(tick,AUTO_STATUS_VERIFY_SEC*1000);
}

async function waitAutoImport(id,totalItems=0,timeoutMs=AUTO_IMPORT_STATUS_MAX_MIN*60*1000){
  const t0=Date.now();
  let last=null;
  let nextVerifyAt=0;

  autoState.import_poll_count=0;
  autoState.import_elapsed_sec=0;
  autoState.import_last_status_payload=null;
  autoState.status_endpoint_errors=0;
  autoState.import_background=true;
  autoState.import_terminal_confirmed=false;
  autoState.persistent_lock=true;

  while((Date.now()-t0) < timeoutMs){
    if(autoState.stop_requested) throw new Error('Остановлено пользователем');

    await interruptibleSleep(AUTO_STATUS_POLL_SEC*1000);
    autoState.import_elapsed_sec=Math.round((Date.now()-t0)/1000);
    let status='';

    if(id){
      try{
        autoState.import_poll_count++;
        const r=await pollAutoImportStatusOnce(id,totalItems);
        last=r.data;
        status=r.status;
        autoState.import_error=null;

        if(importSucceeded(status)){
          autoState.import_terminal_confirmed=true;
          const verified=await verifyLastImportNow();
          if(catalogAcceptsImport(verified,status)){
            autoState.import_background=false;
            clearImportLock('status-success-catalog-confirmed');
            return {ok:true,status,data:last,counters:r.counters,pending:false,verified};
          }
          if(statusReportsNoEffect(r.counters) && !catalogProvesImport(verified)){
            autoState.import_background=false;
            autoState.import_status='SUCCESS_NO_EFFECT';
            autoState.import_error='Prom завершил задачу SUCCESS, но сообщил 0 созданных и 0 обновлённых товаров; фактические группы также не изменились. Повторный запуск разрешён. v3.4.7 дополнительно проверяет реальные группы Prom по названию, потому что YML categoryId не равен внутреннему ID группы Prom.';
            autoState.phase='⚠️ Prom завершил импорт без изменений';
            clearImportLock('success-no-effect');
            return {ok:false,status:'SUCCESS_NO_EFFECT',data:last,counters:r.counters,pending:false,verified};
          }
          autoState.import_status='SUCCESS_WAIT_CATALOG';
          autoState.import_error='Prom сообщает SUCCESS, но группы каталога ещё не совпадают с планом. Продолжаю проверку, новый импорт заблокирован.';
          autoState.phase=`4/5 Prom SUCCESS · жду каталог ${verified.managed||0}/${verified.total||totalItems||0}`;
          persistImportLock('success-wait-catalog');
        }
        if(importFailed(status)){
          autoState.import_background=false;
          autoState.import_terminal_confirmed=true;
          clearImportLock('status-failed');
          return {ok:false,status,data:last,counters:r.counters,pending:false};
        }
      }catch(e){
        recordStatusEndpointError(e,'/products/import/status/'+encodeURIComponent(id));
        autoState.import_error='Статус Prom временно не читается: '+safeText(e);
        autoState.phase=`4/5 Импорт принят Prom. Status API временно не отвечает (${autoState.status_endpoint_errors} ошибок), продолжаю ждать`;
      }
    }else{
      autoState.import_status='ACCEPTED_NO_ID';
      autoState.phase='4/5 Prom принял импорт без ID. Проверяю результат по каталогу';
    }

    if(Date.now()>=nextVerifyAt){
      const verify=await verifyLastImportNow();
      nextVerifyAt=Date.now()+AUTO_STATUS_VERIFY_SEC*1000;
      if(catalogProvesImport(verify)){
        autoState.import_background=false;
        autoState.import_status='VERIFIED_BY_CATALOG';
        autoState.import_error=null;
        clearImportLock('catalog-verified');
        return {ok:true,status:'VERIFIED_BY_CATALOG',data:last,pending:false,verified:verify};
      }

      autoState.phase=`4/5 Жду Prom · подтверждено групп ${verify.managed||0}/${verify.total||totalItems||0} · ${autoState.import_elapsed_sec} сек`;
      autoState.progress=90;
    }
  }

  const verify=await verifyLastImportNow();
  if(catalogProvesImport(verify)){
    autoState.import_background=false;
    autoState.import_status='VERIFIED_BY_CATALOG';
    autoState.import_error=null;
    clearImportLock('catalog-verified-final');
    return {ok:true,status:'VERIFIED_BY_CATALOG',data:last,pending:false,verified:verify};
  }

  autoState.import_background=true;
  const terminalSeen=importSucceeded(autoState.import_status);
  autoState.import_status=terminalSeen?'SUCCESS_WAIT_CATALOG':'ACCEPTED_BACKGROUND';
  autoState.phase=terminalSeen
    ? `⏳ Prom сообщил SUCCESS, но каталог не подтвердил группы ${verify.managed||0}/${verify.total||totalItems||0}. Новый импорт заблокирован`
    : `⏳ Prom продолжает импорт в фоне. Подтверждено групп ${verify.managed||0}/${verify.total||totalItems||0}. Новый импорт заблокирован`;
  autoState.progress=95;
  autoState.import_error=`За ${AUTO_IMPORT_STATUS_MAX_MIN} мин окончание не подтверждено. Фоновая проверка продолжится автоматически.`;
  autoState.persistent_lock=true;
  persistImportLock('accepted-background');
  autoImportWatchStartedAt=Date.parse(autoState.import_accepted_at||'')||Date.now();
  scheduleBackgroundImportWatcher(id,totalItems);

  return {ok:true,status:'ACCEPTED_BACKGROUND',data:last,pending:true,verified:verify};
}


function flattenPromGroups(input,out=[]){
  if(!input) return out;
  if(Array.isArray(input)){
    for(const x of input) flattenPromGroups(x,out);
    return out;
  }
  if(typeof input!=='object') return out;

  if(input.id!==undefined && (input.name!==undefined || input.title!==undefined)){
    out.push({
      id:String(input.id),
      name:norm(input.name||input.title),
      parent_id:String(input.parent_id||input.parentId||input.parent?.id||'')
    });
  }

  for(const key of ['groups','children','subgroups','items']){
    if(input[key]) flattenPromGroups(input[key],out);
  }
  return out;
}
async function getPromGroups(){
  const res=await promRequest('GET','/groups/list?limit=100');
  return flattenPromGroups(res.data||{});
}
function promGroupMaps(groups=[]){
  const byId=new Map();
  const idsByName=new Map();
  for(const g of groups||[]){
    const id=String(g?.id||'');
    const name=norm(g?.name||'');
    if(id) byId.set(id,name);
    const key=name.toLowerCase();
    if(key){
      if(!idsByName.has(key)) idsByName.set(key,new Set());
      if(id) idsByName.get(key).add(id);
    }
  }
  return {byId,idsByName};
}
function productGroupName(p,groupMaps=null){
  const direct=norm(
    (p?.group && typeof p.group==='object' ? (p.group.name||p.group.title) : '') ||
    p?.group_name || p?.groupName ||
    (p?.category && typeof p.category==='object' ? (p.category.name||p.category.title) : '') ||
    p?.category_name || ''
  );
  if(direct) return direct;
  const gid=String(autoGroupId(p)||'');
  return gid && groupMaps?.byId?.get(gid) ? groupMaps.byId.get(gid) : '';
}
function firstProductImage(p,match){
  const r=match?.record||{};
  const supplierImage=(r.pictures||[])[0];
  if(supplierImage) return supplierImage;

  for(const key of ['image','main_image']){
    const x=p?.[key];
    if(typeof x==='string' && x) return x;
    if(x && typeof x==='object'){
      const v=x.url||x.src||x.original_url;
      if(v) return v;
    }
  }
  for(const key of ['images','image_urls','photos','pictures']){
    for(const x of (Array.isArray(p?.[key])?p[key]:[])){
      if(typeof x==='string' && x) return x;
      if(x && typeof x==='object'){
        const v=x.url||x.src||x.original_url;
        if(v) return v;
      }
    }
  }
  return '';
}
async function auditManagedGroups(){
  autoState.phase='5/5 Проверяю группы магазина';
  await verifyManagedGroupsNow();
  autoState.progress=97;

  try{
    const groups=await getPromGroups();
    autoState.groups_audited=groups.length;

    const freshProducts=await listAllProducts();
    const counts=new Map();
    for(const p of freshProducts){
      const gid=autoGroupId(p);
      if(gid) counts.set(String(gid),(counts.get(String(gid))||0)+1);
    }

    const legacy=groups.filter(g=>g.name && !MANAGED_GROUP_NAMES.has(g.name.toLowerCase()));
    const emptyLegacy=legacy.filter(g=>(counts.get(String(g.id))||0)===0);

    autoState.legacy_groups=legacy.length;
    autoState.empty_legacy_groups=emptyLegacy.length;
    autoState.group_cleanup_candidates=emptyLegacy.slice(0,100);
  }catch(e){
    autoState.errors.unshift({where:'groups-audit',error:safeText(e)});
  }
}

async function autoImportCharacteristics(){
  autoState.phase='4/5 Группы + характеристики: формирую единый файл';
  autoState.progress=77;
  autoState.current=0;
  autoState.current_total=0;

  const items=[];
  autoState.skipped_no_external_id=0;
  autoState.skipped_no_group_id=0;
  autoState.group_distribution={};
  autoState.cover_candidates={};
  autoState.groups_imported=0;
  autoState.import_elapsed_sec=0;
  autoState.import_poll_count=0;
  autoState.import_last_status_payload=null;

  for(const p of promRawCache.values()){
    if(autoState.stop_requested) throw new Error('Остановлено пользователем');

    const match=supplierMatches.get(String(p.id))||null;
    const ext=autoExternalId(p);
    if(!ext){
      autoState.skipped_no_external_id++;
      continue;
    }

    const managedGroup=classifyManagedGroup(p,match);
    const attrs=match ? autoImportAttributes(match,p) : [];
    items.push({p,match,attrs,managedGroup});

    autoState.group_distribution[managedGroup.name]=(autoState.group_distribution[managedGroup.name]||0)+1;

    const image=firstProductImage(p,match);
    if(image && !autoState.cover_candidates[String(managedGroup.id)]){
      autoState.cover_candidates[String(managedGroup.id)]={
        group_id:String(managedGroup.id),
        group_name:managedGroup.name,
        image,
        product:p.name||match?.record?.name||''
      };
    }
  }

  autoState.group_assignments_planned=items.length;
  autoState.attributes_planned=items.filter(x=>x.attrs.length).length;
  autoState.current_total=items.length;
  autoState.import_baseline_groups=items.filter(x=>String(autoGroupId(x.p)||'')===String(x.managedGroup?.id||FALLBACK_GROUP.id)).length;
  lastAutoImportPlan=items.map(x=>({
    id:String(x.p.id),
    external_id:autoExternalId(x.p),
    group_id:String(x.managedGroup?.id||FALLBACK_GROUP.id),
    group_name:String(x.managedGroup?.name||FALLBACK_GROUP.name||''),
    attrs:(x.attrs||[]).map(([k,v])=>[String(k),String(v)])
  }));

  if(!items.length){
    lastAutoImportPlan=[];
    autoState.import_status='SKIPPED: нет товаров для импорта';
    return {pending:false,skipped:true};
  }

  // Important: one Prom import task, not 14 separate imports of 120 products.
  // Prom processes imports asynchronously and allows only limited concurrent imports.
  const settings={
    // We update only group + attributes, so forcing the pass cannot touch prices/photos/descriptions.
    // This avoids Prom returning terminal SUCCESS with zero updates for a changed grouping plan.
    force_update:true,
    only_available:false,
    only_update:true,
    mark_missing_product_as:'none',
    updated_fields:['group','attributes']
  };

  const xml=buildAutoYml(items);
  lastAutoImportXml=xml;

  autoState.phase=`4/5 Отправляю один импорт на ${items.length} товаров`;
  autoState.progress=80;

  const r=await promImportFileQueued(
    xml,
    settings,
    `весь каталог: ${items.length} товаров`
  );

  if(r.previous_active){
    autoState.import_id=null;
    autoState.import_status='PREVIOUS_IMPORT_ACTIVE';
    autoState.current=items.length;
    autoState.progress=95;
    return {ok:true,status:'PREVIOUS_IMPORT_ACTIVE',pending:true,previous_active:true};
  }

  const importId=autoImportId(r.data);
  autoState.import_id=importId||null;
  autoState.import_status='ACCEPTED';
  autoState.import_accepted_at=new Date().toISOString();
  autoState.import_fingerprint=autoPlanFingerprint(lastAutoImportPlan);
  autoState.import_background=true;
  autoState.persistent_lock=true;
  autoState.restored_after_restart=false;
  autoState.phase=`4/5 Prom принял единый импорт ${items.length} товаров. Жду завершения`;
  autoState.progress=85;
  persistImportLock('accepted');

  const st=await waitAutoImport(importId,items.length);
  autoState.import_status=st.status;

  if(!st.ok){
    if(st.status==='SUCCESS_NO_EFFECT'){
      autoState.import_status='SUCCESS_NO_EFFECT';
      autoState.import_error=autoState.import_error || 'Prom завершил импорт без подтверждённых изменений групп/характеристик.';
      autoState.phase='⚠️ Prom завершил импорт без подтверждённых изменений';
      autoState.progress=100;
      return st;
    }
    autoState.import_error=safeText(st.data) || st.status;
    throw new Error('Prom не подтвердил единый импорт групп/характеристик: '+st.status);
  }

  autoState.current=items.length;
  if(st.pending){
    autoState.groups_imported=autoState.managed_groups_verified||0;
    autoState.progress=95;
  }else{
    autoState.import_error=null;
    autoState.progress=96;
  }
  return st;
}

async function runAutoAll(reason='manual'){
  if(autoState.running) return;
  if(autoState.import_background) throw new Error('Предыдущий импорт Prom ещё не подтверждён. Новый импорт не запускается.');
  if(!WRITE_ENABLED) throw new Error('WRITE_ENABLED=false');
  if(!PROM_TOKEN) throw new Error('PROM_TOKEN не задан');

  Object.assign(autoState,{
    running:true,
    stop_requested:false,
    started_at:new Date().toISOString(),
    finished_at:null,
    phase:'Запуск',
    progress:1,
    keywords_checked:0,
    keywords_planned:0,
    keywords_changed:0,
    descriptions_checked:0,
    descriptions_planned:0,
    descriptions_changed:0,
    attributes_planned:0,
    attributes_imported:0,
    import_id:null,
    import_status:null,
    import_error:null,
    errors:[],
    last_run_reason:reason,
    current:0,
    current_total:0,
    seo_errors:0,
    group_assignments_planned:0,
    groups_imported:0,
    groups_audited:0,
    legacy_groups:0,
    empty_legacy_groups:0,
    group_cleanup_candidates:[],
    group_distribution:{},
    cover_candidates:{},
    import_elapsed_sec:0,
    import_poll_count:0,
    import_last_status_payload:null,
    feed_progress:{},
    feed_download_source:{},
    import_background:false,
    import_terminal_confirmed:false,
    import_baseline_groups:0,
    managed_groups_verified:0,
    managed_groups_total:0,
    managed_group_nodes_found:0,
    attributes_verified:0,
    attributes_verifiable:0,
    status_endpoint_errors:0,
    status_last_error:null,
    status_last_http:null,
    status_last_path:null,
    import_status_counters:{},
    import_accepted_at:null,
    import_fingerprint:null,
    persistent_lock:false,
    persistent_state_path:AUTO_STATE_PATH,
    persistent_state_saved_at:null,
    restored_after_restart:false,
    restored_lock_age_sec:0
  });

  try{
    autoImportWatchStartedAt=0;
    // FAST: only one catalog-list pass here. No 1641 translation requests in phase 1.
    autoState.phase='1/5 Загружаю каталог Prom';
    autoState.progress=5;

    const products=await listAllProducts();
    promRawCache=new Map(products.map(p=>[String(p.id),p]));
    scanState.total=products.length;
    scanState.processed=products.length;
    scanState.errors=0;
    scanState.last_error=null;
    scanState.summary={
      total:products.length,
      valid:products.length,
      errors:0,
      average_score:0,
      need_safe_fix:0,
      missing:{}
    };

    if(autoState.stop_requested) throw new Error('Остановлено пользователем');

    autoState.phase='2/5 Загружаю BEZET + Militaris и сопоставляю';
    autoState.progress=18;
    await syncSuppliers();

    if(autoState.stop_requested) throw new Error('Остановлено пользователем');

    // One common translation pass for keywords AND descriptions.
    autoState.phase=`3/5 Ключи + описания 0/${products.length}`;
    autoState.progress=35;
    await runFastSeoPass(products);

    if(autoState.stop_requested) throw new Error('Остановлено пользователем');

    autoState.phase='4/5 Группы + характеристики';
    autoState.progress=78;
    const importResult=await autoImportCharacteristics();

    if(importResult?.pending){
      autoState.current=0;
      autoState.current_total=0;
      return;
    }
    if(importResult?.status==='SUCCESS_NO_EFFECT'){
      autoState.current=0;
      autoState.current_total=0;
      return;
    }

    if(autoState.stop_requested) throw new Error('Остановлено пользователем');
    await auditManagedGroups();

    autoState.phase='✅ Готово. Результат импорта подтверждён';
    autoState.progress=100;
    autoState.current=0;
    autoState.current_total=0;
  }catch(e){
    const msg=safeText(e);
    if(msg==='Остановлено пользователем'){
      if(autoState.import_background){
        autoState.phase='⏹ Основной процесс остановлен. Импорт Prom мог продолжиться, поэтому слежу за ним в фоне';
        autoImportWatchStartedAt=Date.now();
        scheduleBackgroundImportWatcher(autoState.import_id,autoState.group_assignments_planned||0);
      }else{
        autoState.phase='Остановлено';
      }
    }else{
      autoState.phase='Ошибка';
      autoState.errors.unshift({where:'AUTO',error:msg});
      autoState.import_error=msg;
    }
  }finally{
    autoState.running=false;
    autoState.finished_at=new Date().toISOString();
    autoState.next_run_at=new Date(Date.now()+AUTO_INTERVAL_HOURS*3600*1000).toISOString();
  }
}

function renderAutoHome(){
  const bootGuardActive=!autoState.import_background && Date.now()<AUTO_BOOT_GUARD_UNTIL && !autoBootGuardSatisfiedByRestoredTerminal;
  const bootGuardLeftMin=Math.max(0,Math.ceil((AUTO_BOOT_GUARD_UNTIL-Date.now())/60000));
  const refresh=(autoState.running||autoState.import_background||stockState.running||bootGuardActive)?'<meta http-equiv="refresh" content="4">':'';
  const fmt=v=>{try{return v?new Date(v).toLocaleString('ru-RU',{timeZone:'Europe/Kyiv'}):'—'}catch{return v||'—'}};
  const latestErr=autoState.errors?.[0]||null;
  const unmatched=Number(supplierState.unmatched_products||0);
  const total=Number(scanState.summary?.valid||scanState.total||0);
  const bezetSrc=supplierState.sources?.bezet||null;
  const militarisSrc=supplierState.sources?.militaris||null;
  const statusErrText=autoState.status_last_error ? JSON.stringify(autoState.status_last_error).slice(0,900) : '';
  const stateStoreLabel=AUTO_STATE_PATH.startsWith('/var/data/')?'persistent disk /var/data':'локальный файл (для полной сохранности между Deploy задайте AUTO_STATE_PATH на Render Persistent Disk)';
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh}
<title>PrimeTac AUTO v3.4.7 GROUP VERIFY</title><style>
:root{color-scheme:dark;--bg:#08100b;--c:#141d17;--ln:#304238;--tx:#f4f7f4;--mu:#9caf9f;--g:#8fdf7d;--y:#e8c66c;--r:#ff8b83}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font-family:system-ui,-apple-system,Segoe UI,sans-serif}.w{max-width:820px;margin:auto;padding:14px}.c{background:var(--c);border:1px solid var(--ln);border-radius:16px;padding:14px;margin:12px 0}h1{font-size:23px;margin:4px 0}.m{font-size:12px;color:var(--mu);line-height:1.5}.btn{width:100%;border:0;border-radius:14px;padding:16px;background:#35653a;color:white;font-size:18px;font-weight:900}.stop{border:1px solid #603f3a;background:#3a2320;color:#fff;border-radius:10px;padding:10px 14px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.s{border:1px solid var(--ln);border-radius:12px;padding:10px}.n{font-size:23px;font-weight:850}.ok{color:var(--g)}.warn{color:var(--y)}.bad{color:var(--r)}.bar{height:10px;background:#202b24;border-radius:99px;overflow:hidden}.bar span{display:block;height:100%;background:var(--g);width:${Math.max(0,Math.min(100,autoState.progress||0))}%}a{color:#b8efb0}@media(max-width:650px){.grid{grid-template-columns:1fr 1fr}}
</style></head><body><div class="w"><h1>🚀 PrimeTac AUTO <span class="m">v3.4.7 GROUP VERIFY</span></h1><div class="m">Одна кнопка. Каждые 4 часа загружает Prom + BEZET + Militaris, дополняет ключи и слабые описания, раскладывает товары по фиксированному дереву PrimeTac и обновляет характеристики. Группы и характеристики отправляются в Prom ОДНИМ импортом на весь каталог. После ACCEPTED автомат ждёт подтверждение до ${AUTO_IMPORT_STATUS_MAX_MIN} минут, а временные ошибки status API больше не считаются завершением. Если Prom отвечает нестабильно, результат дополнительно проверяется по фактическим группам каталога. Фиды поставщиков скачиваются потоково без старого жёсткого 90-секундного обрыва. Категории поставщиков один в один не копируются, поэтому сотен групп не будет. Если один из фидов временно не загрузился, программа повторяет загрузку и не делает частичную обработку. Если Prom занят предыдущим импортом, защита не отправляет второй импорт: автомат проверяет результат уже запущенной задачи. Цены и фото не трогает. Остатки/наличие обновляет отдельный безопасный Stock Monitor только по точному SKU.</div>
<div class="c"><form method="get" action="/auto/run"><button class="btn" ${(autoState.running||autoState.import_background||bootGuardActive)?'disabled':''}>${autoState.running?'⏳ РАБОТАЕТ...':(autoState.import_background?'⏳ ЖДЁМ ПОДТВЕРЖДЕНИЕ PROM...':(bootGuardActive?`🛡️ ЗАЩИТА ПОСЛЕ РЕСТАРТА · ${bootGuardLeftMin} МИН`:'🚀 ПРОВЕРИТЬ И ИСПРАВИТЬ ВСЁ'))}</button></form><div style="height:8px"></div><form method="get" action="/auto/stop"><button class="stop" ${autoState.running?'':'disabled'}>⏹ Стоп</button></form><div style="margin-top:12px"><b>${autoEscHtml(autoState.phase)}</b></div>${bootGuardActive?`<div class="m warn" style="margin-top:6px">Новый импорт временно заблокирован после рестарта, даже если старый lock-файл отсутствует. Осталось примерно ${bootGuardLeftMin} мин.</div>`:''}<div class="bar" style="margin-top:8px"><span></span></div><div class="m" style="margin-top:7px">${autoState.progress||0}% · ${autoState.current_total?`обработано ${autoState.current}/${autoState.current_total} · `:''}старт: ${fmt(autoState.started_at)} · следующий автозапуск: ${fmt(autoState.next_run_at)}</div></div>
<div class="grid"><div class="s"><div class="m">Товаров Prom</div><div class="n">${total||'—'}</div></div><div class="s"><div class="m">Сопоставлено</div><div class="n ok">${supplierState.matched_products||0}</div></div><div class="s"><div class="m">Не найдено</div><div class="n ${unmatched?'warn':''}">${unmatched}</div></div><div class="s"><div class="m">UA-ключи изменено</div><div class="n ok">${autoState.keywords_changed||0}</div><div class="m">нужно ${autoState.keywords_planned||0} · проверено ${autoState.keywords_checked||0}</div></div><div class="s"><div class="m">Описания изменено</div><div class="n ok">${autoState.descriptions_changed||0}</div><div class="m">нужно ${autoState.descriptions_planned||0} · проверено ${autoState.descriptions_checked||0}</div></div><div class="s"><div class="m">Характеристики подтверждено</div><div class="n ok">${autoState.attributes_imported||0}</div><div class="m">из ${autoState.attributes_planned||0}${autoState.attributes_verifiable?` · API читает ${autoState.attributes_verifiable}`:(autoState.import_terminal_confirmed?' · Prom завершил импорт, но list API не отдаёт их для сверки':'')}</div></div><div class="s"><div class="m">Ошибки ключи/описания</div><div class="n ${autoState.seo_errors?'bad':''}">${autoState.seo_errors||0}</div></div></div>
<div class="c"><b>📦 Контроль склада</b>
<div class="m" style="margin-top:7px">Автопроверка: каждые ${STOCK_INTERVAL_HOURS} ч. · запись в Prom: <b class="${STOCK_WRITE_ENABLED?'ok':'warn'}">${STOCK_WRITE_ENABLED?'ВКЛ':'ВЫКЛ (предпросмотр)'}</b></div>
<div class="grid" style="margin-top:10px">
  <div class="s"><div class="m">Сопоставлено по SKU</div><div class="n ok">${stockState.matched||0}</div></div>
  <div class="s"><div class="m">Заканчиваются ≤ ${STOCK_LOW_THRESHOLD}</div><div class="n warn">${stockState.low_stock||0}</div></div>
  <div class="s"><div class="m">Нет в наличии</div><div class="n ${stockState.out_of_stock?'bad':''}">${stockState.out_of_stock||0}</div></div>
  <div class="s"><div class="m">План изменений</div><div class="n">${stockState.planned_changes||0}</div></div>
  <div class="s"><div class="m">Обновлено в Prom</div><div class="n ok">${stockState.applied_changes||0}</div></div>
  <div class="s"><div class="m">Пропали из XML</div><div class="n ${stockState.missing_from_feed?'warn':''}">${stockState.missing_from_feed||0}</div></div>
</div>
<div class="m" style="margin-top:9px">${autoEscHtml(stockState.phase||'Ожидание')}</div>
<div class="m">Статус: ${stockState.running?'⏳ идёт проверка':'готов к запуску'} · прогресс ${stockState.progress||0}%</div>
<div class="m">BEZET: ${stockState.sources?.bezet?.fresh?'✅ свежий XML':(stockState.sources?.bezet?.ok?'⚠️ кеш/устарел':'❌ нет данных')} · Militaris: ${stockState.sources?.militaris?.fresh?'✅ свежий XML':(stockState.sources?.militaris?.ok?'⚠️ кеш/устарел':'❌ нет данных')}</div>
<div class="m">Новые SKU у поставщиков, которых нет в Prom: ${stockState.new_supplier_skus||0}. Неопознанные/без точного SKU: ${stockState.unmatched||0}.</div>
${stockState.safety_blocked?`<div class="m bad">Защита от массовой записи сработала. Ничего массово не записано.</div>`:''}
${stockState.errors?.[0]?`<div class="m bad">Последняя ошибка: ${autoEscHtml(safeText(stockState.errors[0].error))}</div>`:''}
<div class="m" style="margin-top:10px;padding:10px;border:1px solid #465;border-radius:8px">
<b>🧪 Диагностика записи 1 товара</b><br>
${stockDiag.at?`Товар: ${autoEscHtml(stockDiag.product?.name||'—')} · HTTP: ${stockDiag.http_status??'—'} · проверка: ${stockDiag.verified===true?'✅ успешно':stockDiag.verified===false?'❌ не подтверждено':'—'}<br>`:''}
${stockDiag.error?`<span class="bad">Ошибка: ${autoEscHtml(JSON.stringify(stockDiag.error))}</span><br>`:''}
${stockDiag.response?`<span class="m">Ответ Prom: ${autoEscHtml(JSON.stringify(stockDiag.response))}</span><br>`:''}
<form method="get" action="/stock/test-one" style="display:inline"><button class="btn" style="padding:10px 14px;width:auto" ${stockDiag.running?'disabled':''}>${stockDiag.running?'⏳ ТЕСТ...':'🧪 ТЕСТ 1 ТОВАРА'}</button></form>
<a href="/stock/diag">Диагностика JSON</a>
</div>
<div style="margin-top:10px">
<form method="get" action="/stock/run" style="display:inline"><button class="btn" style="padding:10px 14px;width:auto" ${stockState.running?'disabled':''}>${stockState.running?'⏳ ПРОВЕРЯЮ СКЛАД...':'📦 ПРОВЕРИТЬ СКЛАД СЕЙЧАС'}</button></form>
<span class="m"> · </span><a href="/stock/state">Отчёт склада JSON</a>
</div>
</div>
<div class="c"><b>Поставщики</b>
<div class="m" style="margin-top:7px">BEZET: ${bezetSrc?.ok?`✅ ${bezetSrc.count} товаров${bezetSrc.download?.mode==='cache'?' · кеш':''}`:`❌ ${autoEscHtml(safeText(bezetSrc?.error)||'не загружен')}`}</div>
<div class="m">Militaris: ${militarisSrc?.ok?`✅ ${militarisSrc.count} товаров${militarisSrc.download?.mode==='cache'?' · кеш':''}`:`❌ ${autoEscHtml(safeText(militarisSrc?.error)||'не загружен')}`}</div>
<div class="m">Загрузка фидов: BEZET ${autoState.feed_progress?.BEZET?.mb||'0.0'} МБ; Militaris ${autoState.feed_progress?.Militaris?.mb||'0.0'} МБ.</div>
</div>
<div class="c"><b>Группы PrimeTac</b>
<div class="m" style="margin-top:7px">Фиксированная структура: ${MANAGED_GROUPS.length} групп и подгрупп.</div>
<div class="m">Запланировано распределить: ${autoState.group_assignments_planned||0}; до импорта уже совпадало: ${autoState.import_baseline_groups||0}; сейчас подтверждено: ${autoState.groups_imported||0}.</div>
<div class="m">Лишних старых групп: <span class="${autoState.legacy_groups?'warn':''}">${autoState.legacy_groups||0}</span>; пустых кандидатов на удаление: <span class="${autoState.empty_legacy_groups?'warn':''}">${autoState.empty_legacy_groups||0}</span>.</div>
<div class="m">Для обложек автоматически выбраны фото-кандидаты: ${Object.keys(autoState.cover_candidates||{}).length}.</div>
<div class="m" style="margin-top:6px">Prom Public API не публикует DELETE для групп и загрузку фото группы. Поэтому автомат переносит товары и больше не использует старые группы; физически удалить уже пустые старые группы и один раз поставить обложки нужно в кабинете Prom.</div>
<div class="m" style="margin-top:7px"><a href="/groups/plan">Структура групп</a> · <a href="/groups/covers">Фото для групп</a> · <a href="/groups/cleanup">Лишние группы</a></div>
</div>
<div class="c"><b>Импорт групп + характеристик</b><div class="m">ID: ${autoEscHtml(autoState.import_id||'—')} · статус: ${autoEscHtml(autoState.import_status||'—')}</div><div class="m">Принят Prom: ${fmt(autoState.import_accepted_at)} · fingerprint: ${autoEscHtml(autoState.import_fingerprint||'—')}</div><div class="m">Пропущено без external_id: ${autoState.skipped_no_external_id||0}; без ID группы: ${autoState.skipped_no_group_id||0}.</div>
<div class="m">Опросов статуса Prom: ${autoState.import_poll_count||0}; ожидание: ${autoState.import_elapsed_sec||0} сек.</div>
<div class="m">Фактически совпадает с планом групп: ${autoState.managed_groups_verified||0}/${autoState.managed_groups_total||total||0}. Узлов PrimeTac найдено в Prom: ${autoState.managed_group_nodes_found||0}/${MANAGED_GROUPS.length}. ${autoState.import_background?'Prom продолжает импорт в фоне; новый импорт заблокирован.':''}</div>
<div class="m">🔒 Persistent lock: <b class="${autoState.persistent_lock?'ok':'warn'}">${autoState.persistent_lock?'ВКЛ':'нет'}</b> · ${autoEscHtml(stateStoreLabel)} · ${autoEscHtml(AUTO_STATE_PATH)}</div>
<div class="m">После рестарта восстановлено: ${autoState.restored_after_restart?'✅ да':'нет'}${autoState.restored_after_restart?` · возраст lock ${autoState.restored_lock_age_sec||0} сек`:''}.</div>
<div class="m">Ошибок status endpoint: ${autoState.status_endpoint_errors||0}. Последний HTTP: ${autoState.status_last_http??'—'} · путь: ${autoEscHtml(autoState.status_last_path||'—')}</div>
<div class="m">Счётчики Prom: created ${autoState.import_status_counters?.created??'—'} · updated ${autoState.import_status_counters?.updated??'—'} · not_changed ${autoState.import_status_counters?.not_changed??'—'} · errors ${autoState.import_status_counters?.errors??'—'}</div>
${statusErrText?`<div class="bad m">Последняя ошибка status API: ${autoEscHtml(statusErrText)}</div>`:''}
<div class="m">Status API: пустые <code>errors: []</code> не считаются ошибкой. ID импорта распознаётся из <code>processed_id</code>. Проверка групп учитывает, что <code>categoryId</code> в YML — идентификатор внутри файла импорта, а Prom может выдать группе другой внутренний ID. Импорт ограничен только group + attributes.</div>
<div class="m">Здесь больше не будет «120/1606»: весь каталог отправляется одной задачей, а экран показывает реальный статус Prom.</div>${autoState.import_error?`<div class="bad m">${autoEscHtml(safeText(autoState.import_error))}</div>`:''}</div>
${latestErr?`<div class="c"><b class="bad">Последняя ошибка</b><div class="m">${autoEscHtml(safeText(latestErr?.error)||'')}</div></div>`:''}
<div class="c"><div class="m"><b>Автоматически:</b> каждые ${AUTO_INTERVAL_HOURS} ч. Незавершённый импорт сохраняется в lock-файл и восстанавливается после рестарта. После любого рестарта ручной и автоматический новый импорт блокируется минимум на ${AUTO_STARTUP_SAFE_DELAY_MIN} мин, если lock не восстановлен; это защищает переход со старой версии, которая ещё не умела сохранять lock.</div><div class="m">Для гарантии между Render Deploy лучше подключить Persistent Disk и задать <code>AUTO_STATE_PATH=/var/data/primetac-auto-state.json</code>. Без диска защита всё равно работает в рамках живого экземпляра Render.</div><div class="m" style="margin-top:7px"><a href="/auto/state">Отчёт JSON</a> · <a href="/auto/verify">Проверить результат Prom</a> · <a href="/auto/last-import.xml">Последний XML групп/характеристик</a> · <a href="/legacy">Старая техническая панель</a></div></div>
</div></body></html>`;
}

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
__SSR_META_REFRESH__
<title>PrimeTac AUTO v3.4.7 GROUP VERIFY</title>
<style>
:root{color-scheme:dark;--bg:#0b100d;--card:#151b18;--line:#2b352f;--text:#eef4ef;--muted:#9aa49d;--green:#8fd37c;--yellow:#e4be6a;--red:#ff8c83}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}.w{max-width:1180px;margin:auto;padding:16px}.c{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin:12px 0}.m{font-size:12px;color:var(--muted);line-height:1.45}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}button,input,select{font:inherit;border-radius:10px;border:1px solid #405148;padding:10px 12px;background:#1e2923;color:#fff}button{font-weight:750;background:#2d472d;cursor:pointer}button.secondary{background:#1d2822}button:disabled{opacity:.45}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.stat{background:#101511;border:1px solid var(--line);border-radius:12px;padding:12px}.n{font-size:28px;font-weight:850}.good{color:var(--green)}.warn{color:var(--yellow)}.bad{color:var(--red)}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}.pill{padding:4px 7px;border:1px solid var(--line);border-radius:999px;font-size:11px}.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.fbox{border:1px solid var(--line);border-radius:10px;padding:8px;margin:6px 0}.suggest{font-size:11px;color:#c8d7c8;margin-top:4px}.bar{height:8px;background:#202823;border-radius:999px;overflow:hidden}.bar>div{height:100%;background:#8fd37c;width:0}.detail{display:none}.detail.open{display:block}@media(max-width:800px){.grid{grid-template-columns:1fr 1fr}table{font-size:10px}.hide-mobile{display:none}}
</style>
</head>
<body><div class="w">
<h2>🧰 PrimeTac Card Manager <span class="m">v3.4.7 GROUP VERIFY</span></h2>
<div class="m">Ключи и данные поставщиков разделены. 4 UA-запроса считаются достаточными. Характеристики пишутся только в уже существующие пустые поля Prom и только после успешного теста на 1 товаре.</div>

<div class="c">
  <div class="row">
    <form method="post" action="/action/scan" style="display:inline">
      <button type="submit">🔎 Сканировать весь каталог</button>
    </form>
    <form method="get" action="/" style="display:inline">
      <button type="submit" class="secondary">Обновить статус</button>
    </form>
    <button id="fix25" onclick="fixBatch(25)" disabled>✅ Исправить 25</button>
    <button id="fix100" onclick="fixBatch(100)" disabled>✅ Исправить 100</button>
    <button id="fixAll" onclick="fixAll()" disabled>🚀 Исправить ВСЕ</button>
    <button id="stopFix" class="secondary" onclick="stopFix()" disabled>⏹ Стоп</button>
  </div>
  <div class="m good" style="margin-top:9px">SERVER MODE: сканирование и поставщики работают даже без JavaScript.</div>
  <div class="m" id="statusText" style="margin-top:6px">__SSR_STATUS__</div>
  <div class="m" id="scanDiag" style="margin-top:5px">__SSR_DIAG__</div>
  <div class="bar" style="margin-top:9px"><div id="progressBar" style="width:__SSR_PROGRESS__%"></div></div>
</div>

<div class="grid">
  <div class="stat"><div class="m">Всего</div><div id="total" class="n">__SSR_TOTAL__</div></div>
  <div class="stat"><div class="m">Среднее заполнение</div><div id="avg" class="n">__SSR_AVG__</div></div>
  <div class="stat"><div class="m">Ключи нужно дописать</div><div id="need" class="n warn">__SSR_NEED__</div></div>
  <div class="stat"><div class="m">Ошибок сканирования</div><div id="errs" class="n bad">__SSR_ERRS__</div></div>
</div>

<div class="c">
  <b>🔗 Поставщики: BEZET + Militaris</b>
  <div class="m" style="margin-top:5px">XML используется для массового сопоставления. Страница товара загружается только по кнопке, чтобы не бомбить сайты поставщиков тысячами запросов.</div>
  <div class="row" style="margin-top:10px">
    <form method="post" action="/action/suppliers-sync" style="display:inline"><button type="submit">⚡ Загрузить + сопоставить</button></form>
    <form method="post" action="/action/suppliers-refresh" style="display:inline"><button type="submit" class="secondary">Только обновить фиды</button></form>
    <form method="post" action="/action/suppliers-match" style="display:inline"><button type="submit" class="secondary">Только сопоставить</button></form>
    <form method="post" action="/action/probe-attribute" style="display:inline"><button type="submit" class="secondary">🧪 ТЕСТ API (только если есть поля)</button></form>
    <form method="post" action="/action/mass-attributes" style="display:inline"><button type="submit">🚀 Заполнить характеристики</button></form>
    <form method="post" action="/action/mass-descriptions" style="display:inline"><button type="submit" class="secondary">📝 Дополнить пустые описания</button></form>
  </div>
  <div id="supplierStatus" class="m" style="margin-top:8px">__SSR_SUPPLIER__</div>
  <div class="m warn" style="margin-top:6px">__SSR_NOTICE__</div>
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
    <tbody id="rows">__SSR_ROWS__</tbody>
  </table>
</div>

<div id="detail" class="c detail"></div>

<div class="c">
  <b>Автозаполнение из поставщика</b>
  <pre id="enrichLog" class="m">__SSR_ENRICH__</pre>
</div>

<div class="c">
  <b>Последняя обработка UA-ключей</b>
  <pre id="fixLog" class="m">__SSR_FIX__</pre>
</div>
</div>

<script>
try{var __st=document.getElementById('statusText');if(__st)__st.textContent='✅ JS запущен. Проверяю API...';}catch(__e){}

let DATA={rows:[],summary:null};
let scanRunning=false, fixRunning=false;

const LABELS={
 title:'Название',description:'Описание',keywords:'Ключевые слова (UA)',
 producer:'Производитель',type:'Вид товара',color:'Цвет',size:'Размер',
 category:'Категория',weight:'Вес',photos:'Фото'
};

async function api(u,o){
  var controller=(typeof AbortController!=='undefined')?new AbortController():null;
  var timer=controller?setTimeout(function(){controller.abort();},12000):null;
  var opts=o||{};
  if(controller){opts=Object.assign({},opts,{signal:controller.signal});}
  try{
    var r=await fetch(u,opts);
    var text=await r.text();
    var d={};
    try{d=text?JSON.parse(text):{};}catch(_e){throw new Error('API вернул не JSON: '+text.slice(0,180));}
    if(!r.ok) throw new Error(d.error||JSON.stringify(d));
    return d;
  }catch(e){
    if(e && e.name==='AbortError') throw new Error('API не ответил за 12 секунд: '+u);
    throw e;
  }finally{
    if(timer) clearTimeout(timer);
  }
}
function esc(v){ return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;'); }
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

  html+='<div style="margin-top:10px"><button id="supplierOneBtn" class="secondary">🔗 Данные поставщика</button></div><div id="supplierOne" class="m" style="margin-top:10px"></div>';
  d.innerHTML=html;
  const supplierBtn=document.getElementById('supplierOneBtn');
  if(supplierBtn) supplierBtn.addEventListener('click',()=>loadSupplierOne(String(r.id),true));
  const fixBtn=document.getElementById('fixOneBtn');
  if(fixBtn) fixBtn.addEventListener('click',()=>fixOne(String(r.id)));
  d.scrollIntoView({behavior:'smooth',block:'start'});
}

async function startScan(){
  const st=document.getElementById('statusText');
  const dg=document.getElementById('scanDiag');
  if(st) st.textContent='⏳ Отправляю команду сканирования...';
  if(dg) dg.textContent='';
  try{
    const r=await api('/api/scan/start',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    if(st) st.textContent=r.already_running?'🔄 Сканирование уже идёт...':'🔄 Сканирование запущено...';
    pollTicks=0;
    poll();
  }catch(e){
    if(st) st.textContent='❌ Не удалось запустить сканирование';
    if(dg) dg.textContent='Ошибка запуска: '+e.message;
  }
}

async function refresh(){
  try{
    const pair=await Promise.all([api('/api/state'),api('/api/enrich/state')]);
    const d=pair[0], eState=pair[1].state||{};
    DATA.rows=d.scan.rows||[];
    DATA.summary=d.scan.summary||null;
    scanRunning=d.scan.running;
    fixRunning=d.fix.running;

    const total=d.scan.total||0, processed=d.scan.processed||0;
    document.getElementById('total').textContent=(DATA.summary && DATA.summary.total!=null ? DATA.summary.total : (total!=null ? total : '—'));
    document.getElementById('avg').textContent=DATA.summary ? DATA.summary.average_score+'%' : '—';
    document.getElementById('need').textContent=(DATA.summary && DATA.summary.need_safe_fix!=null ? DATA.summary.need_safe_fix : '—');
    document.getElementById('errs').textContent=(DATA.summary && DATA.summary.errors!=null ? DATA.summary.errors : (d.scan && d.scan.errors!=null ? d.scan.errors : 0));

    const pct=total?Math.round(processed/total*100):0;
    document.getElementById('progressBar').style.width=pct+'%';

    const diag=document.getElementById('scanDiag');
    if(d.scan.running){
      document.getElementById('statusText').textContent='🔄 Сканирую: '+processed+'/'+total+' ('+pct+'%)';
      if(diag) diag.textContent='Запущено: '+(d.scan.started_at||'—');
    }else if(d.scan.last_error){
      document.getElementById('statusText').textContent='❌ Сканирование остановлено с ошибкой';
      if(diag) diag.textContent='Ошибка Prom/API: '+d.scan.last_error;
    }else if(DATA.summary){
      document.getElementById('statusText').textContent='✅ Готово. Проверено '+DATA.summary.valid+' товаров.';
      if(diag) diag.textContent='Последнее сканирование завершено: '+(d.scan.finished_at||'—');
    }else{
      document.getElementById('statusText').textContent='Каталог ещё не сканирован.';
      if(diag) diag.textContent='Сейчас запущу сканирование автоматически.';
    }

    const disabled = !DATA.summary || !DATA.summary.need_safe_fix || d.scan.running || d.fix.running;
    const b25=document.getElementById('fix25');
    const b100=document.getElementById('fix100');
    const bAll=document.getElementById('fixAll');
    const bStop=document.getElementById('stopFix');
    if(b25) b25.disabled=disabled;
    if(b100) b100.disabled=disabled;
    if(bAll) bAll.disabled=disabled;
    if(bStop) bStop.disabled=!d.fix.running;

    if(d.fix.started_at){
      document.getElementById('fixLog').textContent=
        'Запланировано: '+d.fix.planned+
        '\\nОбработано: '+d.fix.processed+
        '\\nПодтверждено Prom: '+d.fix.verified+
        '\\nОшибок: '+d.fix.failed+
        ((d.fix.errors && d.fix.errors.length)?'\\n\\n'+JSON.stringify(d.fix.errors.slice(0,10),null,2):'');
    }

    if(eState.started_at || eState.attribute_probe){
      const ep=eState.planned?Math.round((eState.processed||0)/eState.planned*100):0;
      let txt='Тест характеристики: '+(eState.attribute_probe ? (eState.attribute_probe.verified?'✅ подтвержден':'❌ не подтвержден') : 'не запускался');
      if(eState.attribute_probe) txt+='\n'+(eState.attribute_probe.name||'')+' → '+(eState.attribute_probe.field||'')+': '+(eState.attribute_probe.value||'');
      if(eState.started_at) txt+='\nРежим: '+(eState.mode||'—')+'\nОбработано: '+eState.processed+'/'+eState.planned+' ('+ep+'%)\nПодтверждено: '+eState.verified+'\nИзменено полей: '+eState.changed_fields+'\nОшибок: '+eState.failed;
      if((eState.errors && eState.errors.length)) txt+='\n\nПоследние ошибки:\n'+JSON.stringify(eState.errors.slice(-8),null,2);
      const el=document.getElementById('enrichLog'); if(el) el.textContent=txt;
      const mb=document.getElementById('massAttrBtn'); if(mb) mb.disabled=!(eState.attribute_probe && eState.attribute_probe.verified) || eState.running;
      const pb=document.getElementById('probeAttrBtn'); if(pb) pb.disabled=Boolean(eState.running);
      const db=document.getElementById('massDescBtn'); if(db) db.disabled=Boolean(eState.running);
    }

    renderTable();
  }catch(e){
    var st2=document.getElementById('statusText'); if(st2) st2.textContent='❌ Ошибка статуса'; var dg2=document.getElementById('scanDiag'); if(dg2) dg2.textContent=e.message;
  }
}

let pollTicks=0;
async function poll(){
  pollTicks++;
  await refresh();
  if(scanRunning || fixRunning || pollTicks<6){
    setTimeout(poll,1500);
  }else{
    pollTicks=0;
  }
}

async function fixBatch(limit){
  if(!confirm('Безопасно дополнить украинские поисковые запросы у '+limit+' товаров? Другие поля не меняются.'))return;
  try{
    await api('/api/fix/start',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({limit:limit,mode:'batch-'+limit})
    });
    document.getElementById('statusText').textContent='Запущена безопасная обработка '+limit+' товаров...';
    poll();
  }catch(e){
    document.getElementById('statusText').textContent='Ошибка: '+e.message;
  }
}

async function fixAll(){
  const n=(DATA.summary && DATA.summary.need_safe_fix)||0;
  if(!n)return;
  if(!confirm('Исправить ВСЕ '+n+' товаров, где нужно дополнить только UA поисковые запросы? Цены, названия, описания и характеристики НЕ меняются.'))return;
  try{
    await api('/api/fix/start',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({limit:'all',mode:'all-safe'})
    });
    document.getElementById('statusText').textContent='🚀 Запущена массовая безопасная обработка '+n+' товаров...';
    poll();
  }catch(e){
    document.getElementById('statusText').textContent='Ошибка: '+e.message;
  }
}

async function stopFix(){
  try{
    await api('/api/fix/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    document.getElementById('statusText').textContent='Запрошена остановка после текущих товаров...';
    poll();
  }catch(e){
    document.getElementById('statusText').textContent='Ошибка остановки: '+e.message;
  }
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


async function refreshSupplierState(){
  try{
    const d=await api('/api/suppliers/state');
    const s=d.state||{};
    const bz=(s.sources && s.sources.bezet), mi=(s.sources && s.sources.militaris);
    let parts=[];
    if(bz) parts.push('BEZET: '+(bz.ok?('✅ '+bz.count+' товаров'):('❌ '+bz.error)));
    if(mi) parts.push('Militaris: '+(mi.ok?('✅ '+mi.count+' товаров'):('❌ '+mi.error)));
    if(s.matching) parts.push('Сопоставление: '+(s.match_processed||0)+' / '+(s.match_total||0));
    else if(s.match_updated_at) parts.push('Совпало с Prom: '+s.matched_products+' / '+(s.matched_products+s.unmatched_products));
    if(s.match_updated_at) parts.push('Можно заполнить: '+(s.fillable_products||0)+' товаров / '+(s.fillable_fields||0)+' полей');
    if((s.errors||[]).length) parts.push('Ошибок: '+s.errors.length);
    document.getElementById('supplierStatus').textContent=parts.length?parts.join(' • '):'Поставщики ещё не загружены.';
    const sb=document.getElementById('supplierSyncBtn');
    const rb=document.getElementById('supplierRefreshBtn');
    const mb=document.getElementById('supplierMatchBtn');
    if(sb) sb.disabled=Boolean(s.loading||s.matching);
    if(rb) rb.disabled=Boolean(s.loading||s.matching);
    if(mb) mb.disabled=Boolean(s.loading||s.matching||!Object.values(s.sources||{}).some(x=>x.ok));
  }catch(e){
    const el=document.getElementById('supplierStatus'); if(el) el.textContent='Ошибка поставщиков: '+e.message;
  }
}

async function supplierSync(){
  const el=document.getElementById('supplierStatus');
  if(el) el.textContent='Загружаю фиды и сопоставляю с Prom...';
  try{
    await api('/api/suppliers/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const timer=setInterval(async()=>{
      const d=await api('/api/suppliers/state');
      await refreshSupplierState();
      if(!d.state.loading && !d.state.matching) clearInterval(timer);
    },900);
  }catch(e){ if(el) el.textContent='Ошибка: '+e.message; }
}

async function supplierRefresh(){
  const el=document.getElementById('supplierStatus'); if(el) el.textContent='Загружаю два фида...';
  try{
    await api('/api/suppliers/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const timer=setInterval(async()=>{
      await refreshSupplierState();
      const d=await api('/api/suppliers/state');
      if(!d.state.loading){clearInterval(timer);}
    },1200);
  }catch(e){ if(el) el.textContent='Ошибка: '+e.message; }
}

async function supplierMatch(){
  const el=document.getElementById('supplierStatus'); if(el) el.textContent='Сопоставляю товары по SKU/артикулу и названию...';
  try{
    await api('/api/suppliers/match',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const timer=setInterval(async()=>{
      const d=await api('/api/suppliers/state');
      await refreshSupplierState();
      if(!d.state.matching){clearInterval(timer);}
    },1200);
  }catch(e){ if(el) el.textContent='Ошибка: '+e.message; }
}


async function probeAttribute(){
  if(!confirm('Тест изменит только ОДНУ пустую характеристику у одного товара и сразу проверит Prom. Продолжить?')) return;
  try{
    const d=await api('/api/enrich/test-attribute',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    alert((d.probe && d.probe.verified) ? ('✅ Prom подтвердил: '+d.probe.field+' = '+d.probe.value) : '❌ Prom не подтвердил запись характеристики');
    await refresh();
  }catch(e){alert('Ошибка теста: '+e.message);}
}

async function massAttributes(){
  if(!confirm('Заполнить массово ТОЛЬКО существующие пустые характеристики Prom, для которых поставщик дал точное значение? Цены и остатки не меняются.')) return;
  try{
    await api('/api/enrich/attributes/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({limit:'all'})});
    pollEnrich();
  }catch(e){alert('Ошибка: '+e.message);}
}

async function massDescriptions(){
  if(!confirm('Дополнить только короткие/пустые украинские описания описанием из фида поставщика? Названия, цены и остатки не меняются.')) return;
  try{
    await api('/api/enrich/descriptions/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({limit:'all'})});
    pollEnrich();
  }catch(e){alert('Ошибка: '+e.message);}
}

async function pollEnrich(){
  await refresh();
  const d=await api('/api/enrich/state');
  if((d.state && d.state.running)) setTimeout(pollEnrich,1200);
  else { await refreshSupplierState(); await refresh(); }
}

function supplierField(label,value){
  if(Array.isArray(value)) value=value.join(', ');
  return '<div class="fbox"><b>'+esc(label)+'</b><div>'+(value?esc(value):'<span class="bad">нет данных</span>')+'</div></div>';
}

async function loadSupplierOne(id,loadPage){
  const el=document.getElementById('supplierOne');
  if(!el)return;
  el.innerHTML='Ищу товар у поставщиков'+(loadPage?' и читаю страницу товара':'')+'...';
  try{
    const d=await api('/api/suppliers/product/'+encodeURIComponent(id)+(loadPage?'?page=1':''));
    if(!d.matched){ el.innerHTML='<span class="bad">❌ Совпадение у поставщиков не найдено.</span>'; return; }
    const m=d.merged||{};
    let h='<div class="good"><b>✅ '+esc(d.match.supplier_name)+'</b> • совпадение '+d.match.score+'% ('+esc(d.match.reason)+')</div>';
    h+='<div class="m">'+esc(d.supplier_product.name)+' • артикул '+esc(d.supplier_product.sku||'—')+'</div>';
    if(d.supplier_product.url) h+='<div class="m">Страница: '+esc(d.supplier_product.url)+'</div>';
    h+=supplierField('Производитель',m.producer);
    h+=supplierField('Тип товара',m.type);
    h+=supplierField('Цвет',m.color);
    h+=supplierField('Размеры',m.sizes||[]);
    h+=supplierField('Материал / состав',m.material);
    h+=supplierField('Сезон',m.season);
    h+=supplierField('Страна',m.country);
    h+=supplierField('Назначение',m.purpose);
    h+=supplierField('Особенности',m.features);
    h+=supplierField('Мембрана',m.membrane);
    h+=supplierField('Утеплитель',m.insulation);
    h+=supplierField('Молния',m.zipper);
    h+=supplierField('Вес',m.weight);
    if(d.page_error) h+='<div class="warn">Страница не загрузилась: '+esc(d.page_error)+'</div>';
    el.innerHTML=h;
  }catch(e){ el.innerHTML='<span class="bad">Ошибка: '+esc(e.message)+'</span>'; }
}

async function initialBoot(){
  var st=document.getElementById('statusText');
  var dg=document.getElementById('scanDiag');
  if(st) st.textContent='✅ Интерфейс работает. Запускаю сканирование...';
  try{
    var state=await api('/api/state');
    var empty=!state.scan.running && !state.scan.summary && !(state.scan.rows||[]).length;
    if(empty){
      try{
        await api('/api/scan/start',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      }catch(e){
        if(dg) dg.textContent='Ошибка запуска: '+e.message;
      }
    }
  }catch(e){
    if(st) st.textContent='❌ API панели недоступен';
    if(dg) dg.textContent=e.message;
  }
  pollTicks=0;
  poll();
  refreshSupplierState();
}
initialBoot();
</script>
</body></html>`;



app.get('/api/enrich/state', (_req,res) => {
  res.json({ok:true,state:enrichState});
});

app.post('/api/enrich/test-attribute', async (req,res) => {
  try{
    const probe=await testOneAttributeWrite(req.body?.id || null);
    recalcSupplierFillable();
    res.json({ok:true,probe});
  }catch(e){ res.status(400).json({error:safeText(e),prom:e.data||null}); }
});

app.post('/api/enrich/attributes/start', (req,res) => {
  if(!WRITE_ENABLED) return res.status(400).json({error:'WRITE_ENABLED=false'});
  if(enrichState.running) return res.json({ok:true,already_running:true});
  const limit=req.body?.limit==='all'?'all':Math.max(1,Math.min(5000,Number(req.body?.limit||25)));
  enrichAttributesMass(limit).catch(e=>{enrichState.running=false;enrichState.errors.push({error:safeText(e)});});
  res.json({ok:true,started:true,limit});
});

app.post('/api/enrich/descriptions/start', (req,res) => {
  if(!WRITE_ENABLED) return res.status(400).json({error:'WRITE_ENABLED=false'});
  if(enrichState.running) return res.json({ok:true,already_running:true});
  const limit=req.body?.limit==='all'?'all':Math.max(1,Math.min(5000,Number(req.body?.limit||25)));
  enrichDescriptionsMass(limit).catch(e=>{enrichState.running=false;enrichState.errors.push({error:safeText(e)});});
  res.json({ok:true,started:true,limit});
});

app.post('/api/enrich/stop', (_req,res) => {
  enrichState.stop_requested=true;
  res.json({ok:true});
});

app.post('/api/suppliers/sync', (_req,res) => {
  if(supplierState.loading || supplierState.matching) return res.json({ok:true,already_running:true});
  syncSuppliers().catch(e=>{
    supplierState.errors.push({supplier:'sync',error:safeText(e)});
    supplierState.loading=false;
    supplierState.matching=false;
  });
  res.json({ok:true,started:true});
});

app.get('/api/suppliers/state', (_req,res) => {
  const safeState=JSON.parse(JSON.stringify(supplierState));
  res.json({ok:true,state:safeState});
});

app.post('/api/suppliers/refresh', (_req,res) => {
  if(supplierState.loading) return res.json({ok:true,already_running:true});
  refreshSupplierFeeds().catch(e=>{supplierState.errors.push({supplier:'all',error:safeText(e)});supplierState.loading=false;});
  res.json({ok:true,started:true});
});

app.post('/api/suppliers/match', (_req,res) => {
  if(supplierState.matching) return res.json({ok:true,already_running:true});
  if(!supplierIndexes.bezet && !supplierIndexes.militaris) return res.status(400).json({error:'Сначала обновите фиды поставщиков'});
  matchSupplierCatalog().catch(e=>{supplierState.errors.push({supplier:'match',error:safeText(e)});supplierState.matching=false;});
  res.json({ok:true,started:true});
});

app.get('/api/suppliers/diagnostics', (_req,res) => {
  res.json({
    ok:true,
    config:{
      bezet:{feed:SUPPLIER_CONFIG.bezet.feedUrl,site:SUPPLIER_CONFIG.bezet.siteUrl},
      militaris:{feed:SUPPLIER_CONFIG.militaris.feedUrl,site:SUPPLIER_CONFIG.militaris.siteUrl}
    },
    state:supplierState,
    records:{bezet:supplierRecords.bezet.length,militaris:supplierRecords.militaris.length},
    indexes:{bezet:Boolean(supplierIndexes.bezet),militaris:Boolean(supplierIndexes.militaris)},
    matches:supplierMatches.size
  });
});


app.post('/action/scan', (req,res) => {
  serverActionNotice='';
  if(!PROM_TOKEN){
    serverActionNotice='PROM_TOKEN не задан в Render Environment.';
    return res.redirect('/');
  }
  if(!scanState.running){
    scanState.last_error=null;
    startScan().catch(e=>{
      scanState.last_error=e && e.message ? e.message : String(e);
      scanState.running=false;
    });
  }
  res.redirect('/');
});

app.post('/action/suppliers-sync', (req,res) => {
  serverActionNotice='Запущена загрузка и сопоставление поставщиков.';
  if(!supplierState.loading && !supplierState.matching){
    syncSuppliers().catch(e=>{
      supplierState.loading=false;
      supplierState.matching=false;
      supplierState.errors.push({supplier:'all',error:safeText(e)});
    });
  }
  res.redirect('/');
});

app.post('/action/suppliers-refresh', (req,res) => {
  serverActionNotice='Запущено обновление фидов.';
  if(!supplierState.loading){
    refreshSupplierFeeds().catch(e=>{
      supplierState.loading=false;
      supplierState.errors.push({supplier:'all',error:safeText(e)});
    });
  }
  res.redirect('/');
});

app.post('/action/suppliers-match', (req,res) => {
  serverActionNotice='Запущено сопоставление товаров.';
  if(!supplierState.matching){
    matchSupplierCatalog().catch(e=>{
      supplierState.matching=false;
      supplierState.errors.push({supplier:'all',error:safeText(e)});
    });
  }
  res.redirect('/');
});

app.post('/action/probe-attribute', async (req,res) => {
  try{
    const probe=await testOneAttributeWrite(null);
    serverActionNotice=probe && probe.verified
      ? ('✅ Prom подтвердил тест: '+(probe.field||'поле')+' = '+(probe.value||''))
      : '❌ Prom не подтвердил тест характеристики.';
    recalcSupplierFillable();
  }catch(e){
    serverActionNotice='Ошибка теста характеристики: '+(e.message||String(e));
  }
  res.redirect('/');
});

app.post('/action/mass-attributes', (req,res) => {
  recalcSupplierFillable();
  if(Number(supplierState.fillable_fields||0)===0){
    serverActionNotice='⛔ Через API заполнять нечего: 0 товаров / 0 полей. Характеристики нужно обновлять через импорт Prom.';
    return res.redirect('/');
  }
  serverActionNotice='Запущено заполнение характеристик через API.';
  if(!enrichState.running){
    enrichAttributesMass('all').catch(e=>{
      enrichState.running=false;
      enrichState.errors.push({error:safeText(e)});
    });
  }
  res.redirect('/');
});

app.post('/action/mass-descriptions', (req,res) => {
  serverActionNotice='Запущено дополнение пустых/коротких описаний. Прогресс смотри в блоке «Автозаполнение из поставщика».';
  if(!enrichState.running){
    enrichDescriptionsMass('all').catch(e=>{
      enrichState.running=false;
      enrichState.errors.push({error:safeText(e)});
    });
  }
  res.redirect('/');
});

app.get('/api/suppliers/product/:id', async (req,res) => {
  try{
    const loadPage=String(req.query.page||'')==='1';
    res.json(await getSupplierEnrichmentForProm(req.params.id,loadPage));
  }catch(e){
    res.status(500).json({error:safeText(e)});
  }
});


function escHtmlServer(v){
  return String(v == null ? '' : v)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function supplierStatusText(){
  const st=supplierState||{};
  const parts=[];
  const bz=st.sources && st.sources.bezet;
  const mi=st.sources && st.sources.militaris;

  if(bz) parts.push('BEZET: '+(bz.ok ? ('✅ '+bz.count+' товаров') : ('❌ '+(bz.error||'ошибка'))));
  if(mi) parts.push('Militaris: '+(mi.ok ? ('✅ '+mi.count+' товаров') : ('❌ '+(mi.error||'ошибка'))));

  if(st.loading) parts.push('⏳ загружаю фиды');
  if(st.matching) parts.push('⏳ сопоставление '+(st.match_processed||0)+'/'+(st.match_total||0));
  else if(st.match_updated_at){
    parts.push('Совпало с Prom: '+(st.matched_products||0)+' / '+((st.matched_products||0)+(st.unmatched_products||0)));
    parts.push('Можно заполнить характеристик через API: '+(st.fillable_products||0)+' товаров / '+(st.fillable_fields||0)+' полей');
    if((st.matched_products||0)>0 && (st.fillable_fields||0)===0){
      parts.push('⚠ Prom API не отдал пустые category attributes для записи; данные поставщика при этом найдены');
    }
  }

  if((st.errors||[]).length) parts.push('Ошибок: '+st.errors.length);
  return parts.length ? parts.join(' • ') : 'Поставщики ещё не загружены.';
}

function renderAuditRowsServer(){
  const rows=(scanState.rows||[]).slice(0,120);
  if(!rows.length) return '<tr><td colspan="8" class="m">Нет данных для таблицы.</td></tr>';
  return rows.map(r=>{
    const f=r.fields||{};
    const kw=f.keywords||{};
    const prod=f.producer||{};
    const typ=f.type||{};
    const col=f.color||{};
    const sz=f.size||{};
    function okCell(x){ return x && x.ok ? '✅ '+escHtmlServer(x.value||'') : '❌ '+escHtmlServer(x?.value||'Пусто'); }
    return '<tr>'+
      '<td>'+escHtmlServer(r.name||r.id)+'</td>'+
      '<td><b>'+escHtmlServer((r.score??0)+'%')+'</b></td>'+
      '<td>'+okCell(kw)+'</td>'+
      '<td class="hide-mobile">'+okCell(prod)+'</td>'+
      '<td class="hide-mobile">'+okCell(typ)+'</td>'+
      '<td class="hide-mobile">'+okCell(col)+'</td>'+
      '<td class="hide-mobile">'+okCell(sz)+'</td>'+
      '<td><span class="m">ID '+escHtmlServer(r.id)+'</span></td>'+
    '</tr>';
  }).join('');
}

function renderEnrichStatusServer(){
  const e=enrichState||{};
  if(!e.started_at && !e.running) return 'Ещё не запускалось.';
  const lines=[];
  lines.push('Режим: '+(e.mode==='descriptions'?'описания':e.mode==='attributes'?'характеристики':(e.mode||'—')));
  lines.push('Статус: '+(e.running?'🔄 выполняется':'✅ завершено'));
  lines.push('Запланировано: '+(e.planned||0));
  lines.push('Обработано: '+(e.processed||0));
  lines.push('Подтверждено Prom: '+(e.verified||0));
  lines.push('Изменено полей: '+(e.changed_fields||0));
  lines.push('Ошибок: '+(e.failed||0));
  if(e.started_at) lines.push('Старт: '+e.started_at);
  if(e.finished_at) lines.push('Финиш: '+e.finished_at);
  if((e.errors||[]).length){
    lines.push(''); lines.push('Первые ошибки:');
    for(const x of e.errors.slice(0,5)) lines.push('- '+(x.id?('ID '+x.id+': '):'')+(x.error||JSON.stringify(x)));
  }
  return lines.join('\\n');
}

function renderFixStatusServer(){
  const f=fixState||{};
  if(!f.started_at && !f.running) return 'Ещё не запускалась.';
  const lines=[];
  lines.push('Статус: '+(f.running?'🔄 выполняется':'✅ завершено'));
  lines.push('Режим: '+(f.mode||'—'));
  lines.push('Запланировано: '+(f.planned||0));
  lines.push('Обработано: '+(f.processed||0));
  lines.push('Подтверждено Prom: '+(f.verified||0));
  lines.push('Ошибок: '+(f.failed||0));
  if(f.started_at) lines.push('Старт: '+f.started_at);
  if(f.finished_at) lines.push('Финиш: '+f.finished_at);
  return lines.join('\\n');
}

function renderServerHtml(){
  const summary=scanState.summary;
  const total=summary && summary.total!=null ? summary.total : (scanState.total||0);
  const avg=summary ? (summary.average_score+'%') : '—';
  const need=summary && summary.need_safe_fix!=null ? summary.need_safe_fix : '—';
  const errs=summary && summary.errors!=null ? summary.errors : (scanState.errors||0);
  const progress=scanState.total ? Math.round((scanState.processed||0)/scanState.total*100) : 0;

  let status='';
  let diag='';

  if(scanState.running){
    status='🔄 Сканирую: '+(scanState.processed||0)+' / '+(scanState.total||0)+' ('+progress+'%)';
    diag='Страница обновится автоматически.';
  }else if(scanState.last_error){
    status='❌ Сканирование завершилось ошибкой';
    diag='Prom/API: '+scanState.last_error;
  }else if(summary){
    status='✅ Готово. Проверено '+(summary.valid||0)+' товаров.';
    diag='Сканирование завершено.';
  }else if(!PROM_TOKEN){
    status='❌ PROM_TOKEN не найден';
    diag='Добавь PROM_TOKEN в Render → Environment.';
  }else{
    status='⏳ Каталог ещё не просканирован';
    diag='Нажми «Сканировать весь каталог».';
  }

  const shouldRefresh=Boolean(
    scanState.running ||
    supplierState.loading ||
    supplierState.matching ||
    enrichState.running ||
    fixState.running
  );

  let out=html;
  const replacements={
    '__SSR_META_REFRESH__': shouldRefresh ? '<meta http-equiv="refresh" content="3">' : '',
    '__SSR_STATUS__': escHtmlServer(status),
    '__SSR_DIAG__': escHtmlServer(diag),
    '__SSR_PROGRESS__': String(progress),
    '__SSR_TOTAL__': total ? String(total) : '—',
    '__SSR_AVG__': escHtmlServer(avg),
    '__SSR_NEED__': escHtmlServer(need),
    '__SSR_ERRS__': String(errs),
    '__SSR_SUPPLIER__': escHtmlServer(supplierStatusText()),
    '__SSR_NOTICE__': escHtmlServer(serverActionNotice||''),
    '__SSR_ROWS__': renderAuditRowsServer(),
    '__SSR_ENRICH__': escHtmlServer(renderEnrichStatusServer()),
    '__SSR_FIX__': escHtmlServer(renderFixStatusServer())
  };

  for(const k of Object.keys(replacements)){
    out=out.split(k).join(replacements[k]);
  }
  return out;
}

app.get('/', (_req,res) => {
  res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma','no-cache');
  res.set('Expires','0');
  res.type('html').send(renderAutoHome());
});
app.get('/legacy', (_req,res) => { res.type('html').send(renderServerHtml()); });

function startAutoRoute(req,res){
  if(autoState.import_background){
    autoState.phase='⏳ Предыдущий импорт Prom ещё не подтверждён. Новый импорт не запускается';
    return res.redirect(303,'/');
  }
  if(Date.now()<AUTO_BOOT_GUARD_UNTIL && !autoBootGuardSatisfiedByRestoredTerminal && String(req.query?.force||'')!=='YES'){
    const left=Math.max(1,Math.ceil((AUTO_BOOT_GUARD_UNTIL-Date.now())/60000));
    autoState.phase=`🛡️ Защита после рестарта: новый импорт заблокирован ещё примерно ${left} мин`;
    autoState.import_error='Это переходная защита на случай, если предыдущая версия не успела сохранить lock перед Render restart.';
    return res.redirect(303,'/');
  }
  if(!autoState.running){
    setTimeout(()=>runAutoAll('manual').catch(e=>{
      autoState.errors.unshift({where:'run',error:safeText(e)});
      autoState.running=false;
    }),50);
  }
  res.redirect(303,'/');
}
function stopAutoRoute(_req,res){
  autoState.stop_requested=true;
  fixState.stop_requested=true;
  enrichState.stop_requested=true;
  res.redirect(303,'/');
}

app.get('/auto/run', startAutoRoute);
app.post('/auto/run', startAutoRoute);
app.get('/auto/run/', startAutoRoute);
app.post('/auto/run/', startAutoRoute);
app.get('/auto/stop', stopAutoRoute);
app.post('/auto/stop', stopAutoRoute);
app.get('/auto/stop/', stopAutoRoute);
app.post('/auto/stop/', stopAutoRoute);
app.get('/auto/state', (_req,res) => res.json({auto:autoState,scan:scanState.summary,suppliers:supplierState,fix:fixState,enrich:enrichState}));

app.get('/stock/state', (_req,res) => res.json({
  stock:stockState,
  diagnostic:stockDiag,
  config:{
    monitor_enabled:STOCK_MONITOR_ENABLED,
    write_enabled:STOCK_WRITE_ENABLED,
    interval_hours:STOCK_INTERVAL_HOURS,
    low_threshold:STOCK_LOW_THRESHOLD,
    max_writes:STOCK_MAX_WRITES,
    allow_mass:STOCK_ALLOW_MASS
  }
}));


app.get('/stock/diag', (_req,res)=>res.json({diag:stockDiag,plan_count:lastStockPlans.length,write_enabled:STOCK_WRITE_ENABLED}));

app.get('/stock/test-one', async (_req,res)=>{
  try{
    await runOneStockDiagnostic();
  }catch(e){
    stockDiag.error={message:e?.message||String(e),status:e?.status??null,data:e?.data??null};
    stockDiag.running=false;
  }
  return res.redirect(303,'/');
});

app.get('/stock/run', async (_req,res)=>{
  if(stockState.running){
    stockState.phase='Проверка склада уже выполняется';
    return res.redirect(303,'/');
  }

  // Manual run must not stay stuck in the scheduler's "waiting" message.
  stockState.phase='Запускаю ручную проверку склада...';
  stockState.progress=1;

  // If the main AUTO process is already finished, a leftover loading flag is stale.
  if(!autoState.running && supplierState.loading){
    supplierState.loading=false;
  }

  try{
    await runStockMonitor('manual');
  }catch(e){
    stockState.errors.unshift({where:'manual',error:safeText(e)});
    stockState.phase='Ошибка ручной проверки склада';
    stockState.running=false;
  }
  return res.redirect(303,'/');
});


app.get('/groups/plan', (_req,res)=>{
  res.json({
    version:'v3.0',
    interval_hours:AUTO_INTERVAL_HOURS,
    groups:MANAGED_GROUPS,
    distribution:autoState.group_distribution
  });
});

app.get('/groups/cleanup', (_req,res)=>{
  res.json({
    note:'Prom Public API не предоставляет delete для групп. Это безопасный список пустых старых групп после переноса товаров.',
    legacy_groups:autoState.legacy_groups,
    empty_legacy_groups:autoState.empty_legacy_groups,
    candidates:autoState.group_cleanup_candidates
  });
});

app.get('/groups/covers', (_req,res)=>{
  const cards=Object.values(autoState.cover_candidates||{}).map(x=>`
    <div style="border:1px solid #34443a;border-radius:14px;padding:10px;background:#121b15">
      <img src="${autoEscHtml(x.image)}" style="width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:10px;background:#fff" alt="">
      <b style="display:block;margin-top:8px">${autoEscHtml(x.group_name)}</b>
      <div style="font-size:12px;color:#9caf9f">${autoEscHtml(x.product||'')}</div>
    </div>`).join('');

  res.type('html').send(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PrimeTac group covers</title></head><body style="margin:0;background:#08100b;color:#f4f7f4;font-family:system-ui"><div style="max-width:920px;margin:auto;padding:14px"><h2>Фото для групп PrimeTac</h2><p>Автомат выбирает чистое фото реального товара из BEZET/Militaris для каждой группы. Через официальный Prom API установить изображение именно группы нельзя, поэтому отсюда их можно один раз поставить вручную.</p><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">${cards||'<p>Сначала запустите автомат.</p>'}</div></div></body></html>`);
});

app.get('/auto/last-import.xml', (_req,res) => res.type('application/xml').send(lastAutoImportXml||'<?xml version="1.0"?><empty/>'));
app.get('/auto/verify', async (_req,res)=>{
  try{
    let terminal='';
    if(autoState.import_background && autoState.import_id){
      try{
        autoState.import_poll_count++;
        const r=await pollAutoImportStatusOnce(autoState.import_id,autoState.group_assignments_planned||0);
        terminal=r.status;
        if(importFailed(terminal)){
          autoState.import_background=false;
          autoState.import_terminal_confirmed=true;
          autoState.import_error='Prom завершил импорт со статусом '+terminal;
          autoState.phase='Ошибка импорта Prom: '+terminal;
          autoState.progress=100;
          return res.redirect('/');
        }
      }catch(e){
        recordStatusEndpointError(e,'/products/import/status/'+encodeURIComponent(autoState.import_id));
      }
    }

    const verify=await verifyLastImportNow();
    if(autoState.import_background && catalogAcceptsImport(verify,terminal)){
      autoState.import_background=false;
      autoState.import_terminal_confirmed=importSucceeded(terminal);
      autoState.import_status=importSucceeded(terminal) ? terminal : 'VERIFIED_BY_CATALOG';
      autoState.import_error=null;
      if(autoImportWatchTimer){ clearTimeout(autoImportWatchTimer); autoImportWatchTimer=null; }
      await auditManagedGroups();
      autoState.phase=importSucceeded(terminal)
        ? '✅ Готово. Prom подтвердил импорт и каталог совпал с планом'
        : '✅ Готово. Импорт подтверждён по фактическим группам каталога';
      autoState.progress=100;
      clearImportLock('manual-verify-success');
    }else if(autoState.import_background){
      autoState.phase=`⏳ Импорт ещё не подтверждён. Группы ${verify.managed||0}/${verify.total||0}`;
    }else{
      await auditManagedGroups();
    }
  }catch(e){
    autoState.errors.unshift({where:'manual-verify',error:safeText(e)});
  }
  res.redirect('/');
});


app.get('/auto/unlock', (req,res)=>{
  const confirm=String(req.query?.confirm||'');
  if(confirm!=='UNLOCK'){
    autoState.phase='⚠️ Снятие блокировки отменено: нужен confirm=UNLOCK';
    return res.redirect('/');
  }
  if(autoState.running){
    autoState.phase='⚠️ Нельзя снять блокировку, пока основной процесс выполняется';
    return res.redirect('/');
  }
  if(autoImportWatchTimer){ clearTimeout(autoImportWatchTimer); autoImportWatchTimer=null; }
  clearImportLock('manual-unlock');
  autoState.import_background=false;
  autoState.import_status='MANUAL_UNLOCK';
  autoState.import_error=null;
  autoState.persistent_lock=false;
  autoState.phase='🔓 Блокировка импорта снята вручную. Следующий запуск создаст новую задачу Prom';
  autoState.progress=0;
  lastAutoImportPlan=[];
  autoImportWatchStartedAt=0;
  res.redirect('/');
});

app.get('/health', (_req,res) => {
  res.json({
    ok: true,
    app: 'PrimeTac AUTO v3.4.7 GROUP VERIFY',
    prom_connected: Boolean(PROM_TOKEN),
    write_enabled: WRITE_ENABLED,
    stock_monitor_enabled: STOCK_MONITOR_ENABLED,
    stock_write_enabled: STOCK_WRITE_ENABLED
  });
});

app.get('/api/state', (_req,res) => {
  res.json({ scan: scanState, fix: fixState, enrich: enrichState });
});

app.post('/api/scan/start', (_req,res) => {
  if(!PROM_TOKEN) return res.status(400).json({ok:false,error:'PROM_TOKEN не задан в Render Environment'});
  if(scanState.running) return res.json({ ok:true, already_running:true });
  startScan().catch(e=>{
    scanState.last_error=e && e.message ? e.message : String(e);
    scanState.running=false;
    console.error('[SCAN START ERROR]', scanState.last_error);
  });
  res.json({ ok:true, started:true });
});

app.post('/api/fix/start', (req,res) => {
  if(!WRITE_ENABLED) return res.status(400).json({ error:'WRITE_ENABLED=false' });
  if(fixState.running) return res.json({ ok:true, already_running:true });

  const rawLimit = req.body?.limit;
  const mode = String(req.body?.mode || 'batch');
  let limit = rawLimit === 'all'
    ? 'all'
    : Math.max(1, Math.min(5000, Number(rawLimit || BATCH_SIZE)));

  startBatchFix(limit, mode).catch(()=>{});
  res.json({ ok:true, started:true, limit, mode });
});

app.post('/api/fix/stop', (_req,res) => {
  if(!fixState.running){
    return res.json({ ok:true, running:false, message:'Обработка уже остановлена' });
  }

  fixState.stop_requested = true;
  res.json({ ok:true, running:true, stop_requested:true });
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

let stockRetryTimer=null;
function startStockWhenFree(reason='schedule'){
  if(!STOCK_MONITOR_ENABLED || !PROM_TOKEN || stockState.running) return;

  if(autoState.running || autoState.import_background || supplierState.loading){
    stockState.phase='Контроль склада ждёт завершения основного процесса';
    stockState.next_run_at=new Date(Date.now()+15*60*1000).toISOString();

    if(!stockRetryTimer){
      stockRetryTimer=setTimeout(()=>{
        stockRetryTimer=null;
        startStockWhenFree(reason+'-retry');
      },15*60*1000);
    }
    return;
  }

  runStockMonitor(reason).catch(e=>{
    stockState.errors.unshift({where:reason,error:safeText(e)});
    stockState.running=false;
  });
}

restoredImportLock=restoreImportLock();

app.listen(PORT, () => {
  console.log(`PrimeTac AUTO v3.4.7 GROUP VERIFY started on ${PORT}`);
  autoState.next_run_at=new Date(Date.now()+AUTO_INTERVAL_HOURS*3600*1000).toISOString();
  stockState.next_run_at=new Date(Date.now()+STOCK_INTERVAL_HOURS*3600*1000).toISOString();

  if(restoredImportLock){
    const ageSec=Number(autoState.restored_lock_age_sec||0);
    console.log(`[AUTO] restored pending import lock id=${autoState.import_id||'unknown'} age=${ageSec}s from ${AUTO_STATE_PATH}`);
    if(ageSec <= AUTO_LOCK_STALE_HOURS*3600){
      setTimeout(()=>scheduleBackgroundImportWatcher(autoState.import_id,autoState.group_assignments_planned||lastAutoImportPlan.length||0),5000);
    }
  }else if(AUTO_ON_START && PROM_TOKEN && WRITE_ENABLED){
    // A Render restart must never fire a fresh Prom import seconds after boot.
    // Even if the old lock file was lost, give an earlier Prom task time to finish.
    autoState.phase=`🛡️ После запуска сервера автозапуск отложен на ${AUTO_STARTUP_SAFE_DELAY_MIN} мин для защиты от дубля`;
    setTimeout(()=>{
      if(!autoState.running && !autoState.import_background){
        runAutoAll('startup-delayed').catch(e=>{autoState.errors.unshift({where:'startup-delayed',error:safeText(e)});autoState.running=false;});
      }
    },AUTO_STARTUP_SAFE_DELAY_MIN*60*1000);
  }

  if(STOCK_MONITOR_ENABLED && PROM_TOKEN){
    setTimeout(()=>startStockWhenFree('startup'),STOCK_START_DELAY_SEC*1000);
  }
});
setInterval(()=>{
  const dueAt=autoState.next_run_at ? Date.parse(autoState.next_run_at) : 0;
  const due=!Number.isFinite(dueAt) || dueAt===0 || Date.now()>=dueAt;
  if(due && !autoState.running && !autoState.import_background && PROM_TOKEN && WRITE_ENABLED){
    runAutoAll('schedule').catch(e=>{autoState.errors.unshift({where:'schedule',error:safeText(e)});autoState.running=false;});
  }
}, 60*1000);

setInterval(()=>{
  startStockWhenFree('schedule');
}, STOCK_INTERVAL_HOURS*3600*1000);

