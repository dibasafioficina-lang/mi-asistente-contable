/* ---------------------------------------------------------------------------
   Pruebas de regresión — Mi Asistente Contable

   Congela los casos reales que se corrigieron a mano, para que un cambio futuro
   no vuelva a romperlos. Cada caso lleva el hallazgo que lo originó.

   Correr:   node tests.js
   Requiere: npm i xlsx   (y los archivos de datos, si se quieren las pruebas E2E)
--------------------------------------------------------------------------- */
const fs = require("fs");
const path = require("path");

/* --- carga del script de la app en un entorno mínimo de navegador --- */
const XLSX = require("xlsx");
global.XLSX = XLSX;
global.alert = () => {};
global.navigator = { clipboard: { writeText: () => Promise.resolve() } };
const LS = {};
global.localStorage = { getItem: k => (LS[k] === undefined ? null : LS[k]), setItem: (k, v) => { LS[k] = String(v); } };
const store = {};
function mkEl(id) {
  return { _html: "", id, set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
    set onclick(v) {}, get onclick() { return null; }, appendChild() {}, style: {},
    classList: { add() {}, remove() {} }, addEventListener() {}, querySelectorAll: () => [],
    textContent: "", value: "", getAttribute() { return null; } };
}
global.document = { getElementById: id => (store[id] = store[id] || mkEl(id)), querySelectorAll: () => [],
  createElement: () => mkEl(), body: { appendChild() {} } };
global.app = mkEl("app");
global.window = global;

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1].replace(/render\(\);\s*$/, "");
eval.call(global, script);

/* --- mini framework --- */
let ok = 0, fail = 0;
const fails = [];
function test(nombre, fn) {
  try { fn(); ok++; console.log("  \u2713 " + nombre); }
  catch (e) { fail++; fails.push(nombre + " → " + e.message); console.log("  \u2717 " + nombre + "\n      " + e.message); }
}
function eq(a, b, msg) {
  const A = typeof a === "number" ? Math.round(a * 100) / 100 : a;
  const B = typeof b === "number" ? Math.round(b * 100) / 100 : b;
  if (A !== B) throw new Error((msg ? msg + ": " : "") + "esperaba " + B + ", obtuvo " + A);
}
function cerca(a, b, msg, tol) {
  if (Math.abs(a - b) > (tol || 0.02)) throw new Error((msg ? msg + ": " : "") + "esperaba ~" + b + ", obtuvo " + a);
}
function grupo(n) { console.log("\n" + n); }

/* =========================================================================
   1. PARSEO DE MONTOS Y LÍNEAS
   ========================================================================= */
grupo("Parseo de montos y líneas de detalle");

// Hallazgo: money("20,00") devolvía 2000 — la coma decimal se tomaba como separador de miles.
test('money: coma decimal "20,00" = 20.00', () => eq(money("20,00"), 20));
test('money: coma decimal "1,00" = 1.00', () => eq(money("1,00"), 1));
test('money: coma de miles "1,234.56" se conserva', () => eq(money("1,234.56"), 1234.56));
test('money: "1,234" sigue siendo mil doscientos treinta y cuatro', () => eq(money("1,234"), 1234));
test('money: paréntesis = negativo', () => eq(money("(150.00)"), -150));
test('money: prefijo B/', () => eq(money("B/ 1,000.00"), 1000));

// Hallazgo: "YENIFER MUÑOZ :20.00" devolvía monto 0 (la regex exigía espacio antes del número).
test('partirLineaRet: ":" pegado al monto', () => eq(partirLineaRet("YENIFER MUÑOZ :20.00").monto, 20));
test('partirLineaRet: ":" con espacio', () => eq(partirLineaRet("ANA FUENTES: 10.00").monto, 10));
test('partirLineaRet: el ":" no queda en el nombre', () => eq(partirLineaRet("ANA FUENTES: 10.00").texto, "ANA FUENTES"));
test('partirLineaRet: monto en el medio + acreedor al final', () => {
  const p = partirLineaRet("AMABELIS ATENCIO 7.00 CASA FUNERALES VIDA PANAMA");
  eq(p.monto, 7); eq(p.texto, "AMABELIS ATENCIO");
});
// Hallazgo: el guion es digitación, NO un negativo; el signo lo da la columna Débito/Crédito.
test("partirLineaRet: el guion no es signo negativo", () => eq(partirLineaRet("Esther Villarreal -12.50").monto, 12.5));

