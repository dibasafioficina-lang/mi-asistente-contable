const fs=require("fs");
let L=fs.readFileSync("index.html","utf8").split(/\r?\n/);
function at(n,desde){ const i=L.findIndex((l,k)=>(desde==null||k>=desde)&&l.indexOf(n)>=0); if(i<0) throw new Error("no: "+n); return i; }

// ---------- detector: ¿el asiento ya esta en el diario de Caja General? ----------
let i = at('function asientosSugeridosHtml(){');
L.splice(i, 0,
'/* ---- ¿El asiento sugerido ya se registro? ----',
'   Una vez que el asiento esta hecho y el navegador se vuelve a exportar, el reporte no deberia seguir',
'   pidiendolo como si faltara. Se busca en el diario de Caja General un CREDITO por su importe con un',
'   concepto compatible: primero una linea sola, y si no, varias del mismo dia que sumen (el asiento de',
'   cargos suele digitarse renglon por renglon, uno por comision, retencion e ITBMS).',
'   La tolerancia es de 3 centavos, la misma del cotejo. */',
'function asientoRegistrado(monto, patron){',
'  var diario = STATE.diarioCaja || [];',
'  if(!(monto > 0.005) || !diario.length) return null;',
'  var cand = diario.filter(function(x){',
'    return x.credito > 0 && patron.test(normTxt(x.descripcion));',
'  });',
'  for(var k=0;k<cand.length;k++){',
'    if(Math.abs(cand[k].credito - monto) <= 0.03) return { fecha:cand[k].fecha, ref:String(cand[k].referencia||"").trim(), n:1 };',
'  }',
'  var porDia = {};',
'  cand.forEach(function(x){ (porDia[x.fecha] = porDia[x.fecha] || []).push(x); });',
'  var hit = null;',
'  Object.keys(porDia).sort().forEach(function(f){',
'    if(hit || porDia[f].length < 2) return;',
'    var s = Math.round(porDia[f].reduce(function(a,x){ return a+x.credito; },0)*100)/100;',
'    if(Math.abs(s - monto) <= 0.03) hit = { fecha:f, ref:String(porDia[f][0].referencia||"").trim(), n:porDia[f].length };',
'  });',
'  return hit;',
'}',
'function selloRegistrado(reg){',
'  if(!reg) return "";',
'  return \' <span class="as-reg">REGISTRADO</span>\';',
'}',
'function notaRegistrado(reg){',
'  if(!reg) return "";',
'  return \'<div class="as-reg-nota">Ya hay un asiento por este importe en el diario de Caja General: \' +',
'    esc(reg.fecha) + (reg.ref ? " · " + esc(reg.ref) : "") +',
'    (reg.n > 1 ? " (" + reg.n + " renglones del mismo día)" : "") +',
'    \'. Verificá que sea este mismo antes de darlo por hecho.</div>\';',
'}');

// ---------- patron por bloque ----------
i = at('      titulo: "Cargos bancarios y de facturación de tarjeta",');
L.splice(i+1, 0, '      patron: /COMISION|RETENCION|ITBMS|GASTO|CARGO|BANCARIO|DEVOLUCION/,');
i = at('      titulo: "Descargo del tránsito del mes anterior",');
L.splice(i+1, 0, '      patron: /DESCARGO|CIRCULACION|TRANSITO|COMPENS/,');

// ---------- render con el sello ----------
i = at('  bloques.forEach(function(b, k){');
let fin = at('  });', i);
L.splice(i, fin-i+1,
'  bloques.forEach(function(b, k){',
'    var reg = b.patron ? asientoRegistrado(b.monto, b.patron) : null;',
'    h += \'<div class="as-item\'+(reg?" as-hecho":"")+\'"><div class="as-tit">\'+(k+1)+\' · \'+esc(b.titulo)+',
'      \' <b>B/ \'+fmt(b.monto)+\'</b>\'+selloRegistrado(reg)+\'</div>\' +',
'      \'<div class="as-linea"><span>Fecha</span><b>\'+esc(b.fecha)+\'</b></div>\' +',
'      \'<div class="as-linea"><span>Débito</span><b>\'+esc(b.debito)+\' · B/ \'+fmt(b.monto)+\'</b></div>\' +',
'      \'<div class="as-linea"><span>Crédito</span><b>\'+esc(b.credito)+\' · B/ \'+fmt(b.monto)+\'</b></div>\' +',
'      \'<div class="as-linea"><span>Concepto</span><b>\'+esc(b.concepto)+\'</b></div>\' +',
'      notaRegistrado(reg) + b.tabla + (b.nota ? \'<div class="cg-note">\'+esc(b.nota)+\'</div>\' : "") + \'</div>\';',
'  });');

// ---------- CSS ----------
i = at('  .as-item{background:#F7F4F9;border:1px solid #E2D9EA;border-radius:10px;padding:10px 12px;margin-bottom:10px}');
L.splice(i+1, 0,
'  .as-item.as-hecho{background:#F2F9F5;border-color:#BEE3CD}',
'  .as-reg{display:inline-block;background:var(--ok);color:#fff;font-family:"Mulish";font-size:10px;font-weight:800;',
'    letter-spacing:.6px;padding:2px 8px;border-radius:999px;vertical-align:middle;margin-left:6px}',
'  .as-reg-nota{font-size:11.5px;color:#3F6E56;background:#EAF5EE;border-radius:8px;padding:7px 9px;margin:8px 0 4px;line-height:1.45}');
fs.writeFileSync("index.html", L.join("\r\n"));
console.log("ok");
