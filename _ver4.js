const fs=require("fs");const XLSX=require("xlsx");global.XLSX=XLSX;global.alert=()=>{};
global.localStorage={getItem:()=>null,setItem:()=>{}};
global.document={getElementById:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},classList:{add(){},remove(){}},appendChild(){},setProperty(){}}),body:{appendChild(){}}};global.window=global;
let html=fs.readFileSync("index.html","utf8");
eval.call(global, html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1].replace(/render\(\);\s*$/,"").replace(/chequearVersion\(\);/g,""));
const F="C:/Users/50762/Desktop/ARCHIVOS EMPRESA FAMILIAR/CONTAB/MI ASISTENTE CONTABLE/Petty febrero/";
function rd(p){const wb=XLSX.read(fs.readFileSync(F+p),{type:"buffer",cellDates:true});const f=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,raw:true,defval:null});f.hojas={};wb.SheetNames.forEach(n=>{f.hojas[n]=XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1,raw:true,defval:null});});return f;}
const N={transitoPrevio:"paso 0 en febrero petty.xlsx", reporte:"resumen de caja febrero petty.xlsx",
 diarioCaja:"NAVEGADOR DE PETTY CAJA GENERAL FEBRERO CORREGIDO.xlsx",
 diarioBanistmo:"nav banco petty banistmo feberro.xlsx", diarioStg:"nav febrero petty st georges 2026 .xlsx",
 diarioBancoGeneral:"NAV JOURNAL FEBRERO PETTY BANCO GENERAL 2026.xlsx",
 estBanistmo:"est banistmo febr petty.xlsx", estStg:"ESTADO DE CUENTA DE STG FEBRERO  2026.xlsx",
 estBancoGeneral:"est cta banco gral petty febrero.xlsx",
 retVisa:"Copia de PRETTY SHOP, S.A.02_02_2026 visas febrero 2026.xlsx"};
const raws={}; Object.keys(N).forEach(k=>{ raws[k]=rd(N[k]); STATE.files[k]={name:N[k]}; });
ensureResults();
const opts={ventana:STATE.options.ventanaDias, tol:STATE.options.tolerancia};
STATE.periodos = diagnosticarPeriodos(raws);
STATE.results.paso0 = computePasoResult("paso0", raws, opts);
PASO_ORDEN.forEach(k=>{ STATE.results[k]=computePasoResult(k, raws, opts); });
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
let h = '<div class="results-head"><h2>Hallazgos</h2></div>';
["paso1","paso3"].forEach(function(k){
  (STATE.results[k]||[]).filter(x=>(x.clase||"diff")==="diff").slice(0,2).forEach(function(x){
    const a = asientoDelHallazgo(x, k);
    h += '<div class="finding"><input type="checkbox"><div class="ftxt">'+esc(x.texto)+
         '<span class="src">'+esc(x.fuente)+'</span>'+asientoHallazgoHtml(a)+'</div>'+
         '<div class="famt">B/ '+fmt(Math.abs(x.monto))+'</div></div>';
  });
});
fs.writeFileSync("C:/Users/50762/Desktop/CLAUDE/LOGISTICA PREMIUM/_fin.html",
 '<!doctype html><meta charset="utf-8"><style>'+css+'</style><body><div class="app"><div class="step-block"><div class="step-body">'+h+'</div></div></div>');
console.log("render escrito");