/* =========================================================================
   2. NOMBRES DE EMPLEADO
   ========================================================================= */
grupo("Nombres de empleado");

test("empleadoRet: limpia puntuación de borde", () => eq(empleadoRet("ARACELYS GAITAN: 85.67"), "ARACELYS GAITAN"));
test("empleadoRet: quita el concepto líder", () => eq(empleadoRet("DESC DE SON IMPORT AMABELIS: 10.00"), "AMABELIS"));
// Regla de negocio confirmada por Diba: es la misma persona (nombre compuesto).
test("alias: Omaira Villarreal = Esther Villarreal", () => eq(empleadoRet("OMAIRA VILLARREAL 12.50"), "ESTHER VILLARREAL"));
test("typos de 1 letra se fusionan solos", () => eq(mismoNombreRet("HAYLEEN FUENTES", "HAYLLEEN FUENTES"), true));
test("nombres de pila distintos NO se fusionan solos", () => eq(mismoNombreRet("ESTHER VILLARREAL", "OMAIRA VILLARREAL"), false));

/* =========================================================================
   3. CLASIFICACIÓN POR DESTINO
   ========================================================================= */
grupo("Clasificación por destino");

// Regla de negocio: la razón social cambió pero es el mismo acreedor.
["Refresquería", "Shopping Market", "Shopping Refresquería", "Maryan Safi", "Mayi"].forEach(n =>
  test('destinoRet("' + n + '") = Refresquería', () => eq(destinoRet(n), "Refresquería")));
test("destinoRet: St. Georges es banco", () => eq(destinoRet("ST. GEORGES BANK"), "Banco / Préstamo"));
test("destinoRet: ahorro navideño es cooperativa", () => eq(destinoRet("AHORRO NAVIDEÑO ECASESO"), "Cooperativa / Ahorro"));

/* =========================================================================
   4. FORMATO DE CIFRAS Y ESCAPE
   ========================================================================= */
grupo("Formato y seguridad");

test("fmt: separador de miles", () => eq(fmt(1000), "1,000.00"));
test("fmt: millones", () => eq(fmt(1234567.891), "1,234,567.89"));
test("fmt: negativo", () => eq(fmt(-153.2), "-153.20"));
test("fmt: cero", () => eq(fmt(0), "0.00"));
// Hallazgo: el acreedor del Excel se inyectaba como HTML vivo.
test("esc: neutraliza etiquetas HTML", () => eq(esc('<svg onload=alert(1)>'), "&lt;svg onload=alert(1)&gt;"));
test("esc: comillas", () => eq(esc('a"b'), "a&quot;b"));

/* =========================================================================
   5. NETEO — casos sintéticos
   ========================================================================= */
grupo("Neteo (casos sintéticos)");

function mov(o) {
  return Object.assign({ fecha: "2026-01-01", ref: "", fuente: "MAN-ENTRY", desc: "", acr: "", deb: 0, cred: 0, subs: [] }, o);
}

test("invariante: pendiente = descontado + saldo inicial − pagado", () => {
  const movs = [
    mov({ fecha: "2026-01-11", ref: "ME-1", desc: "DESCUENTO DE BANCO", cred: 100, subs: ["JUAN PEREZ 60.00", "MARIA LOPEZ 40.00"] }),
    mov({ fecha: "2026-02-05", ref: "PAY-1", fuente: "AP-PAY", desc: "BANCO NACIONAL - Pago: PAY-1 - PAGO JUAN PEREZ", acr: "BANCO NACIONAL", deb: 60 })
  ];
  const net = netearRetenciones(movs, [{ fecha: "", concepto: "Banco", monto: 25 }]);
  const d = net.porDestino["Banco / Préstamo"];
  cerca(d.desc + d.saldoIni - d.pago, 65, "pendiente del destino");
  const det = net.detalle["Banco / Préstamo"];
  const pend = det.pendientes.reduce((a, b) => a + b.monto, 0);
  const sin = det.pagosSinDesc.reduce((a, b) => a + b.monto, 0);
  cerca(pend - sin, 65, "detalle vs cabecera");
});

