const fs=require("fs");
let L=fs.readFileSync("index.html","utf8").split(/\r?\n/);
function at(n,desde){ const i=L.findIndex((l,k)=>(desde==null||k>=desde)&&l.indexOf(n)>=0); if(i<0) throw new Error("no: "+n); return i; }

// ---------- que asiento hace falta, en lenguaje llano ----------
let i = at('function rojasAbiertas(){');
L.splice(i, 0,
'/* ---- Que asiento hay que registrar para cerrar un hallazgo ----',
'   Quien usa esto no tiene formacion contable: decir "hay una diferencia de B/ 149.73" no alcanza para',
'   saber que hacer. Cada diferencia roja lleva ahora el asiento concreto —que cuenta va al debito, cual al',
'   credito y por cuanto— explicado en una linea de por que.',
'   La regla de fondo es siempre la misma: Caja General es la cuenta puente. Cuando el dinero SALE de caja',
'   hacia el banco, el banco se DEBITA (le entra) y Caja General se ACREDITA (le sale).',
'   Devuelve null cuando el hallazgo no se arregla con un asiento (ej. un dato mal escrito en el Excel). */',
'function cuentaDeBanco(banco){',
'  if(banco === "Banistmo") return "[1.1.1.07] Banistmo";',
'  if(banco === "STG") return "[1.1.1.10] St. Georges Bank";',
'  if(banco === "Banco General") return "Banco General";',
'  return banco || "el banco";',
'}',
'function asientoDelHallazgo(item, pasoKey){',
'  if(!item || (item.clase && item.clase !== "diff")) return null;',
'  var monto = Math.abs(item.monto || 0);',
'  if(!(monto > 0.005)) return null;',
'  var banco = item.banco || "";',
'  var txt = String(item.texto || "");',
'  var CG = "[1.1.8] Caja General";',
'',
'  // Paso 1: el informe de cajeras y el diario de Caja General no dicen lo mismo ese dia.',
'  if(pasoKey === "paso1" && /Diferencia /.test(txt)){',
'    if((item.monto || 0) > 0){',
'      // La cajera reporto mas de lo que el diario registro como depositado: falta el asiento del deposito.',
'      return { porque: "La cajera reportó este dinero como depositado a " + banco + " y en Caja General no está registrado el depósito. Falta el asiento que lo saca de la caja y lo mete al banco.",',
'               debito: cuentaDeBanco(banco), credito: CG, monto: monto,',
'               concepto: "Depósito a " + banco + " del " + (item.fecha||"") + " reportado por la cajera",',
'               fecha: item.fecha || "" };',
'    }',
'    return { porque: "En Caja General hay más depósitos a " + banco + " de los que la cajera reportó ese día. Revisá primero el informe de caja: si al informe le falta la venta, se corrige ahí y no con un asiento. Si el que sobra es el asiento, hay que reversarlo.",',
'             debito: CG, credito: cuentaDeBanco(banco), monto: monto,',
'             concepto: "Reverso del depósito a " + banco + " del " + (item.fecha||"") + " que el informe de caja no respalda",',
'             fecha: item.fecha || "", revisarPrimero: true };',
'  }',
'',
'  // Paso 2: Caja General dice que se deposito y el banco no lo muestra.',
'  if(pasoKey === "paso2"){',
'    return { porque: "Caja General registra este depósito a " + banco + " y el estado de cuenta no lo muestra. Si el banco ya lo acreditó con otra fecha o partido en varias líneas, no hace falta asiento: revisá el estado. Si el depósito nunca se hizo, hay que reversar el asiento.",',
'             debito: CG, credito: cuentaDeBanco(banco), monto: monto,',
'             concepto: "Reverso del depósito a " + banco + " del " + (item.fecha||"") + " que el banco no acredita",',
'             fecha: item.fecha || "", revisarPrimero: true };',
'  }',
'',
'  // Paso 3: el banco muestra un movimiento que el diario no tiene.',
'  if(pasoKey === "paso3" && /no aparece registrado en el diario/.test(txt)){',
'    return { porque: "El banco acreditó este dinero y en el diario de " + banco + " no hay ningún asiento que lo registre. Es plata que entró y todavía no está en los libros.",',
'             debito: cuentaDeBanco(banco), credito: CG, monto: monto,',
'             concepto: "Depósito acreditado por " + banco + " el " + (item.fecha||"") + " sin registrar",',
'             fecha: item.fecha || "" };',
'  }',
'  return null;',
'}',
'function asientoHallazgoHtml(a){',
'  if(!a) return "";',
'  return \'<div class="fas">\' +',
'    \'<div class="fas-tit">\' + (a.revisarPrimero ? "Qué revisar y, si corresponde, qué registrar" : "Asiento que falta registrar") + \'</div>\' +',
'    \'<div class="fas-por">\' + esc(a.porque) + \'</div>\' +',
'    \'<div class="fas-fila"><span>Fecha</span><b>\' + esc(a.fecha) + \'</b></div>\' +',
'    \'<div class="fas-fila"><span>Débito</span><b>\' + esc(a.debito) + \' · B/ \' + fmt(a.monto) + \'</b></div>\' +',
'    \'<div class="fas-fila"><span>Crédito</span><b>\' + esc(a.credito) + \' · B/ \' + fmt(a.monto) + \'</b></div>\' +',
'    \'<div class="fas-fila"><span>Concepto</span><b>\' + esc(a.concepto) + \'</b></div>\' +',
'  \'</div>\';',
'}');

// ---------- render dentro del hallazgo ----------
i = at("      '<div class=\"ftxt\">'+esc(item.texto)+'<span class=\"src\">'+esc(item.fuente)+'</span></div>' +");
L[i] = "      '<div class=\"ftxt\">'+esc(item.texto)+'<span class=\"src\">'+esc(item.fuente)+'</span>' +\n" +
       "        asientoHallazgoHtml(asientoDelHallazgo(item, p.key)) + '</div>' +";

// ---------- CSS ----------
i = at('  .as-reg-nota{font-size:11.5px');
L.splice(i+1, 0,
'  .fas{margin-top:9px;background:#F7F4F9;border:1px solid #E2D9EA;border-radius:9px;padding:8px 10px}',
'  .fas-tit{font-size:11px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:#4A3C63;margin-bottom:5px}',
'  .fas-por{font-size:12px;color:var(--slate);line-height:1.45;margin-bottom:6px}',
'  .fas-fila{display:flex;gap:10px;font-size:12px;padding:1px 0;color:var(--slate)}',
'  .fas-fila span{min-width:58px;flex-shrink:0}',
'  .fas-fila b{color:var(--heading);font-weight:700}');
fs.writeFileSync("index.html", L.join("\r\n"));
console.log("ok");
