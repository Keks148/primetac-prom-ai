const fs = require("fs");
const path = require("path");
const { config } = require("./config");

const STATE_PATH = process.env.PROM_IMPORT_STATE_PATH || "/var/data/primetac-prom-import-state.json";
function ensureDir(){fs.mkdirSync(path.dirname(STATE_PATH),{recursive:true});}
function readState(){try{return JSON.parse(fs.readFileSync(STATE_PATH,"utf8"));}catch{return {};}}
function writeState(state){ensureDir();const tmp=`${STATE_PATH}.tmp`;fs.writeFileSync(tmp,JSON.stringify(state,null,2),"utf8");fs.renameSync(tmp,STATE_PATH);}

async function promJson(endpoint,{method="GET",body=null}={}){
  if(!config.promToken) throw new Error("PROM_TOKEN is not configured");
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),config.httpTimeoutMs);
  try{
    const response=await fetch(`${config.promApiBase}/${endpoint}`,{method,signal:controller.signal,headers:{Accept:"application/json",Authorization:`Bearer ${config.promToken}`,...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const text=await response.text(); let parsed=null; try{parsed=text?JSON.parse(text):null}catch{parsed=text}
    if(!response.ok) throw new Error(`Prom API ${response.status}: ${typeof parsed==="string"?parsed.slice(0,800):JSON.stringify(parsed)}`);
    return parsed;
  }finally{clearTimeout(timer)}
}

async function startImportUrl(feedUrl){
  return promJson("products/import_url",{method:"POST",body:{url:feedUrl,force_update:true,only_available:false,only_update:false,mark_missing_product_as:"none"}});
}

async function getImportStatus(id){return promJson(`products/import/status/${encodeURIComponent(id)}`);}

async function submitCsvControlTest({enabled,feedUrl,summary,groupCountBefore,productCountBefore}){
  const state=readState();
  if(!enabled) return {skipped:true,reason:"PROM_CSV_TEST_IMPORT_ON_START is disabled"};
  if(state.controlCsvV1?.submitted) return {skipped:true,reason:"CSV control test already submitted",state:state.controlCsvV1};
  if(summary.exportedFamilies!==20 || summary.exportedRows<20 || !summary.allTargetsExist || !summary.externalIdsUnique || !summary.productCodesUnique) throw new Error(`Unsafe CSV control feed: ${JSON.stringify(summary)}`);
  const response=await startImportUrl(feedUrl); const id=response?.id||response?.import_id||response?.job_id||null;
  if(!id) throw new Error(`Prom import did not return job id: ${JSON.stringify(response)}`);
  state.controlCsvV1={submitted:true,completed:false,submittedAt:new Date().toISOString(),importId:id,feedUrl,groupCountBefore,productCountBefore,expectedFamilies:summary.exportedFamilies,expectedRows:summary.exportedRows,targetGroups:summary.targetGroups,familyKeys:summary.familyKeys,externalIds:summary.externalIds,startResponse:response};
  writeState(state);
  return {skipped:false,submitted:true,id,expectedFamilies:summary.exportedFamilies,expectedRows:summary.exportedRows,groupCountBefore,productCountBefore};
}

module.exports={STATE_PATH,readState,getImportStatus,submitCsvControlTest};