test("transacciones anuladas (ABORTED) se excluyen junto con su contrapartida", () => {
  const rows = [
    ["Balance Inicial (2026-01-01):", "B/ 0.00"],
    ["Account", "Fecha", "Referencia", "Ref. Sec", "Fuente", "Descripción", "Guardado Por", "Centro de Costos", "", "", "", "Acreedor", "", "Débito", "Crédito"],
    ["[2.3.1.4] X", "2026-01-10", "PAY-9", 1, "AP-PAY", "PROVEEDOR - Pago: PAY-9 - ALGO", "", "", "", "", "", "", "", "B/ 0.00", "B/ 50.00"],
    ["[2.3.1.4] X", "2026-01-10", "PAY-9", 1, "AP-PAY", "ABORTED PROVEEDOR - Pago: PAY-9 - ALGO", "", "", "", "", "", "", "", "B/ 50.00", "B/ 0.00"]
  ];
  const p = parseRetenciones(rows);
  eq(p.movs.length, 0, "movimientos vivos");
  eq(p.anuladas.n, 2, "filas anuladas contadas");
  cerca(p.anuladas.cred, 50, "crédito anulado");
});

test("saldo inicial del Paso 0 se netea como apertura", () => {
  const movs = [mov({ fecha: "2026-02-05", ref: "PAY-1", fuente: "AP-PAY", desc: "SON IMPORT - Pago", acr: "SON IMPORT,S.A.", deb: 30 })];
  const net = netearRetenciones(movs, [{ fecha: "", concepto: "Son Import", monto: 100 }]);
  const d = net.porDestino["Son Import"];
  cerca(d.saldoIni, 100, "apertura registrada");
  cerca(d.desc + d.saldoIni - d.pago, 70, "queda debiendo 70");
});

test("cuadre: detecta una fila perdida", () => {
  const parsed = { saldoInicial: 0, movs: [mov({ cred: 100 })], anuladas: { n: 0, deb: 0, cred: 0 },
    declarado: { debitos: 0, creditos: 150, balanceFinal: 150 } };
  const net = netearRetenciones(parsed.movs, []);
  const c = cuadreRetenciones(parsed, net);
  eq(c.ok, false, "debe fallar");
});

test("cuadre: detecta comprobantes duplicados", () => {
  const m1 = mov({ ref: "PAY-1", fuente: "AP-PAY", desc: "X - Pago", acr: "SON IMPORT,S.A.", deb: 50 });
  const parsed = { saldoInicial: 0, movs: [m1, Object.assign({}, m1)], anuladas: { n: 0, deb: 0, cred: 0 }, declarado: {} };
  const c = cuadreRetenciones(parsed, netearRetenciones(parsed.movs, []));
  eq(c.duplicados.length, 1, "duplicados detectados");
  eq(c.ok, false, "no debe cuadrar");
});

test("archivo sin movimientos no rompe", () => {
  const net = netearRetenciones([], []);
  eq(Object.keys(net.porDestino).length, 0);
});

/* =========================================================================
   5b. MÓDULO 1 — efectivo del día consolidado por el banco
   ========================================================================= */
grupo("Módulo 1 — conciliación banco vs diario");

test("esDepositoEfectivo distingue efectivo de tarjeta/ACH", () => {
  eq(esDepositoEfectivo("DEPOSITO BRINKS DEL 09/6/2026"), true);
  eq(esDepositoEfectivo("DEPOSITO DEL 09/6/2026"), true);
  eq(esDepositoEfectivo("DEPOSITO POR TARJETA CLAVE STG DEL 09/6/2026"), false);
  eq(esDepositoEfectivo("DEPOSITO POR TARJETA VISA STG DEL 09/06/2026"), false);
  eq(esDepositoEfectivo("DEPOSITO ACH"), false);
  eq(esDepositoEfectivo("AJUSTE DE RETENCION MAYO 0.20"), false);
});

// Hallazgo: el banco acreditó 398.35 el 12-jun por el Brinks (395.00) + la ventanilla (3.35) del 09-jun,
// que el diario registra separados. El emparejamiento por monto los cruzaba y dejaba el 3.35 huérfano.
test("Brinks + ventanilla del mismo día se emparejan con un solo crédito consolidado", () => {
  const diario = [
    { fecha: "2026-06-09", debito: 395.00, credito: 0, descripcion: "DEPOSITO BRINKS DEL 09/6/2026", fila: 1 },
    { fecha: "2026-06-09", debito: 3.35,   credito: 0, descripcion: "DEPOSITO DEL 09/6/2026",        fila: 2 }
  ];
  const estado = [{ fecha: "2026-06-12", debito: 0, credito: 398.35, descripcion: "Descripción", fila: 138 }];
  const c = conciliarBancoEstado(diario, estado, 3, 0.01, null);
  eq(c.faltanEnBanco.length, 0, "partidas del diario sin emparejar");
  eq(c.faltanEnDiario.length, 0, "créditos del estado sin emparejar");
});

