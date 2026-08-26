const fs=require("fs");const XLSX=require("xlsx");global.XLSX=XLSX;global.alert=()=>{};
global.localStorage={getItem:()=>null,setItem:()=>{}};
global.document={getElementById:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},classList:{add(){},remove(){}},appendChild(){},setProperty(){}}),body:{appendChild(){}}};global.window=global;
let html=fs.readFileSync("index.html","utf8");
eval.call(global, html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1].replace(/render\(\);\s*$/,"").replace(/chequearVersion\(\);/g,""));

// --- caso sintetico: el asiento de cargos NO esta, y despues SI ---
STATE.transitoPrevio=null; STATE.chequesDetalle=null; STATE.results={};
STATE.saldoCajaGeneral = { inicial:0, final:1000, fechaFinal:"2026-02-28" };
STATE.results = { paso2:[{clase:"en_transito",motivo:"x",banco:"STG",fecha:"2026-02-28",monto:1000,concepto:"Cheque (detalle individual)",texto:"x"}] };
STATE.estados = { Banistmo:[
  {fecha:"2026-02-15",debito:170.00,credito:0,descripcion:"COMISION V/MC ESTABLECIMIENTO AFILIADO"},
  {fecha:"2026-02-20",debito:503.11,credito:0,descripcion:"RETENCION ITBMS V/MC"}
]};
STATE.retVisaDetalle = null;
STATE.diarioCaja = [];
let h = asientosSugeridosHtml();
console.log("sin el asiento en el diario  -> sello REGISTRADO: " + (h.indexOf("as-reg")>=0 ? "SI (mal)" : "no"));

// ahora el usuario lo registro: un solo renglon por el total
STATE.diarioCaja = [{ fecha:"2026-02-28", debito:0, credito:673.11, descripcion:"COMISIONES Y RETENCIONES DE TARJETA DE FEBRERO", referencia:"ME-00000001899", fila:99 }];
h = asientosSugeridosHtml();
console.log("con el asiento (1 renglon)   -> sello REGISTRADO: " + (h.indexOf("as-reg")>=0 ? "SI" : "NO (mal)"));
console.log("   " + (h.match(/Ya hay un asiento[^<]*/)||[""])[0]);

// digitado renglon por renglon el mismo dia
STATE.diarioCaja = [
  { fecha:"2026-02-28", debito:0, credito:170.00, descripcion:"COMISION DE TARJETA", referencia:"ME-1899", fila:98 },
  { fecha:"2026-02-28", debito:0, credito:503.11, descripcion:"RETENCION ITBMS DE TARJETA", referencia:"ME-1899", fila:99 }
];
h = asientosSugeridosHtml();
console.log("con el asiento (2 renglones) -> sello REGISTRADO: " + (h.indexOf("as-reg")>=0 ? "SI" : "NO (mal)"));
console.log("   " + (h.match(/Ya hay un asiento[^<]*/)||[""])[0]);

// un credito por otro importe no debe marcarlo
STATE.diarioCaja = [{ fecha:"2026-02-28", debito:0, credito:999.99, descripcion:"COMISION DE TARJETA", referencia:"ME-1", fila:99 }];
h = asientosSugeridosHtml();
console.log("con un importe distinto      -> sello REGISTRADO: " + (h.indexOf("as-reg")>=0 ? "SI (mal)" : "no"));

// un credito del importe correcto pero de otro concepto tampoco
STATE.diarioCaja = [{ fecha:"2026-02-28", debito:0, credito:673.11, descripcion:"DEPOSITO BRINKS DEL 28/02/2026", referencia:"ME-1", fila:99 }];
h = asientosSugeridosHtml();
console.log("con otro concepto            -> sello REGISTRADO: " + (h.indexOf("as-reg")>=0 ? "SI (mal)" : "no"));

// --- render para mirarlo ---
STATE.diarioCaja = [{ fecha:"2026-02-28", debito:0, credito:673.11, descripcion:"COMISIONES Y RETENCIONES DE TARJETA DE FEBRERO", referencia:"ME-00000001899", fila:99 }];
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
fs.writeFileSync("C:/Users/50762/Desktop/CLAUDE/LOGISTICA PREMIUM/_reg.html",
 '<!doctype html><meta charset="utf-8"><style>'+css+'</style><body><div class="app"><div class="cg-box">'+asientosSugeridosHtml()+'</div></div>');
console.log("\nrender escrito");