test("si el banco los acredita por separado, también cuadra", () => {
  const diario = [
    { fecha: "2026-06-08", debito: 400.00, credito: 0, descripcion: "DEPOSITO BRINKS DEL 08/6/2026", fila: 1 },
    { fecha: "2026-06-08", debito: 1.30,   credito: 0, descripcion: "DEPOSITO DEL 08/6/2026",        fila: 2 }
  ];
  const estado = [
    { fecha: "2026-06-10", debito: 0, credito: 400.00, descripcion: "Ach De Brink S Panama S.A.", fila: 10 },
    { fecha: "2026-06-10", debito: 0, credito: 1.30,   descripcion: "Descripción",                fila: 11 }
  ];
  const c = conciliarBancoEstado(diario, estado, 3, 0.01, null);
  eq(c.faltanEnBanco.length, 0, "partidas del diario sin emparejar");
  eq(c.faltanEnDiario.length, 0, "créditos del estado sin emparejar");
});

test("no consolida efectivo con depósitos de tarjeta del mismo día", () => {
  const diario = [
    { fecha: "2026-06-09", debito: 395.00, credito: 0, descripcion: "DEPOSITO BRINKS DEL 09/6/2026", fila: 1 },
    { fecha: "2026-06-09", debito: 3.35,   credito: 0, descripcion: "DEPOSITO DEL 09/6/2026",        fila: 2 },
    { fecha: "2026-06-09", debito: 153.25, credito: 0, descripcion: "DEPOSITO POR TARJETA CLAVE STG DEL 09/6/2026", fila: 3 }
  ];
  // Solo hay crédito por el efectivo: la tarjeta debe quedar como pendiente, no arrastrada en la suma.
  const estado = [{ fecha: "2026-06-12", debito: 0, credito: 398.35, descripcion: "Descripción", fila: 138 }];
  const c = conciliarBancoEstado(diario, estado, 3, 0.01, null);
  eq(c.faltanEnBanco.length, 1, "queda solo la tarjeta");
  cerca(c.faltanEnBanco[0].monto, 153.25, "monto de la tarjeta");
});

/* =========================================================================
   6. E2E con el archivo real (se saltan si el archivo no está)
   ========================================================================= */
grupo("Extremo a extremo (archivo real)");

const ARCHIVO = "C:/Users/50762/Desktop/ARCHIVOS EMPRESA FAMILIAR/CONTAB/MI ASISTENTE CONTABLE/Petty Junio 2026/retenciones a empleados por pagar enero a junio 2026 petty.xlsx";
const PASO0 = [
  { fecha: "", concepto: "Son Import", monto: 120 },
  { fecha: "", concepto: "Refresquería", monto: 87.71 },
  { fecha: "", concepto: "Banco - Yennifer", monto: 63.27 }
];

if (!fs.existsSync(ARCHIVO)) {
  console.log("  – omitidas: no se encontró el archivo de datos");
} else {
  const wb = XLSX.read(fs.readFileSync(ARCHIVO), { type: "buffer", cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
  rows.hojas = {};
  wb.SheetNames.forEach(n => { rows.hojas[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }); });
  const parsed = parseRetenciones(rows);
  const net = netearRetenciones(parsed.movs, PASO0);

  test("cuadra contra el Balance Final que declara el archivo", () => {
    const c = cuadreRetenciones(parsed, net);
    const malos = c.controles.filter(x => !x.ok).map(x => x.nombre).join("; ");
    eq(malos, "", "controles que fallan");
    eq(c.duplicados.length, 0, "duplicados");
  });

  test("totales del período", () => {
    cerca(net.totalDesc, 6834.86, "descontado");
    cerca(net.totalPago, 6020.29, "pagado");
    cerca(net.totalDesc - net.totalPago + net.totalSaldoIni, 1085.55, "pendiente total");
  });

  test("invariante por destino (pendientes − pagos sin descuento = desc + ini − pagado)", () => {
    Object.keys(net.porDestino).forEach(d => {
      const x = net.porDestino[d], det = net.detalle[d];
      const pend = det.pendientes.reduce((a, b) => a + b.monto, 0);
      const sin = det.pagosSinDesc.reduce((a, b) => a + b.monto, 0);
      cerca(pend - sin, x.desc + (x.saldoIni || 0) - x.pago, d);
    });
  });

  // Hallazgo: la Ñ rota ("MU?OZ") impedía imputar PAY0004115 y PAY0004244 a Yenifer.
  test("Yenifer: todos sus pagos de banco se le imputan (ninguno queda sin identificar)", () => {
    const L = libroMayorRet(net, "YENIFER MUNOZ", "Banco / Préstamo");
    if (!L.filas.some(f => /PAY0004115/.test(f.ref || ""))) throw new Error("falta PAY0004115");
    if (!L.filas.some(f => /PAY0004244/.test(f.ref || ""))) throw new Error("falta PAY0004244");
    cerca(L.totalPago, 885.78, "pagos imputados a Yenifer");
    // 15 obligaciones (apertura del Paso 0 + 14 quincenas) contra 14 pagadas → queda una quincena.
    cerca(L.totalRet, 949.05, "retenido + apertura");
    cerca(L.saldo, 63.27, "queda pendiente una quincena");
  });
  test("ningún pago de banco queda sin identificar el empleado", () => {
    const sinId = (net.pag["Banco / Préstamo"] || []).filter(p => p.sub === "(sin identificar)");
    eq(sinId.length, 0, "pagos sin empleado identificado");
  });

  // Hallazgo: el typo "ESTHER VILLAREAL" (una R) dejaba PAY0004405 fuera del libro.
  test("Esther: el pago con typo en el nombre igual se le imputa", () => {
    const L = libroMayorRet(net, "ESTHER VILLARREAL", "Banco / Préstamo");
    if (!L.filas.some(f => /PAY0004405/.test(f.ref || ""))) throw new Error("falta PAY0004405");
  });

  // Hallazgo: la 1ra quincena de marzo quedó sin pagar mientras se pagaron quincenas posteriores.
  test("Itza: se detecta la retención saltada ME-00000001897", () => {
    const s = (net.saltadas || []).find(x => /1897/.test(x.ref || ""));
    if (!s) throw new Error("no se detectó la saltada");
    cerca(s.monto, 94.13, "monto");
  });

  // Hallazgo: ':' pegado al monto + concepto y empleado en la misma línea.
  test("ME-00000001970 se desglosa por empleado (no queda '(sin detalle)')", () => {
    const lineas = (net.ded["Son Import"] || []).filter(x => /1970/.test(x.ref || ""));
    if (lineas.length < 5) throw new Error("solo " + lineas.length + " líneas");
    if (lineas.some(x => x.emp === "(sin detalle)")) throw new Error("quedó sin detalle");
    cerca(lineas.reduce((a, b) => a + b.monto, 0), 80, "suma del comprobante");
  });

  test("libro por acreedor coincide con el resumen por destino", () => {
    [["Son Import", "Son Import"], ["Refresquería", "Refresquería"],
     ["COOPERATIVA", "Cooperativa / Ahorro"], ["CASA DE FUNERALES", "Casa de Funerales"]].forEach(([q, d]) => {
      const L = libroMayorRet(net, q), x = net.porDestino[d];
      cerca(L.saldo, x.desc + (x.saldoIni || 0) - x.pago, q);
    });
  });

  test("libro por persona coincide con el detalle de pendientes (Banco)", () => {
    const g = {};
    net.detalle["Banco / Préstamo"].pendientes.forEach(p => { (g[p.sub || "?"] = g[p.sub || "?"] || []).push(p); });
    Object.keys(g).forEach(emp => {
      const L = libroMayorRet(net, emp, "Banco / Préstamo");
      cerca(L.saldo, g[emp].reduce((a, b) => a + b.monto, 0), emp);
    });
  });

  test("cada pago global se reparte y la suma de lo aplicado da el monto del pago", () => {
    (net.aplicaciones || []).forEach(a => {
      cerca(a.lotes.reduce((s, l) => s + l.monto, 0), a.monto, a.ref);
    });
  });

  test("los comprobantes sin detalle se detectan y traen sugerencia cuando existe patrón", () => {
    if (!net.sinDetalle.length) throw new Error("con este archivo debería haber comprobantes sin detalle");
    if (net.sinDetalle.some(s => /1970/.test(s.ref))) throw new Error("ME-1970 ya no debería estar");
  });
}

/* --- resumen --- */
console.log("\n" + "=".repeat(52));
console.log("  " + ok + " pasaron, " + fail + " fallaron");
if (fail) { console.log("\nFallos:"); fails.forEach(f => console.log("  - " + f)); }
console.log("=".repeat(52));
process.exit(fail ? 1 : 0);
