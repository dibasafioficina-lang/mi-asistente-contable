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

// Regla de negocio: el banco SIEMPRE compensa la VISA por el neto (bruto − retención del día).
test("VISA: se empareja por el neto, no por el bruto", () => {
  const diario = [{ fecha: "2026-06-08", debito: 503.17, credito: 0, descripcion: "DEPOSITO POR TARJETA VISA STG DEL 08/6/2026", fila: 1 }];
  const estado = [{ fecha: "2026-06-08", debito: 0, credito: 478.60, descripcion: "Remisión V/Mc 016005605", fila: 10 }];
  const c = conciliarBancoEstado(diario, estado, 3, 0.01, { "2026-06-08": 24.57 });
  eq(c.faltanEnBanco.length, 0, "VISA sin emparejar");
  eq(c.faltanEnDiario.length, 0, "remisión sin emparejar");
});

test("VISA: con la retención conocida NO se empareja por el bruto", () => {
  // Un crédito que coincide con el BRUTO no debe capturar la línea VISA: su compensación es el neto.
  const diario = [{ fecha: "2026-06-08", debito: 503.17, credito: 0, descripcion: "DEPOSITO POR TARJETA VISA STG DEL 08/6/2026", fila: 1 }];
  const estado = [{ fecha: "2026-06-08", debito: 0, credito: 503.17, descripcion: "Otro deposito cualquiera", fila: 10 }];
  const c = conciliarBancoEstado(diario, estado, 3, 0.01, { "2026-06-08": 24.57 });
  eq(c.faltanEnBanco.length, 1, "la VISA queda pendiente (su neto no llegó)");
  eq(c.faltanEnDiario.length, 1, "el otro crédito queda sin par");
});

// Hallazgo: el navegador registró 1,127.27 como "DEPOSITO POR TARJETA VISA BANISTMO", pero el informe de
// caja de ese día lo desglosa en VISA 733.55 + CLAVE 393.72, que es como el banco los acredita.
// El informe es la fuente de referencia cuando el detalle del navegador viene incompleto.
const REPORTE_02ENE = [
  { fecha: "2026-01-02", cajera: "ANA", banco: "Banistmo", metodo: "VISA",  monto: 733.55, fila: 7 },
  { fecha: "2026-01-02", cajera: "ANA", banco: "Banistmo", metodo: "CLAVE", monto: 393.72, fila: 7 }
];
const DIARIO_02ENE = [{ fecha: "2026-01-02", debito: 0, credito: 1127.27,
  descripcion: "DEPOSITO POR TARJETA VISA BANISTMO DEL 02/01/2026", referencia: "ME-00000001827", fila: 6 }];

test("desgloseDelInforme encuentra las partidas del día", () => {
  const d = desgloseDelInforme(REPORTE_02ENE, "2026-01-02", "Banistmo", 1127.27, 0.01);
  if (!d) throw new Error("no encontró el desglose");
  eq(d.length, 2);
  cerca(d.reduce((a, p) => a + p.monto, 0), 1127.27, "suma de las partidas");
});

test("desgloseDelInforme no inventa: si no suma el monto, devuelve null", () => {
  eq(desgloseDelInforme(REPORTE_02ENE, "2026-01-02", "Banistmo", 999.99, 0.01), null);
  eq(desgloseDelInforme(REPORTE_02ENE, "2026-01-03", "Banistmo", 1127.27, 0.01), null);
});

// "No importa si el comprobante no define si es visa o clave: si cuadra la tarjeta, concílialo."
test("el desglose ignora el método: toma el subconjunto que cuadra", () => {
  const rep = REPORTE_02ENE.concat([
    { fecha: "2026-01-02", cajera: "ANA", banco: "Banistmo", metodo: "EFECTIVO", monto: 500.00, fila: 8 }
  ]);
  // El asiento consolida solo las dos tarjetas; el efectivo del día va por otro lado.
  const d = desgloseDelInforme(rep, "2026-01-02", "Banistmo", 1127.27, 0.01);
  if (!d) throw new Error("debería encontrar el subconjunto VISA+CLAVE");
  eq(d.length, 2);
  cerca(d.reduce((a, p) => a + p.monto, 0), 1127.27);
});

test("consolidado del navegador que el banco acredita separado: coteja, no es hallazgo", () => {
  const estado = [
    { fecha: "2026-01-02", debito: 0, credito: 733.55, descripcion: "DEPOSITO", fila: 2 },
    { fecha: "2026-01-05", debito: 0, credito: 393.72, descripcion: "DEPOSITO", fila: 3 }
  ];
  const h = paso2(DIARIO_02ENE, estado, [], null, null, null, 3, 0.01, REPORTE_02ENE);
  eq(h.filter(x => Math.abs(x.monto - 1127.27) < 0.01).length, 0, "no debe reportarse");
});

test("si falta una partida en el banco, sí se reporta y se explica el desglose", () => {
  const estado = [{ fecha: "2026-01-02", debito: 0, credito: 733.55, descripcion: "DEPOSITO", fila: 2 }];
  const h = paso2(DIARIO_02ENE, estado, [], null, null, null, 3, 0.01, REPORTE_02ENE);
  const c = h.filter(x => Math.abs(x.monto - 1127.27) < 0.01);
  eq(c.length, 1, "debe reportarse");
  if (!/VISA B\/ 733\.55 \+ CLAVE B\/ 393\.72/.test(c[0].texto))
    throw new Error("el hallazgo debe explicar el desglose del informe");
});

// Hallazgo: algunos meses el diario registra la VISA de TODO el mes en un asiento del último día
// ("DEL 1 AL 31 DE ENERO") mientras el banco la acreditó en remisiones diarias. El monto del diario es el
// bruto del período; el banco pagó el neto repartido. Sin esto aparecía como "en tránsito" B/ 5,823.79.
test("depósito acumulado del mes se coteja contra las remisiones diarias (neto)", () => {
  const diario = [{ fecha: "2026-01-31", debito: 0, credito: 5823.79,
    descripcion: "DEPOSITOS POR TARJETA VISA STG DEL 1 AL 31 DE ENERO 2026.", referencia: "ME-9", fila: 1 }];
  // El banco lo pagó en 3 remisiones que suman el neto (bruto 5823.79 − retenciones 280.62).
  const estado = [
    { fecha: "2026-01-10", debito: 0, credito: 2000.00, descripcion: "Remisión V/Mc", fila: 2 },
    { fecha: "2026-01-20", debito: 0, credito: 2000.00, descripcion: "Remisión V/Mc", fila: 3 },
    { fecha: "2026-01-30", debito: 0, credito: 1543.17, descripcion: "Remisión V/Mc", fila: 4 }
  ];
  const ret = { "2026-01-10": 100.00, "2026-01-20": 100.00, "2026-01-30": 80.62 };
  const h = paso2(diario, [], estado, null, ret, null, 3, 0.01, null);
  eq(h.filter(x => Math.abs(x.monto - 5823.79) < 0.01).length, 0, "no debe quedar en tránsito");
});

test("rangoDeposito reconoce el rango del mes", () => {
  const r = rangoDeposito("DEPOSITOS POR TARJETA VISA STG DEL 1 AL 31 DE ENERO 2026.");
  if (!r) throw new Error("no reconoció el rango");
  eq(r.ym, "2026-01"); eq(r.diaIni, 1); eq(r.diaFin, 31);
  eq(rangoDeposito("DEPOSITO POR TARJETA VISA STG DEL 09/6/2026"), null, "un solo día no es rango");
});

// Hallazgo: "BANISTMO ENERO 2026.xlsx" se llama enero, su encabezado dice "ESTADO DE CUENTA PETTY ENERO",
// pero sus 14 filas son del 17 al 24 de julio. Produjo 28 hallazgos falsos por B/ 15,137.79.
function movsDe(ym, n) {
  const a = [];
  for (let i = 1; i <= n; i++) a.push({ fecha: ym + "-" + String(i).padStart(2, "0"), debito: 0, credito: 10, descripcion: "X", fila: i });
  return a;
}

test("detecta un archivo de otro período", () => {
  const v = validarPeriodos([
    { nombre: "Diario Caja General", archivo: "caja.xlsx", datos: movsDe("2026-01", 20) },
    { nombre: "Informe de caja", archivo: "informe.xlsx", datos: movsDe("2026-01", 15) },
    { nombre: "Estado Banistmo", archivo: "BANISTMO ENERO 2026.xlsx", datos: movsDe("2026-07", 14) }
  ]);
  eq(v.mesTrabajo, "2026-01");
  eq(v.alertas.length, 1, "debe alertar");
  eq(v.alertas[0].clase, "ajeno", "sin registros del mes de trabajo");
});

// El mes se decide por mayoría, no tomando un archivo como referencia: el equivocado podría ser ese.
test("el mes de trabajo se decide por mayoría, aunque el diario sea el equivocado", () => {
  const v = validarPeriodos([
    { nombre: "Diario Caja General", archivo: "caja.xlsx", datos: movsDe("2026-07", 5) },
    { nombre: "Estado STG", archivo: "stg.xlsx", datos: movsDe("2026-01", 20) },
    { nombre: "Informe de caja", archivo: "informe.xlsx", datos: movsDe("2026-01", 15) },
    { nombre: "Estado Banistmo", archivo: "bani.xlsx", datos: movsDe("2026-01", 10) }
  ]);
  eq(v.mesTrabajo, "2026-01", "manda la mayoría");
  eq(v.alertas.length, 1);
  eq(v.alertas[0].nombre, "Diario Caja General", "el señalado es el que se desvía");
});

test("avisa cuando el nombre del archivo dice un mes y los registros dicen otro", () => {
  const v = validarPeriodos([
    { nombre: "Diario", archivo: "d.xlsx", datos: movsDe("2026-01", 10) },
    { nombre: "Estado STG", archivo: "STG JULIO 2026.xlsx", datos: movsDe("2026-01", 10) }
  ]);
  eq(v.alertas.length, 1);
  eq(v.alertas[0].clase, "nombre", "el período está bien, el nombre engaña");
  eq(v.alertas[0].nombreEnganoso, true);
});

test("una sola alerta por archivo aunque tenga varias razones", () => {
  const v = validarPeriodos([
    { nombre: "Diario", archivo: "d.xlsx", datos: movsDe("2026-01", 20) },
    { nombre: "Informe", archivo: "i.xlsx", datos: movsDe("2026-01", 15) },
    { nombre: "Estado Banistmo", archivo: "BANISTMO ENERO 2026.xlsx", datos: movsDe("2026-07", 14) }
  ]);
  eq(v.alertas.length, 1, "no debe duplicarse");
  eq(v.alertas[0].clase, "ajeno");
  eq(v.alertas[0].nombreEnganoso, true, "y además señala el nombre engañoso");
});

test("detecta un archivo que mezcla dos meses", () => {
  const v = validarPeriodos([
    { nombre: "Diario", archivo: "d.xlsx", datos: movsDe("2026-01", 20) },
    { nombre: "Estado STG", archivo: "stg.xlsx", datos: movsDe("2026-01", 10).concat(movsDe("2026-02", 3)) }
  ]);
  eq(v.alertas.length, 1);
  eq(v.alertas[0].clase, "mezclado");
});

test("no alerta cuando todos los archivos son del mismo mes", () => {
  const v = validarPeriodos([
    { nombre: "A", archivo: "a.xlsx", datos: movsDe("2026-01", 10) },
    { nombre: "B", archivo: "b.xlsx", datos: movsDe("2026-01", 8) }
  ]);
  eq(v.alertas.length, 0, "no debe alertar");
});

test("mesDominanteDeRegistros y mesEnNombre", () => {
  eq(mesDominanteDeRegistros(movsDe("2026-01", 10).concat(movsDe("2026-02", 3))), "2026-01");
  eq(mesEnNombre("BANISTMO ENERO 2026.xlsx"), "01");
  eq(mesEnNombre("estado de cta stg petty.xlsx"), null);
});

// Regresión: mesDominante(fechas) opera sobre strings y la usan ultimoDiaMes/primerDiaMes. Al agregar la
// validación de períodos se definió otra mesDominante(registros) que la pisaba, y ultimoDiaMes empezó a
// devolver null → los depósitos del último día dejaron de marcarse "en tránsito" y salían como diferencia.
test("ultimoDiaMes / primerDiaMes siguen funcionando (no los pisa otra función)", () => {
  const fechas = ["2026-01-02", "2026-01-15", "2026-01-31"];
  eq(ultimoDiaMes(fechas), "2026-01-31");
  eq(primerDiaMes(fechas), "2026-01-01");
  eq(mesDominante(fechas), "2026-01", "opera sobre strings de fecha");
});

// Hallazgo: el depósito del 08-ene compensó en el banco el 12-ene (4 días), fuera de la ventana de 3.
test("el desglose del informe tolera el rezago del banco", () => {
  const diario = [{ fecha: "2026-01-08", debito: 0, credito: 471.52,
    descripcion: "DEPOSITO POR TARJETA VISA BANISTMO DEL 08/01/2026", referencia: "ME-00000001832", fila: 1 }];
  const reporte = [
    { fecha: "2026-01-08", cajera: "ANA", banco: "Banistmo", metodo: "VISA",  monto: 241.58, fila: 2 },
    { fecha: "2026-01-08", cajera: "ANA", banco: "Banistmo", metodo: "CLAVE", monto: 229.94, fila: 2 }
  ];
  const estado = [
    { fecha: "2026-01-12", debito: 0, credito: 241.58, descripcion: "CR REMISION - V/MC", fila: 3 },
    { fecha: "2026-01-12", debito: 0, credito: 229.94, descripcion: "CR REMISION - CLAVE", fila: 4 }
  ];
  const h = paso2(diario, estado, [], null, null, null, 3, 0.01, reporte);
  eq(h.filter(x => Math.abs(x.monto - 471.52) < 0.01).length, 0, "debe conciliar pese al rezago");
});

test("periodoDe y seSolapan", () => {
  const p = periodoDe([{ fecha: "2026-01-31" }, { fecha: "2026-01-02" }, { fecha: null }]);
  eq(p.desde, "2026-01-02"); eq(p.hasta, "2026-01-31");
  eq(seSolapan({ desde: "2026-01-01", hasta: "2026-01-31" }, { desde: "2026-01-15", hasta: "2026-02-15" }), true);
  eq(seSolapan({ desde: "2026-01-01", hasta: "2026-01-31" }, { desde: "2026-07-01", hasta: "2026-07-31" }), false);
  eq(periodoDe([]), null);
});

// Bug introducido al formatear las cifras: un <input type="number"> con value="2,517.82" se ve VACÍO.
test("numInput: valores de input sin separador de miles", () => {
  eq(numInput(2517.82), "2517.82");
  eq(numInput(-15), "-15");
  eq(numInput(0), "0");
  eq(numInput(null), "0");
  if (/,/.test(numInput(1234567.89))) throw new Error("numInput no debe llevar coma de miles");
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

/* ---- Partidas en tránsito del mes anterior (Paso 0) que compensan este mes ----
   La VISA del 31-dic quedó registrada en el diario de diciembre (ME-00000001826) y el banco la acreditó
   el 02-ene. La línea del estado NO tiene asiento de enero porque el asiento es de diciembre: si el Paso 3
   no la aparta, sale como "no aparece registrado en el diario contable" — una diferencia falsa. */
const P0_VISA = [
  { fecha: "2025-12-31", banco: "Banistmo", monto: 1341.20, concepto: "visa en transito",  comprobante: "ME-00000001826", sentido: "credito" },
  { fecha: "2025-12-31", banco: "Banistmo", monto: 1285.05, concepto: "clave en transito", comprobante: "ME-00000001826", sentido: "credito" }
];
const EST_VISA = () => [
  { fecha: "2026-01-02", debito: 0, credito: 1341.20, descripcion: "CR REMISION - V/MC PAGO DE FACTURACION//01866314", fila: 5 },
  { fecha: "2026-01-02", debito: 0, credito: 1285.05, descripcion: "CR REMISION - CLAVE PAGO DE FACTURACION//01866314", fila: 9 }
];

test("la VISA en tránsito del mes anterior compensa contra la Remisión V/Mc", () => {
  const r = consumirTransitoPrevio(P0_VISA, { Banistmo: EST_VISA() }, 0.01);
  eq(r.pendientes.length, 0, "ambas deben compensar");
  eq(r.compensadas.length, 2);
  eq(r.fechasRaras.length, 0, "fechas correctas: sin aviso");
});

test("el Paso 3 no reporta como diferencia lo que compensó del mes anterior", () => {
  const h = paso3([], [], EST_VISA(), [], null, null, 3, 0.01, null, P0_VISA);
  eq(h.filter(x => (x.clase || "diff") === "diff").length, 0, "el 1,341.20 y el 1,285.05 ya tienen asiento en diciembre");
});

test("sin el Paso 0, las remisiones del arranque quedan a confirmar, no como rojas", () => {
  // Antes salian como diferencia. Pero una remision de tarjeta en los primeros dias habiles del mes es
  // casi siempre la compensacion de ventas del mes anterior (su asiento vive en el diario del mes
  // pasado): se clasifica "a confirmar" con la indicacion de cargar el Paso 0, que es quien la valida.
  const h = paso3([], [], EST_VISA(), [], null, null, 3, 0.01, null, null);
  eq(h.filter(x => (x.clase || "diff") === "diff").length, 0, "no son rojas");
  const conf = h.filter(x => /mes anterior/i.test(x.motivo || ""));
  eq(conf.length, 2, "quedan a confirmar como compensacion del mes anterior");
});

// El resumen del Paso 0 traía "31/12/2026" por "31/12/2025": el matching es hacia adelante, así que una
// fecha futura hace que la partida nunca compense. Se concilia igual y se levanta un aviso (no una diferencia).
test("una fecha imposible en el Paso 0 concilia igual y levanta aviso", () => {
  const malFechado = P0_VISA.map(p => ({ ...p, fecha: "2026-12-31" }));
  const r = consumirTransitoPrevio(malFechado, { Banistmo: EST_VISA() }, 0.01);
  eq(r.pendientes.length, 0, "debe conciliar pese al año mal tecleado");
  eq(r.fechasRaras.length, 2, "y avisar de las dos");
  const h = paso0(malFechado, EST_VISA(), [], null, 3, 0.01);
  eq(h.filter(x => x.clase === "aviso").length, 2);
  eq(h.filter(x => !esNoRojo(x)).length, 0, "un aviso no es una diferencia roja");
});

test("una partida del Paso 0 no puede consumir dos líneas del estado", () => {
  // 315.00 aparece dos veces en el estado y solo una vez en tránsito: solo una línea queda consumida.
  const est = [
    { fecha: "2026-01-05", debito: 0, credito: 315.00, descripcion: "DEPOSITO", fila: 36 },
    { fecha: "2026-01-06", debito: 0, credito: 315.00, descripcion: "DEPOSITO", fila: 40 }
  ];
  consumirTransitoPrevio([{ fecha: "2025-12-31", banco: "Banistmo", monto: 315.00, concepto: "cheque en transito", comprobante: "", sentido: "credito" }],
    { Banistmo: est }, 0.01);
  eq(est.filter(x => x._transitoUsado).length, 1, "solo una línea del estado se marca como usada");
});

/* ---- El asiento que acumula toda la tarjeta del mes ----
   El diario STG registra la VISA de enero completo en un solo asiento del 31 (5,543.17) mientras el banco
   la fue acreditando en 15 remisiones diarias. Sin esta pasada, las 15 salían como diferencia. */
const REMISIONES = [
  ["2026-01-06", 925.59], ["2026-01-10", 70.76], ["2026-01-12", 6.09], ["2026-01-14", 367.11],
  ["2026-01-16", 484.63], ["2026-01-17", 544.64], ["2026-01-19", 155.35], ["2026-01-20", 148.05],
  ["2026-01-21", 381.31], ["2026-01-22", 571.44], ["2026-01-23", 350.91], ["2026-01-26", 279.46],
  ["2026-01-28", 81.85],  ["2026-01-29", 445.22], ["2026-01-31", 730.76]
];
const estRemisiones = () => REMISIONES.map(([f, m], i) => (
  { fecha: f, debito: 0, credito: m, descripcion: "Remisión V/Mc 016005605 Liq. No. " + (3744856 + i), fila: 10 + i }));
const ACUM_NETO = 5543.17;

test("el asiento que acumula la VISA del mes cuadra contra sus remisiones diarias", () => {
  const diario = [{ fecha: "2026-01-31", debito: ACUM_NETO, credito: 0,
    descripcion: "DEPOSITOS POR TARJETA VISA STG DEL 1 AL 31 DE ENERO 2026.", referencia: "ME-00000001854", fila: 90 }];
  const c = conciliarBancoEstado(diario, estRemisiones(), 3, 0.01, { "2026-01-31": 35.84 });
  eq(c.faltanEnBanco.length, 0, "el acumulado queda cuadrado");
  eq(c.faltanEnDiario.length, 0, "y consume las 15 remisiones");
});

test("el acumulado también cuadra si el diario trae el BRUTO del período", () => {
  // Caja General registra el bruto (5,823.79 = 5,543.17 + 280.62 de retenciones del mes).
  const retDia = {};
  REMISIONES.forEach(([f], i) => { retDia[f] = [47.5, 3.64, 0.32, 18.62, 24.88, 27.79, 7.96, 6.76, 19.57, 29.32, 17.3, 14.32, 4.1, 22.7, 35.84][i]; });
  const diario = [{ fecha: "2026-01-31", debito: 5823.79, credito: 0,
    descripcion: "DEPOSITOS POR TARJETA VISA STG DEL 1 AL 31 DE ENERO 2026.", referencia: "ME-00000001854", fila: 90 }];
  const c = conciliarBancoEstado(diario, estRemisiones(), 3, 0.01, retDia);
  eq(c.faltanEnBanco.length, 0, "resta las retenciones del RANGO, no las de un día");
});

// El efectivo del día se enganchaba con cualquier crédito que coincidiera en importe — incluida una
// remisión de tarjeta. Se comió la Remisión V/Mc de 350.91 y dejó huérfano el acumulado del mes.
test("el efectivo del día no puede consumir una remisión de tarjeta", () => {
  const diario = [
    { fecha: "2026-01-23", debito: 300.91, credito: 0, descripcion: "DEPOSITO BRINKS DEL 23/01/2026", fila: 1 },
    { fecha: "2026-01-23", debito: 50.00,  credito: 0, descripcion: "DEPOSITO DEL 23/01/2026",        fila: 2 }
  ];
  // El único crédito que suma 350.91 es una remisión VISA: el efectivo NO debe tomarla.
  const estado = [{ fecha: "2026-01-23", debito: 0, credito: 350.91, descripcion: "Remisión V/Mc 016005605", fila: 20 }];
  const c = conciliarBancoEstado(diario, estado, 3, 0.01, null);
  eq(c.faltanEnBanco.length, 2, "el efectivo queda pendiente, no se cuadra contra la remisión");
  eq(c.faltanEnDiario.length, 1, "y la remisión sigue libre para su propio asiento");
});

// Un día sin ventas VISA (fila en cero en el informe) no tiene nada que compensar en el banco.
test("un día VISA en cero no genera hallazgo", () => {
  eq(paso4([{ fecha: "2026-01-30", bruto: 0, retenciones: 0, neto: 0 }], [], 3, 0.01).length, 0);
  eq(paso4([{ fecha: "2026-01-30", bruto: 100, retenciones: -5, neto: 95 }], [], 3, 0.01).length, 1);
});

// El banco parte un depósito en tránsito en varios créditos: 92.97 del 29-dic entró como 60.41 + 32.56.
/* ---- La combinación tiene que ser del MISMO día ----
   Permitir que una partida se arme con líneas de fechas distintas convierte cualquier importe chico en
   "compensado" a fuerza de sumar céntimos sueltos. El depósito de 5.85 del 06-dic se daba por cuadrado
   con 1.63 del 28-ene + 0.72 del 26-ene + 3.50 del 19-ene, y encima dejaba huérfanos esos tres. */
test("una partida no se arma sumando céntimos de días distintos", () => {
  const est = [
    { fecha: "2026-01-19", debito: 0, credito: 3.50, descripcion: "Descripción", fila: 20 },
    { fecha: "2026-01-26", debito: 0, credito: 0.72, descripcion: "Descripción", fila: 30 },
    { fecha: "2026-01-28", debito: 0, credito: 1.63, descripcion: "Descripción", fila: 40 }
  ];
  const r = consumirTransitoPrevio(
    [{ fecha: "2025-12-06", banco: "STG", monto: 5.85, concepto: "deposito en transito", comprobante: "ME-00000001799", sentido: "credito" }],
    { STG: est }, 0.01);
  eq(r.pendientes.length, 1, "sigue pendiente: 5.85 no está en el banco");
  eq(est.filter(x => x._transitoUsado).length, 0, "y no se come los depósitos de enero");
});

test("comboMismoDia solo acepta líneas de la misma fecha", () => {
  const pool = [
    { fecha: "2026-01-02", monto: 60.41, usado: false },
    { fecha: "2026-01-02", monto: 32.56, usado: false },
    { fecha: "2026-01-05", monto: 40.00, usado: false }
  ];
  const c = comboMismoDia(pool, "2025-12-29", 92.97, 366, 0.01, 3);
  eq(c.length, 2);
  eq(pool[c[0]].fecha, "2026-01-02");
  eq(pool[c[1]].fecha, "2026-01-02");
  // 100.41 = 60.41 + 40.00 existe, pero son días distintos: no se acepta.
  eq(comboMismoDia(pool, "2025-12-29", 100.41, 366, 0.01, 3), null);
});

test("una partida del Paso 0 puede compensar en varias líneas del estado", () => {
  const est = [
    { fecha: "2026-01-02", debito: 0, credito: 60.41, descripcion: "Descripción", fila: 3 },
    { fecha: "2026-01-02", debito: 0, credito: 32.56, descripcion: "Descripción", fila: 5 }
  ];
  const r = consumirTransitoPrevio(
    [{ fecha: "2025-12-29", banco: "STG", monto: 92.97, concepto: "deposito en transito", comprobante: "ME-00000001824", sentido: "credito" }],
    { STG: est }, 0.01);
  eq(r.pendientes.length, 0, "compensó partido en dos");
  eq(est.filter(x => x._transitoUsado).length, 2, "las dos líneas quedan consumidas");
});

/* ---- El total del Paso 0 tiene que ser el saldo inicial de Caja General ----
   Caja General es la cuenta puente: su saldo al arrancar el mes ES lo que quedó en tránsito del anterior. */
const P0_MIXTO = [
  { fecha: "2026-05-30", banco: "STG", monto: 470.00, concepto: "deposito en transito", comprobante: "", sentido: "credito" },
  { fecha: "2026-05-30", banco: "STG", monto: 1352.68, concepto: "deposito en transito", comprobante: "", sentido: "credito" },
  { fecha: "2026-05-27", banco: "Banistmo", monto: 282.72, concepto: "Cheque en circulacion", comprobante: "", sentido: "credito" }
];

test("el cuadre del Paso 0 deja fuera los cheques en circulación", () => {
  const c = cuadreSaldoInicialPaso0(P0_MIXTO, { inicial: 1822.68, fechaInicial: "2026-06-01" });
  cerca(c.total, 1822.68, "solo lo que pasa por Caja General");
  cerca(c.totalFuera, 282.72, "el cheque emitido no suma");
  eq(c.nFuera, 1);
  eq(c.ok, true, "cuadra");
});

test("el cuadre detecta que al resumen le faltan partidas", () => {
  const c = cuadreSaldoInicialPaso0(P0_MIXTO, { inicial: 2517.82, fechaInicial: "2026-06-01" });
  eq(c.ok, false);
  cerca(c.dif, -695.14, "negativo = al resumen le falta");
  if (!/faltan/.test(cuadreSaldoIniHtml(c))) throw new Error("el panel debe decir que faltan partidas");
});

test("el cuadre detecta que el resumen trae partidas de más", () => {
  const c = cuadreSaldoInicialPaso0(P0_MIXTO, { inicial: 1000, fechaInicial: "2026-06-01" });
  cerca(c.dif, 822.68, "positivo = sobra");
  if (!/de más/.test(cuadreSaldoIniHtml(c))) throw new Error("el panel debe decir que sobra");
});

test("un cheque emitido por referencia PAY tampoco suma", () => {
  const c = cuadreSaldoInicialPaso0(
    [{ fecha: "2026-05-30", banco: "Banistmo", monto: 500, concepto: "cheque", comprobante: "PAY0004133", sentido: "debito" }],
    { inicial: 0, fechaInicial: "2026-06-01" });
  cerca(c.total, 0); eq(c.ok, true);
});

test("sin saldo de Caja General no se puede cuadrar (no se inventa una alerta)", () => {
  eq(cuadreSaldoInicialPaso0(P0_MIXTO, null), null);
  eq(cuadreSaldoInicialPaso0(P0_MIXTO, { inicial: null }), null);
  eq(cuadreSaldoInicialPaso0([], { inicial: 100 }), null);
  eq(cuadreSaldoIniHtml(null), "");
});

// Un saldo acreedor en una cuenta puente de depósitos en tránsito es señal de otro problema.
test("el panel avisa aparte si el saldo inicial es negativo", () => {
  const h = cuadreSaldoIniHtml(cuadreSaldoInicialPaso0(P0_MIXTO, { inicial: -2469.06, fechaInicial: "2026-01-01" }));
  if (!/negativo/.test(h)) throw new Error("debe advertir del saldo negativo");
});

/* ---- Asiento de ajuste al saldo de apertura de Caja General ----
   Un saldo inicial NEGATIVO está en la columna crédito, y ahí no tiene sentido: todo lo que viene en
   tránsito es dinero ya registrado como depositado, o sea débito. Se corrige con un asiento fechado en el
   mes anterior (dentro del mes cambiaría el saldo final y dejaría el de apertura igual de mal). */
test("saldo inicial negativo → ajuste al DÉBITO por la diferencia completa", () => {
  const c = cuadreSaldoInicialPaso0(P0_MIXTO, { inicial: -2469.06, fechaInicial: "2026-01-01" });
  const a = ajusteCajaGeneral(c);
  eq(a.columna, "Débito");
  cerca(a.monto, 4291.74, "1,822.68 − (−2,469.06)");
  // El ejercicio anterior ya está declarado y no se toca: el ajuste entra en el período abierto.
  eq(a.fecha, "2026-01-01", "primer día del período que se revisa");
});

test("si el saldo se pasa, el ajuste va al CRÉDITO", () => {
  const a = ajusteCajaGeneral(cuadreSaldoInicialPaso0(P0_MIXTO, { inicial: 2517.82, fechaInicial: "2026-06-01" }));
  eq(a.columna, "Crédito");
  cerca(a.monto, 695.14);
  eq(a.fecha, "2026-06-01");
});

/* ---- El ajuste de apertura ya asentado ----
   Caso real: ME-00000002023, débito de 18,123.07 fechado el 01-ene. El navegador sigue mostrando el
   Balance Inicial viejo (lo calcula al corte), así que hay que sumarle los ajustes de apertura. */
test("un ajuste fechado el primer día del período corrige la apertura", () => {
  const diario = [
    { fecha: "2026-01-01", debito: 18123.07, credito: 0, descripcion: "ajusta saldo errado de la caja general al cierre 2025.", referencia: "ME-00000002023", fila: 2 },
    { fecha: "2026-01-02", debito: 0, credito: 56.49, descripcion: "ajuste en caja general movido de diciembre 2025", referencia: "ME-00000001827", fila: 12 }
  ];
  const p0 = [{ fecha: "2025-12-31", banco: "STG", monto: 15654.01, concepto: "deposito en transito", comprobante: "", sentido: "credito" }];
  const c = cuadreSaldoInicialPaso0(p0, { inicial: -2469.06, fechaInicial: "2026-01-01" }, diario);
  eq(c.ajustes.length, 1, "solo el del 01-ene; el del 02-ene es movimiento del mes");
  cerca(c.totalAjustes, 18123.07);
  cerca(c.apertura, 15654.01, "−2,469.06 + 18,123.07");
  eq(c.ok, true, "con el ajuste, cuadra");
  eq(ajusteCajaGeneral(c), null, "y ya no se propone otro");
});

test("un ajuste al crédito en la apertura resta", () => {
  const diario = [{ fecha: "2026-06-01", debito: 0, credito: 529.18, descripcion: "ajuste de apertura", referencia: "ME-1", fila: 2 }];
  const c = cuadreSaldoInicialPaso0(P0_MIXTO, { inicial: 2351.86, fechaInicial: "2026-06-01" }, diario);
  cerca(c.totalAjustes, -529.18);
  cerca(c.apertura, 1822.68);
  eq(c.ok, true);
});

test("sin diario, el cuadre usa el Balance Inicial tal cual", () => {
  const c = cuadreSaldoInicialPaso0(P0_MIXTO, { inicial: 1822.68, fechaInicial: "2026-06-01" });
  eq(c.ajustes.length, 0);
  cerca(c.apertura, 1822.68);
  eq(c.ok, true);
});

test("si el Paso 0 cuadra no se propone ningún ajuste", () => {
  eq(ajusteCajaGeneral(cuadreSaldoInicialPaso0(P0_MIXTO, { inicial: 1822.68, fechaInicial: "2026-06-01" })), null);
  eq(ajusteCajaGeneral(null), null);
  eq(ajusteHtml(null, []), "");
});

test("los asientos que ya dicen 'ajuste' se listan para no duplicarlos", () => {
  const diario = [
    { fecha: "2026-01-02", debito: 0, credito: 56.49, descripcion: "ajuste en caja general movido de diciembre 2025", referencia: "ME-00000001827", fila: 4 },
    { fecha: "2026-01-05", debito: 100, credito: 0, descripcion: "DEPOSITO BRINKS", referencia: "ME-00000001829", fila: 9 }
  ];
  const y = ajustesEnCajaGeneral(diario);
  eq(y.length, 1, "solo el que dice ajuste");
  eq(y[0].columna, "Crédito");
  cerca(y[0].monto, 56.49);
  const c = cuadreSaldoInicialPaso0(P0_MIXTO, { inicial: -2469.06, fechaInicial: "2026-01-01" });
  if (!/56\.49/.test(ajusteHtml(c, y))) throw new Error("el panel debe mostrar el ajuste ya registrado");
});

/* ---- Archivo equivocado en la casilla ----
   Se identifica por el CONTENIDO, no por el nombre. Un archivo en la casilla que no le toca no siempre
   revienta: a veces el parser devuelve vacío y el paso sale "sin diferencias" con media información menos. */
const NAV = (cuenta) => [
  [null, "Account", "Fecha", "Referencia", "Ref. Sec", "Fuente", "Descripción", "Guardado Por"],
  [null, cuenta, "2026-01-02", "ME-1", null, "MAN-ENTRY", "DEPOSITO", "IRIS"]
];
const EST_BANISTMO = [["Cuenta", "Fecha", "Hora", "Cheque", "Descripción", "Débito", "Crédito", "Saldo", "Signo"],
                      ["011", "2026-01-02", "03:15", "0", "DB COMISION", "1.5", "0", "12180.32", "D"]];
const EST_STG = [["Fecha", "Descripción", "Débitos(-)", "Créditos(+)", "Balance"],
                 ["2026-01-02", "Remisión V/Mc", "0", "155.35", "1000.00"]];
const EST_BG = [["Fecha", "Referencia", "Transacción", "Descripción", "Débito", "Crédito", "Saldo total"],
                ["2026-01-31", "305", "50", "COMISION MENSUAL", 5.35, 0, 983.95]];

test("identifica cada archivo por su contenido", () => {
  eq(identificarArchivo(NAV("[1.1.8] Caja General")), "diarioCaja");
  eq(identificarArchivo(NAV("[1.1.1.10] St. Georges Bank")), "diarioStg");
  eq(identificarArchivo(NAV("[1.1.1.5] Banistmo")), "diarioBanistmo");
  eq(identificarArchivo(NAV("[2.3.1.4] Retencion a empleados por pagar")), "retenciones");
  eq(identificarArchivo([["FECHA", "BANCO", "MONTO", "CONCEPTO", "COMPROBANTE"]]), "transitoPrevio");
  eq(identificarArchivo(EST_STG), "estado");
  eq(identificarArchivo([["hola"], ["mundo"]]), null);
});

test("cada estado de cuenta se reconoce por su encabezado", () => {
  eq(bancoDeEstado(EST_BANISTMO), "banistmo");
  eq(bancoDeEstado(EST_STG), "stg");
  eq(bancoDeEstado(EST_BG), "bancogeneral", "Saldo total, antes que Saldo a secas");
});

test("el archivo correcto en su casilla pasa", () => {
  eq(validarArchivoParaCasilla("diarioCaja", NAV("[1.1.8] Caja General")), null);
  eq(validarArchivoParaCasilla("estStg", EST_STG), null);
  eq(validarArchivoParaCasilla("estBanistmo", EST_BANISTMO), null);
});

test("el archivo equivocado se rechaza diciendo qué es", () => {
  const e = validarArchivoParaCasilla("diarioCaja", NAV("[1.1.1.5] Banistmo"));
  if (!/^Archivo equivocado/.test(e)) throw new Error("debe arrancar con 'Archivo equivocado'");
  if (!/navegador de Banistmo/.test(e)) throw new Error("debe decir qué se subió");
  if (!/va el navegador de Caja General/.test(e)) throw new Error("y qué iba ahí");
});

// El parser de Banistmo es tolerante ("Débitos" contiene "Débito"), así que sin mirar el encabezado
// completo el estado de STG pasaba en la casilla de Banistmo sin chistar.
test("un estado de cuenta no pasa por el de otro banco", () => {
  if (!validarArchivoParaCasilla("estBanistmo", EST_STG)) throw new Error("STG no va en Banistmo");
  if (!validarArchivoParaCasilla("estStg", EST_BANISTMO)) throw new Error("Banistmo no va en STG");
  if (!validarArchivoParaCasilla("estBanistmo", EST_BG)) throw new Error("Banco General no va en Banistmo");
});

test("un archivo irreconocible se rechaza", () => {
  const e = validarArchivoParaCasilla("reporte", [["cualquier", "cosa"], [1, 2]]);
  if (!/no se reconoce el formato/.test(e)) throw new Error("debe decir que no lo reconoce");
});

test("una casilla sin firma conocida no se valida", () => {
  eq(validarArchivoParaCasilla("otraCosa", [["x"]]), null);
});

/* ---- El Paso 0 necesita los estados de cuenta ----
   Sin ellos no hay contra qué cotejar y TODAS las partidas salen como pendientes. Ese resultado se
   arrastra al resumen del mes siguiente: enero devolvía 22 partidas por 17,225.11 en vez de 10 por
   4,221.14, con las 12 que ya habían compensado adentro. Pasaba al ejecutar el Paso 1 antes de subir los
   estados: el Paso 0 quedaba calculado sin ellos y no se recalculaba nunca más. */
test("sin estados de cuenta, el Paso 0 avisa que no pudo cotejar nada", () => {
  const p0 = [
    { fecha: "2025-12-31", banco: "Banistmo", monto: 1341.20, concepto: "visa en transito", comprobante: "ME-1", sentido: "credito" },
    { fecha: "2025-12-30", banco: "Banistmo", monto: 80.00, concepto: "cheque en transito", comprobante: "ME-2", sentido: "credito" }
  ];
  const h = paso0(p0, [], [], null, 3, 0.01);
  const avisos = h.filter(x => x.clase === "aviso");
  eq(avisos.length, 1, "tiene que avisar");
  if (!/sin estados de cuenta/i.test(avisos[0].texto)) throw new Error("y decir por qué");
  eq(h.filter(x => esEnTransito(x) && /aún NO compensó/.test(x.texto)).length, 2, "las dos quedan pendientes");
});

test("con estados de cuenta no avisa y las partidas compensan", () => {
  const p0 = [{ fecha: "2025-12-31", banco: "Banistmo", monto: 1341.20, concepto: "visa en transito", comprobante: "ME-1", sentido: "credito" }];
  const est = [{ fecha: "2026-01-02", debito: 0, credito: 1341.20, descripcion: "CR REMISION - V/MC", fila: 5 }];
  const h = paso0(p0, est, [], null, 3, 0.01);
  eq(h.filter(x => x.clase === "aviso").length, 0);
  eq(h.filter(x => /aún NO compensó/.test(x.texto)).length, 0, "compensó");
});

/* ---- El navegador de Caja General recortado ----
   El de febrero llegó sin la etiqueta "Balance Inicial (fecha):" y sin las filas de totales del final:
   quedó solo el importe suelto en la primera fila. Sin esa cifra no corre el cuadre del Paso 0, que es
   justo el control que avisa si el resumen en tránsito trae partidas de más o de menos. */
test("recupera el saldo de apertura aunque falte su etiqueta", () => {
  const rows = [
    [null, null, null, null, null, null, null, null, null, null, null, null, "B/ 18,134.77", null, null],
    [null, "Account", "Fecha", "Referencia", "Ref. Sec", "Fuente", "Descripción"],
    [null, "[1.1.8] Caja General", "2026-02-02", "ME-1", null, "MAN-ENTRY", "DEPOSITO", null, null, null, null, null, null, "B/ 0.00", "B/ 265.00"]
  ];
  const s = parseSaldoCajaGeneral(rows);
  cerca(s.inicial, 18134.77);
  eq(s.inicialInferido, true, "queda marcado como inferido, no leído de su etiqueta");
});

test("la etiqueta real gana sobre la inferencia", () => {
  const s = parseSaldoCajaGeneral([["Balance Inicial (2026-01-01):", null, "-B/ 2,469.06"]]);
  cerca(s.inicial, -2469.06);
  eq(!!s.inicialInferido, false);
});

test("no se inventa un saldo donde no lo hay", () => {
  // Una fila de encabezado con varias celdas de texto no es un saldo.
  eq(parseSaldoCajaGeneral([[null, "Account", "Fecha", "Referencia"], [null, "[1.1.8] Caja General"]]), null);
  eq(parseSaldoCajaGeneral([["Reporte de Caja General"]]), null);
  eq(parseSaldoCajaGeneral([]), null);
});

/* ---- Diferencias que se cancelan entre sí ----
   Caso real de febrero: los cheques del 11 (255.60+164.08+292.62+273.49 = 985.79) se depositaron el 12,
   el diario los registró ese día en dos asientos y el reporte solo puso 273.49 en su columna Cheque.
   Salían tres diferencias que son la misma partida vista tres veces, y suman cero. */
const D_FEB = () => [
  { fecha: "2026-02-12", banco: "Banistmo", monto: -712.30, clase: "diff", texto: "Diferencia Banistmo 2026-02-12", fuente: "x" },
  { fecha: "2026-02-11", banco: "Banistmo", monto: 985.79, clase: "diff", texto: "Cheques Banistmo 2026-02-11", fuente: "x" },
  { fecha: "2026-02-12", banco: "Banistmo", monto: -273.49, clase: "diff", texto: "Cheques Banistmo 2026-02-12", fuente: "x" }
];

test("tres diferencias que suman cero se colapsan en un aviso", () => {
  const r = colapsarCompensados(D_FEB(), 0.01);
  eq(r.length, 1, "las tres se reemplazan por uno solo");
  eq(r[0].clase, "aviso");
  eq(esNoRojo(r[0]), true, "ya no es una diferencia");
  cerca(r[0].monto, 985.79, "el monto es el bruto de la partida");
  if (!/se cancelan entre sí/.test(r[0].texto)) throw new Error("debe explicar por qué");
  ["985.79", "-712.30", "-273.49"].forEach(m => {
    if (!r[0].texto.includes(m)) throw new Error("debe nombrar las tres: falta " + m);
  });
});

test("dos diferencias opuestas también se colapsan", () => {
  const r = colapsarCompensados([
    { fecha: "2026-02-11", banco: "STG", monto: 300, clase: "diff", texto: "a", fuente: "x" },
    { fecha: "2026-02-12", banco: "STG", monto: -300, clase: "diff", texto: "b", fuente: "x" }
  ], 0.01);
  eq(r.length, 1);
  eq(r[0].clase, "aviso");
});

test("no se colapsan diferencias de bancos distintos", () => {
  const r = colapsarCompensados([
    { fecha: "2026-02-11", banco: "STG", monto: 300, clase: "diff", texto: "a", fuente: "x" },
    { fecha: "2026-02-11", banco: "Banistmo", monto: -300, clase: "diff", texto: "b", fuente: "x" }
  ], 0.01);
  eq(r.length, 2, "el cruce entre bancos lo maneja aparte el swap de banco");
});

test("no se colapsan diferencias separadas por semanas", () => {
  const r = colapsarCompensados([
    { fecha: "2026-02-02", banco: "STG", monto: 300, clase: "diff", texto: "a", fuente: "x" },
    { fecha: "2026-02-25", banco: "STG", monto: -300, clase: "diff", texto: "b", fuente: "x" }
  ], 0.01);
  eq(r.length, 2, "un corrimiento de fecha es de días, no de 23 días");
});

test("las diferencias que NO se cancelan quedan intactas", () => {
  const h = [
    { fecha: "2026-02-11", banco: "STG", monto: 300, clase: "diff", texto: "a", fuente: "x" },
    { fecha: "2026-02-12", banco: "STG", monto: -250, clase: "diff", texto: "b", fuente: "x" }
  ];
  eq(colapsarCompensados(h, 0.01).length, 2);
  eq(colapsarCompensados([], 0.01).length, 0);
});

test("solo se colapsan diferencias, no lo que ya era aviso o tránsito", () => {
  const h = [
    { fecha: "2026-02-11", banco: "STG", monto: 300, clase: "en_transito", texto: "a", fuente: "x" },
    { fecha: "2026-02-12", banco: "STG", monto: -300, clase: "aviso", texto: "b", fuente: "x" }
  ];
  eq(colapsarCompensados(h, 0.01).length, 2);
});

/* ---- Faltantes, sobrantes y ajustes ----
   No son un método de pago ni un depósito, pero mueven el saldo de Caja General en su propio diario. */
test("el asiento partido en dos líneas no cuenta doble", () => {
  // El navegador trae el faltante como dos líneas de Caja General con la MISMA referencia: una al débito
  // y otra al crédito, del mismo importe. El faltante es 0.20, ni 0.40 ni 0.
  const diario = [
    { fecha: "2026-06-02", debito: 0, credito: 0.20, descripcion: "FALTANTE DEL 02/6/2026", referencia: "ME-00000001961", fila: 43 },
    { fecha: "2026-06-02", debito: 0.20, credito: 0, descripcion: "FALTANTE DEL 02/06/2026", referencia: "ME-00000001961", fila: 57 }
  ];
  const d = faltSobrDiario(diario);
  eq(d.length, 1, "un comprobante, no dos");
  cerca(d[0].monto, 0.20);
  eq(d[0].tipo, "FALTANTE");
});

test("un asiento de una sola línea se toma tal cual", () => {
  const d = faltSobrDiario([{ fecha: "2026-01-21", debito: 0, credito: 0.75, descripcion: "FALTANTE DEL 21/01/2026", referencia: "ME-1", fila: 9 }]);
  eq(d.length, 1);
  cerca(d[0].monto, 0.75);
});

test("un faltante reportado y no asentado es diferencia", () => {
  const c = cotejarFaltantesSobrantes(
    [{ fecha: "2026-01-21", cajera: "ANA", tipo: "FALTANTE", monto: 5.00 }], [], 0.01);
  eq(c.length, 1);
  eq(c[0].clase, "monto");
  cerca(c[0].dif, -5.00, "el diario no tiene nada");
});

test("un asiento sin respaldo en el reporte también es diferencia", () => {
  const c = cotejarFaltantesSobrantes([], [{ fecha: "2026-01-10", tipo: "FALTANTE", tipos: ["FALTANTE"], monto: 3.00 }], 0.01);
  eq(c.length, 1);
  cerca(c[0].dif, 3.00);
});

test("si el importe cuadra pero la etiqueta no, es aviso y no diferencia", () => {
  const c = cotejarFaltantesSobrantes(
    [{ fecha: "2026-06-27", cajera: "EIRA", tipo: "SOBRANTE", monto: 0.01 }],
    [{ fecha: "2026-06-27", tipo: "AMBOS", tipos: ["FALTANTE", "SOBRANTE"], monto: 0.01 }], 0.01);
  eq(c.length, 1);
  eq(c[0].clase, "etiqueta", "el importe cuadra: lo que falla es la descripción");
});

test("lo que cuadra no genera nada", () => {
  eq(cotejarFaltantesSobrantes(
    [{ fecha: "2026-01-21", tipo: "FALTANTE", monto: 0.75 }],
    [{ fecha: "2026-01-21", tipo: "FALTANTE", tipos: ["FALTANTE"], monto: 0.75 }], 0.01).length, 0);
});

test("los ajustes del mes se listan; los de apertura no (los cuenta el Paso 0)", () => {
  const diario = [
    { fecha: "2026-01-01", debito: 18123.07, credito: 0, descripcion: "ajusta saldo errado de la caja general al cierre 2025.", referencia: "ME-00000002023", fila: 2 },
    { fecha: "2026-01-02", debito: 0, credito: 56.49, descripcion: "ajuste en caja general movido de diciembre 2025", referencia: "ME-00000001827", fila: 12 }
  ];
  const a = ajustesDelMes(diario, "2026-01-01");
  eq(a.length, 1, "solo el del 02-ene");
  cerca(a[0].monto, 56.49);
  eq(a[0].columna, "Crédito");
  eq(ajustesDelMes(diario, null).length, 2, "sin fecha de apertura, se listan los dos");
});

test("un ajuste en Caja General se reporta como aviso, no como diferencia", () => {
  const diario = [{ fecha: "2026-01-02", debito: 0, credito: 56.49, descripcion: "ajuste en caja general", referencia: "ME-1", fila: 12 }];
  const h = paso1([], diario, null, 0.01, [], "2026-01-01");
  eq(h.length, 1);
  eq(h[0].clase, "aviso");
  eq(esNoRojo(h[0]), true, "no bloquea el cierre");
});

/* ---- Las SALIDAS del banco quedan fuera del alcance ----
   Este módulo coteja lo que pasa por Caja General. Los pagos (cheques emitidos, ACH, planillas) y los
   cargos propios del banco (comisiones, ITBMS, retenciones, timbres) salen directo de la cuenta sin tocar
   Caja General: no se concilian, pero se cuenta lo que quedó fuera para que la exclusión sea explícita. */
const DIARIO_SALIDAS = [
  { fecha: "2026-01-26", debito: 0, credito: 1589.71, descripcion: "SEGUNDA QUINCENA DE ENERO 2026", referencia: "ME-00000001851", fila: 30 },
  { fecha: "2026-01-30", debito: 0, credito: 551.29, descripcion: "INDUSTRIAS MODERNAS, S.A. - Pago:PAY0004121", referencia: "PAY0004121", fila: 40 },
  { fecha: "2026-01-31", debito: 0, credito: 100, descripcion: "CARGOS BANCARIOS 45.27", referencia: "ME-1", fila: 50 },
  { fecha: "2026-01-05", debito: 920, credito: 0, descripcion: "DEPOSITO BRINKS DEL 05/01/2026", referencia: "ME-2", fila: 9 }
];
const ESTADO_SALIDAS = [
  { fecha: "2026-01-05", debito: 60, credito: 0, descripcion: "DB COMISION POR TRANSACCION DE ACH", fila: 3 },
  { fecha: "2026-01-14", debito: 237.68, credito: 0, descripcion: "Cheque 7831", fila: 8 },
  { fecha: "2026-06-30", debito: 30, credito: 0, descripcion: "DB COMISIÃ“N POR BAJO SALDO//COBRO COM JUN 26", fila: 9 },
  { fecha: "2026-01-02", debito: 0, credito: 1341.20, descripcion: "CR REMISION - V/MC", fila: 5 }
];

test("las salidas se cuentan pero no se cotejan", () => {
  const r = resumenSalidas(DIARIO_SALIDAS, ESTADO_SALIDAS);
  eq(r.pagos.n, 3, "los 3 créditos del diario; el débito Brinks es una entrada");
  cerca(r.pagos.total, 2241.00);
  eq(r.cargos.n, 3, "los 3 débitos del estado; el crédito de remisión es una entrada");
  cerca(r.cargos.total, 327.68);
});

test("un cheque emitido que el banco cobró no genera diferencia", () => {
  // "Cheque 7831" sale de la cuenta bancaria, no de Caja General: no es de este módulo.
  const h = paso3([], [], [], ESTADO_SALIDAS, null, null, 3, 0.01, null, null);
  eq(h.filter(x => (x.clase || "diff") === "diff" && /7831/.test(x.texto)).length, 0);
});

test("la exclusión de salidas se informa, no se descarta en silencio", () => {
  const h = paso3([], [], [], ESTADO_SALIDAS, null, null, 3, 0.01, null, null);
  const inf = h.filter(esInformativo);
  if (!inf.length) throw new Error("debe quedar constancia de lo que se dejó fuera");
  if (!/no se cotejan en este módulo/.test(inf[0].texto)) throw new Error("y decir por qué");
  // Ninguna SALIDA es diferencia roja. (El crédito de remisión del fixture sí lo es: es una entrada
  // que llegó al banco sin respaldo en el diario, y eso sí es de este módulo.)
  const rojasSalida = h.filter(x => !esNoRojo(x) && /Cheque 7831|COMISI/i.test(x.texto || ""));
  eq(rojasSalida.length, 0, "ni el cheque emitido ni las comisiones cuentan como diferencia");
});

test("lo que ya compensó se lista como tránsito ENTRANTE, no como pendiente", () => {
  const h = paso0(P0_VISA, EST_VISA(), [], null, 3, 0.01);
  eq(h.filter(x => esEnTransito(x) && /mes anterior/i.test(x.motivo || "")).length, 2, "se deja la traza");
  eq(h.filter(x => /aún NO compensó/.test(x.texto)).length, 0, "ninguna sigue pendiente");
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

/* ---- De qué está hecho el saldo de Caja General ----
   El saldo contable al cierre NO es el tránsito: arrastra la apertura que ya compensó en el banco (nadie
   la da de baja de la cuenta) y las retenciones de tarjeta (la venta entra bruta, el depósito sale neto). */
test("el desglose del saldo de Caja General suma el saldo final", () => {
  // Apertura efectiva = Balance Inicial (−2,469.06) + ajuste ME-00000002023 (18,123.07) = 15,654.01.
  // De ahí sale lo que compensó y todavía no se descargó: 15,654.01 − 2,650.04 pendientes.
  STATE.transitoPrevio = null; STATE.diarioCaja = null;
  STATE.saldoCajaGeneral = { inicial: 15654.01, movimiento: 20660.32, final: 18191.26, fechaFinal: "2026-01-31" };
  STATE.results = {
    paso0: [
      { clase: "en_transito", motivo: "compensó — venía del mes anterior", monto: 13003.97, concepto: "x", texto: "x" },
      { clase: "en_transito", motivo: "aún pendiente de compensar", banco: "Banistmo", monto: 2650.04, concepto: "cheque", texto: "x" }
    ],
    paso2: [{ clase: "en_transito", motivo: "último día del mes", banco: "STG", monto: 1571.10, concepto: "tarjeta", texto: "x" }]
  };
  const d = desgloseSaldoCaja();
  // Dentro de Caja General solo sigue lo que no tiene asiento de salida: el item de tarjeta del Paso 2
  // nace de un CREDITO de Caja General, o sea que ya salio de la cuenta y va del lado del banco.
  cerca(d.transito, 2650.04, "solo lo pendiente del Paso 0");
  cerca(d.compenso, 13003.97, "la apertura que ya compensó");
  cerca(d.resto, 2537.25, "el resto del movimiento (retenciones + lo salido sin compensar)");
  cerca(d.transito + d.compenso + d.resto, d.final, "las tres partes dan el saldo final");
});

test("sin saldo final no hay desglose que mostrar", () => {
  STATE.saldoCajaGeneral = null;
  eq(desgloseSaldoCaja(), null);
  eq(desgloseSaldoCajaHtml(), "");
  STATE.saldoCajaGeneral = { inicial: 100, final: null };
  eq(desgloseSaldoCaja(), null);
});


/* ---- El resumen en tránsito toma TODOS los pasos ----
   Cada paso ve una parte distinta y ninguno lo ve entero. El Paso 2 rutea desde Caja General por banco,
   así que no ve el efectivo (Brinks y ventanilla no llevan etiqueta de banco): eso solo aparece en el
   Paso 3. En enero quedaban fuera 1,354.25 en cinco partidas del 28 al 31 (ME-1850/52/53/54). */
test("el efectivo que solo ve el Paso 3 entra al resumen", () => {
  STATE.results = {
    paso0: [{ clase: "en_transito", motivo: "aún pendiente de compensar", banco: "Banistmo", fecha: "2025-12-22", monto: 435.71, concepto: "cheque", texto: "x" }],
    paso2: [{ clase: "en_transito", motivo: "último día del mes", banco: "STG", fecha: "2026-01-31", monto: 246.20, concepto: "DEPOSITO POR TARJETA CLAVE STG", texto: "x" }],
    paso3: [
      { clase: "en_transito", motivo: "depósito de fin de mes", banco: "STG", fecha: "2026-01-28", monto: 405.00, concepto: "DEPOSITO BRINKS DEL 28/01/2026", texto: "x" },
      { clase: "en_transito", motivo: "último día del mes", banco: "STG", fecha: "2026-01-31", monto: 1.95, concepto: "DEPOSITO DEL 31/01/2026", texto: "x" }
    ]
  };
  const it = recolectarEnTransito();
  eq(it.length, 4, "las dos del Paso 3 se suman");
  cerca(it.reduce((a, b) => a + b.monto, 0), 1088.86);
  // El 1.95 es del mismo día y banco que el 246.20 pero es otra partida: no se debe tapar.
  if (!it.some(x => Math.abs(x.monto - 1.95) < 0.001)) throw new Error("el 1.95 tiene que estar");
});

test("una partida que dos pasos ven no se cuenta dos veces", () => {
  // El Paso 2 la ve partida (detalle de cheques) y el Paso 3 entera (un asiento del diario).
  STATE.results = {
    paso2: [
      { clase: "en_transito", motivo: "último día del mes", banco: "Banistmo", fecha: "2026-01-31", monto: 181.13, concepto: "Cheque", texto: "x" },
      { clase: "en_transito", motivo: "último día del mes", banco: "Banistmo", fecha: "2026-01-31", monto: 336.18, concepto: "Cheque", texto: "x" }
    ],
    paso3: [{ clase: "en_transito", motivo: "último día del mes", banco: "Banistmo", fecha: "2026-01-31", monto: 517.31, concepto: "DEPOSITO DE BANISTMO CK", texto: "x" }]
  };
  const it = recolectarEnTransito();
  eq(it.length, 2, "el 517.31 ya está cubierto por 181.13 + 336.18");
  cerca(it.reduce((a, b) => a + b.monto, 0), 517.31);
});

test("dos partidas iguales del MISMO paso no se tapan entre sí", () => {
  STATE.results = { paso2: [
    { clase: "en_transito", motivo: "cheque pendiente por cambiar", banco: "Banistmo", fecha: "2026-02-27", monto: 90.00, concepto: "Cheque", texto: "x" },
    { clase: "en_transito", motivo: "cheque pendiente por cambiar", banco: "Banistmo", fecha: "2026-02-27", monto: 90.00, concepto: "Cheque", texto: "x" }
  ]};
  const it = recolectarEnTransito();
  eq(it.length, 2, "son dos cheques reales");
  cerca(it.reduce((a, b) => a + b.monto, 0), 180.00);
});

test("recolectar dos veces seguidas da lo mismo", () => {
  STATE.results = { paso2: [{ clase: "en_transito", motivo: "x", banco: "STG", fecha: "2026-01-31", monto: 100, concepto: "y", texto: "x" }],
                    paso3: [{ clase: "en_transito", motivo: "x", banco: "STG", fecha: "2026-01-31", monto: 100, concepto: "y", texto: "x" }] };
  const a = recolectarEnTransito().length, b = recolectarEnTransito().length;
  eq(a, 1); eq(b, 1, "el marcador de dedupe no se arrastra entre llamadas");
});


/* ---- El tilde de "corregido" sigue a su partida ----
   Se guardaba con la POSICIÓN del hallazgo ("paso0_3"). Al recalcular un paso la lista cambia de orden y
   de tamaño, así que los tildes quedaban aplicados a otras partidas y el Excel exportaba "Corregido: Sí"
   sobre una que nadie revisó. La clave ahora es el contenido. */
const H = (fecha, banco, monto, concepto) => ({ fecha, banco, monto, concepto, texto: "x", clase: "en_transito" });

test("la clave de un hallazgo no depende de su posición", () => {
  const lista1 = [H("2025-12-22", "Banistmo", 435.71, "cheque en transito"), H("2025-12-30", "Banistmo", 80, "cheque en transito")];
  const lista2 = [H("2026-01-05", "STG", 92.97, "deposito"), H("2025-12-30", "Banistmo", 80, "cheque en transito"), H("2025-12-22", "Banistmo", 435.71, "cheque en transito")];
  const k1 = clavesDeHallazgos("paso0", lista1), k2 = clavesDeHallazgos("paso0", lista2);
  eq(k1[0], k2[2], "el 435.71 conserva su clave aunque se mueva de la posición 0 a la 2");
  eq(k1[1], k2[1], "y el 80.00 también");
});

test("dos partidas idénticas reciben claves distintas", () => {
  // Dos cheques de 90.00 el mismo día son dos partidas reales: marcar una no debe marcar la otra.
  const k = clavesDeHallazgos("paso2", [H("2026-02-27", "Banistmo", 90, "Cheque"), H("2026-02-27", "Banistmo", 90, "Cheque")]);
  eq(k.length, 2);
  if (k[0] === k[1]) throw new Error("las claves no pueden repetirse");
  // ...pero el orden entre ellas es estable, así que el tilde no salta de una a otra al recalcular.
  const k2 = clavesDeHallazgos("paso2", [H("2026-02-27", "Banistmo", 90, "Cheque"), H("2026-02-27", "Banistmo", 90, "Cheque")]);
  eq(k[0], k2[0]); eq(k[1], k2[1]);
});

test("la clave distingue paso, fecha, banco, monto y concepto", () => {
  const base = H("2026-01-31", "STG", 246.20, "tarjeta clave");
  const k = clavesDeHallazgos("paso2", [base])[0];
  [["paso3", base], ["paso2", H("2026-01-30", "STG", 246.20, "tarjeta clave")],
   ["paso2", H("2026-01-31", "Banistmo", 246.20, "tarjeta clave")],
   ["paso2", H("2026-01-31", "STG", 246.21, "tarjeta clave")],
   ["paso2", H("2026-01-31", "STG", 246.20, "otra cosa")]].forEach(function(p){
    if (clavesDeHallazgos(p[0], [p[1]])[0] === k) throw new Error("debería ser otra clave: " + JSON.stringify(p));
  });
});

test("un hallazgo sin banco ni concepto igual recibe clave", () => {
  const k = clavesDeHallazgos("paso1", [{ fecha: "", banco: "", monto: 0, clase: "aviso", texto: "sin estados de cuenta" }]);
  eq(k.length, 1);
  if (!k[0]) throw new Error("no puede quedar vacía");
});


/* ---- Caja General es la cuenta puente de TODA la venta ----
   No es solo efectivo: cada método que el informe reporte tiene que quedar cotejado o reportado. Faltaban
   YAPPY (925.47 en junio) y el ACH de Banco General (161.07): sin banco reconocido, esas columnas se
   descartaban en silencio y su venta nunca se cotejaba contra nada. */
// El parser reconoce el encabezado por Fecha/Cajera/Sr.George/Banistmo, así que el fixture siempre
// arranca con ese par de columnas de Visa; lo que se prueba se agrega después.
const INFORME = (cols, fila) => [
  [null, null, "TARJETA", null].concat(cols.map(function(c){ return /total/i.test(c) ? "Totales" : null; })),
  ["Fecha", "Cajera", "Visa Sr.George", "Visa Banistmo"].concat(cols),
  ["2026-06-11", "ANA", 0, 0].concat(fila)
];

test("mapea Yappy y el ACH de Banco General", () => {
  const r = parseReporteConsolidado(INFORME(
    ["ACH Banistmo", "ACH B. GENERAL ", "Yappy Yappy", "total yappy"],
    [44.89, 161.07, 925.47, 925.47]));
  const m = {}; r.forEach(x => { const k = x.metodo + "|" + x.banco; m[k] = (m[k] || 0) + x.monto; });
  cerca(m["YAPPY|Banco General"], 925.47, "Yappy compensa en Banco General");
  cerca(m["ACH|Banco General"], 161.07, "B. GENERAL nombra el banco sin decir Banistmo ni George");
  cerca(m["ACH|Banistmo"], 44.89);
});

// "total yappy" contiene YAPPY y se colaba: duplicaba el Yappy del mes (1,850.94 en vez de 925.47).
test("las columnas de Totales no se cuentan como venta", () => {
  const r = parseReporteConsolidado(INFORME(["Yappy Yappy", "total yappy"], [925.47, 925.47]));
  cerca(r.filter(x => x.metodo === "YAPPY").reduce((a, b) => a + b.monto, 0), 925.47);
});

test("las columnas de ajuste clb no son venta cobrada", () => {
  const r = parseReporteConsolidado(INFORME(["Yappy Yappy", "Yappy clb(+)"], [925.47, 50]));
  cerca(r.filter(x => x.metodo === "YAPPY").reduce((a, b) => a + b.monto, 0), 925.47);
});

test("lo que queda fuera del cotejo se informa, no se descarta", () => {
  const r = parseReporteConsolidado(INFORME(["Efectivo Brink", "Crédito", "Faltante"], [9997, 896.75, 0.75]));
  const et = (r.sinMapear || []).map(c => c.etiqueta);
  // El efectivo ya no es "sin cotejar": se coteja por dia contra Caja General en el Paso 1.
  if (et.indexOf("Efectivo Brink") >= 0) throw new Error("el efectivo se coteja, no va a sin cotejar");
  cerca((r.efectivo || []).reduce(function(a, e){ return a + e.monto; }, 0), 9997, "el efectivo viaja por dia");
  if (et.indexOf("Crédito") < 0) throw new Error("el crédito también");
  if (et.some(x => /Faltante/i.test(x))) throw new Error("faltante y sobrante se cotejan aparte");
  if (et.some(x => /Fecha|Cajera/i.test(x))) throw new Error("Fecha y Cajera no son métodos de pago");
  cerca(r.sinMapear.find(c => c.etiqueta === "Crédito").total, 896.75);
});

/* ---- Trazabilidad de los reportes ----
   Un papel de trabajo sin período, fecha de emisión ni versión de la herramienta no se puede auditar. Y
   fue lo que impidió distinguir un resumen en tránsito viejo de uno nuevo cuando arrastraba partidas ya
   compensadas. Lo delicado: el resumen es el INSUMO del Paso 0 del mes siguiente, así que la cabecera no
   puede romper su relectura. */
test("la cabecera de trazabilidad trae período, fecha, versión y archivos", () => {
  STATE.periodos = { mesTrabajo: "2026-01", alertas: [] };
  STATE.options = { ventanaDias: 3, tolerancia: 0.01 };
  STATE.files = { diarioCaja: { name: "navegador CAJA GENERAL enero.xlsx" },
                  estStg: { name: "STG estado de cuenta.xls" } };
  const f = filasTraza("Checklist de prueba");
  const plano = f.map(r => (r || []).join(" | ")).join(" ~ ");
  ["Checklist de prueba", "enero 2026", APP_VERSION, "navegador CAJA GENERAL enero.xlsx",
   "STG estado de cuenta.xls", "3 días / B/ 0.01"].forEach(function(t){
    if (plano.indexOf(t) < 0) throw new Error("falta en la cabecera: " + t);
  });
  if (!/[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}/.test(plano)) throw new Error("falta la fecha y hora de emisión");
});

test("la cabecera no rompe la relectura del resumen en tránsito", () => {
  // El Paso 0 del mes siguiente lee este mismo archivo: si la cabecera lo tapara, se rompe el ciclo.
  STATE.periodos = { mesTrabajo: "2026-01", alertas: [] };
  STATE.options = { ventanaDias: 3, tolerancia: 0.01 };
  STATE.files = { diarioCaja: { name: "x.xlsx" } };
  const rows = filasTraza("Partidas en tránsito al cierre");
  rows.push(["Fecha", "Banco", "Monto", "Concepto", "Comprobante", "Motivo"]);
  rows.push(["2025-12-22", "Banistmo", 435.71, "cheque en transito", "ME-00000001817", "pendiente"]);
  rows.push(["2026-01-31", "STG", 246.20, "tarjeta clave", "ME-00000001854", "último día del mes"]);
  const tp = parseTransitoPrevio(rows);
  eq(tp.length, 2, "las dos partidas se releen");
  cerca(tp.reduce((a, b) => a + b.monto, 0), 681.91);
  eq(identificarArchivo(rows), "transitoPrevio", "y se sigue reconociendo el archivo");
  eq(validarArchivoParaCasilla("transitoPrevio", rows), null);
});

test("sin período detectado cae al rango del navegador de Caja General", () => {
  STATE.periodos = null;
  STATE.saldoCajaGeneral = { inicial: 0, final: 0, fechaInicial: "2026-02-01", fechaFinal: "2026-02-28" };
  eq(periodoTrabajo(), "2026-02-01 al 2026-02-28");
  STATE.saldoCajaGeneral = null;
  eq(periodoTrabajo(), "—", "y si no hay nada, no se inventa");
});

/* ---- La búsqueda de combinaciones no puede colgar la pestaña ----
   buscarSubsetSuma es exponencial y cuando el objetivo NO se puede alcanzar recorre todo el espacio.
   Medido antes del tope: 28 partidas con maxN 60 = 268 millones de nodos y 3,7 s, y crece de ahí. Una
   corrida real completa de los 4 pasos consume entre 2.500 y 10.000 nodos. */
test("una búsqueda imposible se corta en vez de colgarse", () => {
  const pool = [];
  for (let i = 0; i < 34; i++) pool.push({ fecha: "2026-01-15", monto: Math.round((10 + i * 0.37) * 100) / 100, usado: false });
  const suma = pool.reduce((a, b) => a + b.monto, 0);
  subsetTruncado = 0;
  const t = Date.now();
  const r = buscarSubsetSuma(pool, "2026-01-15", suma + 0.5, 366, 0.01, 60);
  const ms = Date.now() - t;
  eq(r, null, "no hay combinación posible");
  if (ms > 1000) throw new Error("tardó " + ms + " ms: el tope no está actuando");
  eq(subsetTruncado, 1, "y queda registrado que se cortó");
});

test("una búsqueda que sí cuadra no se ve afectada por el tope", () => {
  const pool = [{ fecha: "2026-01-02", monto: 60.41, usado: false },
                { fecha: "2026-01-02", monto: 32.56, usado: false },
                { fecha: "2026-01-05", monto: 40.00, usado: false }];
  subsetTruncado = 0;
  const r = buscarSubsetSuma(pool, "2025-12-29", 92.97, 366, 0.01, 3);
  eq(r.length, 2);
  eq(subsetTruncado, 0, "no se cortó nada");
});

// Un corte silencioso se leería como "no compensa" y mandaría al mes siguiente una partida que sí
// cuadraba. El aviso lo agrega computePasoResult leyendo la señal que deja la búsqueda.
test("un paso que corta una búsqueda deja la señal para el aviso", () => {
  const est = [];
  for (let i = 0; i < 34; i++) est.push({ fecha: "2026-01-15", debito: 0, credito: Math.round((10 + i * 0.37) * 100) / 100, descripcion: "Remisión V/Mc", fila: i });
  const diario = [{ fecha: "2026-01-31", debito: 99999.99, credito: 0, descripcion: "DEPOSITOS POR TARJETA VISA STG DEL 1 AL 31 DE ENERO 2026.", referencia: "ME-1", fila: 90 }];
  subsetTruncado = 0;
  const t = Date.now();
  paso3(diario, [], est, [], null, null, 3, 0.01, null, null);
  if (Date.now() - t > 2000) throw new Error("el paso tardó demasiado: el tope no actuó");
  if (!subsetTruncado) throw new Error("tiene que quedar registrado que la búsqueda se cortó");
});

test("poolDelMetodo lee el campo de ambos pasos", () => {
  // El Paso 2 arma su pool con "desc" y el Paso 3 con "descripcion".
  const p2 = [{ desc: "Remisión V/Mc 016005605", monto: 100 }, { desc: "DEPOSITO", monto: 50 }];
  const p3 = [{ descripcion: "Remisión V/Mc 016005605", monto: 100 }, { descripcion: "DEPOSITO", monto: 50 }];
  eq(poolDelMetodo(p2, "DEPOSITOS POR TARJETA VISA STG").length, 1);
  eq(poolDelMetodo(p3, "DEPOSITOS POR TARJETA VISA STG").length, 1);
  eq(poolDelMetodo(p3, "DEPOSITO BRINKS"), null, "sin método reconocido no se restringe");
  eq(poolDelMetodo([{ descripcion: "DEPOSITO", monto: 5 }], "TARJETA VISA"), null,
     "si el método no deja ninguna línea, mejor buscar en todo que no buscar");
});

/* ---- Celdas de importe que no se pueden leer ----
   money() devolvía 0 ante cualquier cosa que no entendiera. Probado sobre enero: corromper la celda del
   crédito de 1,341.20 dejaba el cierre en CERO diferencias y mandaba esa partida al resumen del mes
   siguiente como si nunca hubiera compensado — sin una sola señal. */
test("los formatos válidos se siguen leyendo igual", () => {
  ilegiblesN = 0;
  [["B/ 1,234.56", 1234.56], ["(500.00)", -500], ["-500", -500], ["20,00", 20], ["1,234", 1234],
   ["$100", 100], ["0", 0], ["", 0], ["   ", 0], [null, 0], [42, 42], [".5", 0.5], ["5.", 5],
   ["-B/ 2,469.06", -2469.06], ["B/ 0.00", 0]].forEach(function(p){
    cerca(money(p[0]), p[1], "money(" + JSON.stringify(p[0]) + ")");
  });
  eq(ilegiblesN, 0, "ninguno de estos es ilegible");
});

test("el texto que no es un importe se registra en vez de valer cero en silencio", () => {
  ["#REF!", "N/A", "12ABC", "sin dato", "-", "500 USD", "1.2.3"].forEach(function(v){
    ilegiblesN = 0;
    eq(money(v), 0, "devuelve 0 para no romper las sumas");
    eq(ilegiblesN, 1, "pero queda registrado: " + v);
  });
});

test("una celda ilegible queda registrada al leer el archivo", () => {
  ilegiblesN = 0; ilegiblesVals = [];
  const movs = parseEstadoCuenta([["Fecha", "Descripción", "Débito", "Crédito", "Saldo"],
                                  ["2026-01-02", "CR REMISION - V/MC", "0", "#REF!", "100"]], "banistmo");
  eq(movs.length, 1);
  cerca(movs[0].credito, 0, "se toma como cero para no romper las sumas");
  eq(ilegiblesN, 1, "pero queda la señal para que el paso lo avise");
  eq(ilegiblesVals[0], "#REF!", "con el valor, para poder buscarlo en el Excel");
});

// Caso real: el informe de febrero trae "273.49-255.60-164.08-292.62" escrito en la celda de Cheque del
// 12-feb. Se leía como 0 y por eso el reporte no cuadraba contra el diario — era la causa de las tres
// diferencias que se cancelaban entre sí.
test("un desglose escrito a mano en la celda de importe se detecta", () => {
  ilegiblesN = 0; ilegiblesVals = [];
  eq(money("273.49-255.60-164.08-292.62"), 0);
  eq(ilegiblesN, 1);
});

test("la tolerancia máxima es 0.03", () => {
  eq(TOLERANCIA_MAX, 0.03);
});

/* ---- El saldo de Caja General tiene que SER el tránsito que sigue DENTRO de la cuenta ----
   Una sola vara para las dos puntas del mes: la misma que usa el cuadre de apertura del mes siguiente. Lo que
   se acreditó el día del depósito (cheques, Brinks, y todo lo que el Paso 2 ve como crédito de Caja General)
   viaja en el resumen para que el banco lo confirme, pero YA SALIÓ de la cuenta y no suma al saldo. Cerrar el
   mes con el total del resumen deja la apertura del mes siguiente descuadrada por esa diferencia — le pasó a
   febrero de 2026, que abrió en 6,755.43 con 2,650.04 adentro. */
test("cuando el saldo iguala al tránsito que sigue dentro de la cuenta, el control da verde", () => {
  STATE.transitoPrevio = null; STATE.diarioCaja = null;
  STATE.saldoCajaGeneral = { inicial: 2650.04, final: 2650.04, fechaFinal: "2026-01-31" };
  STATE.results = {
    paso0: [{ clase: "en_transito", motivo: "aún pendiente", banco: "Banistmo", fecha: "2025-12-22", monto: 2650.04, concepto: "cheque", texto: "x" }],
    paso2: [{ clase: "en_transito", motivo: "último día del mes", banco: "STG", fecha: "2026-01-31", monto: 1571.10, concepto: "tarjeta", texto: "x" }]
  };
  const h = desgloseSaldoCajaHtml();
  if (h.indexOf("Coincide") < 0) throw new Error("debería dar verde");
  if (h.indexOf("Qué falta para que cuadre") >= 0) throw new Error("no debería pedir asientos");
  if (h.indexOf("no lo sumes al cerrar") < 0) throw new Error("tiene que decir que lo ya acreditado no suma al saldo");
  // Cerrar con el total del resumen (2,650.04 + 1,571.10) ya NO da verde: es lo que descuadraba la apertura.
  STATE.saldoCajaGeneral = { inicial: 2650.04, final: 4221.14, fechaFinal: "2026-01-31" };
  const h2 = desgloseSaldoCajaHtml();
  if (h2.indexOf("Coincide") >= 0) throw new Error("el total del resumen no es el saldo de la cuenta");
});

test("cuando no coincide, dice de qué se compone la diferencia", () => {
  // apertura efectiva = Balance Inicial (−2,469.06) + ajuste ME-00000002023 (18,123.07) = 15,654.01
  STATE.transitoPrevio = null; STATE.diarioCaja = null;
  STATE.saldoCajaGeneral = { inicial: 15654.01, final: 18191.26, fechaFinal: "2026-01-31" };
  STATE.results = {
    paso0: [
      { clase: "en_transito", motivo: "compensó — venía del mes anterior", banco: "STG", fecha: "2026-01-02", monto: 13003.97, concepto: "deposito", texto: "x" },
      { clase: "en_transito", motivo: "aún pendiente", banco: "Banistmo", fecha: "2025-12-22", monto: 2650.04, concepto: "cheque", texto: "x" }
    ],
    paso2: [{ clase: "en_transito", motivo: "último día del mes", banco: "STG", fecha: "2026-01-31", monto: 1571.10, concepto: "tarjeta", texto: "x" }],
    paso3: [{ clase: "en_transito", motivo: "depósito de fin de mes", banco: "STG", fecha: "2026-01-28", monto: 1354.25, concepto: "DEPOSITO BRINKS", texto: "x" }]
  };
  const d = desgloseSaldoCaja();
  cerca(d.totalResumen, 5575.39, "el tránsito completo");
  cerca(d.compenso, 13003.97);
  cerca(d.soloBanco, 2925.35, "lo que ya salió de Caja General pero el banco no reflejó");
  cerca(d.resto, 2537.25, "resto del movimiento (retenciones y tarjeta de fin de mes)");
  // Los tres componentes explican la diferencia al centavo.
  cerca(d.final - d.compenso + d.soloBanco - d.resto, d.totalResumen, "el puente cierra");
  const h = desgloseSaldoCajaHtml();
  if (h.indexOf("Coincide") >= 0) throw new Error("no debería dar verde");
  ["13,003.97", "2,925.35", "2,537.25", "Qué falta para que cuadre"].forEach(function(t){
    if (h.indexOf(t) < 0) throw new Error("falta en el desglose: " + t);
  });
  // Lo ya acreditado se muestra aparte, no como componente de la diferencia.
  if (h.indexOf("Aparte: en tránsito pero ya acreditado") < 0) throw new Error("tiene que ir aparte");
  // La diferencia es contra lo que sigue DENTRO de la cuenta (2,650.04), no contra el resumen completo.
  // La diferencia se compone de lo que compensó y falta descargar, el arrastre y el residuo: lo ya
  // acreditado quedó fuera porque nunca estuvo en el saldo.
  cerca(d.final - d.transito, d.compenso + d.arrastre + d.resto, "la diferencia usa la misma vara que la apertura del mes siguiente");
});

test("el detalle lista las partidas que ya salieron de Caja General", () => {
  // Mismo estado que la prueba anterior: el tránsito del Paso 3 no está en Caja General.
  STATE.estados = null; STATE.retVisaDetalle = null;
  const ya = partidasYaAcreditadas();
  if (ya.length !== 2) throw new Error("esperaba dos partidas, hubo " + ya.length);
  cerca(Math.round(ya.reduce(function(a,x){ return a+x.monto; },0)*100)/100, 2925.35);
  const h = desgloseSaldoCajaHtml();
  if (h.indexOf("DEPOSITO BRINKS") < 0) throw new Error("la tabla no muestra el concepto");
});

test("un cargo de ITBMS sobre comisión no se cuenta como comisión", () => {
  STATE.saldoCajaGeneral = { inicial: 0, final: 0, fechaFinal: "2026-01-31" };
  STATE.estados = { Banistmo: [
    { fecha: "2026-01-15", debito: 100, credito: 0, descripcion: "COMISION V/MC ESTABLECIMIENTO AFILIADO" },
    { fecha: "2026-01-15", debito: 7, credito: 0, descripcion: "ITBMS SOBRE COMISION V/MC" },
    { fecha: "2026-01-20", debito: 50, credito: 0, descripcion: "RETENCION ITBMS V/MC" },
    { fecha: "2026-02-02", debito: 999, credito: 0, descripcion: "COMISION V/MC" }   // fuera del mes
  ] };
  const cg = cargosTarjetaPorBanco();
  cerca(cg[0].porTipo["Comisión"], 100);
  cerca(cg[0].porTipo["ITBMS"], 7);
  cerca(cg[0].total, 157, "no arrastra los días del mes siguiente");
  STATE.estados = null;
});

test("el reporte de Caja General se puede imprimir solo", () => {
  STATE.saldoCajaGeneral = { inicial: 0, final: 100, fechaFinal: "2026-01-31" };
  STATE.results = { paso2: [{ clase: "en_transito", motivo: "x", banco: "STG", fecha: "2026-01-31", monto: 100, concepto: "t", texto: "x" }] };
  const h = desgloseSaldoCajaHtml();
  // El botón necesita el id del recuadro: sin él, el CSS de impresión no sabe qué dejar visible.
  if (h.indexOf("id=\"cgReporte\"") < 0) throw new Error("falta el id del recuadro");
  if (h.indexOf("id=\"btnPrintCG\"") < 0) throw new Error("falta el botón de imprimir");
  // En el papel el reporte va solo, así que lleva su propio encabezado y su pie de trazabilidad.
  // Al pie ya no van los archivos usados sino los asientos que quedan por registrar: la traza del
  // periodo va en el encabezado de la hoja y el checklist del modulo la repite entera.
  if (h.indexOf("cg-pie-as") < 0) throw new Error("falta el bloque de asientos por registrar");
});

test("el panel de períodos cierra su propio recuadro", () => {
  // Comparte el nombre de variable con otros armadores de HTML: si se le cuela el cierre de otro panel,
  // el aviso de archivos de otro mes se rompe justo cuando más importa.
  const h = periodosHtml({ mesTrabajo: "2026-01", archivos: 3, alertas: [
    { clase: "ajeno", nombre: "Estado Banistmo", archivo: "BANISTMO.xlsx", periodo: { desde: "2025-07-01", hasta: "2025-07-31" } }
  ]});
  if (h.indexOf("per-panel") < 0) throw new Error("no armó el panel");
  if (h.indexOf("cg-solo-pie") >= 0) throw new Error("se le coló el pie del reporte de Caja General");
  const abre = (h.match(/<div/g)||[]).length, cierra = (h.match(/<\/div>/g)||[]).length;
  if (abre !== cierra) throw new Error("quedan " + (abre-cierra) + " div sin cerrar");
});

test("el descargo del tránsito del mes anterior no se cuenta como diferencia", () => {
  // Febrero 2026: un solo crédito de 1,354.25 a STG el 28-feb descarga los cinco depósitos que quedaron
  // en tránsito de enero. La cajera reportó esa venta en ENERO, así que el reporte de febrero no la trae.
  const diario = [{ fecha: "2026-02-28", debito: 0, credito: 1354.25, descripcion: "DESCARGO DEL DEPOSITO STG EN TRANSITO DE ENERO", referencia: "ME-00000001896", fila: 90 }];
  const transito = [
    { fecha: "2026-01-28", banco: "STG", monto: 405.00, concepto: "DEPOSITO BRINKS DEL 28/01/2026", sentido: "credito" },
    { fecha: "2026-01-29", banco: "STG", monto: 195.00, concepto: "DEPOSITO BRINKS DEL 29/01/2026", sentido: "credito" },
    { fecha: "2026-01-30", banco: "STG", monto: 751.00, concepto: "DEPOSITO BRINKS DEL 30/01/2026", sentido: "credito" },
    { fecha: "2026-01-30", banco: "STG", monto: 1.30, concepto: "DEPOSITO DEL 30/01/2026", sentido: "credito" },
    { fecha: "2026-01-31", banco: "STG", monto: 1.95, concepto: "DEPOSITO DEL 31/01/2026", sentido: "credito" }
  ];
  const sin = paso1([], diario, null, 0.01, [], "2026-02-01", null);
  eq(contarRojas(sin), 1, "sin el tránsito previo sale como diferencia");
  const con = paso1([], diario, null, 0.01, [], "2026-02-01", transito);
  eq(contarRojas(con), 0, "con el tránsito previo deja de ser diferencia");
  // La exclusión se lista: sacarla en silencio haría parecer que ese crédito nunca existió.
  const inf = con.filter(x => x.clase === "informativo" && /Descargo del tránsito/.test(x.texto));
  eq(inf.length, 1, "falta el informativo del descargo");
  if (inf[0].texto.indexOf("5 partida(s)") < 0) throw new Error("no dice cuántas partidas descarga");
  if (inf[0].texto.indexOf("ME-00000001896") < 0) throw new Error("no cita el comprobante");
});

test("un depósito que el reporte de cajeras sí respalda no se toma por descargo", () => {
  // Mismo importe que una partida en tránsito, pero la cajera lo reportó ESTE mes: es venta del mes y
  // tiene que seguir cotejándose. Sin esta condición el cotejo se borraría solo por coincidir el monto.
  const reporte = [{ fecha: "2026-02-10", banco: "STG", metodo: "CLAVE", monto: 405.00, cajera: "A" }];
  const diario = [{ fecha: "2026-02-10", debito: 0, credito: 405.00, descripcion: "DEPOSITO POR TARJETA CLAVE STG DEL 10/02/2026", referencia: "ME-2", fila: 5 }];
  const transito = [{ fecha: "2026-01-28", banco: "STG", monto: 405.00, concepto: "DEPOSITO BRINKS DEL 28/01/2026", sentido: "credito" }];
  const h = paso1(reporte, diario, null, 0.01, [], "2026-02-01", transito);
  eq(contarRojas(h), 0, "el día cuadra");
  eq(h.filter(x => /Descargo del tránsito/.test(x.texto || "")).length, 0, "no debía tomarlo por descargo");
});

test("el estado de Banco General se lee con una sola columna Monto con signo", () => {
  // Banco General cambió el formato entre enero y febrero de 2026: antes Débito/Crédito, ahora un solo
  // "Monto" firmado. Sin esto el archivo de febrero no se leía y se caía la conciliación entera.
  const rows = [
    ["Numero de Cuenta:03-30-00-000067-9"],
    ["Movimientos desde 01-feb-2026 hasta 28-feb-2026"],
    ["Fecha", "Referencia", "Descripción", "Monto", "Saldo total"],
    ["2026-02-28", "305", "COMISION MENSUAL POR SERVICIO BANCA EN LINEA", -5.35, 978.60],
    ["2026-02-20", "410", "DEPOSITO YAPPY", 120.50, 983.95]
  ];
  const e = parseEstadoCuenta(rows, "bancogeneral");
  eq(e.length, 2);
  cerca(e[0].debito, 5.35, "el monto negativo es un débito");
  cerca(e[0].credito, 0);
  cerca(e[1].credito, 120.50, "el positivo es un crédito");
  cerca(e[1].debito, 0);
});

test("el estado de Banco General con columna Monto se acepta al subirlo", () => {
  // El parser ya leía el formato nuevo, pero el validador de subida no lo reconocía y lo rechazaba con
  // "Archivo equivocado" antes de llegar a leerlo. Las dos puertas tienen que conocer el mismo formato.
  const rows = [
    ["Numero de Cuenta:03-30-00-000067-9"],
    ["Fecha", "Referencia", "Descripción", "Monto", "Saldo total"],
    ["2026-02-28", "305", "COMISION MENSUAL POR SERVICIO BANCA EN LINEA", -5.35, 978.60]
  ];
  eq(identificarArchivo(rows), "estado");
  eq(bancoDeEstado(rows), "bancogeneral");
  eq(validarArchivoParaCasilla("estBancoGeneral", rows), null, "no debería alertar");
  // Y en la casilla que no le toca sigue alertando.
  if (!validarArchivoParaCasilla("estStg", rows)) throw new Error("debería alertar en la casilla de STG");
});

test("la ventana de días se mide en días hábiles del banco, no de calendario", () => {
  // Febrero 2026: el banco no tuvo un solo movimiento el 15, 16 ni 17 (domingo y los dos días de
  // carnaval). Los depósitos CLAVE de STG del 13 y el 14 compensaron el 18 y con la ventana de 3 días de
  // calendario salían como diferencia aunque estuvieran cotejados.
  const filas = [["Fecha", "Descripcion", "Debitos", "Creditos", "Balance"]];
  ["02","03","04","05","06","09","10","11","12","13","14","18","19","20","23"].forEach(function(d){
    filas.push(["2026-02-" + d, "MOVIMIENTO", 0, 10, 100]);
  });
  fijarCalendarioBancario({ estStg: filas });
  eq(distanciaBancaria("2026-02-13", "2026-02-18"), 2, "del 13 al 18 hay 2 días hábiles");
  eq(distanciaBancaria("2026-02-14", "2026-02-18"), 1);
  eq(distanciaBancaria("2026-02-12", "2026-02-13"), 1, "días seguidos siguen a distancia 1");
  eq(daysBetween("2026-02-13", "2026-02-18"), 5, "el calendario no cambia");
  // Fuera del período que cubren los estados no se descuenta nada: ahí no sabemos si el banco cerró o
  // si el archivo simplemente no llega hasta esa fecha.
  eq(distanciaBancaria("2026-03-10", "2026-03-15"), 5, "fuera del rango, días de calendario");
  CAL_BANCARIO = null;
});

test("un estado de cuenta de pocas líneas no arma calendario bancario", () => {
  // El de Banco General trae una sola línea al mes. Si eso definiera los días hábiles, todo el resto del
  // mes contaría como inhábil y la ventana se volvería infinita.
  fijarCalendarioBancario({ estBancoGeneral: [
    ["Fecha", "Referencia", "Descripción", "Monto", "Saldo total"],
    ["2026-02-28", "305", "COMISION MENSUAL", -5.35, 978.60]
  ]});
  eq(CAL_BANCARIO, null, "no debería armarlo con tan pocos días");
  eq(distanciaBancaria("2026-02-13", "2026-02-18"), 5, "sin calendario, días de calendario");
});

test("la ventana por defecto es de 7 dias habiles", () => {
  // 7 dias habiles del banco cubren el rezago real de acreditacion. Bajarla vuelve a cortar cotejos
  // legitimos cuando cae un feriado largo; subirla sin medir arriesga emparejar partidas ajenas.
  // Se lee del fuente y no de STATE: otras pruebas le cambian las opciones al vuelo.
  const m = html.match(/options:\{ ventanaDias:(\d+)/);
  if (!m) throw new Error("no se encontró el valor por defecto en el fuente");
  eq(parseInt(m[1], 10), 7);
});

test("el aviso de celda ilegible dice archivo, hoja, celda, fila y columna", () => {
  // Caso real: en el informe de febrero alguien escribió los cuatro cheques del día seguidos en la celda
  // del método. "Buscalo en el Excel" no alcanza: el informe tiene 30 columnas y dos filas de encabezado.
  const filas = [];
  filas[5] = [null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,"CHEQUE"];
  filas[6] = ["Fecha","Empresa","Cajera",null,null,null,null,null,null,null,null,null,null,null,null,"Cheque\nSr.George","Cheque\nBanistmo"];
  filas[18] = ["2026-02-12","PETTY SHOP","DARITZA",80,null,null,null,null,null,null,null,null,null,null,null,0,"273.49-255.60-164.08-292.62"];
  const libro = filas; libro.hojas = { "FEBRERO ": filas };
  STATE.files = { reporte: { name: "resumen de caja febrero petty.xlsx" } };
  const u = ubicarIlegible({ reporte: libro }, "273.49-255.60-164.08-292.62");
  if (!u) throw new Error("no encontró la celda");
  eq(u.celda, "Q19", "columna 17 = Q, fila 19");
  eq(u.hoja, "FEBRERO ");
  eq(u.fecha, "2026-02-12");
  eq(u.columna, "Cheque / Banistmo", "el encabezado viene en dos renglones");
  eq(u.quien, "Cajera DARITZA");
  const t = textoUbicacion(u);
  ["resumen de caja febrero petty.xlsx", "hoja FEBRERO", "celda Q19", "Cheque / Banistmo"].forEach(function(x){
    if (t.indexOf(x) < 0) throw new Error("falta en el texto: " + x);
  });
  // Un valor que no está en ningún libro no revienta: el aviso sale igual, sin ubicación.
  eq(ubicarIlegible({ reporte: libro }, "no existe"), null);
  eq(textoUbicacion(null), "");
  STATE.files = {};
});

test("el valor ilegible se guarda completo, no recortado", () => {
  // Se recortaba a 24 caracteres y así no se podía volver a buscar la celda en el libro.
  ilegiblesN = 0; ilegiblesVals = [];
  money("273.49-255.60-164.08-292.62");
  eq(ilegiblesN, 1);
  eq(ilegiblesVals[0], "273.49-255.60-164.08-292.62");
  ilegiblesN = 0; ilegiblesVals = [];
});

test("los pasos recogidos se recuerdan entre sesiones", () => {
  // La lista se vuelve a dibujar entera con cada tilde de "corregido": sin guardar el estado, cada clic
  // desplegaria de nuevo todo lo que se habia recogido.
  Object.keys(PLEGADOS).forEach(function(k){ delete PLEGADOS[k]; });
  plegarPaso("paso2", true);
  eq(PLEGADOS.paso2, true);
  eq(leerPrefs().plegados.paso2, true, "tiene que quedar en las preferencias");
  plegarPaso("paso2", false);
  eq(PLEGADOS.paso2, undefined, "al desplegar se borra la clave, no queda en false");
  eq(leerPrefs().plegados.paso2, undefined);
});

test("el reporte de Caja General se puede imprimir aunque la conciliación no cierre", () => {
  // El botón Imprimir vivía dentro del bloque de cierre, que solo se dibuja cuando los Pasos 1 y 2
  // cuadran: justo cuando el papel de trabajo hace más falta, no había con qué sacarlo.
  STATE.saldoCajaGeneral = { inicial: 0, final: 100, fechaFinal: "2026-02-28" };
  STATE.results = {
    paso2: [{ clase: "en_transito", motivo: "x", banco: "STG", fecha: "2026-02-28", monto: 100, concepto: "t", texto: "x" }],
    paso3: [{ clase: "diff", banco: "Banistmo", fecha: "2026-02-02", monto: 230.31, texto: "una diferencia abierta" }]
  };
  eq(rojasAbiertas(), 1);
  const h = desgloseSaldoCajaHtml();
  if (h.indexOf("btnPrintCG") < 0) throw new Error("falta el botón de imprimir");
  // Y el papel tiene que decir que salió con diferencias abiertas: si no, se archiva un cuadre que no cerró.
  if (h.indexOf("cg-prov") < 0) throw new Error("no avisa que las cifras son provisionales");
  if (h.indexOf("1 diferencia(s) sin resolver al emitir") < 0) throw new Error("el encabezado de la hoja no lo dice");
});

test("si no se puede leer el Balance Final, el panel lo dice en vez de desaparecer", () => {
  // Desaparecía sin explicación y parecía que el botón de imprimir se había roto.
  STATE.saldoCajaGeneral = { inicial: 5575.39, final: null, fechaFinal: null };
  STATE.results = {};
  const h = desgloseSaldoCajaHtml();
  if (h.indexOf("Balance Final") < 0) throw new Error("debería explicar por qué no se puede calcular");
  // Sin navegador de Caja General no hay nada que comparar: ahí sí va vacío.
  STATE.saldoCajaGeneral = null;
  eq(desgloseSaldoCajaHtml(), "");
});

test("un depósito consolidado que aún no compensa queda en tránsito, no en rojo", () => {
  // Febrero 2026: el asiento del 27-feb registra 2,108.52 bajo la etiqueta VISA, pero es el total del día
  // (VISA 1,124.69 + CLAVE 983.83). El banco lo acreditó en marzo. Registrar el total sumado no es un
  // error: mientras el informe respalde el importe y el banco no haya acreditado nada, es tránsito.
  const cg = [{ fecha: "2026-02-27", debito: 0, credito: 2108.52, referencia: "ME-00000001876",
                descripcion: "DEPOSITO POR TARJETA VISA BANISTMO DEL 27/02/2026", fila: 80 }];
  const reporte = [
    { fecha: "2026-02-27", banco: "Banistmo", metodo: "VISA", monto: 1124.69, cajera: "A" },
    { fecha: "2026-02-27", banco: "Banistmo", metodo: "CLAVE", monto: 983.83, cajera: "A" }
  ];
  const estVacio = [{ fecha: "2026-02-20", descripcion: "DEPOSITO", debito: 0, credito: 50, fila: 2 }];
  const h = paso2(cg, estVacio, [], null, null, null, 7, 0.01, reporte, null);
  eq(contarRojas(h), 0, "no es una diferencia");
  const t = h.filter(function(x){ return x.clase === "en_transito"; });
  eq(t.length, 1);
  cerca(t[0].monto, 2108.52);
  if (t[0].texto.indexOf("VISA B/ 1,124.69 + CLAVE B/ 983.83") < 0) throw new Error("no muestra el desglose");

  // Pero si el banco YA acreditó una de las dos partidas y la otra no, media compensación no es un corte
  // de mes limpio: eso sigue siendo una diferencia que hay que mirar.
  const estMitad = [{ fecha: "2026-02-27", descripcion: "CR REMISION - V/MC", debito: 0, credito: 1124.69, fila: 2 }];
  const h2 = paso2(cg, estMitad, [], null, null, null, 7, 0.01, reporte, null);
  eq(contarRojas(h2), 1, "compensó solo una parte: hay que revisarla");
});

/* ---- Descargos del transito previo en los Pasos 2 y 3 ---- */
const TR_DESC = [{ fecha: "2026-01-28", banco: "STG", monto: 405.00, concepto: "DEPOSITO BRINKS", sentido: "credito" }];
const EST_DESC = [{ fecha: "2026-02-02", descripcion: "Ach De Brinks Panama, S.A.", debito: 0, credito: 405.00, fila: 2 }];

test("Paso 2: el asiento que descarga transito compensado no es un deposito nuevo", () => {
  // Febrero 2026: el ME-1896 descargaba el efectivo de enero (ya compensado el 02-feb) y salia como
  // "en transito" otra vez, inflando el resumen. La linea del estado la consume el Paso 0, asi que el
  // cotejo normal no la encuentra: hay que reconocerlo contra el transito previo compensado.
  const cg = [{ fecha: "2026-02-28", debito: 0, credito: 405.00, descripcion: "DEPOSITO EFECTIVO STG PENDIENTE DE ENERO", referencia: "ME-9", fila: 5 }];
  const h = paso2(cg, [], EST_DESC.map(function(x){ return Object.assign({}, x); }), null, null, null, 7, 0.01, null, TR_DESC);
  eq(h.filter(esEnTransito).length, 0, "no debe quedar en transito");
  const inf = h.filter(function(x){ return x.clase === "informativo" && /Descargo/.test(x.concepto || ""); });
  eq(inf.length, 1, "falta el informativo del descargo");
  cerca(inf[0].monto, 405.00);
});

test("Paso 2: sin compensacion y sin etiqueta, el mismo importe NO es descargo", () => {
  // La partida sigue pendiente en el banco: un deposito nuevo que coincida por casualidad debe seguir
  // su camino normal (en transito de fin de mes), no borrarse como descargo.
  const cg = [{ fecha: "2026-02-28", debito: 0, credito: 405.00, descripcion: "DEPOSITO POR TARJETA CLAVE STG DEL 28/02/2026", referencia: "ME-9", fila: 5 }];
  const h = paso2(cg, [], [], null, null, null, 7, 0.01, null, TR_DESC);
  eq(h.filter(function(x){ return x.clase === "informativo" && /Descargo/.test(x.concepto || ""); }).length, 0);
  eq(h.filter(esEnTransito).length, 1, "queda en transito, como corresponde");
});

test("Paso 2: la etiqueta DESCARGO matchea directo, y sin correspondencia avisa", () => {
  // Con la palabra DESCARGO la intencion es explicita: se acepta contra cualquier partida del transito
  // previo aunque el estado no muestre la compensacion (p.ej. estado aun no exportado).
  const cg = [{ fecha: "2026-02-15", debito: 0, credito: 405.00, descripcion: "DESCARGO TRANSITO ENERO STG", referencia: "ME-9", fila: 5 }];
  const h = paso2(cg, [], [], null, null, null, 7, 0.01, null, TR_DESC);
  eq(h.filter(function(x){ return x.clase === "informativo" && /Descargo/.test(x.concepto || ""); }).length, 1);
  // Y si dice DESCARGO pero el importe no corresponde a nada, se avisa en vez de callar.
  const cg2 = [{ fecha: "2026-02-15", debito: 0, credito: 999.99, descripcion: "DESCARGO TRANSITO ENERO STG", referencia: "ME-9", fila: 5 }];
  const h2 = paso2(cg2, [], [], null, null, null, 7, 0.01, null, TR_DESC);
  const av = h2.filter(function(x){ return x.clase === "aviso" && /correspondencia/.test(x.concepto || ""); });
  eq(av.length, 1, "falta el aviso de DESCARGO sin correspondencia");
});

test("Paso 3: el debito del navegador que descarga transito compensado no queda en transito", () => {
  // El mismo asiento visto del lado del banco (debito al banco). Camino sin CK (conciliarBancoEstado)...
  const dStg = [{ fecha: "2026-02-05", debito: 405.00, credito: 0, descripcion: "DESCARGO TRANSITO ENERO", referencia: "ME-9", fila: 4 }];
  const h = paso3([], dStg, [], EST_DESC.map(function(x){ return Object.assign({}, x); }), null, null, 7, 0.01, null, TR_DESC);
  eq(contarRojas(h), 0);
  eq(h.filter(esEnTransito).length, 0, "no debe quedar en transito");
  eq(h.filter(function(x){ return x.clase === "informativo" && /Descargo/.test(x.concepto || ""); }).length, 1);
  // ...y camino con concepto de cheque (pasa por la conciliacion de cheques): el ME-1855 de febrero.
  const dB = [{ fecha: "2026-02-05", debito: 405.00, credito: 0, descripcion: "DESCARGO DE CK DE ENERO", referencia: "ME-9", fila: 4 }];
  const trB = [{ fecha: "2026-01-28", banco: "Banistmo", monto: 405.00, concepto: "cheque en transito", sentido: "credito" }];
  const estB = [{ fecha: "2026-02-02", descripcion: "DEPOSITO", debito: 0, credito: 405.00, fila: 2 }];
  const h2 = paso3(dB, [], estB, [], null, null, 7, 0.01, null, trB);
  eq(h2.filter(esEnTransito).length, 0, "el cheque-descargo tampoco queda en transito");
  eq(h2.filter(function(x){ return x.clase === "informativo" && /Descargo/.test(x.concepto || ""); }).length, 1);
});

test("la misma partida con fechas distintas en dos pasos se cuenta una sola vez", () => {
  // El Paso 2 usa la fecha del reporte (cheque recibido el 11-feb) y el Paso 3 la del asiento (digitado
  // el 12-feb): con fecha exacta se contaba dos veces. La ventana de dias del cotejo lo resuelve.
  STATE.options = { ventanaDias: 7, tolerancia: 0.01 };
  STATE.results = {
    paso2: [{ clase: "en_transito", motivo: "cheque pendiente por cambiar", banco: "Banistmo", fecha: "2026-02-11", monto: 273.49, concepto: "Cheque (detalle individual)", texto: "x" }],
    paso3: [{ clase: "en_transito", motivo: "cheque pendiente por cambiar", banco: "Banistmo", fecha: "2026-02-12", monto: 273.49, concepto: "DEPOSITO DE BANISTMO CK 12/02/2026", texto: "x" }]
  };
  eq(recolectarEnTransito().length, 1, "es la misma plata");
  cerca(transitoPorMetodo().total, 273.49);
});

test("el renglon de apertura sale de sus partidas, no de una resta", () => {
  // Calculado como apertura - pendiente - descargado, el renglon absorbia cualquier descuadre de la
  // apertura y lo presentaba como plata por descargar: en junio de 2026 pedia un asiento de 14,463.12
  // cuando las partidas que de verdad habian compensado sumaban 1,307.78. Ahora sale de las partidas, y
  // el detalle cuadra con el total por construccion.
  STATE.transitoPrevio = null; STATE.diarioCaja = null; STATE.chequesDetalle = null;
  STATE.estados = null; STATE.retVisaDetalle = null;
  // Apertura de 9,000 contra un transito previo de 750: un descuadre enorme, que NO es plata por descargar.
  STATE.saldoCajaGeneral = { inicial: 9000, final: 600, fechaFinal: "2026-02-28" };
  const inf = { clase: "informativo", concepto: "Descargo de transito", banco: "STG", fecha: "2026-02-10", monto: 350,
                partidas: [{ banco: "STG", fecha: "2026-01-20", monto: 350, concepto: "deposito" }], texto: "x" };
  STATE.results = {
    paso0: [
      { clase: "en_transito", motivo: "compensó — venía del mes anterior", banco: "STG", fecha: "2026-02-05", monto: 350, concepto: "deposito", texto: "x" },
      { clase: "en_transito", motivo: "compensó — venía del mes anterior", banco: "STG", fecha: "2026-02-06", monto: 120, concepto: "deposito", texto: "x" },
      { clase: "en_transito", motivo: "aún pendiente", banco: "STG", fecha: "2026-01-25", monto: 400, concepto: "deposito", texto: "x" }
    ],
    paso1: [inf],
    paso3: [Object.assign({}, inf)]
  };
  // El mismo descargo lo ven dos pasos: se cuenta una sola vez.
  cerca(totalDescargado(), 350, "un solo asiento, aunque lo vean dos pasos");
  const ap = partidasApertura();
  eq(ap.length, 1, "de las dos compensadas, una ya tiene descargo");
  cerca(ap[0].monto, 120);
  const d = desgloseSaldoCaja();
  cerca(d.compenso, 120, "solo lo que compenso y sigue sin descargar");
  cerca(d.compenso, ap.reduce(function(a,x){ return a+x.monto; },0), "el renglon es la suma de su detalle");
});

test("una remision de tarjeta al arranque del mes es compensacion del mes anterior, no diferencia", () => {
  // Febrero 2026: el 01 fue domingo y el banco arranco el 02. La remision V/MC de 230.31 del 02-feb
  // (ventas de fin de enero, asiento en el diario de enero) salia como roja porque la regla comparaba
  // contra el dia 1 del calendario. Ahora el limite es el primer dia CON MOVIMIENTO, y las remisiones
  // tienen 3 dias habiles de margen (clarean con rezago).
  const est = [
    { fecha: "2026-02-02", descripcion: "CR REMISION - V/MC PAGO DE FACTURACION//01866314", debito: 0, credito: 230.31, fila: 3 },
    { fecha: "2026-02-03", descripcion: "CR REMISION - CLAVE PAGO DE FACTURACION//01866314", debito: 0, credito: 359.71, fila: 4 },
    { fecha: "2026-02-02", descripcion: "DEPOSITO", debito: 0, credito: 500.00, fila: 5 },
    { fecha: "2026-02-10", descripcion: "CR REMISION - V/MC PAGO DE FACTURACION//01866314", debito: 0, credito: 777.77, fila: 6 },
    { fecha: "2026-02-10", descripcion: "MOVIMIENTO RELLENO", debito: 5, credito: 0, fila: 7 }
  ];
  const h = paso3(est.length ? [] : null, [], est, [], null, null, 7, 0.01, null, null);
  const porMonto = function(m){ return h.filter(function(x){ return Math.abs(x.monto - m) < 0.005; })[0]; };
  eq(porMonto(230.31).clase, "en_transito", "remision del primer dia con movimiento");
  eq(porMonto(359.71).clase, "en_transito", "remision al dia siguiente, dentro del margen de rezago");
  if (!/mes anterior/i.test(porMonto(230.31).motivo)) throw new Error("debe contar como entrante del mes anterior");
  eq(porMonto(500.00).clase, "en_transito", "un deposito comun del primer dia con movimiento tambien");
  eq(porMonto(777.77).clase, "diff", "una remision a mitad de mes sigue siendo diferencia real");
  // Y como son ENTRANTES (ya compensaron), no se arrastran al resumen en transito del proximo mes.
  STATE.results = { paso3: h };
  eq(recolectarEnTransito().filter(function(x){ return Math.abs(x.monto-230.31)<0.005; }).length, 0);
});

test("el historial en transito muestra cada partida y marca el arrastre de meses viejos", () => {
  // El motor arrastra sin limite de tiempo, pero el cierre solo mostraba totales por metodo: un cheque
  // de diciembre invisible en pantalla es un deposito omitido que nadie va a notar.
  STATE.periodos = { mesTrabajo: "2026-02" };
  STATE.saldoCajaGeneral = { inicial: 0, final: 100, fechaFinal: "2026-02-28" };
  STATE.transitoPrevio = null; STATE.diarioCaja = null; STATE.chequesDetalle = null;
  STATE.results = { paso0: [
    { clase: "en_transito", motivo: "aún pendiente de compensar", banco: "Banistmo", fecha: "2025-10-15", monto: 500.00, concepto: "cheque en transito", texto: "x" },
    { clase: "en_transito", motivo: "aún pendiente de compensar", banco: "Banistmo", fecha: "2025-12-22", monto: 435.71, concepto: "cheque en transito", texto: "x" }
  ], paso2: [
    { clase: "en_transito", motivo: "último día del mes", banco: "STG", fecha: "2026-02-28", monto: 90.00, concepto: "Cheque (detalle individual)", texto: "x" }
  ]};
  const h = tablaTransitoHtml();
  ["2025-10-15", "2025-12-22", "2026-02-28"].forEach(function(f){
    if (h.indexOf(f) < 0) throw new Error("falta la partida del " + f);
  });
  if (h.indexOf("arrastre de diciembre 2025") < 0) throw new Error("no marca el arrastre de diciembre");
  // El de octubre lleva mas de 4 meses (136 dias al cierre): un cheque ya vencido debe alertar fuerte.
  if (h.indexOf("más de 4 meses") < 0) throw new Error("no alerta el cheque vencido");
  if (h.indexOf("2 viene(n) arrastrándose") < 0) throw new Error("no cuenta el arrastre en la nota");
  // Y el motor los sigue arrastrando: los tres estan en el resumen, sin limite de antiguedad.
  eq(recolectarEnTransito().length, 3);
});

test("los asientos sugeridos salen del estado de cuenta, no de una diferencia", () => {
  // Los cargos son dato duro: se leen del estado y del informe de retenciones, y se desglosan por banco
  // y concepto para poder digitar el asiento directo. Deducirlos por diferencia arrastraria cualquier
  // otro descuadre al renglon de gastos bancarios.
  STATE.transitoPrevio = null; STATE.diarioCaja = null; STATE.chequesDetalle = null;
  // La cuenta cierra en 1,894.32 con 1,000.00 en transito: los 894.32 de residuo son los cargos que
  // quedaron atrapados adentro. Sin residuo no hay nada que sacar de Caja General (ver el test de abajo).
  STATE.saldoCajaGeneral = { inicial: 0, final: 1894.32, fechaFinal: "2026-02-28" };
  STATE.results = { paso2: [{ clase: "en_transito", motivo: "último día del mes", banco: "STG", fecha: "2026-02-28", monto: 1000, concepto: "Cheque (detalle individual)", texto: "x" }] };
  STATE.estados = { Banistmo: [
    { fecha: "2026-02-15", debito: 170.00, credito: 0, descripcion: "COMISION V/MC ESTABLECIMIENTO AFILIADO" },
    { fecha: "2026-02-15", debito: 22.76, credito: 0, descripcion: "ITBMS SOBRE COMISION V/MC" },
    { fecha: "2026-02-20", debito: 503.11, credito: 0, descripcion: "RETENCION ITBMS V/MC" }
  ]};
  STATE.retVisaDetalle = [{ fecha: "2026-02-10", bruto: 500, retenciones: -198.45, neto: 301.55 }];
  const h = asientosSugeridosHtml();
  if (h.indexOf("Cargos bancarios y de facturación de tarjeta") < 0) throw new Error("falta el asiento de cargos");
  // 170.00 + 22.76 + 503.11 + 198.45 = 894.32
  if (h.indexOf("894.32") < 0) throw new Error("el total de los cargos no cuadra");
  ["Retención ITBMS", "Comisión", "ITBMS", "Retención VISA"].forEach(function(t){
    if (h.indexOf(t) < 0) throw new Error("falta el desglose de " + t);
  });
  if (h.indexOf("[1.1.8] Caja General") < 0) throw new Error("el asiento no nombra la cuenta a acreditar");
  STATE.estados = null; STATE.retVisaDetalle = null;
});

test("si no queda ningun asiento por registrar, el bloque lo dice", () => {
  // Sin cargos ni apertura sin descargar, el saldo YA es el transito: el pie tiene que decirlo en vez de
  // quedar vacio y hacer dudar de si se calculo algo.
  STATE.estados = null; STATE.retVisaDetalle = null;
  STATE.transitoPrevio = null; STATE.diarioCaja = null; STATE.chequesDetalle = null;
  STATE.saldoCajaGeneral = { inicial: 0, final: 500, fechaFinal: "2026-02-28" };
  STATE.results = { paso2: [{ clase: "en_transito", motivo: "último día del mes", banco: "STG", fecha: "2026-02-28", monto: 500, concepto: "Cheque (detalle individual)", texto: "x" }] };
  const h = asientosSugeridosHtml();
  if (h.indexOf("No queda ninguno") < 0) throw new Error("deberia decir que no queda nada por registrar");
});

test("un deposito por tarjeta no cuadra con lineas de otro concepto", () => {
  // 17-jun-2026: el deposito de tarjeta de 847.07 "cuadro" con 609.00 de un pago de certificado + 236.82
  // de una remision clave + 1.26 sueltos. La suma daba, pero le robo al deposito del 22 la remision que
  // era suya, y ese termino saliendo como diferencia. Un deposito por tarjeta compensa en remisiones.
  const cg = [{ fecha: "2026-06-17", debito: 0, credito: 847.07, descripcion: "DEPOSITO POR TARJETA CLAVE STG DEL 17/6/2026", referencia: "ME-1", fila: 5 }];
  const est = [
    { fecha: "2026-06-23", descripcion: "Pago De Shopping Petty Certificado", debito: 0, credito: 609.00, fila: 2 },
    { fecha: "2026-06-23", descripcion: "Remision Clave 016005605", debito: 0, credito: 236.82, fila: 3 },
    { fecha: "2026-06-22", descripcion: "Descripción", debito: 0, credito: 1.26, fila: 4 },
    { fecha: "2026-06-18", descripcion: "Remision Clave 016005605", debito: 0, credito: 435.22, fila: 5 }
  ];
  const h = paso2(cg, [], est, null, null, null, 7, 0.01, null, null);
  // No cuadra por combinacion falsa: queda pendiente (en transito), que es lo honesto.
  eq(h.filter(function(x){ return x.clase === "en_transito" || (x.clase || "diff") === "diff"; }).length, 1);
  // Y la remision del 23 NO fue consumida: sigue disponible para el deposito que le corresponde.
  if (est[1]._transitoUsado) throw new Error("no debia tocar la remision del 23");
});

test("la partida VISA del desglose se busca NETA de retencion", () => {
  // 22-jun-2026: el asiento de 480.43 dice CLAVE pero es VISA 243.61 + CLAVE 236.82. La VISA compensa
  // neta (243.61 - 11.91 = 231.70) y la CLAVE al dia siguiente. El desglose buscaba la VISA por su bruto
  // y no la encontraba nunca, asi que el asiento entero salia como diferencia.
  const cg = [{ fecha: "2026-06-22", debito: 0, credito: 480.43, descripcion: "DEPOSITO POR TARJETA CLAVE STG DEL 22/6/2026", referencia: "ME-00000001976", fila: 9 }];
  const reporte = [
    { fecha: "2026-06-22", banco: "STG", metodo: "VISA", monto: 243.61, cajera: "A" },
    { fecha: "2026-06-22", banco: "STG", metodo: "CLAVE", monto: 236.82, cajera: "A" }
  ];
  const est = [
    { fecha: "2026-06-22", descripcion: "Remisión V/Mc 016005605 Liq. No. 3906896", debito: 0, credito: 231.70, fila: 2 },
    { fecha: "2026-06-23", descripcion: "Remision Clave 016005605", debito: 0, credito: 236.82, fila: 3 }
  ];
  const ret = { "2026-06-22": 11.91 };
  const h = paso2(cg, [], est, null, ret, null, 7, 0.01, reporte, null);
  eq(contarRojas(h), 0, "las dos partidas compensaron");
  eq(h.filter(esEnTransito).length, 0, "y no queda nada en transito");
  // Sin el informe de retenciones no hay como saber el neto: ahi si queda pendiente.
  const h2 = paso2(cg, [], est.map(function(x){ return Object.assign({}, x); }), null, null, null, 7, 0.01, reporte, null);
  if (contarRojas(h2) + h2.filter(esEnTransito).length === 0) throw new Error("sin retenciones no deberia cuadrar solo");
});

test("la ventana de compensacion del Paso 0 depende del tipo de partida", () => {
  // Un cheque puede clarear hasta 4 meses despues; un deposito de ventanilla o de efectivo, no. Con una
  // ventana unica de 366 dias, el deposito de B/ 1.92 del 20-mar-2026 "compenso" con otro 1.92 del
  // 03-jun (75 dias despues) por pura coincidencia de importe, y dejo de arrastrarse justo cuando esa
  // insistencia es la senal de que el deposito nunca se hizo.
  eq(ventanaTransito({ concepto: "Cheque en circulacion" }), 90);
  eq(ventanaTransito({ concepto: "deposito en transito" }), 15);
  eq(ventanaTransito({ concepto: "DEPOSITO POR TARJETA CLAVE STG" }), 12);

  CAL_BANCARIO = null;
  const previo = [
    { fecha: "2026-03-20", banco: "STG", monto: 1.92, concepto: "deposito en transito", sentido: "credito" },
    { fecha: "2026-03-19", banco: "STG", monto: 500.00, concepto: "Cheque en circulacion", sentido: "credito" }
  ];
  const estado = [
    { fecha: "2026-06-03", descripcion: "Descripción", debito: 0, credito: 1.92, fila: 2 },
    { fecha: "2026-06-03", descripcion: "DEPOSITO", debito: 0, credito: 500.00, fila: 3 }
  ];
  const r = consumirTransitoPrevio(previo, { STG: estado }, 0.01);
  const pend = r.pendientes.map(function(p){ return p.monto; });
  if (pend.indexOf(1.92) < 0) throw new Error("el deposito de 1.92 a 75 dias no debia darse por compensado");
  eq(r.compensadas.length, 1, "el cheque si compensa: para el la ventana es de 4 meses");
  cerca(r.compensadas[0].monto, 500.00);
});

test("un ACH puede compensar ANTES del asiento; el resto de los metodos no", () => {
  // 27-jun-2026: el ACH de 1,313.10 entro al banco el 22 (100.00 + 579.10 + 25.00) y el 23 (609.00), o
  // sea antes de que se registrara el asiento. Eso es normal en un ACH: se ordena y despues se digita.
  const est = [
    { fecha: "2026-06-22", descripcion: "Bouti A Petty Cert De Mayo", debito: 0, credito: 579.10, fila: 2 },
    { fecha: "2026-06-22", descripcion: "Son Import A Petty Certificado", debito: 0, credito: 25.00, fila: 3 },
    { fecha: "2026-06-22", descripcion: "Bouti A Petty Certif", debito: 0, credito: 100.00, fila: 4 },
    { fecha: "2026-06-23", descripcion: "Pago De Shopping Petty Certificado", debito: 0, credito: 609.00, fila: 5 }
  ];
  const ach = [{ fecha: "2026-06-27", debito: 1313.10, credito: 0, descripcion: "DEPOSITO ACH STG DEL 27/6/2026", referencia: "ME-1", fila: 9 }];
  const c = conciliarBancoEstado(ach, est.map(function(x){ return Object.assign({}, x); }), 7, 0.01, null);
  eq(c.faltanEnBanco.length, 0, "el ACH tiene que cotejar aunque el banco lo haya acreditado antes");

  // El mismo importe y las mismas lineas, pero como deposito de EFECTIVO: ahi no puede ser anterior.
  const efe = [{ fecha: "2026-06-27", debito: 1313.10, credito: 0, descripcion: "DEPOSITO BRINKS DEL 27/6/2026", referencia: "ME-2", fila: 9 }];
  const c2 = conciliarBancoEstado(efe, est.map(function(x){ return Object.assign({}, x); }), 7, 0.01, null);
  eq(c2.faltanEnBanco.length, 1, "un deposito de efectivo no se acredita antes de entregarse");
});

test("una misma partida vista por tres pasos se cuenta una sola vez", () => {
  // Junio 2026: el Yappy de 16.04 lo veian el Paso 0, el 2 y el 3. Al marcarlo consumido en el Paso 2
  // dejaba de estar disponible para el 3, que lo volvia a sumar: el transito quedaba inflado en 16.04.
  STATE.options = { ventanaDias: 7, tolerancia: 0.01 };
  const base = { clase: "en_transito", banco: "Banco General", fecha: "2026-06-30", monto: 16.04, texto: "x" };
  STATE.results = {
    paso0: [Object.assign({}, base, { motivo: "aún pendiente de compensar", concepto: "yappy en transito" })],
    paso2: [Object.assign({}, base, { motivo: "último día del mes", concepto: "DEPOSITO POR YAPPY DEL 30/06/2026" })],
    paso3: [Object.assign({}, base, { motivo: "último día del mes", concepto: "DEPOSITO POR YAPPY DEL 30/06/2026" })]
  };
  eq(recolectarEnTransito().length, 1, "es la misma plata vista tres veces");
  cerca(transitoPorMetodo().total, 16.04);

  // Pero dos partidas DISTINTAS del mismo importe y dia dentro de un mismo paso siguen siendo dos.
  STATE.results = { paso2: [
    { clase: "en_transito", motivo: "x", banco: "Banistmo", fecha: "2026-02-27", monto: 90.00, concepto: "Cheque (detalle individual)", texto: "x" },
    { clase: "en_transito", motivo: "x", banco: "Banistmo", fecha: "2026-02-27", monto: 90.00, concepto: "Cheque (detalle individual)", texto: "x" }
  ]};
  eq(recolectarEnTransito().length, 2, "dos cheques iguales del mismo dia son dos partidas reales");
});

test("el renglon de apertura compensada muestra que partidas lo componen", () => {
  // El renglon daba un total y nada mas: no habia forma de saber que asiento falta. Son las partidas del
  // Paso 0 que ya compensaron en el banco y todavia no tienen su descargo asentado.
  STATE.transitoPrevio = null; STATE.diarioCaja = null; STATE.chequesDetalle = null;
  STATE.estados = null; STATE.retVisaDetalle = null;
  STATE.saldoCajaGeneral = { inicial: 1000, final: 800, fechaFinal: "2026-02-28" };
  STATE.results = {
    paso0: [
      { clase: "en_transito", motivo: "compensó — venía del mes anterior", banco: "STG", fecha: "2026-02-02", monto: 246.20, concepto: "DEPOSITO POR TARJETA CLAVE STG DEL 31/01/2026", texto: "x" },
      { clase: "en_transito", motivo: "compensó — venía del mes anterior", banco: "Banistmo", fecha: "2026-02-03", monto: 153.56, concepto: "Cheque (detalle individual)", texto: "x" },
      { clase: "en_transito", motivo: "aún pendiente de compensar", banco: "Banistmo", fecha: "2025-12-22", monto: 600.24, concepto: "cheque en transito", texto: "x" }
    ],
    // El descargo del cheque SI se asento: esa partida no debe aparecer en el detalle.
    paso3: [{ clase: "informativo", concepto: "Descargo de transito", banco: "Banistmo", fecha: "2026-02-03", monto: 153.56,
              partidas: [{ banco: "Banistmo", fecha: "2026-01-15", monto: 153.56, concepto: "Cheque (detalle individual)" }], texto: "x" }]
  };
  const ap = partidasApertura();
  eq(ap.length, 1, "solo la que no tiene descargo");
  cerca(ap[0].monto, 246.20);
  // Y el detalle suma exactamente lo que dice el renglon.
  const d = desgloseSaldoCaja();
  cerca(ap.reduce(function(a,x){ return a+x.monto; },0), d.compenso, "el detalle cuadra con el total");
  const h = desgloseSaldoCajaHtml();
  if (h.indexOf("Apertura que ya compensó en el banco") < 0) throw new Error("falta el bloque");
  // El concepto se recorta a 44 caracteres en la tabla, asi que se busca el prefijo.
  if (h.indexOf("DEPOSITO POR TARJETA CLAVE STG DEL") < 0) throw new Error("no lista la partida");
  if (h.indexOf("Cheque (detalle individual)") >= 0) throw new Error("lista una que ya se descargo");
});

test("el descargo visto solo por el Paso 1 tambien excluye sus partidas del detalle", () => {
  // El Paso 1 detecta el descargo desde el credito en Caja General, sin necesidad del navegador del
  // banco. Su hallazgo no llevaba la lista de partidas, asi que el TOTAL del renglon si restaba el
  // descargo pero el DETALLE listaba esas mismas partidas como pendientes: la tabla contradecia al
  // numero de arriba. Pasaba con los 6 cheques de Banistmo de febrero cuando faltaba ese navegador.
  const cg = [{ fecha: "2026-02-02", debito: 0, credito: 490.00, descripcion: "DESCARGO CK BANISTMO EN CIRCULACION DE ENERO", referencia: "ME-1855", fila: 8 }];
  const transito = [
    { fecha: "2026-01-15", banco: "Banistmo", monto: 250.00, concepto: "Cheque (detalle individual)", sentido: "credito" },
    { fecha: "2026-01-22", banco: "Banistmo", monto: 240.00, concepto: "Cheque (detalle individual)", sentido: "credito" }
  ];
  const h1 = paso1([], cg, null, 0.01, [], "2026-02-01", transito);
  const inf = h1.filter(function(x){ return x.clase === "informativo" && /Descargo/.test(x.concepto || ""); });
  eq(inf.length, 1, "el Paso 1 tiene que reconocer el descargo");
  if (!inf[0].partidas) throw new Error("el hallazgo del Paso 1 debe llevar las partidas que descarga");
  eq(inf[0].partidas.length, 2);

  // Con ese hallazgo, el detalle de la apertura no debe listar las dos partidas ya descargadas.
  STATE.transitoPrevio = null; STATE.diarioCaja = null; STATE.chequesDetalle = null;
  STATE.estados = null; STATE.retVisaDetalle = null;
  STATE.saldoCajaGeneral = { inicial: 800, final: 600, fechaFinal: "2026-02-28" };
  STATE.results = {
    paso0: [
      { clase: "en_transito", motivo: "compensó — venía del mes anterior", banco: "Banistmo", fecha: "2026-02-03", monto: 250.00, concepto: "Cheque (detalle individual)", texto: "x" },
      { clase: "en_transito", motivo: "compensó — venía del mes anterior", banco: "Banistmo", fecha: "2026-02-09", monto: 240.00, concepto: "Cheque (detalle individual)", texto: "x" },
      { clase: "en_transito", motivo: "compensó — venía del mes anterior", banco: "STG", fecha: "2026-02-02", monto: 310.00, concepto: "DEPOSITO BRINKS", texto: "x" }
    ],
    paso1: h1
  };
  const ap = partidasApertura();
  eq(ap.length, 1, "solo la de STG, que no tiene descargo");
  cerca(ap[0].monto, 310.00);
  // Y el detalle cuadra con el total del renglon.
  cerca(ap.reduce(function(a,x){ return a+x.monto; },0), desgloseSaldoCaja().compenso, "detalle = renglon");
});

test("un archivo con celdas de importe ilegibles no se puede subir", () => {
  // Se leerian como CERO y esa partida quedaria fuera del cotejo: el paso saldria "sin diferencias" con
  // plata faltando. Mejor rechazarlo al subirlo, que es cuando corregir el Excel cuesta menos.
  const filas = [];
  filas[5] = [null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,"CHEQUE"];
  filas[6] = ["Fecha","Empresa","Cajera","Efectivo\nBrink",null,null,null,null,null,null,null,null,null,null,null,"Cheque\nSr.George","Cheque\nBanistmo"];
  filas[7] = ["2026-02-11","PETTY SHOP","VERONICA",100,null,null,null,null,null,null,null,null,null,null,null,0,50];
  filas[18] = ["2026-02-12","PETTY SHOP","DARITZA",80,null,null,null,null,null,null,null,null,null,null,null,0,"273.49-255.60-164.08-292.62"];
  const libro = filas; libro.hojas = { "FEBRERO ": filas };
  const msg = validarArchivoParaCasilla("reporte", libro);
  if (!msg) throw new Error("deberia rechazar el archivo");
  if (msg.indexOf("273.49-255.60-164.08-292.62") < 0) throw new Error("no dice cual es el valor ilegible");
  if (msg.indexOf("celda Q19") < 0) throw new Error("no dice en que celda esta");
  if (msg.indexOf("Cheque / Banistmo") < 0) throw new Error("no dice de que columna es");

  // El mismo archivo con la celda corregida entra sin problema.
  filas[18][16] = 985.79;
  eq(validarArchivoParaCasilla("reporte", libro), null, "corregida, tiene que entrar");

  // Y el contador global no queda alterado: lo usa el aviso de cada paso.
  ilegiblesN = 0; ilegiblesVals = [];
  filas[18][16] = "no es un numero";
  validarArchivoParaCasilla("reporte", libro);
  eq(ilegiblesN, 0, "la validacion no debe ensuciar el contador del cotejo");
  filas[18][16] = 985.79;
});

test("el Paso 2 cuadra un ACH que el banco partio en cuatro abonos", () => {
  // 27-jun-2026: Caja General registra el ACH de 1,313.10 en un solo asiento y el banco lo acredito
  // separado, un abono por cada quien transfirio: 100.00 + 579.10 + 25.00 el 22 y 609.00 el 23. Son
  // CUATRO lineas y buscarCombinacion solo prueba hasta tres. El subset-sum sobre el pool entero se
  // cortaba por el tope de nodos, asi que primero se reduce a las lineas donde un ACH puede caer.
  CAL_BANCARIO = null;
  const cg = [{ fecha: "2026-06-27", debito: 0, credito: 1313.10, descripcion: "DEPOSITO ACH STG DEL 27/6/2026", referencia: "ME-1983", fila: 9 }];
  const est = [
    { fecha: "2026-06-22", descripcion: "Bouti A Petty Certif", debito: 0, credito: 100.00, fila: 2 },
    { fecha: "2026-06-22", descripcion: "Bouti A Petty Cert De Mayo", debito: 0, credito: 579.10, fila: 3 },
    { fecha: "2026-06-22", descripcion: "Son Import A Petty Certificado", debito: 0, credito: 25.00, fila: 4 },
    { fecha: "2026-06-23", descripcion: "Pago De Shopping Petty Certificado", debito: 0, credito: 609.00, fila: 5 }
  ];
  const h = paso2(cg, [], est, null, null, null, 7, 0.01, null, null);
  eq(contarRojas(h), 0, "el ACH tiene que cuadrar");
  eq(h.filter(esEnTransito).length, 0, "y no queda en transito");
});

test("el pool de un ACH descarta tarjeta, efectivo del camion y cargos", () => {
  // Un ACH cae en transferencias y depositos de terceros, nunca en una remision de tarjeta ni en el
  // camion de valores. Ademas de ser lo correcto, es lo que hace que el subset-sum no se corte.
  const pool = [
    { fecha: "2026-06-22", desc: "Bouti A Petty Certif", monto: 100 },
    { fecha: "2026-06-22", desc: "Remisión V/Mc 016005605", monto: 231.70 },
    { fecha: "2026-06-22", desc: "Remision Clave 016005605", monto: 236.82 },
    { fecha: "2026-06-22", desc: "Ach De Brinks Panama, S.A.", monto: 310 },
    { fecha: "2026-06-22", desc: "COMISION V/MC ESTABLECIMIENTO", monto: 12 }
  ];
  const sub = poolParaAch(pool);
  eq(sub.length, 1, "solo la transferencia del cliente");
  eq(sub[0].desc, "Bouti A Petty Certif");
});

test("el resumen en transito corrige las fechas que Excel guardo invertidas", () => {
  // Excel guarda las fechas ambiguas (dia <= 12) como Date con MES/DIA cambiados: el cheque del 07-abr
  // quedaba como 04-jul y el del 12-may como 05-dic. Con eso la partida viaja al futuro, nunca compensa
  // --el matching va hacia adelante-- y el historial la marca vencida por mas de 4 meses.
  // Las inequivocas (dia > 12) dan el rango real; en el resumen de junio venian como TEXTO.
  const rows = [
    ["Fecha","Banco","Monto","Concepto","Comprobante"],
    ["19/3/2026", "Banistmo", 500.00, "deposito de Banistmo CK", ""],
    ["20/4/2026", "Banistmo", 85.50, "deposito de Banistmo CK", ""],
    ["30/5/2026", "Banistmo", 224.89, "deposito de Banistmo CK", ""],
    [new Date(2026, 6, 4), "Banistmo", 66.45, "deposito de Banistmo CK", ""],
    [new Date(2026, 11, 5), "Banistmo", 270.41, "deposito de Banistmo CK", ""],
    [new Date(2026, 3, 25), "Banistmo", 289.60, "deposito de Banistmo CK", ""]
  ];
  const tr = parseTransitoPrevio(rows);
  const porMonto = function(m){ return tr.filter(function(x){ return Math.abs(x.monto-m)<0.005; })[0]; };
  eq(porMonto(66.45).fecha, "2026-04-07", "04-jul era 07-abr");
  eq(porMonto(270.41).fecha, "2026-05-12", "05-dic era 12-may");
  // Las que ya caian dentro del rango no se tocan, ambiguas o no.
  eq(porMonto(289.60).fecha, "2026-04-25");
  eq(porMonto(500.00).fecha, "2026-03-19");
  eq(porMonto(224.89).fecha, "2026-05-30");
});

test("el asiento de descargo muestra las partidas que lo componen", () => {
  // Pedia un monto sin decir de que salia: el historial en transito de abajo es otra cosa (lo que queda
  // pendiente) y no tiene por que sumar lo mismo, asi que no habia con que contrastarlo.
  STATE.transitoPrevio = null; STATE.diarioCaja = null; STATE.chequesDetalle = null;
  STATE.estados = null; STATE.retVisaDetalle = null;
  STATE.saldoCajaGeneral = { inicial: 500, final: 900, fechaFinal: "2026-06-30" };
  STATE.results = { paso0: [
    { clase: "en_transito", motivo: "compensó — venía del mes anterior", banco: "Banistmo", fecha: "2026-06-15", monto: 66.45, concepto: "deposito de Banistmo CK", texto: "x" },
    { clase: "en_transito", motivo: "compensó — venía del mes anterior", banco: "Banistmo", fecha: "2026-06-03", monto: 224.89, concepto: "deposito de Banistmo CK", texto: "x" }
  ]};
  const h = asientosSugeridosHtml();
  if (h.indexOf("Descargo del tránsito del mes anterior") < 0) throw new Error("falta el asiento");
  ["2026-06-15", "66.45", "2026-06-03", "224.89", "291.34"].forEach(function(t){
    if (h.indexOf(t) < 0) throw new Error("el asiento no muestra " + t);
  });
});

test("el efectivo del dia se empareja partida por partida antes que por la suma", () => {
  // El banco acredita el Brinks por un lado y la ventanilla por otro, y hasta en dias distintos: el
  // 11-jun-2026 la ventanilla de 3.61 entro el 12 y el Brinks de 535.00 el 15. Buscar la suma del dia
  // primero hacia que una combinacion cuadrara de casualidad y se llevara la linea de otro dia, y esos
  // depositos quedaban en transito teniendo su credito en el banco.
  CAL_BANCARIO = null;
  const diario = [
    { fecha: "2026-06-11", debito: 535.00, credito: 0, descripcion: "DEPOSITO BRINKS DEL 11/6/2026", fila: 2 },
    { fecha: "2026-06-11", debito: 3.61, credito: 0, descripcion: "DEPOSITO DEL 11/6/2026", fila: 3 }
  ];
  const estado = [
    { fecha: "2026-06-12", descripcion: "Descripción", debito: 0, credito: 3.61, fila: 5 },
    { fecha: "2026-06-15", descripcion: "Ach De Brink S Panama S.A.", debito: 0, credito: 535.00, fila: 6 }
  ];
  const c = conciliarBancoEstado(diario, estado, 7, 0.01, null);
  eq(c.faltanEnBanco.length, 0, "los dos tienen su credito en el banco, en dias distintos");

  // Y cuando el banco SI los junta en un solo deposito, la consolidacion por suma sigue funcionando.
  const diario2 = [
    { fecha: "2026-06-11", debito: 535.00, credito: 0, descripcion: "DEPOSITO BRINKS DEL 11/6/2026", fila: 2 },
    { fecha: "2026-06-11", debito: 3.61, credito: 0, descripcion: "DEPOSITO DEL 11/6/2026", fila: 3 }
  ];
  const estado2 = [{ fecha: "2026-06-12", descripcion: "Ach De Brink S Panama S.A.", debito: 0, credito: 538.61, fila: 5 }];
  const c2 = conciliarBancoEstado(diario2, estado2, 7, 0.01, null);
  eq(c2.faltanEnBanco.length, 0, "juntos en una sola linea tambien cuadran");
});

test("la parte de un deposito consolidado no se suma ademas del total", () => {
  // 30-jun-2026: el Paso 2 trae de Caja General el asiento consolidado de 280.21 (VISA 91.26 + CLAVE
  // 188.95) y el Paso 3 ve la CLAVE de 188.95 por separado en el diario del banco. Son la misma plata:
  // sumar las dos inflaba el transito en 188.95.
  STATE.options = { ventanaDias: 7, tolerancia: 0.01 };
  STATE.results = {
    paso2: [{ clase: "en_transito", motivo: "último día del mes", banco: "STG", fecha: "2026-06-30", monto: 280.21,
              concepto: "DEPOSITO POR TARJETA VISA STG DEL 30/06/2026", texto: "x",
              partes: [{ metodo: "VISA", monto: 91.26 }, { metodo: "CLAVE", monto: 188.95 }] }],
    paso3: [{ clase: "en_transito", motivo: "último día del mes", banco: "STG", fecha: "2026-06-30", monto: 188.95,
              concepto: "DEPOSITO POR TARJETA CLAVE STG DEL 30/06/2026", texto: "x" }]
  };
  eq(recolectarEnTransito().length, 1, "es la misma plata");
  cerca(transitoPorMetodo().total, 280.21, "queda el consolidado, que es el total");

  // Una partida que NO es parte del consolidado si se suma.
  STATE.results.paso3.push({ clase: "en_transito", motivo: "último día del mes", banco: "STG", fecha: "2026-06-30",
                             monto: 9.02, concepto: "DEPOSITO DEL 30/06/2026", texto: "x" });
  eq(recolectarEnTransito().length, 2);
  cerca(transitoPorMetodo().total, 289.23);
});

test("cada diferencia dice que asiento hay que registrar", () => {
  // Quien usa esto no tiene formacion contable: "hay una diferencia de B/ 149.73" no alcanza para saber
  // que hacer. La regla de fondo: cuando el dinero sale de caja al banco, el banco se DEBITA y Caja
  // General se ACREDITA.
  // Paso 1, la cajera reporto mas de lo registrado: falta el asiento del deposito.
  const a1 = asientoDelHallazgo({ clase: "diff", banco: "STG", fecha: "2026-02-05", monto: 149.73,
    texto: "Diferencia STG 2026-02-05: reporte de cajeras B/ 202.12 vs. diario Caja General" }, "paso1");
  if (!a1) throw new Error("el Paso 1 deberia sugerir asiento");
  eq(a1.debito, "[1.1.1.10] St. Georges Bank", "el banco recibe: va al debito");
  eq(a1.credito, "[1.1.8] Caja General", "la caja entrega: va al credito");
  cerca(a1.monto, 149.73);
  if (a1.revisarPrimero) throw new Error("este caso es un asiento directo, no un reverso");

  // Paso 1 al reves (el diario tiene mas que el informe): es un reverso y hay que revisar antes.
  const a2 = asientoDelHallazgo({ clase: "diff", banco: "STG", fecha: "2026-02-02", monto: -556.51,
    texto: "Diferencia STG 2026-02-02: reporte de cajeras B/ 1,094.72 vs. diario Caja General" }, "paso1");
  eq(a2.debito, "[1.1.8] Caja General", "el reverso va al reves");
  eq(a2.credito, "[1.1.1.10] St. Georges Bank");
  cerca(a2.monto, 556.51, "el monto va en positivo aunque la diferencia sea negativa");
  if (!a2.revisarPrimero) throw new Error("un reverso hay que revisarlo antes de registrarlo");

  // Paso 3, el banco acredito y no hay asiento: entra plata que no esta en los libros.
  const a3 = asientoDelHallazgo({ clase: "diff", banco: "Banistmo", fecha: "2026-02-26", monto: 371.28,
    texto: "Banistmo 2026-02-26: B/ 371.28 en el estado de cuenta no aparece registrado en el diario contable" }, "paso3");
  eq(a3.debito, "[1.1.1.07] Banistmo");
  eq(a3.credito, "[1.1.8] Caja General");

  // Lo que no se arregla con un asiento no lo sugiere.
  eq(asientoDelHallazgo({ clase: "aviso", banco: "STG", fecha: "2026-02-05", monto: 10, texto: "x" }, "paso1"), null);
  eq(asientoDelHallazgo({ clase: "en_transito", banco: "STG", fecha: "2026-02-05", monto: 10, texto: "x" }, "paso2"), null);
  // Y el HTML lleva las tres lineas del asiento.
  const h = asientoHallazgoHtml(a1);
  ["Débito", "Crédito", "Concepto", "149.73"].forEach(function(t){
    if (h.indexOf(t) < 0) throw new Error("al asiento le falta " + t);
  });
});

test("un asiento ya registrado se marca REGISTRADO", () => {
  // Una vez hecho el asiento y reexportado el navegador, el reporte no debe seguir pidiendolo.
  STATE.transitoPrevio = null; STATE.chequesDetalle = null; STATE.retVisaDetalle = null;
  STATE.saldoCajaGeneral = { inicial: 0, final: 1673.11, fechaFinal: "2026-02-28" };
  STATE.results = { paso2: [{ clase: "en_transito", motivo: "x", banco: "STG", fecha: "2026-02-28", monto: 1000, concepto: "Cheque (detalle individual)", texto: "x" }] };
  STATE.estados = { Banistmo: [
    { fecha: "2026-02-15", debito: 170.00, credito: 0, descripcion: "COMISION V/MC ESTABLECIMIENTO AFILIADO" },
    { fecha: "2026-02-20", debito: 503.11, credito: 0, descripcion: "RETENCION ITBMS V/MC" }
  ]};
  STATE.diarioCaja = [];
  if (asientosSugeridosHtml().indexOf("as-reg") >= 0) throw new Error("sin el asiento no debe decir REGISTRADO");
  // Registrado en un solo renglon.
  STATE.diarioCaja = [{ fecha: "2026-02-28", debito: 0, credito: 673.11, descripcion: "COMISIONES Y RETENCIONES DE TARJETA", referencia: "ME-1899", fila: 9 }];
  if (asientosSugeridosHtml().indexOf("as-reg") < 0) throw new Error("deberia marcarlo REGISTRADO");
  // Digitado renglon por renglon el mismo dia, que es como suele hacerse.
  STATE.diarioCaja = [
    { fecha: "2026-02-28", debito: 0, credito: 170.00, descripcion: "COMISION DE TARJETA", referencia: "ME-1899", fila: 8 },
    { fecha: "2026-02-28", debito: 0, credito: 503.11, descripcion: "RETENCION ITBMS DE TARJETA", referencia: "ME-1899", fila: 9 }
  ];
  if (asientosSugeridosHtml().indexOf("as-reg") < 0) throw new Error("varios renglones del mismo dia tambien cuentan");
  // Ni un importe distinto ni otro concepto lo marcan.
  STATE.diarioCaja = [{ fecha: "2026-02-28", debito: 0, credito: 999.99, descripcion: "COMISION DE TARJETA", referencia: "ME-1", fila: 9 }];
  if (asientosSugeridosHtml().indexOf("as-reg") >= 0) throw new Error("otro importe no es este asiento");
  STATE.diarioCaja = [{ fecha: "2026-02-28", debito: 0, credito: 673.11, descripcion: "DEPOSITO BRINKS DEL 28/02/2026", referencia: "ME-1", fila: 9 }];
  if (asientosSugeridosHtml().indexOf("as-reg") >= 0) throw new Error("otro concepto no es este asiento");
  STATE.estados = null; STATE.diarioCaja = null;
});

test("cada casilla dice de donde sacar su archivo", () => {
  // El nombre de la casilla usa el vocabulario del sistema de origen ("Navegador"), no el de quien la usa.
  // Sin la instruccion de exportacion, alguien que no conoce el circuito no puede ni empezar.
  STATE.files = {};
  ["transitoPrevio","reporte","diarioCaja","estBanistmo","estStg","estBancoGeneral","retVisa",
   "diarioBanistmo","diarioStg","diarioBancoGeneral"].forEach(function(k){
    if (!DE_DONDE[k]) throw new Error("falta la instruccion de " + k);
    const h = dzHtml(k, "x", "y");
    if (h.indexOf("¿De dónde saco este archivo?") < 0) throw new Error("la casilla " + k + " no la muestra");
  });
  // Los estados de cuenta avisan del recorte de fechas: fue causa real de diferencias falsas en febrero.
  ["estBanistmo","estStg","estBancoGeneral"].forEach(function(k){
    if (!/último día del mes/.test(DE_DONDE[k])) throw new Error(k + " no avisa del rango de fechas");
  });
});

test("el reverso esconde el debito/credito hasta confirmar la revision", () => {
  // Un reverso anula un asiento ya registrado. Quien no tiene criterio contable no deberia poder copiar
  // el debito/credito sin antes mirar de donde salio: si el error estaba en el informe y no en la
  // contabilidad, reversar lo empeora.
  const rev = asientoDelHallazgo({ clase: "diff", banco: "STG", fecha: "2026-02-02", monto: -556.51,
    texto: "Diferencia STG 2026-02-02: reporte de cajeras B/ 1,094.72 vs. diario Caja General" }, "paso1");
  const h = asientoHallazgoHtml(rev, "paso1");
  if (h.indexOf("Revisá esto antes de tocar nada") < 0) throw new Error("no encabeza con la advertencia");
  if (h.indexOf("<details") < 0) throw new Error("el detalle del reverso deberia ir plegado");
  // Los pasos de revision del Paso 1 estan y son concretos.
  if (h.indexOf("informe de caja") < 0) throw new Error("no dice que revisar");
  eq((h.match(/<li>/g) || []).length, QUE_REVISAR.paso1.length, "un punto por cada cosa a revisar");
  // El debito/credito existe, pero DENTRO del details.
  const iDet = h.indexOf("<details"), iDeb = h.indexOf("Débito");
  if (!(iDeb > iDet)) throw new Error("el débito quedó fuera del plegado");

  // Un asiento que NO es reverso se muestra directo, sin plegar: no hay nada que confirmar.
  const dir = asientoDelHallazgo({ clase: "diff", banco: "STG", fecha: "2026-02-05", monto: 149.73,
    texto: "Diferencia STG 2026-02-05: reporte de cajeras B/ 202.12 vs. diario Caja General" }, "paso1");
  const h2 = asientoHallazgoHtml(dir, "paso1");
  if (h2.indexOf("<details") >= 0) throw new Error("un asiento directo no debe ir plegado");
  if (h2.indexOf("Asiento que falta registrar") < 0) throw new Error("le falta el titulo");
});

test("ST GEORGES se reconoce como STG", () => {
  // El banco se escribe de varias formas segun quien exporte. Sin esto, el resumen en transito de junio
  // de 2026 traia 1,972.60 con banco "ST GEORGES" y esas cinco partidas quedaban fuera del cotejo del
  // Paso 0: ni compensaban ni quedaban pendientes, desaparecian.
  ["STG", "ST GEORGES", "St. Georges", "DEPOSITO POR TARJETA CLAVE STG"].forEach(function(s){
    eq(clasificarBancoPorTexto(s), "STG", s + " deberia ser STG");
  });
  eq(clasificarBancoPorTexto("Banistmo"), "Banistmo");
  eq(clasificarBancoPorTexto("Banco General"), "Banco General");
});

test("un banco no reconocido en el resumen en transito se denuncia", () => {
  // Una partida cuyo banco no se reconoce no entra a ningun pool: no compensa ni queda pendiente. Que eso
  // pase en silencio es peor que una diferencia, porque el total del resumen deja de cuadrar sin motivo.
  const previo = [
    { fecha: "2026-05-30", banco: "Bancolombia", monto: 500.00, concepto: "deposito en transito", sentido: "credito" },
    { fecha: "2026-05-30", banco: "STG", monto: 100.00, concepto: "deposito en transito", sentido: "credito" }
  ];
  const h = paso0(previo, [], [], null, 7, 0.01);
  const av = h.filter(function(x){ return /no reconozco/.test(x.texto || ""); });
  eq(av.length, 1, "deberia avisar del banco desconocido");
  cerca(av[0].monto, 500.00);
  if (av[0].texto.indexOf("Bancolombia") < 0) throw new Error("no dice cual es el banco raro");
  eq(contarRojas(h) >= 1, true, "es una diferencia, no un aviso menor");
});

test("el arrastre de meses anteriores sale del residuo, en las dos direcciones", () => {
  // Metido dentro del renglon residual, un descuadre de apertura se disfraza de "cargos de tarjeta" y
  // manda a buscar donde no es: en junio de 2026 el residuo daba 9,446.30 cuando los cargos del mes eran
  // 990.54. Y sin contemplar el signo negativo, enero daba -10,466.72 en vez de 2,537.25.
  STATE.chequesDetalle = null; STATE.estados = null; STATE.retVisaDetalle = null;
  // La cuenta abre con 900 y el resumen del mes pasado justifica 400: sobran 500 de meses viejos.
  STATE.saldoCajaGeneral = { inicial: 900, final: 950, fechaFinal: "2026-06-30", fechaInicial: "2026-06-01" };
  STATE.diarioCaja = [];
  STATE.transitoPrevio = [{ fecha: "2026-05-20", banco: "STG", monto: 400, concepto: "deposito en transito", sentido: "credito" }];
  STATE.results = { paso0: [{ clase: "en_transito", motivo: "aún pendiente", banco: "STG", fecha: "2026-05-20", monto: 400, concepto: "deposito", texto: "x" }] };
  let d = desgloseSaldoCaja();
  cerca(d.arrastre, 500, "la cuenta trae 500 de mas al abrir");
  cerca(d.transito + d.compenso + d.resto + d.arrastre, d.final, "los cuatro renglones dan el saldo");
  let h = desgloseSaldoCajaHtml();
  if (h.indexOf("Arrastre de meses anteriores") < 0) throw new Error("falta el bloque de arrastre");
  if (h.indexOf("no se generó este mes") < 0) throw new Error("no explica que no es de este mes");

  // Al reves: la cuenta abre con 200 y el resumen justifica 400. Falta plata en la apertura.
  STATE.saldoCajaGeneral = { inicial: 200, final: 950, fechaFinal: "2026-06-30", fechaInicial: "2026-06-01" };
  d = desgloseSaldoCaja();
  cerca(d.arrastre, -200, "la cuenta abre con 200 de menos");
  cerca(d.transito + d.compenso + d.resto + d.arrastre, d.final, "sigue cuadrando");
  h = desgloseSaldoCajaHtml();
  if (h.indexOf("abre con menos") < 0) throw new Error("no explica el caso inverso");

  // Si la apertura cuadra con el resumen, no hay bloque de arrastre que mostrar.
  STATE.saldoCajaGeneral = { inicial: 400, final: 950, fechaFinal: "2026-06-30", fechaInicial: "2026-06-01" };
  d = desgloseSaldoCaja();
  cerca(d.arrastre, 0);
  if (desgloseSaldoCajaHtml().indexOf("Arrastre de meses anteriores") >= 0) throw new Error("no deberia mostrar arrastre");
  STATE.transitoPrevio = null; STATE.diarioCaja = null;
});

test("avisa cuando al navegador de Caja General le faltan lineas", () => {
  // Un deposito tiene dos lados con el mismo comprobante: debito al banco y credito a Caja General. Si el
  // navegador se exporto filtrado, falta un lado y el Paso 1 marca como "asiento que falta registrar"
  // algo que SI esta registrado — y encima sugiere un asiento que ya existe. Paso en febrero de 2026 con
  // el ME-00000001876 (3,571.60) y el ME-00000001877 (2,662.52).
  const caja = [
    { fecha: "2026-02-27", debito: 3853.89, credito: 0, descripcion: "REPORTE DE VENTA DEL 27/02/2026", referencia: "ME-00000001876", fila: 90 }
  ];
  const banistmo = [
    { fecha: "2026-02-27", debito: 1463.08, credito: 0, descripcion: "DEPOSITO BANISTMO CK DEL 27/02/2026", referencia: "ME-00000001876", fila: 5 },
    { fecha: "2026-02-27", debito: 2108.52, credito: 0, descripcion: "DEPOSITO BANISTMO /VISA/CLAVE DEL 27/02/2026", referencia: "ME-00000001876", fila: 6 },
    { fecha: "2026-02-28", debito: 2662.52, credito: 0, descripcion: "DEPOSITO POR TARJETA VISA BANISTMO DEL 28/02/2026", referencia: "ME-00000001877", fila: 7 }
  ];
  const f = integridadComprobantes(caja, { Banistmo: banistmo });
  eq(f.length, 2, "los dos comprobantes tienen el lado del banco y no el de Caja General");
  cerca(f[0].falta + f[1].falta, 6234.12);
  eq(f[1].ausente, true, "el ME-1877 no aparece en absoluto");
  eq(f[0].ausente, false, "el ME-1876 aparece, pero sin sus creditos");
  const h = integridadHtml(f);
  ["ME-00000001876", "ME-00000001877", "6,234.12", "volvé a exportar"].forEach(function(t){
    if (h.toLowerCase().indexOf(t.toLowerCase()) < 0) throw new Error("al aviso le falta: " + t);
  });

  // Si el comprobante SI tiene creditos en Caja General, la diferencia puede ser legitima (hay depositos
  // que no vienen de Caja General). Ahi no se alarma: en enero de 2026 eso marcaba dos correctos.
  const caja2 = caja.concat([{ fecha: "2026-02-27", debito: 0, credito: 3571.60, descripcion: "DEPOSITO BANISTMO DEL 27/02/2026", referencia: "ME-00000001876", fila: 91 }]);
  const f2 = integridadComprobantes(caja2, { Banistmo: banistmo.slice(0, 2) });
  eq(f2.length, 0, "con el credito puesto, no hay nada que denunciar");
  const caja3 = [{ fecha: "2026-01-14", debito: 0, credito: 1122.79, descripcion: "DEPOSITO", referencia: "ME-1837", fila: 3 }];
  const stg3 = [{ fecha: "2026-01-14", debito: 1197.79, credito: 0, descripcion: "DEPOSITO DEL DIA 14", referencia: "ME-1837", fila: 4 }];
  eq(integridadComprobantes(caja3, { STG: stg3 }).length, 0, "una diferencia parcial no se denuncia");

  // Sin navegador de Caja General no hay nada que comparar.
  eq(integridadComprobantes(null, { Banistmo: banistmo }).length, 0);
  eq(integridadHtml([]), "");
});

test("un deposito de fin de mes sin credito en Caja General es transito, no diferencia", () => {
  // Con la mecanica nueva el credito a Caja General se registra el dia que el BANCO COMPENSA. Un deposito
  // de los ultimos dias del mes compensa el mes siguiente, asi que su credito tambien: comparar el reporte
  // del dia contra los creditos del dia lo marcaba como "asiento que falta registrar" todos los meses.
  // Paso en febrero de 2026 con los 3,571.60 del 27-feb y los 2,662.52 del 28-feb.
  CAL_BANCARIO = null;
  const reporte = [
    { fecha: "2026-02-10", banco: "Banistmo", metodo: "VISA", monto: 500.00, cajera: "A" },
    { fecha: "2026-02-27", banco: "Banistmo", metodo: "VISA", monto: 1124.69, cajera: "A" },
    { fecha: "2026-02-27", banco: "Banistmo", metodo: "CHEQUE", monto: 1463.08, cajera: "A" },
    { fecha: "2026-02-28", banco: "Banistmo", metodo: "VISA", monto: 300.00, cajera: "A" }
  ];
  // El diario solo registra el deposito del 10; los de fin de mes van el mes que viene.
  const cg = [{ fecha: "2026-02-10", debito: 0, credito: 500.00, descripcion: "DEPOSITO POR TARJETA VISA BANISTMO DEL 10/02/2026", referencia: "ME-1", fila: 5 }];
  const h = paso1(reporte, cg, null, 0.01, [], "2026-02-01", null);
  eq(contarRojas(h), 0, "los de fin de mes no son diferencias");
  const t = h.filter(esEnTransito);
  eq(t.length, 2, "el 27 y el 28 quedan en transito");
  cerca(t.reduce(function(a,x){ return a+x.monto; },0), 2887.77);
  if (!t[0].partes) throw new Error("el hallazgo debe llevar su desglose por metodo");

  // Uno de mitad de mes sin credito SIGUE siendo diferencia: ahi si falta el asiento.
  const reporte2 = [{ fecha: "2026-02-10", banco: "Banistmo", metodo: "VISA", monto: 500.00, cajera: "A" }];
  const h2 = paso1(reporte2, [], null, 0.01, [], "2026-02-01", null);
  eq(contarRojas(h2), 1, "a mitad de mes, sin credito, falta el asiento");
});

test("los cheques del detalle no se suman ademas del consolidado que los contiene", () => {
  // El consolidado del 27-feb-2026 (3,571.60) incluye CHEQUE 1,463.08, que el detalle del informe trae
  // como doce cheques sueltos. Sumar las dos cosas inflaba el transito en 1,463.08.
  STATE.options = { ventanaDias: 7, tolerancia: 0.01 };
  STATE.results = {
    paso1: [{ clase: "en_transito", motivo: "depósito de fin de mes", banco: "Banistmo", fecha: "2026-02-27", monto: 3571.60,
              concepto: "Depósito de fin de mes reportado por la cajera", texto: "x",
              partes: [{ metodo: "VISA", monto: 1124.69 }, { metodo: "CLAVE", monto: 983.83 }, { metodo: "CHEQUE", monto: 1463.08 }] }],
    paso2: [
      { clase: "en_transito", motivo: "cheque pendiente", banco: "Banistmo", fecha: "2026-02-27", monto: 270.30, concepto: "Cheque (detalle individual)", texto: "x" },
      { clase: "en_transito", motivo: "cheque pendiente", banco: "Banistmo", fecha: "2026-02-27", monto: 1192.78, concepto: "Cheque (detalle individual)", texto: "x" }
    ]
  };
  eq(recolectarEnTransito().length, 1, "los cheques ya estan dentro del consolidado");
  cerca(transitoPorMetodo().total, 3571.60);

  // Una partida de OTRO metodo, que no es parte del consolidado, si se suma.
  STATE.results.paso2.push({ clase: "en_transito", motivo: "x", banco: "Banistmo", fecha: "2026-02-27", monto: 9.02, concepto: "DEPOSITO DEL 27/02/2026", texto: "x" });
  eq(recolectarEnTransito().length, 2, "un deposito de ventanilla no es parte de VISA/CLAVE/CHEQUE");
  cerca(transitoPrevioTotalTest(), 3580.62);

  // Y una partida del dia siguiente no puede comerse el saldo del dia anterior.
  STATE.results.paso2 = [{ clase: "en_transito", motivo: "x", banco: "Banistmo", fecha: "2026-02-28", monto: 270.30, concepto: "Cheque (detalle individual)", texto: "x" }];
  eq(recolectarEnTransito().length, 2, "otra fecha, otra partida");
});
function transitoPrevioTotalTest(){ return transitoPorMetodo().total; }


test("avisa cuando al navegador de un BANCO le faltan los depositos", () => {
  // Caja General acredita los depositos del mes con comprobantes ME-18xx.
  const caja = [
    { fecha:"2026-02-02", referencia:"ME-00000001855", descripcion:"DEPOSITO BRINKS", debito:0, credito:1000 },
    { fecha:"2026-02-03", referencia:"ME-00000001856", descripcion:"DEPOSITO BRINKS", debito:0, credito:500 }
  ];
  // STG trae su lado; Banistmo salio filtrado y no comparte NI UN comprobante.
  const diarios = {
    STG: [{ fecha:"2026-02-02", referencia:"ME-00000001855", descripcion:"DEPOSITO", debito:1000, credito:0 }],
    Banistmo: [{ fecha:"2026-02-11", referencia:"PAY0010655", descripcion:"TRASPASO", debito:3000, credito:0 }]
  };
  const estados = {
    STG: [{ fecha:"2026-02-02", descripcion:"DEPOSITO", debito:0, credito:1000 }],
    Banistmo: [{ fecha:"2026-02-03", descripcion:"CR REMISION", debito:0, credito:500 }]
  };
  const r = integridadDiariosBanco(caja, diarios, estados);
  eq(r.length, 1, "solo se denuncia el banco sin comprobantes en comun");
  eq(r[0].banco, "Banistmo");
  cerca(r[0].sinRespaldo, 500);   // ME-1856 quedo sin contrapartida en ningun banco

  // Si el navegador de Banistmo trae su lado, no se denuncia nada.
  diarios.Banistmo.push({ fecha:"2026-02-03", referencia:"ME-00000001856", descripcion:"DEPOSITO", debito:500, credito:0 });
  eq(integridadDiariosBanco(caja, diarios, estados).length, 0, "archivo completo, sin aviso");

  // Un banco cuyo estado de cuenta no tuvo entradas ese mes no se denuncia aunque no comparta nada.
  const sinEntradas = { Banistmo: [] };
  eq(integridadDiariosBanco(caja, { Banistmo: [] }, sinEntradas).length, 0, "sin entradas en el estado, sin aviso");
});


test("si la cuenta ya cuadra, los cargos no se acreditan a Caja General", () => {
  // La venta entra bruta y el deposito sale bruto tambien: los cargos del banco nunca quedan atrapados
  // en Caja General. Cuando el saldo YA es el transito, pedir el asiento de cargos contra Caja General la
  // dejaria corta por su importe. En febrero de 2026 eran 1,268.76 sobre una cuenta cuadrada al centavo.
  STATE.transitoPrevio = null; STATE.diarioCaja = null; STATE.chequesDetalle = null; STATE.retVisaDetalle = null;
  STATE.saldoCajaGeneral = { inicial: 0, final: 1000, fechaFinal: "2026-02-28" };
  STATE.results = { paso2: [{ clase: "en_transito", motivo: "último día del mes", banco: "STG", fecha: "2026-02-28", monto: 1000, concepto: "Cheque (detalle individual)", texto: "x" }] };
  STATE.estados = { Banistmo: [
    { fecha: "2026-02-15", debito: 170.00, credito: 0, descripcion: "COMISION V/MC ESTABLECIMIENTO AFILIADO" },
    { fecha: "2026-02-20", debito: 503.11, credito: 0, descripcion: "RETENCION ITBMS V/MC" }
  ]};
  const h = asientosSugeridosHtml();
  if (h.indexOf("nada que registrar contra Caja General") < 0) throw new Error("deberia avisar que no va contra Caja General");
  if (h.indexOf("Gastos bancarios / Comisiones") >= 0) throw new Error("no debe proponer el asiento contra Caja General");
  if (h.indexOf("673.11") < 0) throw new Error("el aviso tiene que decir de cuanto son los cargos");
  STATE.estados = null;
});


test("la tabla de lo ya acreditado suma exactamente su propio total", () => {
  // Las dos caras del transito se calculaban por separado: una recorriendo el Paso 0 y los cheques del
  // Paso 2, la otra restando eso del total del resumen. En febrero de 2026 el renglon decia 9,856.78 y su
  // tabla listaba 11,499.86. Ahora las dos salen de clasificar la MISMA lista, asi que no pueden diferir.
  STATE.transitoPrevio = null; STATE.diarioCaja = null; STATE.chequesDetalle = null; STATE.retVisaDetalle = null;
  STATE.estados = null;
  STATE.saldoCajaGeneral = { inicial: 0, final: 5000, fechaFinal: "2026-02-29" };
  STATE.results = {
    paso0: [{ clase: "en_transito", motivo: "aún pendiente de compensar", banco: "Banistmo", fecha: "2025-12-22", monto: 435.71, concepto: "cheque en transito", texto: "x" }],
    paso1: [{ clase: "en_transito", motivo: "depósito de fin de mes — el crédito se registra al compensar", banco: "Banistmo", fecha: "2026-02-27", monto: 3571.60, concepto: "Depósito de fin de mes reportado por la cajera", texto: "x" }],
    paso2: [{ clase: "en_transito", motivo: "último día del mes", banco: "STG", fecha: "2026-02-28", monto: 4148.70, concepto: "DEPOSITOS POR TARJETA VISA STG DEL 1 AL 28 DE FEBRERO 2026.", texto: "x" }],
    paso3: []
  };
  const c = clasificarTransito();
  // El deposito de fin de mes del Paso 1 sigue DENTRO de la cuenta: es justo lo que Caja General no acredito.
  cerca(c.totalDentro, 4007.31);   // 435.71 + 3,571.60
  cerca(c.totalFuera, 4148.70);    // la VISA acumulada ya tiene su credito
  eq(c.dentro.length + c.fuera.length, recolectarEnTransito().length, "ninguna partida se pierde ni se duplica");
  const suma = Math.round(partidasYaAcreditadas().reduce(function(a,x){ return a+x.monto; },0)*100)/100;
  cerca(suma, desgloseSaldoCaja().soloBanco);
});

test("una venta que entra y no sale por ningun deposito se denuncia", () => {
  // El 28 de febrero de 2026 entraron 5,047.42 de venta, la cajera reporto 2,662.52 depositados a Banistmo
  // y de los otros 2,384.90 no habia rastro. Iban dentro del renglon de retenciones, donde se leian como
  // un cargo del banco en vez de plata que hay que ir a buscar.
  STATE.results = { paso1: [{ clase: "en_transito", motivo: "depósito de fin de mes", banco: "Banistmo", fecha: "2026-02-28", monto: 2662.52, concepto: "Depósito de fin de mes reportado por la cajera", texto: "x" }] };
  STATE.retVisaDetalle = null;
  STATE.diarioCaja = [
    { fecha: "2026-02-28", referencia: "ME-1877", debito: 5047.42, credito: 0, descripcion: "REPORTE DE VENTA DEL 28/02/2026" },
    { fecha: "2026-02-27", referencia: "ME-1876", debito: 900.00, credito: 900.00, descripcion: "REPORTE DE VENTA DEL 27/02/2026" }
  ];
  const v = ventasSinDeposito();
  eq(v.length, 1, "solo el dia que quedo sin explicar");
  cerca(v[0].pendiente, 2384.90);

  // Un ajuste de saldo no es una venta: no obliga a ningun deposito.
  STATE.diarioCaja = [{ fecha: "2026-01-01", referencia: "ME-2023", debito: 18123.07, credito: 0, descripcion: "AJUSTA SALDO ERRADO DE LA CAJA GENERAL AL CIERRE" }];
  eq(ventasSinDeposito().length, 0, "un ajuste de saldo no se denuncia como venta sin depositar");

  // La VISA de St. Georges se acredita en un solo asiento a fin de mes: su venta diaria no esta pendiente.
  STATE.diarioCaja = [{ fecha: "2026-02-12", referencia: "ME-1864", debito: 431.05, credito: 0, descripcion: "REPORTE DE VENTA DEL 12/02/2026" }];
  STATE.results = { paso1: [] };
  eq(ventasSinDeposito().length, 1, "sin el informe de retenciones la venta VISA queda pendiente");
  STATE.retVisaDetalle = [{ fecha: "2026-02-12", bruto: 431.05, retenciones: -19.97, neto: 411.08 }];
  eq(ventasSinDeposito().length, 0, "con el informe, la venta VISA del dia ya esta explicada");
  STATE.diarioCaja = null; STATE.retVisaDetalle = null;
});


test("una venta sin deposito queda en transito y viaja al mes siguiente", () => {
  // No la ve ningun paso: no hay linea de banco que cotejar, justamente porque el deposito falta. Si no
  // entra al resumen, el mes que viene nadie se acuerda de ella y una venta que nunca llego al banco
  // desaparece sin dejar rastro.
  STATE.transitoPrevio = null; STATE.chequesDetalle = null; STATE.retVisaDetalle = null; STATE.estados = null;
  STATE.saldoCajaGeneral = { inicial: 0, final: 2384.86, fechaFinal: "2026-02-29" };
  STATE.results = {
    paso0: [], paso1: [], paso2: [],
    // El Brinks del mes dice donde compensa el efectivo: de ahi sale el banco de la partida.
    paso3: [{ clase: "en_transito", motivo: "depósito de fin de mes", banco: "STG", fecha: "2026-02-26", monto: 605.00, concepto: "DEPOSITO BRINKS DEL 26/02/2026", texto: "x" }]
  };
  STATE.diarioCaja = [{ fecha: "2026-02-28", referencia: "ME-1877", debito: 2384.86, credito: 0, descripcion: "REPORTE DE VENTA DEL 28/02/2026" }];
  eq(bancoDelEfectivo(), "STG", "el banco sale de donde compenso el efectivo del mes");
  const tr = recolectarEnTransito();
  const p = tr.filter(function(x){ return x.concepto === "Depósito pendiente de identificar"; });
  eq(p.length, 1, "la venta sin deposito entra al resumen en transito");
  eq(p[0].banco, "STG");
  cerca(p[0].monto, 2384.86);
  cerca(transitoPorMetodo().total, 2989.86);   // 605.00 del Brinks + 2,384.86 de la venta
  // Y sigue DENTRO de Caja General: entro y no salio, asi que no descuadra el saldo contra el transito.
  const c = clasificarTransito();
  eq(c.dentro.filter(function(x){ return x.concepto === "Depósito pendiente de identificar"; }).length, 1);
  cerca(desgloseSaldoCaja().resto, 0);

  // Sin evidencia de donde compensa el efectivo, la partida va sin banco en vez de con uno inventado.
  STATE.results.paso3 = [];
  eq(bancoDelEfectivo(), null, "sin evidencia no se inventa un banco");
  eq(recolectarEnTransito().filter(function(x){ return x.concepto === "Depósito pendiente de identificar"; })[0].banco, "");
  STATE.diarioCaja = null;
});


test("el descargo se reconoce ANTES de buscarle contrapartida en el banco", () => {
  // Un descargo no tiene linea propia en el estado: las que le corresponden ya las consumio el Paso 0.
  // Buscandole match primero, el motor le adjudicaba lineas de OTROS depositos. En febrero de 2026 el
  // descargo de 1,354.25 se llevo la remision V/Mc del 2-feb (759.45) y con esa linea consumida el
  // acumulado de VISA del mes ya no podia cuadrar: 4,148.70 salian "en transito" habiendo compensado.
  const caja = [
    // El asiento de descargo. Su concepto no dice "descargo" -- viene escrito con las palabras de quien lo
    // digito -- asi que se reconoce por sus partidas, no por su texto.
    { fecha: "2026-02-02", referencia: "ME-1855", debito: 0, credito: 759.45, descripcion: "se registra lo que quedo en circulacion en enero STG", fila: 2 },
    { fecha: "2026-02-28", referencia: "ME-1877", debito: 0, credito: 500.00, descripcion: "DEPOSITOS POR TARJETA VISA STG DEL 1 AL 28 DE FEBRERO 2026", fila: 3 }
  ];
  const estStg = [
    { fecha: "2026-02-02", descripcion: "Remisión V/Mc 016005605 Liq. No. 3770756", debito: 0, credito: 759.45, fila: 2 },
    { fecha: "2026-02-12", descripcion: "Remisión V/Mc 016005605 Liq. No. 3781020", debito: 0, credito: 480.00, fila: 3 }
  ];
  // El Paso 0 dice que la partida de 759.45 de enero ya compenso: eso convierte al asiento en descargo.
  const transitoPrevio = [{ banco: "STG", fecha: "2026-01-31", monto: 759.45, concepto: "DEPOSITO POR TARJETA VISA STG DEL 31/01/2026" }];
  const retVisaDia = { "2026-02-12": 20.00 };
  const h = paso2(caja, [], estStg, null, retVisaDia, null, 7, 0.01, null, transitoPrevio);
  const desc = h.filter(function(x){ return String(x.concepto||"").indexOf("Descargo") >= 0; });
  eq(desc.length, 1, "el asiento de enero se reconoce como descargo");
  // Y la remision del 2-feb queda libre, asi que el acumulado de VISA cuadra contra su neto (500 - 20 = 480).
  const transito = h.filter(function(x){ return esEnTransito(x) && String(x.concepto||"").indexOf("VISA STG DEL 1 AL") >= 0; });
  eq(transito.length, 0, "el acumulado del mes no queda en transito: compenso contra las remisiones");
  eq(contarRojas(h), 0, "y no deja diferencias");
});

test("el resumen en transito lleva y lee si el credito a Caja General ya se hizo", () => {
  // Febrero de 2026: los cheques de 273.49 y 238.55 y el Brinks de 605.00 se acreditaron en Caja General al
  // depositarlos y compensaron en marzo. Sin esta columna volvian como si siguieran dentro de la cuenta.
  const rows = [
    ["Fecha","Banco","Monto","Concepto","Comprobante","Motivo","Crédito a Caja General"],
    ["12/02/2026","Banistmo",273.49,"Cheque (detalle individual)","","cheque pendiente por cambiar","ya hecho"],
    ["26/02/2026","STG",605.00,"DEPOSITO BRINKS DEL 26/02/2026","","en tránsito","ya hecho"],
    ["27/02/2026","STG",282.29,"Depósito de fin de mes reportado por la cajera","","depósito de fin de mes — el crédito se registra al compensar","pendiente"]
  ];
  const tr = parseTransitoPrevio(rows);
  eq(tr.sinColumnaCredito, false);
  eq(tr[0].creditoCG, "hecho"); eq(tr[1].creditoCG, "hecho"); eq(tr[2].creditoCG, "pendiente");
  eq(pasaPorCajaGeneral(tr[0]), false, "un cheque ya acreditado no esta dentro de Caja General");
  eq(pasaPorCajaGeneral(tr[2]), true, "el fin de mes si");
  const c = cuadreSaldoInicialPaso0(tr, { inicial: 282.29, fechaInicial: "2026-03-01" });
  eq(c.ok, true, "la apertura solo espera lo que sigue dentro de la cuenta");
  // Un resumen bajado antes de este cambio: se lee igual que siempre y queda marcado para avisar.
  const viejo = parseTransitoPrevio(rows.map(function(r){ return r.slice(0,6); }));
  eq(viejo.sinColumnaCredito, true);
  eq(viejo[0].creditoCG, null);
  eq(pasaPorCajaGeneral(viejo[0]), true, "sin la columna, como hasta ahora");
});

test("un cheque ya acreditado que compensa el mes siguiente no pide asiento de descargo", () => {
  // Era el riesgo de marzo: el panel iba a pedir Debito Banistmo / Credito Caja General por 273.49,
  // acreditando la cuenta por segunda vez.
  STATE.transitoPrevio = null; STATE.diarioCaja = null; STATE.chequesDetalle = null;
  STATE.estados = null; STATE.retVisaDetalle = null;
  STATE.saldoCajaGeneral = { inicial: 246.20, final: 0, fechaFinal: "2026-03-31" };
  const trPrev = [
    { fecha: "2026-02-12", banco: "Banistmo", monto: 273.49, concepto: "Cheque (detalle individual)", comprobante: "", sentido: "credito", creditoCG: "hecho" },
    { fecha: "2026-02-26", banco: "Banistmo", monto: 246.20, concepto: "Depósito de fin de mes reportado por la cajera", comprobante: "", sentido: "credito", creditoCG: "pendiente" }
  ];
  const estB = [
    { fecha: "2026-03-02", descripcion: "DEPOSITO", debito: 0, credito: 246.20, fila: 2 },
    { fecha: "2026-03-11", descripcion: "DEPOSITO", debito: 0, credito: 273.49, fila: 3 }
  ];
  const h0 = paso0(trPrev, estB, [], null, 7, 0.01);
  const comp = h0.filter(function(x){ return /mes anterior/.test(x.motivo || ""); });
  eq(comp.length, 2, "las dos compensaron");
  STATE.results = { paso0: h0 };
  const ap = partidasApertura();
  eq(ap.length, 1, "solo la que seguia dentro de Caja General");
  cerca(ap[0].monto, 246.20);
  cerca(desgloseSaldoCaja().compenso, 246.20, "el descargo no incluye el cheque");
  const ch = comp.filter(function(x){ return Math.abs(x.monto - 273.49) < 0.005; })[0];
  if (ch.texto.indexOf("No lleva asiento de descargo") < 0) throw new Error("el Paso 0 debe decir que no lleva descargo");
  eq(h0.filter(function(x){ return x.clase === "aviso" && /Crédito a Caja General/.test(x.concepto || ""); }).length, 0,
     "con la columna no hay aviso de version anterior");
});

test("lo que sale del cierre vuelve a entrar con su estado, mes tras mes", () => {
  STATE.transitoPrevio = null; STATE.diarioCaja = null; STATE.chequesDetalle = null;
  STATE.estados = null; STATE.retVisaDetalle = null;
  STATE.saldoCajaGeneral = { inicial: 0, final: 887.29, fechaFinal: "2026-02-28" };
  STATE.results = {
    paso0: [{ clase: "en_transito", motivo: "aún pendiente de compensar", banco: "Banistmo", fecha: "2026-01-20", monto: 238.55,
              concepto: "Cheque (detalle individual)", comprobante: "", creditoCG: "hecho", texto: "x" }],
    paso1: [{ clase: "en_transito", motivo: "depósito de fin de mes — el crédito se registra al compensar", banco: "STG", fecha: "2026-02-27",
              monto: 282.29, concepto: "Depósito de fin de mes reportado por la cajera", comprobante: "", texto: "x" }],
    paso3: [{ clase: "en_transito", motivo: "en tránsito", banco: "STG", fecha: "2026-02-26", monto: 605.00,
              concepto: "DEPOSITO BRINKS DEL 26/02/2026", comprobante: "", texto: "x" }]
  };
  let libro = null;
  const orig = XLSX.writeFile;
  XLSX.writeFile = function(wb){ libro = wb; };
  try { exportarEnTransito(); } finally { XLSX.writeFile = orig; }
  if (!libro) throw new Error("no se exporto");
  const rows = XLSX.utils.sheet_to_json(libro.Sheets["En transito"], { header: 1, raw: true });
  const tr = parseTransitoPrevio(rows);
  const por = function(m){ return tr.filter(function(x){ return Math.abs(x.monto - m) < 0.005; })[0]; };
  eq(tr.length, 3);
  eq(por(605.00).creditoCG, "hecho", "Brinks: se acredita al depositar");
  eq(por(282.29).creditoCG, "pendiente", "fin de mes: se acredita al compensar");
  eq(por(238.55).creditoCG, "hecho", "lo ya acreditado no se olvida al pasar otro mes");
});

test("las erratas de una y dos letras se corrigen, pero solo hacia palabras clave y sin ambiguedad", () => {
  // Marzo de 2026: "Banismto" dejo 1,643.08 sin banco y el Paso 1 no pudo reconocer el descargo.
  eq(clasificarBancoPorTexto("deposito Banismto ck 1463.08 del 27/2/2026"), "Banistmo", "dos letras invertidas");
  eq(clasificarBancoPorTexto("DEPOSITO BANISTOM"), "Banistmo");
  if (normTxt("DEPSOITO DE BANISTMO").indexOf("DEPOSITO") < 0) throw new Error("DEPSOITO no se corrigio");
  eq(normTxt("RETENSIONN DEL MES"), "RETENCION DEL MES", "dos letras en una palabra de 10");
  eq(normTxt("REMISON V/MC"), "REMISION V/MC");
  eq(normTxt("COMISION"), "COMISION", "una palabra clave exacta nunca se toca");
  // Resguardos: corregir mal mueve plata de lugar.
  eq(normTxt("YESENIA BLANCO"), "YESENIA BLANCO", "palabras de menos de 6 letras quedan exactas");
  eq(normTxt("CARLOS PEREZ"), "CARLOS PEREZ", "un nombre no se vuelve CARGOS");
  eq(normTxt("deposito omitido"), "DEPOSITO OMITIDO", "OMITIDO no es EMITIDO");
  eq(normTxt("debido a"), "DEBIDO A", "DEBIDO no es DEBITO");
  eq(normTxt("VETA"), "VETA");
});

test("la fecha de origen se lee del texto del asiento", () => {
  eq(fechaOrigenEnTexto("deposito Banistmo tarjeta visa 28/2", "2026-03-01"), "2026-02-28");
  eq(fechaOrigenEnTexto("deposito Banismto ck 1463.08 del 27/2/2026", "2026-03-01"), "2026-02-27");
  eq(fechaOrigenEnTexto("deposito Banismto ck 90.00 y 90.00 28/2", "2026-03-01"), "2026-02-28", "los importes no son fechas");
  eq(fechaOrigenEnTexto("DEPOSITO BRINKS DEL 01/03/2026", "2026-03-01"), null, "la fecha del propio mes no es de origen");
  eq(fechaOrigenEnTexto("deposito del 30/12", "2026-01-02"), "2025-12-30", "cruza el año");
});

function lineaCG(fecha, desc, credito){ return { fecha: fecha, debito: 0, credito: credito, descripcion: desc, referencia: "ME-00000001878", fila: 1 }; }

test("el descargo repartido por medio de pago se reconoce (1-mar-2026, Banistmo, -4,591.04)", () => {
  const reporte = [
    { fecha: "2026-03-01", banco: "Banistmo", metodo: "VISA", monto: 1040.29, cajera: "G" },
    { fecha: "2026-03-01", banco: "Banistmo", metodo: "CLAVE", monto: 752.77, cajera: "G" },
    { fecha: "2026-03-01", banco: "Banistmo", metodo: "CHEQUE", monto: 90.00, cajera: "G" }
  ];
  const cg = [
    lineaCG("2026-03-01", "DEPOSITO DE BANISTMO CK DEL 01/03/2026", 90.00),
    lineaCG("2026-03-01", "DEPOSITO POR TARJETA VISA BANISTMO DEL 01/03/2026", 1793.06),
    lineaCG("2026-03-01", "deposito Banistmo tarjeta visa 28/2", 1013.53),
    lineaCG("2026-03-01", "deposito Banistmo tarjeta clave 28/2", 1468.99),
    lineaCG("2026-03-01", "deposito Banismto ck 90.00 y 90.00 28/2", 180.00),
    lineaCG("2026-03-01", "deposito Banismto ck 1463.08 del 27/2/2026", 1463.08),
    lineaCG("2026-03-01", "deposito Banistmo tarjeta visa 27/2", 1124.69),
    lineaCG("2026-03-01", "deposito Banistmo tarjeta clave 27/2", 983.83)
  ];
  const transito = [
    { fecha: "2026-02-27", banco: "Banistmo", monto: 3571.60, concepto: "Depósito de fin de mes reportado por la cajera", sentido: "credito" },
    { fecha: "2026-02-28", banco: "Banistmo", monto: 2662.52, concepto: "Depósito de fin de mes reportado por la cajera", sentido: "credito" }
  ];
  const h = paso1(reporte, cg, null, 0.01, [], "2026-03-01", transito);
  eq(contarRojas(h), 0, "la diferencia de -4,591.04 era el descargo");
  const d = h.filter(function(x){ return x.clase === "informativo" && /Descargo/.test(x.concepto || ""); });
  eq(d.length, 2, "un descargo por cada partida de febrero");
  const por = function(m){ return d.filter(function(x){ return Math.abs(x.monto - m) < 0.005; })[0]; };
  eq(por(3571.60).lineas.length, 3, "ck + visa + clave del 27-feb");
  eq(por(2662.52).lineas.length, 3, "ck + visa + clave del 28-feb");
  if (por(3571.60).texto.indexOf("suman B/ 3,571.60") < 0) throw new Error("el texto debe decir que las lineas suman la partida");
});

test("un descargo que cita su fecha pero no suma lo mismo marca la diferencia contra la partida, no contra la cajera (1-mar-2026, STG)", () => {
  STATE.decisiones = {};
  const cg = [
    lineaCG("2026-03-01", "deposito brinks St georges 28/2", 2380.00),
    lineaCG("2026-03-01", "deposito efectivo St georges 28/2", 4.88),
    lineaCG("2026-03-01", "deposito brinks St georges 27/2", 280.00),
    lineaCG("2026-03-01", "deposito efectivo St georges 27/2", 2.32)
  ];
  // El resumen de febrero bajado con la version 2026.09.26 traia otros importes.
  const transito = [
    { fecha: "2026-02-27", banco: "STG", monto: 282.29, concepto: "Depósito pendiente de identificar", sentido: "credito" },
    { fecha: "2026-02-28", banco: "STG", monto: 1116.10, concepto: "Depósito pendiente de identificar", sentido: "credito" }
  ];
  const h = paso1([], cg, null, 0.01, [], "2026-03-01", transito);
  const nc = h.filter(function(x){ return /no coincide/.test(x.concepto || ""); });
  eq(nc.length, 2, "una por fecha de origen");
  nc.forEach(function(x){ eq(x.clase, "diff", "es una diferencia real"); });
  const d28 = nc.filter(function(x){ return x.lineas.some(function(l){ return /28\/2/.test(l.descripcion); }); })[0];
  cerca(d28.monto, 1268.78, "la diferencia es contra la partida de 1,116.10, no el total");
  const d27 = nc.filter(function(x){ return x.lineas.some(function(l){ return /27\/2/.test(l.descripcion); }); })[0];
  cerca(d27.monto, 0.03);
  eq(contarRojas(h), 2, "no aparece la diferencia de 2,667.20 contra el reporte de cajeras en cero");
  eq(h.filter(function(x){ return x.clase === "diff" && Math.abs(Math.abs(x.monto) - 2667.20) < 0.01; }).length, 0);
  // El Paso 2 hereda la decision: aparta las lineas y no la vuelve a reportar.
  const dec = STATE.decisiones.descargos.lista.filter(function(d){ return d.dif != null; });
  eq(dec.length, 2, "la decision viaja a los Pasos 2 y 3");
});

test("una linea que cita una fecha del mes anterior sin partida de esa fecha tampoco vuelve al cotejo del dia", () => {
  STATE.decisiones = {};
  const cg = [ lineaCG("2026-03-01", "deposito brinks St georges 25/2", 500.00) ];
  const transito = [{ fecha: "2026-02-27", banco: "STG", monto: 480.00, concepto: "Depósito pendiente de identificar", sentido: "credito" }];
  const h = paso1([], cg, null, 0.01, [], "2026-03-01", transito);
  const nc = h.filter(function(x){ return /no coincide/.test(x.concepto || ""); });
  eq(nc.length, 1);
  cerca(nc[0].monto, 20.00, "contra la partida mas parecida del banco");
  if (nc[0].texto.indexOf("no trae ninguna partida de STG del 2026-02-25") < 0) throw new Error("debe decir que esa fecha no esta: " + nc[0].texto);
  eq(contarRojas(h), 1, "una sola diferencia, no otra contra la cajera");
});

test("el desglose por medio de pago viaja en el resumen y reconoce un descargo sin fecha en el texto", () => {
  const partes = [{ metodo: "CHEQUE", monto: 1463.08 }, { metodo: "VISA", monto: 1124.69 }, { metodo: "CLAVE", monto: 983.83 }];
  // Ida y vuelta por el Excel del cierre.
  STATE.transitoPrevio = null; STATE.diarioCaja = null; STATE.chequesDetalle = null;
  STATE.estados = null; STATE.retVisaDetalle = null;
  STATE.saldoCajaGeneral = { inicial: 0, final: 3571.60, fechaFinal: "2026-02-28" };
  STATE.results = { paso1: [{ clase: "en_transito", motivo: "depósito de fin de mes — el crédito se registra al compensar", banco: "Banistmo",
    fecha: "2026-02-27", monto: 3571.60, concepto: "Depósito de fin de mes reportado por la cajera", comprobante: "", partes: partes, texto: "x" }] };
  let libro = null;
  const orig = XLSX.writeFile;
  XLSX.writeFile = function(wb){ libro = wb; };
  try { exportarEnTransito(); } finally { XLSX.writeFile = orig; }
  const tr = parseTransitoPrevio(XLSX.utils.sheet_to_json(libro.Sheets["En transito"], { header: 1, raw: true }));
  eq(tr.length, 1);
  eq((tr[0].partes || []).length, 3, "el desglose vuelve a entrar");
  eq(tr[0].partes[0].metodo, "CHEQUE");
  cerca(tr[0].partes[0].monto, 1463.08);

  // Lineas SIN fecha de origen y un transito con otra combinacion posible (2,108.52 + 1,463.08 = 3,571.60):
  // sin el desglose seria adivinar; con el desglose es exacto.
  const cg = [
    lineaCG("2026-03-02", "DEPOSITO POR TARJETA VISA BANISTMO", 1124.69),
    lineaCG("2026-03-02", "DEPOSITO POR TARJETA CLAVE BANISTMO", 983.83),
    lineaCG("2026-03-02", "DEPOSITO DE BANISTMO CK", 1463.08)
  ];
  const transito = [
    { fecha: "2026-02-27", banco: "Banistmo", monto: 3571.60, concepto: "Depósito de fin de mes reportado por la cajera", sentido: "credito", partes: partes },
    { fecha: "2026-02-20", banco: "Banistmo", monto: 2108.52, concepto: "deposito en transito", sentido: "credito" },
    { fecha: "2026-02-21", banco: "Banistmo", monto: 1463.08, concepto: "cheque en transito", sentido: "credito" }
  ];
  const h = paso1([], cg, null, 0.01, [], "2026-03-01", transito);
  eq(contarRojas(h), 0);
  const d = h.filter(function(x){ return x.clase === "informativo" && /Descargo/.test(x.concepto || ""); });
  eq(d.length, 1, "un solo descargo");
  eq(d[0].partidas.length, 1, "descarga la partida del desglose, no la otra combinacion");
  cerca(d[0].partidas[0].monto, 3571.60);
});

test("el excedente del dia sin fecha ni desglose solo se da por descargo si la combinacion es unica", () => {
  const cg = [lineaCG("2026-03-02", "DEPOSITO DE BANISTMO CK", 500.00), lineaCG("2026-03-02", "DEPOSITO DE BANISTMO CK", 300.00)];
  // Unica: 800 = 800.
  const unica = paso1([], cg, null, 0.01, [], "2026-03-01",
    [{ fecha: "2026-02-10", banco: "Banistmo", monto: 800.00, concepto: "cheque en transito", sentido: "credito" }]);
  eq(contarRojas(unica), 0, "una sola combinacion posible: descargo");
  // Ambigua: 800 = 800 o 500 + 300 de otras partidas. Queda como diferencia para que se revise.
  const cg2 = [lineaCG("2026-03-02", "DEPOSITO DE BANISTMO CK", 450.00), lineaCG("2026-03-02", "DEPOSITO DE BANISTMO CK", 350.00)];
  const ambigua = paso1([], cg2, null, 0.01, [], "2026-03-01", [
    { fecha: "2026-02-10", banco: "Banistmo", monto: 800.00, concepto: "cheque en transito", sentido: "credito" },
    { fecha: "2026-02-11", banco: "Banistmo", monto: 500.00, concepto: "cheque en transito", sentido: "credito" },
    { fecha: "2026-02-12", banco: "Banistmo", monto: 300.00, concepto: "cheque en transito", sentido: "credito" }
  ]);
  eq(contarRojas(ambigua) > 0, true, "dos combinaciones posibles: no se adivina");
});

test("el Paso 2 aparta el descargo repartido en varias lineas antes de conciliar", () => {
  const caja = [
    { fecha: "2026-03-01", referencia: "ME-00000001878", debito: 0, credito: 1013.53, descripcion: "deposito Banistmo tarjeta visa 28/2", fila: 2 },
    { fecha: "2026-03-01", referencia: "ME-00000001878", debito: 0, credito: 1468.99, descripcion: "deposito Banistmo tarjeta clave 28/2", fila: 3 },
    { fecha: "2026-03-01", referencia: "ME-00000001878", debito: 0, credito: 180.00, descripcion: "deposito Banismto ck 90.00 y 90.00 28/2", fila: 4 }
  ];
  const transitoPrevio = [{ banco: "Banistmo", fecha: "2026-02-28", monto: 2662.52, concepto: "Depósito de fin de mes reportado por la cajera", sentido: "credito" }];
  const h = paso2(caja, [], [], null, {}, null, 7, 0.01, null, transitoPrevio);
  const desc = h.filter(function(x){ return /Descargo/.test(x.concepto || ""); });
  eq(desc.length, 1, "un descargo");
  eq(desc[0].lineas.length, 3);
  eq(h.filter(function(x){ return esEnTransito(x) || x.clase === "diff"; }).length, 0, "sus lineas no quedan en transito ni como diferencia");
});

test("no se avisa 'descargo que no coincide' de lineas que otro reconocimiento si explico", () => {
  // Cita una sola fecha (31/01) pero descarga partidas de dos fechas: no cuadra por fecha de origen y si por
  // partidas. Paso en febrero de 2026 con el asiento de 1,354.25: el aviso salia aunque el descargo se reconocia.
  const cg = [lineaCG("2026-02-02", "DESCARGO DEPOSITOS BRINKS STG AL 31/01", 450.00)];
  const transito = [
    { fecha: "2026-01-31", banco: "STG", monto: 100.00, concepto: "DEPOSITO BRINKS", sentido: "credito" },
    { fecha: "2026-01-29", banco: "STG", monto: 350.00, concepto: "DEPOSITO BRINKS", sentido: "credito" }
  ];
  const h = paso1([], cg, null, 0.01, [], "2026-02-01", transito);
  eq(h.filter(function(x){ return x.clase === "informativo" && /Descargo/.test(x.concepto || ""); }).length, 1, "se reconoce por sus partidas");
  eq(h.filter(function(x){ return x.clase === "aviso" && /no coincide/.test(x.concepto || ""); }).length, 0, "sin aviso falso");
  eq(contarRojas(h), 0);
});

test("el transito anterior se coteja una sola vez: los Pasos 2 y 3 heredan lo que decidio el Paso 0", () => {
  STATE.decisiones = {};
  const trPrev = [{ fecha: "2026-02-27", banco: "Banistmo", monto: 500.00, concepto: "cheque en transito", comprobante: "", sentido: "credito" }];
  const fila = function(){ return [{ fecha: "2026-03-02", descripcion: "DEPOSITO", credito: 500.00, debito: 0, fila: 2 }]; };
  paso0(trPrev, fila(), [], null, 7, 0.01);
  let llamadas = 0;
  const orig = consumirTransitoPrevio;
  consumirTransitoPrevio = function(){ llamadas++; return orig.apply(null, arguments); };
  try {
    const e2 = fila();   // el mismo estado leido de nuevo
    paso2([], e2, [], null, null, null, 7, 0.01, null, trPrev);
    eq(e2[0]._transitoUsado, true, "el Paso 2 aparta la linea que uso el Paso 0");
    const e3 = fila();
    paso3([], [], e3, [], null, null, 7, 0.01, null, trPrev);
    eq(e3[0]._transitoUsado, true, "el Paso 3 tambien");
  } finally { consumirTransitoPrevio = orig; }
  eq(llamadas, 0, "ni el Paso 2 ni el Paso 3 vuelven a cotejar el transito");
  // Con OTRO estado de cuenta la decision no aplica y el paso coteja por su cuenta.
  STATE.decisiones = {};
  paso0(trPrev, fila(), [], null, 7, 0.01);
  const otro = [{ fecha: "2026-03-05", descripcion: "DEPOSITO", credito: 500.00, debito: 0, fila: 9 }];
  paso2([], otro, [], null, null, null, 7, 0.01, null, trPrev);
  eq(otro[0]._transitoUsado, true, "con otro archivo decide de nuevo, no usa la decision vieja");
});

test("el descargo se decide en el Paso 1 y el Paso 2 lo hereda aunque el texto no tenga fecha", () => {
  STATE.decisiones = {};
  const partes = [{ metodo: "CHEQUE", monto: 1463.08 }, { metodo: "VISA", monto: 1124.69 }, { metodo: "CLAVE", monto: 983.83 }];
  const trPrev = [{ fecha: "2026-02-27", banco: "Banistmo", monto: 3571.60, concepto: "Depósito de fin de mes reportado por la cajera", sentido: "credito", partes: partes }];
  const cg = [
    lineaCG("2026-03-02", "DEPOSITO POR TARJETA VISA BANISTMO", 1124.69),
    lineaCG("2026-03-02", "DEPOSITO POR TARJETA CLAVE BANISTMO", 983.83),
    lineaCG("2026-03-02", "DEPOSITO DE BANISTMO CK", 1463.08)
  ];
  // El banco acredito la partida de febrero de una vez: esa linea la consume el Paso 0.
  const estB = [{ fecha: "2026-03-02", descripcion: "DEPOSITO", credito: 3571.60, debito: 0, fila: 4 }];
  paso0(trPrev, estB, [], null, 7, 0.01);
  const h1 = paso1([], cg, null, 0.01, [], "2026-03-01", trPrev);
  eq(contarRojas(h1), 0, "el Paso 1 lo reconoce por el desglose");
  const h2 = paso2(cg, [{ fecha: "2026-03-02", descripcion: "DEPOSITO", credito: 3571.60, debito: 0, fila: 4 }], [], null, null, null, 7, 0.01, null, trPrev);
  eq(h2.filter(function(x){ return /Descargo/.test(x.concepto || ""); }).length, 1, "el Paso 2 usa el descargo del Paso 1");
  eq(contarRojas(h2), 0, "y sus lineas no salen como depositos sin compensar");
});

test("el informe de cajeras trae el efectivo por dia", () => {
  const rows = [
    [],
    [null, null, null, "EFECTIVO", null, null, "TARJETA", null],
    ["Fecha", "Empresa", "Cajera", "Efectivo\nBrink", "Efectivo\nVentanilla", "efectivo Yappy\nclb(-)", "Visa\nSr.George", "Visa\nBanistmo"],
    ["15/03/2026", "PETTY", "GENESIS", 535.00, 3.61, 0, null, 100.00],
    ["16/03/2026", "PETTY", "EIRA", 320.00, 0, 0, null, null]
  ];
  const r = parseReporteConsolidado(rows);
  eq((r.efectivo || []).length, 3, "535 + 3.61 del 15 y 320 del 16");
  eq(r.efectivo[0].tipo, "BRINK"); eq(r.efectivo[1].tipo, "VENTANILLA");
  eq(r.efectivo[0].fecha, "2026-03-15");
  eq((r.sinMapear || []).filter(function(c){ return /brink|ventanilla/i.test(c.etiqueta); }).length, 0, "el efectivo ya no queda como metodo sin cotejar");
});

test("el efectivo de la cajera se coteja contra Caja General en el Paso 1", () => {
  STATE.decisiones = {};
  const rep = [{ fecha: "2026-03-10", banco: "STG", metodo: "VISA", monto: 100.00, cajera: "A" }];
  rep.efectivo = [
    { fecha: "2026-03-10", tipo: "BRINK", monto: 535.00 }, { fecha: "2026-03-10", tipo: "VENTANILLA", monto: 3.61 },
    { fecha: "2026-03-31", tipo: "BRINK", monto: 280.00 }
  ];
  const base = [
    lineaCG("2026-03-10", "DEPOSITO POR TARJETA VISA STG DEL 10/03/2026", 100.00),
    lineaCG("2026-03-10", "DEPOSITO BRINKS DEL 10/03/2026", 535.00)
  ];
  const completo = base.concat([lineaCG("2026-03-10", "DEPOSITO DEL 10/03/2026", 3.61)]);
  const h = paso1(rep, completo, null, 0.01, [], "2026-03-01", null);
  eq(contarRojas(h), 0, "Brink + ventanilla = lo acreditado");
  const fin = h.filter(function(x){ return esEnTransito(x) && /Efectivo de fin de mes/.test(x.concepto || ""); });
  eq(fin.length, 1, "el Brinks del 31 sin credito queda en transito");
  cerca(fin[0].monto, 280.00);
  // Falta asentar la ventanilla: diferencia roja.
  const falta = paso1(rep, base, null, 0.01, [], "2026-03-01", null);
  const rojas = falta.filter(function(x){ return !esNoRojo(x); });
  eq(rojas.length, 1);
  if (rojas[0].texto.indexOf("Efectivo 2026-03-10") < 0) throw new Error("debe decir que es el efectivo: " + rojas[0].texto);
});

/* Al cierre, Caja General puede tener el credito de un efectivo que el informe de la cajera no trae. El
   credito YA se hizo, asi que la plata salio de la cuenta: lo que queda en transito es del lado del banco y
   lo reporta el Paso 2 (hereda la misma linea). Emitirlo tambien como diferencia en el Paso 1 lo contaba
   dos veces. Caso real: 28-may-2026, "DEPOSITO DEL 28/5/2026" por 73.00 en ventanilla, informe en 0.00. */
test("el efectivo asentado al cierre que el informe no trae es aviso, no diferencia (28-may-2026)", () => {
  STATE.decisiones = {};
  const rep = [{ fecha: "2026-05-28", banco: "STG", metodo: "VISA", monto: 100.00, cajera: "A" }];
  rep.efectivo = [{ fecha: "2026-05-20", tipo: "BRINK", monto: 400.00 }];
  const cg = [
    lineaCG("2026-05-20", "DEPOSITO BRINKS DEL 20/05/2026", 400.00),
    lineaCG("2026-05-28", "DEPOSITO POR TARJETA VISA STG DEL 28/05/2026", 100.00),
    lineaCG("2026-05-28", "DEPOSITO DEL 28/5/2026", 73.00),
    lineaCG("2026-05-29", "DEPOSITO POR TARJETA VISA STG DEL 29/05/2026", 0.01)
  ];
  const h = paso1(rep, cg, null, 0.01, [], "2026-05-01", null);
  eq(contarRojas(h), 0, "el efectivo de ventanilla del cierre no es una diferencia");
  const av = h.filter(function(x){ return esAviso(x) && /informe de la cajera no trae/.test(x.concepto || ""); });
  eq(av.length, 1, "sale como aviso de archivo de origen");
  cerca(av[0].monto, 73.00, "el monto del aviso es lo que falta en el informe");
  eq(av[0].fecha, "2026-05-28");
  if (av[0].texto.indexOf("falta es la línea en el informe de la cajera") < 0)
    throw new Error("el aviso debe decir que falta la linea en el informe: " + av[0].texto);
  // Y no viaja como transito de Caja General: eso inflaria el saldo de apertura del mes siguiente.
  eq(h.filter(function(x){ return esEnTransito(x) && Math.abs((x.monto||0) - 73.00) < 0.005; }).length, 0,
     "el credito ya se hizo: no es transito DENTRO de Caja General");
});

/* El guard: el aviso es solo para el cierre. En medio del mes no hay rezago del banco que lo explique, asi
   que un efectivo asentado que la cajera no reporto sigue siendo una diferencia roja. */
test("un efectivo asentado sin reportar en MEDIO del mes sigue siendo diferencia", () => {
  STATE.decisiones = {};
  const rep = []; rep.efectivo = [{ fecha: "2026-05-20", tipo: "BRINK", monto: 400.00 }];
  const cg = [
    lineaCG("2026-05-10", "DEPOSITO DEL 10/5/2026", 73.00),
    lineaCG("2026-05-20", "DEPOSITO BRINKS DEL 20/05/2026", 400.00),
    lineaCG("2026-05-29", "DEPOSITO BRINKS DEL 29/05/2026", 0.01)
  ];
  const h = paso1(rep, cg, null, 0.01, [], "2026-05-01", null);
  const rojas = h.filter(function(x){ return !esNoRojo(x); });
  eq(rojas.length, 1, "el 10 de mayo no es cierre: la diferencia queda");
  eq(rojas[0].fecha, "2026-05-10");
  cerca(rojas[0].monto, -73.00, "sigue con el signo de siempre");
});

/* Y el caso inverso no cambia: cuando la cajera SI reporto y Caja General no acredito, la plata sigue
   DENTRO de la cuenta y viaja al resumen como transito. */
test("el efectivo de cierre reportado y sin asentar sigue siendo tránsito", () => {
  STATE.decisiones = {};
  const rep = []; rep.efectivo = [
    { fecha: "2026-05-20", tipo: "BRINK", monto: 400.00 },
    { fecha: "2026-05-29", tipo: "VENTANILLA", monto: 73.00 }
  ];
  const cg = [
    lineaCG("2026-05-20", "DEPOSITO BRINKS DEL 20/05/2026", 400.00),
    lineaCG("2026-05-29", "DEPOSITO POR TARJETA VISA STG DEL 29/05/2026", 0.01)
  ];
  const h = paso1(rep, cg, null, 0.01, [], "2026-05-01", null);
  eq(contarRojas(h), 0);
  const fin = h.filter(function(x){ return esEnTransito(x) && /Efectivo de fin de mes/.test(x.concepto || ""); });
  eq(fin.length, 1, "sin credito a Caja General, sigue adentro y viaja al resumen");
  cerca(fin[0].monto, 73.00);
});

test("el Paso 2 busca en el banco el efectivo que decidio el Paso 1", () => {
  STATE.decisiones = {};
  const rep = []; rep.efectivo = [{ fecha: "2026-03-10", tipo: "BRINK", monto: 535.00 }, { fecha: "2026-03-10", tipo: "VENTANILLA", monto: 3.61 }];
  const cg = [lineaCG("2026-03-10", "DEPOSITO BRINKS DEL 10/03/2026", 535.00), lineaCG("2026-03-10", "DEPOSITO DEL 10/03/2026", 3.61)];
  eq(contarRojas(paso1(rep, cg, null, 0.01, [], "2026-03-01", null)), 0);
  // El banco lo acredito consolidado dos dias despues.
  const estS = [{ fecha: "2026-03-12", descripcion: "ACH DE BRINKS PANAMA", credito: 538.61, debito: 0, fila: 2 }];
  eq(contarRojas(paso2(cg, [], estS, null, null, null, 7, 0.01, null, null)), 0, "encuentra el efectivo consolidado");
  // Si el banco no lo tiene, es diferencia.
  const sinEf = [{ fecha: "2026-03-12", descripcion: "ACH DE BRINKS PANAMA", credito: 100.00, debito: 0, fila: 2 }];
  const h = paso2(cg, [], sinEf, null, null, null, 7, 0.01, null, null);
  eq(h.filter(function(x){ return x.clase === "diff" && /efectivo/i.test(x.texto || ""); }).length, 2, "Brinks y ventanilla sin credito en el banco");
});

test("el efectivo que el banco acredita junto con un deposito ajeno a Caja General compensa (deposito mixto)", () => {
  // 04-feb-2026: STG acredito 4,465.00 = 265.00 del Brinks del 02-feb + 4,200.00 de caja menuda (PDN-000000044),
  // que esta solo en el diario del banco. Los 265.00 salian como "no aparece en el estado de cuenta".
  STATE.decisiones = {};
  const rep = []; rep.efectivo = [{ fecha: "2026-02-02", tipo: "BRINK", monto: 265.00 }];
  const cg = [lineaCG("2026-02-02", "DEPOSITO BRINKS DEL 02/02/2026", 265.00)];
  cg[0].referencia = "ME-00000001855";
  eq(contarRojas(paso1(rep, cg, null, 0.01, [], "2026-02-01", null)), 0);
  const estS = function(){ return [{ fecha: "2026-02-04", descripcion: "Ach De Brinks Panama, S.A. - D08563bsafe 030226 David", credito: 4465.00, debito: 0, fila: 2 }]; };
  const diarioStg = [
    { fecha: "2026-02-02", debito: 265.00, credito: 0, descripcion: "DEPOSITO BRINKS DEL 02/02/2026", referencia: "ME-00000001855", fila: 3 },
    { fecha: "2026-02-04", debito: 4200.00, credito: 0, descripcion: "dueños/préstamo interno - caja menuda", referencia: "PDN-000000044", fila: 4 }
  ];
  const h = paso2(cg, [], estS(), null, null, null, 7, 0.01, null, null, { STG: diarioStg });
  eq(contarRojas(h), 0, "compensa dentro del deposito mixto");
  const m = h.filter(function(x){ return x.motivo === "compensó en un depósito mixto"; });
  eq(m.length, 1);
  ["4,465.00", "4,200.00", "PDN-000000044"].forEach(function(s){ if (m[0].texto.indexOf(s) < 0) throw new Error("al texto le falta " + s); });

  // Sin el diario del banco el resto no esta explicado: sigue siendo diferencia.
  eq(contarRojas(paso2(cg, [], estS(), null, null, null, 7, 0.01, null, null)), 1, "sin diario, no se adivina");
  // Si el resto lo explica un asiento que SI esta en Caja General (otro deposito del navegador), tampoco.
  const diario2 = [{ fecha: "2026-02-04", debito: 4200.00, credito: 0, descripcion: "DEPOSITO", referencia: "ME-00000001855", fila: 4 }];
  eq(contarRojas(paso2(cg, [], estS(), null, null, null, 7, 0.01, null, null, { STG: diario2 })), 1, "el resto tiene que ser ajeno a Caja General");
});

test("el Paso 4 no usa una remision VISA que el Paso 2 asigno a otra venta", () => {
  STATE.decisiones = {};
  const estStg = function(){ return [{ fecha: "2026-03-11", descripcion: "Remisión V/Mc 016005605", credito: 95.00, debito: 0, fila: 5 }]; };
  const cg = [lineaCG("2026-03-10", "DEPOSITO POR TARJETA VISA STG DEL 10/03/2026", 100.00)];
  const e = estStg();
  eq(contarRojas(paso2(cg, [], e, null, { "2026-03-10": 5.00 }, null, 7, 0.01, null, null)), 0, "el Paso 2 asigna la remision a la venta del 10");
  // El informe lista primero el 11: sin la asignacion, el 11 se llevaba la remision del 10.
  const ret = [
    { fecha: "2026-03-11", bruto: 100.00, retenciones: -5.00, neto: 95.00 },
    { fecha: "2026-03-10", bruto: 100.00, retenciones: -5.00, neto: 95.00 }
  ];
  const h = paso4(ret, e, 7, 0.01);
  eq(h.length, 1, "un solo dia sin remision");
  eq(h[0].fecha, "2026-03-11", "y es el 11: la remision ya pago la venta del 10");
});

test("el año mal tecleado no convierte el efectivo del dia en descargo (02-ene-2026)", () => {
  eq(fechaOrigenEnTexto("DEPOSITO BRINKS DEL 02/01/2025", "2026-01-02"), null, "mismo dia y mes: es la fecha del asiento");
  eq(fechaOrigenEnTexto("deposito Banistmo tarjeta visa 28/2", "2026-03-01"), "2026-02-28", "una fecha de otro dia sigue siendo origen");
  STATE.decisiones = {};
  const rep = []; rep.efectivo = [{ fecha: "2026-01-02", tipo: "BRINK", monto: 740.00 }, { fecha: "2026-01-02", tipo: "VENTANILLA", monto: 55.76 }];
  const cg = [lineaCG("2026-01-02", "DEPOSITO BRINKS DEL 02/01/2025", 740.00), lineaCG("2026-01-02", "DEPOSITO DEL 02/01/2025", 55.76)];
  eq(contarRojas(paso1(rep, cg, null, 0.01, [], "2026-01-01", null)), 0, "el efectivo del dia cuadra con la cajera");
});

test("el Paso 3 no reabre un descargo que el Paso 1 ya decidio (164.08 del 27-jun-2026)", () => {
  // Una linea que nombra banco la vio el Paso 1: si la cajera la reporto, es deposito del mes. El Paso 3 la
  // tomaba como descargo de otro cheque de 164.08 de mayo y los dos pasos se contradecian.
  STATE.decisiones = {};
  const trPrev = [{ fecha: "2026-05-20", banco: "Banistmo", monto: 164.08, concepto: "cheque en transito", sentido: "credito" }];
  const estB = function(){ return [{ fecha: "2026-06-03", descripcion: "DEPOSITO", credito: 164.08, debito: 0, fila: 2 }]; };
  paso0(trPrev, estB(), [], null, 7, 0.01);
  const rep = [{ fecha: "2026-06-27", banco: "Banistmo", metodo: "CHEQUE", monto: 164.08, cajera: "A" }];
  const cg = [lineaCG("2026-06-27", "DEPOSITO DE BANISTMO CK DEL 27/6/2026", 164.08)];
  const h1 = paso1(rep, cg, null, 0.01, [], "2026-06-01", trPrev);
  eq(h1.filter(function(x){ return /Descargo/.test(x.concepto || ""); }).length, 0, "el Paso 1 lo coteja contra la cajera");
  const dB = [{ fecha: "2026-06-27", debito: 164.08, credito: 0, descripcion: "DEPOSITO DE BANISTMO CK DEL 27/6/2026", referencia: "ME-00000001878", fila: 3 }];
  const h3 = paso3(dB, [], estB(), [], null, null, 7, 0.01, null, trPrev);
  eq(h3.filter(function(x){ return /Descargo/.test(x.concepto || ""); }).length, 0, "el Paso 3 no lo convierte en descargo");
});

test("el efectivo toma la combinacion del banco mas cercana a su fecha (junio de 2026)", () => {
  // El 13 tiene sus 4.90 el 15; los 4.90 del 19 son del 17. Con la primera combinacion que sumaba, el 13 se
  // llevaba los del 19 y el 17 quedaba sin compensar.
  STATE.decisiones = {};
  const rep = []; rep.efectivo = [{ fecha: "2026-06-13", tipo: "BRINK", monto: 869.90 }, { fecha: "2026-06-17", tipo: "BRINK", monto: 364.90 }];
  const cg = [lineaCG("2026-06-13", "DEPOSITO BRINKS DEL 13/6/2026", 869.90), lineaCG("2026-06-17", "DEPOSITO BRINKS DEL 17/6/2026", 364.90)];
  eq(contarRojas(paso1(rep, cg, null, 0.01, [], "2026-06-01", null)), 0);
  // Ordenado como el estado real: de la fecha mas nueva a la mas vieja.
  const estS = [
    { fecha: "2026-06-19", descripcion: "Ach De Brink S Panama 180626", credito: 360.00, debito: 0, fila: 1 },
    { fecha: "2026-06-19", descripcion: "Descripción", credito: 4.90, debito: 0, fila: 2 },
    { fecha: "2026-06-16", descripcion: "Ach De Brinks Panama 140626", credito: 865.00, debito: 0, fila: 3 },
    { fecha: "2026-06-15", descripcion: "Descripción", credito: 4.90, debito: 0, fila: 4 }
  ];
  eq(contarRojas(paso2(cg, [], estS, null, null, null, 7, 0.01, null, null)), 0, "cada dia encuentra su propio efectivo");
});

test("la venta sin deposito no se confunde con el efectivo de fin de mes del mismo dia (28-mar-2026)", () => {
  // La cajera reporto 189.31 de ventanilla y Caja General acredito 31.40: quedan 157.91 de efectivo en transito.
  // Aparte, la venta del dia deja 65.10 sin ningun deposito. Las dos cosas viajan al mes siguiente.
  STATE.decisiones = {}; STATE.transitoPrevio = null; STATE.chequesDetalle = null; STATE.estados = null; STATE.retVisaDetalle = null;
  STATE.diarioCaja = [
    { fecha: "2026-03-28", referencia: "ME-00000001905", debito: 2002.43, credito: 0, descripcion: "REPORTE DE VENTA DEL 28/03/2026", fila: 1 },
    { fecha: "2026-03-28", referencia: "ME-00000001905", debito: 0, credito: 1779.42, descripcion: "DEPOSITO POR TARJETA VISA BANISTMO DEL 28/03/2026", fila: 2 }
  ];
  STATE.results = { paso1: [{ clase: "en_transito", fecha: "2026-03-28", banco: "STG", monto: 157.91,
    concepto: "Efectivo de fin de mes reportado por la cajera", comprobante: "", motivo: "efectivo de fin de mes sin crédito en Caja General",
    partes: [{ metodo: "EFECTIVO VENTANILLA", monto: 189.31 }], texto: "x" }] };
  const tr = recolectarEnTransito();
  eq(tr.length, 2, "el efectivo y la venta sin deposito");
  cerca(tr.reduce(function(a, x){ return a + x.monto; }, 0), 223.01, "157.91 + 65.10");
});

test("el Paso 0 dice en su propio resultado si la apertura de Caja General cuadra", () => {
  STATE.decisiones = {}; STATE.diarioCaja = [];
  const trPrev = [{ fecha: "2026-02-20", banco: "Banistmo", monto: 500.00, concepto: "cheque en transito", sentido: "credito" }];
  STATE.saldoCajaGeneral = { inicial: 500.00, fechaInicial: "2026-03-01", final: 0, fechaFinal: "2026-03-31" };
  const ok = paso0(trPrev, [], [], null, 7, 0.01);
  const cuadra = ok.filter(function(x){ return /Apertura de Caja General cuadrada/.test(x.concepto || ""); });
  eq(cuadra.length, 1, "lo dice el Paso 0, no solo el panel del saldo");
  eq(contarRojas(ok), 0);
  // Y cuando no cuadra, lo avisa con la diferencia.
  STATE.decisiones = {};
  STATE.saldoCajaGeneral = { inicial: 400.00, fechaInicial: "2026-03-01", final: 0, fechaFinal: "2026-03-31" };
  const mal = paso0(trPrev, [], [], null, 7, 0.01);
  const av = mal.filter(function(x){ return x.clase === "aviso" && /apertura/i.test(x.concepto || ""); });
  eq(av.length, 1, "avisa que no cuadra");
  cerca(av[0].monto, 100.00);
});

test("la venta que entra y no sale la detecta el Paso 1, no el cierre", () => {
  STATE.decisiones = {}; STATE.transitoPrevio = null; STATE.chequesDetalle = null; STATE.estados = null; STATE.retVisaDetalle = null;
  const reporte = [{ fecha: "2026-03-10", banco: "Banistmo", metodo: "VISA", monto: 700.00, cajera: "A" }];
  const cg = [
    { fecha: "2026-03-10", referencia: "ME-00000001900", debito: 1000.00, credito: 0, descripcion: "REPORTE DE VENTA DEL 10/03/2026", fila: 1 },
    { fecha: "2026-03-10", referencia: "ME-00000001900", debito: 0, credito: 700.00, descripcion: "DEPOSITO POR TARJETA VISA BANISTMO DEL 10/03/2026", fila: 2 }
  ];
  const h = paso1(reporte, cg, null, 0.01, [], "2026-03-01", null);
  const vsd = h.filter(function(x){ return /Depósito pendiente de identificar/.test(x.concepto || ""); });
  eq(vsd.length, 1, "el Paso 1 la denuncia en su propio resultado");
  cerca(vsd[0].monto, 300.00, "1,000 de venta menos 700 acreditados");
  eq(contarRojas(h), 0, "no es una diferencia: es plata que sigue pendiente de depositar");
  // Y en el cierre no se cuenta dos veces.
  STATE.diarioCaja = cg; STATE.results = { paso1: h };
  const tr = recolectarEnTransito().filter(function(x){ return /Depósito pendiente de identificar/.test(x.concepto || ""); });
  eq(tr.length, 1, "una sola vez en el resumen");
});

test("los cheques los decide el Paso 2 y el Paso 3 verifica el total del navegador", () => {
  STATE.decisiones = {};
  const detalle = [
    { fecha: "2026-03-05", banco: "Banistmo", monto: 100.00 },
    { fecha: "2026-03-06", banco: "Banistmo", monto: 50.00 }
  ];
  const cg = [
    lineaCG("2026-03-05", "DEPOSITO DE BANISTMO CK DEL 05/03/2026", 100.00),
    lineaCG("2026-03-06", "DEPOSITO DE BANISTMO CK DEL 06/03/2026", 50.00)
  ];
  // El banco los junta en un solo deposito.
  const estB = function(){ return [{ fecha: "2026-03-08", descripcion: "DEPOSITO", credito: 150.00, debito: 0, fila: 2 }]; };
  const h2 = paso2(cg, estB(), [], null, null, detalle, 7, 0.01, null, null);
  eq(contarRojas(h2), 0, "los dos cheques clarean en el Paso 2");
  eq(h2.filter(esEnTransito).length, 0, "ninguno queda pendiente");
  // El Paso 3 no los vuelve a clarear: recibe las lineas usadas y solo verifica el navegador.
  // Cada corrida con filas nuevas: el Paso 3 marca las que usa y no se pueden reusar entre llamadas.
  const dB = function(){ return [
    { fecha: "2026-03-05", debito: 100.00, credito: 0, descripcion: "DEPOSITO DE BANISTMO CK DEL 05/03/2026", referencia: "ME-1", fila: 2 },
    { fecha: "2026-03-06", debito: 50.00, credito: 0, descripcion: "DEPOSITO DE BANISTMO CK DEL 06/03/2026", referencia: "ME-2", fila: 3 }
  ]; };
  const h3 = paso3(dB(), [], estB(), [], null, null, 7, 0.01, null, null);
  eq(contarRojas(h3), 0, "el deposito de 150 ya lo explico el Paso 2");
  eq(h3.filter(esEnTransito).length, 0, "y los cheques no vuelven a quedar en transito");
  // Si al navegador del banco le falta un cheque, el Paso 3 lo avisa.
  const h3b = paso3([dB()[0]], [], estB(), [], null, null, 7, 0.01, null, null);
  const av = h3b.filter(function(x){ return x.clase === "aviso" && /cheque/i.test(x.concepto || ""); });
  eq(av.length, 1, "avisa que el navegador no tiene todos los cheques");
  if (av[0].texto.indexOf("150.00") < 0 || av[0].texto.indexOf("100.00") < 0) throw new Error("el aviso debe decir los dos totales: " + av[0].texto);
});

test("un asiento repetido en el navegador del banco no viaja en silencio al resumen", () => {
  STATE.decisiones = {};
  // El mismo deposito, dos veces, bajo el mismo comprobante, y ninguno compensa en el estado.
  const linea = function(fila){ return { fecha: "2026-03-10", referencia: "ME-00000001900", debito: 300.00, credito: 0,
    descripcion: "DEPOSITO POR TARJETA VISA BANISTMO DEL 10/03/2026", fila: fila }; };
  const h = paso3([linea(2), linea(3)], [], [], [], null, null, 7, 0.01, null, null);
  const av = h.filter(function(x){ return x.clase === "aviso" && /repetido/i.test(x.concepto || ""); });
  eq(av.length, 1, "un solo aviso, no uno por copia");
  if (av[0].texto.indexOf("2 veces") < 0) throw new Error("el aviso debe decir cuantas veces aparece: " + av[0].texto);
  eq(h.filter(esEnTransito).length, 2, "siguen en transito: el aviso no cambia el arrastre");
  // Un deposito que aparece una sola vez no genera aviso.
  STATE.decisiones = {};
  const h2 = paso3([linea(2)], [], [], [], null, null, 7, 0.01, null, null);
  eq(h2.filter(function(x){ return x.clase === "aviso" && /repetido/i.test(x.concepto || ""); }).length, 0);
});

test("al arranque del mes, el Paso 3 dice si el resumen del mes anterior no trae esa partida", () => {
  STATE.decisiones = {}; STATE.diarioCaja = null;
  const estB = function(){ return [{ fecha: "2026-03-02", descripcion: "CR REMISION - V/MC PAGO DE FACTURACION", credito: 230.31, debito: 0, fila: 2 }]; };
  // Sin resumen del mes anterior: es el respaldo por fecha y queda en transito para confirmar.
  const sinResumen = paso3([], [], estB(), [], null, null, 7, 0.01, null, null);
  eq(contarRojas(sinResumen), 0);
  eq(sinResumen.filter(esEnTransito).length, 1, "sin resumen, se confirma a mano");
  // Con resumen que trae esa misma partida pendiente, el Paso 0 la da por compensada y consume la linea:
  // el Paso 3 ni siquiera la ve, que es lo correcto.
  const trPrev = [{ fecha: "2026-02-28", banco: "Banistmo", monto: 230.31, concepto: "Remisión V/Mc de fin de mes", sentido: "credito" }];
  STATE.decisiones = {};
  const est2 = estB();
  const conPartida = paso3([], [], est2, [], null, null, 7, 0.01, null, trPrev);
  eq(est2[0]._transitoUsado, true, "la compensó el Paso 0");
  eq(conPartida.length, 0, "el Paso 3 no tiene nada que decir de esa línea");
  // Con resumen que NO la trae: no se silencia como transito, se pide confirmarla. No bloquea: puede ser
  // legitima (su asiento esta en el navegador del mes pasado, como las remisiones del 02-feb-2026).
  const otro = [{ fecha: "2026-02-28", banco: "Banistmo", monto: 99.99, concepto: "cheque en transito", sentido: "credito" }];
  STATE.decisiones = {};
  const sinPartida = paso3([], [], estB(), [], null, null, 7, 0.01, null, otro);
  eq(contarRojas(sinPartida), 0, "no bloquea el paso");
  const sc = sinPartida.filter(esSinConfirmar);
  eq(sc.length, 1, "queda como sin confirmar");
  if (sc[0].texto.indexOf("no trae ninguna partida de ese importe") < 0) throw new Error("debe decir por que: " + sc[0].texto);
});

test("una fecha mal tecleada en la venta del dia no se toma por descargo si la cajera la reporto (4-jun-2026, 04/5)", () => {
  STATE.decisiones = {};
  const reporte = [{ fecha: "2026-06-04", banco: "Banistmo", metodo: "CLAVE", monto: 130.45, cajera: "A" }];
  const cg = [ lineaCG("2026-06-04", "DEPOSITO POR TAREJTA CLAVE BTS DEL 04/5/2026", 130.45) ];
  const transito = [{ fecha: "2026-04-11", banco: "Banistmo", monto: 164.08, concepto: "deposito de Banistmo CK", sentido: "credito" }];
  const h = paso1(reporte, cg, null, 0.01, [], "2026-06-01", transito);
  eq(contarRojas(h), 0, "la venta del dia cuadra con la cajera");
  eq(h.filter(function(x){ return /no coincide/.test(x.concepto || ""); }).length, 0, "no se reporta como descargo");
});

test("el cierre dice en qué días buscar el residuo, y el cuadro suma exactamente el residuo", () => {
  STATE.transitoPrevio = null; STATE.estados = null; STATE.chequesDetalle = null; STATE.decisiones = {};
  // Dos días de venta: el primero deja la retención de tarjeta, el segundo un hueco de 200 que no explica nadie.
  STATE.diarioCaja = [
    { fecha: "2026-05-04", debito: 1000.00, credito: 0, descripcion: "REPORTE DE VENTA DEL 04/05/2026", referencia: "ME-1", fila: 1 },
    { fecha: "2026-05-04", debito: 0, credito: 950.00, descripcion: "DEPOSITO POR TARJETA VISA STG DEL 04/05/2026", referencia: "ME-1", fila: 2 },
    { fecha: "2026-05-05", debito: 1000.00, credito: 0, descripcion: "REPORTE DE VENTA DEL 05/05/2026", referencia: "ME-2", fila: 3 },
    { fecha: "2026-05-05", debito: 0, credito: 800.00, descripcion: "DEPOSITO POR TARJETA VISA STG DEL 05/05/2026", referencia: "ME-2", fila: 4 },
    { fecha: "2026-05-06", debito: 300.00, credito: 0, descripcion: "AJUSTA SALDO ERRADO DE LA CAJA GENERAL", referencia: "ME-3", fila: 5 }
  ];
  STATE.retVisaDetalle = [{ fecha: "2026-05-04", bruto: 1000.00, retenciones: -50.00, neto: 950.00 }];
  STATE.saldoCajaGeneral = { inicial: 0, final: 550.00, fechaInicial: "2026-05-01", fechaFinal: "2026-05-31" };
  STATE.results = { paso0: [], paso1: [], paso2: [], paso3: [] };
  const d = desgloseSaldoCaja();
  const p = pistasResiduo();
  cerca(p.total, d.resto, "el cuadro suma el residuo, no un número aparte");
  const d4 = p.dias.filter(function(x){ return x.fecha === "2026-05-04"; })[0];
  cerca(d4.sinExplicar, 50.00, "el día normal deja solo la retención");
  cerca(d4.retencion, 50.00, "y al lado se ve la retención del informe para compararla");
  // El hueco de 200 del día 5 no es residuo: es una venta que entró y no salió, con su propio renglón.
  eq(p.dias.filter(function(x){ return x.fecha === "2026-05-05"; }).length, 0);
  eq(p.dias[0].fecha, "2026-05-06", "el mayor va primero");
  cerca(p.dias[0].sinExplicar, 300.00, "el ajuste que no es venta ni depósito");
  eq(p.dias.length, 2);
  // El ajuste, que no es venta ni depósito, se lista aparte para poder ir a buscarlo.
  eq(p.otros.length, 1);
  cerca(p.otros[0].monto, 300.00);
  const h = desgloseSaldoCajaHtml();
  if (h.indexOf("Dónde buscar") < 0) throw new Error("el cuadro tiene que salir en el reporte");
  if (h.indexOf("AJUSTA SALDO ERRADO") < 0) throw new Error("y listar el asiento que no es venta ni depósito");
});

test("el descargo del mes anterior no aparece como un hueco del día: se empareja con la apertura", () => {
  STATE.decisiones = {}; STATE.estados = null; STATE.chequesDetalle = null; STATE.retVisaDetalle = null;
  STATE.transitoPrevio = [{ fecha: "2026-04-28", banco: "STG", monto: 500.00, concepto: "deposito en transito", sentido: "credito" }];
  STATE.diarioCaja = [
    { fecha: "2026-05-04", debito: 0, credito: 500.00, descripcion: "deposito St georges 28/4", referencia: "ME-1", fila: 1 }
  ];
  STATE.saldoCajaGeneral = { inicial: 500.00, final: 0, fechaInicial: "2026-05-01", fechaFinal: "2026-05-31" };
  STATE.results = { paso0: [], paso1: [{ clase:"informativo", concepto:"Descargo de tránsito", banco:"STG", fecha:"2026-05-04",
    monto:500.00, texto:"x", partidas:[{banco:"STG", fecha:"2026-04-28", monto:500.00, concepto:"deposito en transito"}],
    lineas:[{fecha:"2026-05-04", monto:500.00, descripcion:"deposito St georges 28/4"}] }], paso2: [], paso3: [] };
  const p = pistasResiduo();
  eq(p.dias.length, 0, "el día del descargo no queda con un hueco");
  cerca(p.descargos, 500.00);
  cerca(p.total, desgloseSaldoCaja().resto);
});

test("las partidas acreditadas que se reingresaron en el cierre anterior cuentan como dentro de Caja General", () => {
  // El resumen de enero de 2026 se bajo con 15 partidas "credito ya hecho" (4,105.39). Despues, en enero, se
  // registro el reingreso (ME-1853 y ME-1854) y Caja General abrio febrero con el total del resumen: 6,755.43.
  // El Paso 0 acusaba 4,105.39 "de mas" cada vez que se ejecutaba un paso, aunque la cuenta estaba bien.
  const tr = [
    { fecha: "2025-12-22", banco: "Banistmo", monto: 2644.19, concepto: "cheque en transito", creditoCG: "pendiente" },
    { fecha: "2026-01-28", banco: "STG", monto: 405.00, concepto: "DEPOSITO BRINKS DEL 28/01/2026", creditoCG: "hecho" },
    { fecha: "2026-01-30", banco: "Banistmo", monto: 230.31, concepto: "DEPOSITO POR TARJETA VISA BANISTMO", creditoCG: "hecho" }
  ];
  corregirAcreditadasReingresadas(tr, { inicial: 3279.50, fechaInicial: "2026-02-01" }, []);
  eq(tr[1].creditoCG, "pendiente", "reingresada: vuelve a estar dentro");
  eq(tr[2].reingresada, true);
  cerca(tr.reingresadas.total, 635.31);
  eq(cuadreSaldoInicialPaso0(tr, { inicial: 3279.50, fechaInicial: "2026-02-01" }, []).ok, true, "la apertura cuadra");

  // Si la cuenta abre solo con las pendientes, el credito si se hizo: no se toca nada.
  const tr2 = tr.map(function(x, i){ return Object.assign({}, x, { creditoCG: i ? "hecho" : "pendiente", reingresada: undefined }); });
  corregirAcreditadasReingresadas(tr2, { inicial: 2644.19, fechaInicial: "2026-02-01" }, []);
  eq(tr2[1].creditoCG, "hecho");
  eq(tr2.reingresadas, undefined);
  // Y si la apertura no es ninguna de las dos cosas, tampoco: el aviso tiene que salir.
  const tr3 = tr.map(function(x, i){ return Object.assign({}, x, { creditoCG: i ? "hecho" : "pendiente" }); });
  corregirAcreditadasReingresadas(tr3, { inicial: 5000, fechaInicial: "2026-02-01" }, []);
  eq(tr3[1].creditoCG, "hecho");
});

test("el resumen no lleva el deposito consolidado y ademas sus partes", () => {
  // Enero de 2026: el Paso 2 dejo en transito los 590.02 del 30-ene (VISA + CLAVE en un solo asiento) y el
  // Paso 3 las mismas VISA 230.31 y CLAVE 359.71 sueltas. El resumen las llevo las tres.
  STATE.results = {
    paso2: [{ fecha: "2026-01-30", banco: "Banistmo", monto: 590.02, clase: "en_transito", motivo: "depósito consolidado — aún no compensa",
              concepto: "DEPOSITO POR TARJETA VISA BANISTMO DEL 30/01/2026", partes: [{ metodo: "VISA", monto: 230.31 }, { metodo: "CLAVE", monto: 359.71 }] }],
    paso3: [{ fecha: "2026-01-30", banco: "Banistmo", monto: 230.31, clase: "en_transito", motivo: "depósito de fin de mes", concepto: "DEPOSITO POR TARJETA VISA BANISTMO DEL 30/01/2026" },
            { fecha: "2026-01-30", banco: "Banistmo", monto: 359.71, clase: "en_transito", motivo: "depósito de fin de mes", concepto: "DEPOSITO POR TARJETA CLAVE BANISTMO DEL 30/01/2026" }]
  };
  const tr = recolectarEnTransito();
  eq(tr.length, 1, "una sola partida");
  cerca(tr[0].monto, 590.02);
  STATE.results = {};
});

test("el Paso 0 cuenta una sola vez el consolidado que el resumen viejo trae junto con sus partes", () => {
  const tr = [
    { fecha: "2025-12-22", banco: "Banistmo", monto: 435.71, concepto: "cheque en transito", creditoCG: "pendiente" },
    { fecha: "2026-01-30", banco: "Banistmo", monto: 590.02, concepto: "DEPOSITO POR TARJETA VISA BANISTMO DEL 30/01/2026", comprobante: "ME-00000001853", creditoCG: "pendiente" },
    { fecha: "2026-01-30", banco: "Banistmo", monto: 230.31, concepto: "DEPOSITO POR TARJETA VISA BANISTMO DEL 30/01/2026", creditoCG: "pendiente" },
    { fecha: "2026-01-30", banco: "Banistmo", monto: 359.71, concepto: "DEPOSITO POR TARJETA CLAVE BANISTMO DEL 30/01/2026", creditoCG: "pendiente" }
  ];
  quitarConsolidadosDuplicados(tr);
  eq(tr.length, 3, "sale el consolidado");
  eq(tr.duplicados.length, 1);
  cerca(tr.duplicados[0].monto, 590.02);
  // El reingreso registrado por el doble aparece en el cuadre de apertura como lo que es.
  const h = paso0(tr, [], [], null, 7, 0.01);
  if (!h.some(function(x){ return x.concepto === "Partida contada dos veces en el resumen"; })) throw new Error("falta el aviso");

  // Dos partidas distintas del mismo dia que no suman otra: no se toca nada.
  const tr2 = [
    { fecha: "2026-01-30", banco: "STG", monto: 100.00, concepto: "A" },
    { fecha: "2026-01-30", banco: "STG", monto: 40.00, concepto: "B" },
    { fecha: "2026-01-30", banco: "STG", monto: 50.00, concepto: "C" }
  ];
  quitarConsolidadosDuplicados(tr2);
  eq(tr2.length, 3);
});

test("un descargo que ya esta en Caja General no se vuelve a pedir aunque no nombre banco", () => {
  // 02-feb-2026: Caja General tiene "Descargo de partidas que venian en transito..." por 246.20 (la CLAVE STG
  // del 31-ene) y el navegador de St. Georges no trae su debito. El panel lo seguia pidiendo.
  STATE.results = { paso0: [
    { fecha: "2026-02-02", banco: "STG", monto: 246.20, clase: "en_transito", motivo: "compensó — venía del mes anterior", concepto: "CLAVE STG 31/01" },
    { fecha: "2026-02-02", banco: "STG", monto: 405.00, clase: "en_transito", motivo: "compensó — venía del mes anterior", concepto: "BRINKS 28/01" }
  ] };
  STATE.diarioCaja = [{ fecha: "2026-02-02", debito: 0, credito: 246.20, referencia: "ME-00000001855",
    descripcion: "Descargo de partidas que venían en tránsito del mes anterior y ya compensaron en el banco" }];
  const p = partidasApertura();
  eq(p.length, 1, "solo falta el de 405.00");
  cerca(p[0].monto, 405.00);
  STATE.results = {}; STATE.diarioCaja = null;
});

test("el .xls del navegador contable (una pagina web) se lee tal cual viene", () => {
  // El sistema exporta el navegador como HTML con extension .xls, sin charset y con los acentos en
  // Windows-1252. Antes la app lo rechazaba como "archivo equivocado".
  const html = "\n\n\t<table><tr><td colspan='12'><strong>Balance Inicial (2026-01-01):</strong></td><td>-B/ 2,469.06</td></tr>" +
    "<tr><td></td><td>Account</td><td>Fecha</td><td>Referencia</td><td>Ref. Sec</td><td>Fuente</td><td>Descripción</td><td>Guardado Por</td>" +
    "<td>Centro de Costos</td><td>OF</td><td>Contenedor</td><td>Acreedor</td><td>Proveedor</td><td>Débito</td><td>Crédito</td></tr>" +
    "<tr><td></td><td>[1.1.8] Caja General</td><td>2026-01-30</td><td>ME-00000001853</td><td></td><td>MAN-ENTRY</td><td>DEPOSITO BRINKS DEL 30/01/2026</td>" +
    "<td>ARELYS SALDAÑA</td><td></td><td></td><td></td><td></td><td></td><td>B/ 0.00</td><td>B/ 751.00</td></tr></table>";
  const bytes = Uint8Array.from(Array.from(html).map(function(c){ return c.charCodeAt(0); }));   // latin-1, como viene
  eq(esLibroHtml(bytes), true);
  const wb = leerLibro(bytes);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
  eq(identificarArchivo(rows), "diarioCaja");
  eq(validarArchivoParaCasilla("diarioCaja", rows), null, "entra en su casilla");
  const d = parseDiario(rows, "Caja General");
  eq(d.length, 1);
  cerca(d[0].credito, 751.00);
  // Un .xlsx de verdad sigue por el camino de siempre.
  eq(esLibroHtml(Uint8Array.from([0x50, 0x4B, 3, 4])), false);
});

test("el cuadre de apertura dice cuándo la diferencia es lo que ya se había acreditado (febrero 2026)", () => {
  // Caso real: el resumen de enero trae 18 partidas por 6,755.43, de las cuales 15 (B/ 4,105.39) ya tenían su
  // crédito en Caja General. La cuenta abrió febrero con el total del resumen en vez de con los 2,650.04
  // que seguían adentro.
  const transito = [
    { fecha: "2025-12-22", banco: "Banistmo", monto: 435.71, concepto: "cheque en transito", sentido: "credito", creditoCG: "pendiente" },
    { fecha: "2025-12-22", banco: "Banistmo", monto: 2208.48, concepto: "cheque en transito", sentido: "credito", creditoCG: "pendiente" },
    { fecha: "2025-12-06", banco: "STG", monto: 5.85, concepto: "deposito en transito", sentido: "credito", creditoCG: "pendiente" },
    { fecha: "2026-01-28", banco: "STG", monto: 405.00, concepto: "DEPOSITO BRINKS DEL 28/01/2026", sentido: "credito", creditoCG: "hecho" },
    { fecha: "2026-01-31", banco: "Banistmo", monto: 3700.39, concepto: "Cheque (detalle individual)", sentido: "credito", creditoCG: "hecho" }
  ];
  const saldo = { inicial: 6755.43, final: 0, fechaInicial: "2026-02-01", fechaFinal: "2026-02-28" };
  const c = cuadreSaldoInicialPaso0(transito, saldo, []);
  eq(c.ok, false);
  cerca(c.total, 2650.04, "solo lo que sigue dentro de la cuenta");
  cerca(c.totalAcreditadas, 4105.39);
  eq(c.nAcreditadas, 2);
  eq(c.esResumenCompleto, true, "la apertura es el resumen completo");
  const h = cuadreSaldoIniHtml(c);
  if (h.indexOf("La diferencia es exactamente eso") < 0) throw new Error("tiene que decirlo: " + h.slice(0, 400));
  if (h.indexOf("2,650.04") < 0) throw new Error("y decir en cuánto debió cerrar el mes pasado");
  // Con la apertura correcta, cuadra.
  const c2 = cuadreSaldoInicialPaso0(transito, { inicial: 2650.04, fechaInicial: "2026-02-01" }, []);
  eq(c2.ok, true);
});

test("el efectivo asentado en una linea se parte: ventanilla suelta + camion en un deposito mixto", () => {
  // 12-mar-2026: el asiento junta el camion y la ventanilla del dia en un solo credito de 25.28 (25.00 del
  // Brinks + 0.28 de ventanilla); antes venian en dos lineas. El banco los acredito separados el 16: los
  // 0.28 como linea suelta y los 25.00 dentro del ACH de 5,025.00, cuyo resto son los 5,000.00 del
  // prestamo interno que solo esta en el diario del banco. Buscando el total tal cual, ninguna de las dos
  // partes aparecia y los 25.28 salian como diferencia teniendolas las dos en el estado.
  const cg = [{ fecha: "2026-03-12", debito: 0, credito: 25.28, descripcion: "DEPOSITO BRINKS DEL 12/03/2026", referencia: "ME-00000001886", fila: 7 }];
  const est = function(){ return [
    { fecha: "2026-03-16", descripcion: "Descripción", debito: 0, credito: 0.28, fila: 3 },
    { fecha: "2026-03-16", descripcion: "Ach De Brinks Panama, S.A. - D08563bsafe 130326 David", debito: 0, credito: 5025.00, fila: 4 }
  ]; };
  const diarioStg = [{ fecha: "2026-03-16", debito: 5000.00, credito: 0, descripcion: "dueños/préstamo interno - caja", referencia: "PDN-000000050", fila: 11 }];
  const dec = function(){ STATE.decisiones = { efectivo: { firmaCaja: firmaDiario(cg), banco: "STG", filas: { 7: true } } }; };
  dec();
  const h = paso2(cg, [], est(), null, null, null, 7, 0.01, null, null, { STG: diarioStg });
  eq(contarRojas(h), 0, "el efectivo compensó partido en dos");
  const inf = h.filter(function(x){ return x.clase === "informativo" && /partido/.test(x.motivo || ""); });
  eq(inf.length, 1, "y se informa cómo compensó");
  if (inf[0].texto.indexOf("0.28") < 0 || inf[0].texto.indexOf("25.00") < 0) {
    throw new Error("tiene que nombrar las dos partes: " + inf[0].texto);
  }
  // Sin el navegador del banco no hay con que explicar los 5,000.00, y ahi si es una diferencia.
  dec();
  eq(contarRojas(paso2(cg, [], est(), null, null, null, 7, 0.01, null, null)), 1,
     "sin el diario del banco el resto del depósito no se explica");
});

test("el camion de dos dias en un solo ACH, y cada ventanilla en su dia", () => {
  // 16 y 17-mar-2026: 41.56 y 44.29, cada uno en una sola linea. El banco acredito las ventanillas el 18
  // (1.56 y 4.29) y los dos Brinks de 40.00 juntos, como un ACH de 80.00 el 19. Ademas de cuadrar, cada
  // ventanilla tiene que quedar en SU dia: con la asignacion cruzada el total da igual, pero el hallazgo
  // diria 37.27 y 42.73 del camion, importes que nunca existieron.
  const cg = [
    { fecha: "2026-03-16", debito: 0, credito: 41.56, descripcion: "DEPOSITO BRINKS DEL 16/03/2026", referencia: "ME-00000001890", fila: 8 },
    { fecha: "2026-03-17", debito: 0, credito: 44.29, descripcion: "DEPOSITO BRINKS DEL 17/03/2026", referencia: "ME-00000001891", fila: 9 }
  ];
  const est = [
    { fecha: "2026-03-18", descripcion: "Descripción", debito: 0, credito: 1.56, fila: 5 },
    { fecha: "2026-03-18", descripcion: "Descripción", debito: 0, credito: 4.29, fila: 6 },
    { fecha: "2026-03-19", descripcion: "Ach De Brinks Panama, S.A. - D08563bsafe 180326 David", debito: 0, credito: 80.00, fila: 7 }
  ];
  STATE.decisiones = { efectivo: { firmaCaja: firmaDiario(cg), banco: "STG", filas: { 8: true, 9: true } } };
  const h = paso2(cg, [], est, null, null, null, 7, 0.01, null, null, { STG: [] });
  eq(contarRojas(h), 0, "los dos días compensaron en el mismo ACH");
  const inf = h.filter(function(x){ return x.clase === "informativo" && /partido/.test(x.motivo || ""); });
  eq(inf.length, 2);
  const d16 = inf.filter(function(x){ return x.fecha === "2026-03-16"; })[0];
  const d17 = inf.filter(function(x){ return x.fecha === "2026-03-17"; })[0];
  if (d16.texto.indexOf("1.56") < 0 || d16.texto.indexOf("40.00") < 0) {
    throw new Error("el 16 lleva su ventanilla de 1.56 y 40.00 del camión: " + d16.texto);
  }
  if (d17.texto.indexOf("4.29") < 0 || d17.texto.indexOf("40.00") < 0) {
    throw new Error("el 17 lleva su ventanilla de 4.29 y 40.00 del camión: " + d17.texto);
  }
});

test("una remision paga el mismo metodo de dos dias seguidos", () => {
  // 15 y 16-mar-2026: los asientos de 189.06 y 394.95 dicen VISA pero traen VISA + CLAVE. Las VISA
  // compensan sueltas (90.25 el 16, 251.78 el 17) y las CLAVE van JUNTAS en una sola remision:
  // 98.81 + 143.17 = 241.98 el 17. Buscando cada parte por su cuenta no aparecia ninguna CLAVE, el
  // desglose se revertia entero y los dos asientos salian como diferencia con su plata en el banco.
  const cg = [
    { fecha: "2026-03-15", debito: 0, credito: 189.06, descripcion: "DEPOSITO POR TARJETA VISA BANISTMO DEL 15/03/2026", referencia: "ME-00000001889", fila: 2 },
    { fecha: "2026-03-16", debito: 0, credito: 394.95, descripcion: "DEPOSITO POR TARJETA VISA BANISTMO DEL 16/03/2026", referencia: "ME-00000001890", fila: 3 }
  ];
  const reporte = [
    { fecha: "2026-03-15", banco: "Banistmo", metodo: "VISA", monto: 90.25, cajera: "A" },
    { fecha: "2026-03-15", banco: "Banistmo", metodo: "CLAVE", monto: 98.81, cajera: "A" },
    { fecha: "2026-03-16", banco: "Banistmo", metodo: "VISA", monto: 251.78, cajera: "A" },
    { fecha: "2026-03-16", banco: "Banistmo", metodo: "CLAVE", monto: 143.17, cajera: "A" }
  ];
  const est = [
    { fecha: "2026-03-16", descripcion: "CR REMISION - V/MC PAGO DE FACTURACION//01866314", debito: 0, credito: 90.25, fila: 2 },
    { fecha: "2026-03-17", descripcion: "CR REMISION - V/MC PAGO DE FACTURACION//01866314", debito: 0, credito: 251.78, fila: 3 },
    { fecha: "2026-03-17", descripcion: "CR REMISION - CLAVE PAGO DE FACTURACION//01866314", debito: 0, credito: 241.98, fila: 4 }
  ];
  STATE.decisiones = {};
  const h = paso2(cg, est, [], null, null, null, 7, 0.01, reporte, null);
  eq(contarRojas(h), 0, "los dos asientos compensaron");
  eq(h.filter(esEnTransito).length, 0, "y no queda nada en tránsito");
  // La remision agrupada se consume UNA sola vez: no puede pagar los dos dias por separado.
  eq(est.filter(function(x){ return x.credito === 241.98; }).length, 1);
});

test("un asiento acumula el metodo de todo el mes aunque su texto no declare el rango", () => {
  // 31-mar-2026: "DEPOSITOS POR YAPPY 404.49" junta los siete depositos que el banco fue acreditando del
  // 19 al 29. Como el texto no dice "DEL 1 AL 31", conciliarAcumuladoPeriodo no lo ve, y siete lineas
  // exceden el tope de cinco del emparejamiento normal: los seis creditos que no cuadraban salian como
  // "no aparece registrado en el diario" teniendo su asiento.
  const nav = [{ fecha: "2026-03-31", debito: 404.49, credito: 0, descripcion: "DEPOSITOS POR YAPPY 404.49", referencia: "ME-00000001906", fila: 1 }];
  const est = [
    { fecha: "2026-03-19", descripcion: "DEPOSITO YAPPY - POS PE (3 TRANSACCIONES)", debito: 0, credito: 89.83, fila: 2 },
    { fecha: "2026-03-20", descripcion: "DEPOSITO YAPPY - POS PE (2 TRANSACCIONES)", debito: 0, credito: 24.59, fila: 3 },
    { fecha: "2026-03-21", descripcion: "DEPOSITO YAPPY - POS PE (1 TRANSACCIONES)", debito: 0, credito: 21.39, fila: 4 },
    { fecha: "2026-03-26", descripcion: "DEPOSITO YAPPY - POS PE (3 TRANSACCIONES)", debito: 0, credito: 34.82, fila: 5 },
    { fecha: "2026-03-27", descripcion: "DEPOSITO YAPPY - POS PE (1 TRANSACCIONES)", debito: 0, credito: 10.69, fila: 6 },
    { fecha: "2026-03-28", descripcion: "DEPOSITO", debito: 0, credito: 157.94, fila: 7 },
    { fecha: "2026-03-29", descripcion: "DEPOSITO YAPPY - POS PE (3 TRANSACCIONES)", debito: 0, credito: 65.23, fila: 8 }
  ];
  const c = conciliarBancoEstado(nav, est.map(function(x){ return Object.assign({}, x); }), 7, 0.01, null);
  eq(c.faltanEnDiario.length, 0, "los siete créditos cuadran contra el asiento acumulado");
  eq(c.faltanEnBanco.length, 0, "y el asiento no queda en tránsito");
  eq(c.bloques.length, 1, "cuadró como bloque");
  eq(c.bloques[0].creditos.length, 7);
  cerca(c.bloques[0].total, 404.49);
});

test("el banco reagrupa: el mismo total repartido de otra forma cuadra como bloque", () => {
  // 30-mar-2026: las tarjetas del 27 y 28 (VISA 546.65 + 739.62 = 1,286.27) entraron como DOS remisiones
  // de 824.01 + 462.26, el mismo total repartido distinto. Ninguna linea coincide con ninguna, asi que las
  // remisiones salian como diferencia Y los asientos inflaban el transito. Lo mismo con la CLAVE.
  const nav = [
    { fecha: "2026-03-27", debito: 546.65, credito: 0, descripcion: "DEPOSITO POR TARJETA VISA BANISTMO DEL 27/03/2026", referencia: "ME-1903", fila: 1 },
    { fecha: "2026-03-28", debito: 739.62, credito: 0, descripcion: "DEPOSITO POR TARJETA VISA BANISTMO DEL 28/03/2026", referencia: "ME-1904", fila: 2 },
    { fecha: "2026-03-27", debito: 100.47, credito: 0, descripcion: "DEPOSITO POR TARJETA CLAVE BANISTMO DEL 27/03/2026", referencia: "ME-1903", fila: 3 },
    { fecha: "2026-03-28", debito: 1008.37, credito: 0, descripcion: "DEPOSITO POR TARJETA CLAVE BANISTMO DEL 28/03/2026", referencia: "ME-1904", fila: 4 }
  ];
  const est = [
    { fecha: "2026-03-30", descripcion: "CR REMISION - V/MC PAGO DE FACTURACION//01866314", debito: 0, credito: 824.01, fila: 2 },
    { fecha: "2026-03-30", descripcion: "CR REMISION - V/MC PAGO DE FACTURACION//01866314", debito: 0, credito: 462.26, fila: 3 },
    { fecha: "2026-03-30", descripcion: "CR REMISION - CLAVE PAGO DE FACTURACION//01866314", debito: 0, credito: 318.92, fila: 4 },
    { fecha: "2026-03-30", descripcion: "CR REMISION - CLAVE PAGO DE FACTURACION//01866314", debito: 0, credito: 789.92, fila: 5 }
  ];
  const c = conciliarBancoEstado(nav, est, 7, 0.01, null);
  eq(c.faltanEnDiario.length, 0, "las cuatro remisiones cuadran");
  eq(c.faltanEnBanco.length, 0, "y los cuatro asientos no quedan en tránsito");
  eq(c.bloques.length, 2, "un bloque por método: V/MC y CLAVE");
  // Y no se mezclan los metodos: cada bloque suma lo suyo.
  const totales = c.bloques.map(function(b){ return Math.round(b.total*100)/100; }).sort();
  cerca(totales[0], 1108.84, "el bloque de CLAVE");
  cerca(totales[1], 1286.27, "el bloque de V/MC");
});

test("un deposito que no esta en ningun archivo sigue saliendo como diferencia", () => {
  // Los 270.30 y 328.16 que entraron a Banistmo el 11-mar-2026 no estan en el informe de cajeras, ni en
  // Caja General, ni en el diario del banco, ni en el desglose de cheques. El diario de ese dia solo tiene
  // pagos, asi que no hay con que armar su total y tienen que seguir apareciendo: es plata que entro al
  // banco y nadie registro.
  const nav = [
    { fecha: "2026-03-11", debito: 0, credito: 2000.00, descripcion: "SON IMPORT, S.A. - Pago", referencia: "PAY0004267", fila: 1 },
    { fecha: "2026-03-11", debito: 0, credito: 2443.25, descripcion: "PRIMERA QUINCENA DE MARZO", referencia: "ME-1897", fila: 2 }
  ];
  const est = [
    { fecha: "2026-03-11", descripcion: "DEPOSITO", debito: 0, credito: 270.30, fila: 2 },
    { fecha: "2026-03-11", descripcion: "DEPOSITO", debito: 0, credito: 328.16, fila: 3 }
  ];
  const c = conciliarBancoEstado(nav, est, 7, 0.01, null);
  eq(c.faltanEnDiario.length, 2, "los dos depósitos siguen sin registrar");
  eq(c.bloques.length, 0, "y no se cierra ningún bloque");
});

test("con dos formas de llegar al mismo total, el bloque no se da por cuadrado", () => {
  // El resguardo del cotejo por bloques: elegir una de dos combinaciones posibles seria adivinar, y
  // adivinar aca mueve plata de lugar. Los creditos suman 300.00 y el diario puede armarlo de dos maneras
  // (150+150 o 100+200), asi que se deja como diferencia.
  const nav = [
    { fecha: "2026-03-10", debito: 150.00, credito: 0, descripcion: "DEPOSITO POR TARJETA VISA BANISTMO DEL 10/03/2026", referencia: "ME-1", fila: 1 },
    { fecha: "2026-03-10", debito: 150.00, credito: 0, descripcion: "DEPOSITO POR TARJETA VISA BANISTMO DEL 10/03/2026", referencia: "ME-2", fila: 2 },
    { fecha: "2026-03-11", debito: 100.00, credito: 0, descripcion: "DEPOSITO POR TARJETA VISA BANISTMO DEL 11/03/2026", referencia: "ME-3", fila: 3 },
    { fecha: "2026-03-11", debito: 200.00, credito: 0, descripcion: "DEPOSITO POR TARJETA VISA BANISTMO DEL 11/03/2026", referencia: "ME-4", fila: 4 }
  ];
  const est = [
    { fecha: "2026-03-12", descripcion: "CR REMISION - V/MC PAGO DE FACTURACION", debito: 0, credito: 130.00, fila: 2 },
    { fecha: "2026-03-12", descripcion: "CR REMISION - V/MC PAGO DE FACTURACION", debito: 0, credito: 170.00, fila: 3 }
  ];
  const c = conciliarBancoEstado(nav, est, 7, 0.01, null);
  eq(c.bloques.length, 0, "la combinación es ambigua: no se cierra el bloque");
  eq(c.faltanEnDiario.length, 2, "las dos remisiones quedan como diferencia");
});

test("una partida de fin de mes compensa POR PARTES, cada medio de pago por su cuenta", () => {
  // 27-feb-2026: el deposito de 3,571.60 es CHEQUE 1,463.08 + VISA 1,124.69 + CLAVE 983.83, y el banco
  // acredito cada medio por separado: las dos tarjetas el 2-mar y los cheques repartidos en tres depositos
  // (864.62 el 2, mas 270.30 y 328.16 el 11). Buscando el total no aparecia nunca: la partida viajaba al
  // resumen del mes siguiente habiendo compensado completa, y los dos depositos del 11 salian como plata
  // que nadie registro.
  const partes = [{ metodo: "VISA", monto: 1124.69 }, { metodo: "CLAVE", monto: 983.83 }, { metodo: "CHEQUE", monto: 1463.08 }];
  const tr = [{ fecha: "2026-02-27", banco: "Banistmo", monto: 3571.60, concepto: "Depósito de fin de mes reportado por la cajera", sentido: "credito", partes: partes }];
  const est = function(){ return [
    { fecha: "2026-03-02", descripcion: "CR REMISION - V/MC PAGO DE FACTURACION//01866314", debito: 0, credito: 1124.69, fila: 2 },
    { fecha: "2026-03-02", descripcion: "CR REMISION - CLAVE PAGO DE FACTURACION//01866314", debito: 0, credito: 983.83, fila: 3 },
    { fecha: "2026-03-02", descripcion: "DEPOSITO", debito: 0, credito: 864.62, fila: 4 },
    { fecha: "2026-03-11", descripcion: "DEPOSITO", debito: 0, credito: 270.30, fila: 5 },
    { fecha: "2026-03-11", descripcion: "DEPOSITO", debito: 0, credito: 328.16, fila: 6 }
  ]; };
  const e1 = est();
  const r = consumirTransitoPrevio(tr, { Banistmo: e1, STG: [] }, 0.01);
  eq(r.compensadas.length, 1, "la partida compensó completa, por partes");
  eq(r.pendientes.length, 0);
  eq(r.compensadas[0].porPartes, true);
  // Las cinco lineas quedaron consumidas: ninguna puede volver a usarse en los Pasos 2 y 3.
  eq(e1.filter(function(x){ return x._transitoUsado; }).length, 5, "las cinco líneas del banco quedan apartadas");

  // Si falta UNA parte, la partida sigue pendiente entera: media compensación no es una compensación.
  const e2 = est().filter(function(x){ return Math.abs(x.credito - 328.16) > 0.01; });
  const r2 = consumirTransitoPrevio(tr.map(function(t){ return Object.assign({}, t); }), { Banistmo: e2, STG: [] }, 0.01);
  eq(r2.pendientes.length, 1, "sin una de las partes la partida no se da por compensada");
  eq(e2.filter(function(x){ return x._transitoUsado; }).length, 0, "y no consume ninguna línea a medias");
});

test("un asiento que acumula el mes sin decirlo en su texto tampoco queda en transito", () => {
  // 31-mar-2026: "DEPOSITOS POR YAPPY 404.49" junta los siete depositos que el banco fue acreditando del
  // 19 al 29. El Paso 3 ya lo cuadraba como bloque, pero el Paso 2 lo evalua por su cuenta: no lograba
  // emparejarlo —siete lineas exceden el match directo y el texto no declara el rango— y como es del
  // ultimo dia del mes lo mandaba a transito. El resumen del mes siguiente se llevaba 404.49 que ya
  // habian compensado.
  const cg = [{ fecha: "2026-03-31", debito: 0, credito: 404.49, descripcion: "DEPOSITOS POR YAPPY 404.49", referencia: "ME-00000001906", fila: 9 }];
  const est = [
    { fecha: "2026-03-19", descripcion: "DEPOSITO YAPPY - POS PE (3 TRANSACCIONES)", debito: 0, credito: 89.83, fila: 2 },
    { fecha: "2026-03-20", descripcion: "DEPOSITO YAPPY - POS PE (2 TRANSACCIONES)", debito: 0, credito: 24.59, fila: 3 },
    { fecha: "2026-03-21", descripcion: "DEPOSITO YAPPY - POS PE (1 TRANSACCIONES)", debito: 0, credito: 21.39, fila: 4 },
    { fecha: "2026-03-26", descripcion: "DEPOSITO YAPPY - POS PE (3 TRANSACCIONES)", debito: 0, credito: 34.82, fila: 5 },
    { fecha: "2026-03-27", descripcion: "DEPOSITO YAPPY - POS PE (1 TRANSACCIONES)", debito: 0, credito: 10.69, fila: 6 },
    { fecha: "2026-03-28", descripcion: "DEPOSITO", debito: 0, credito: 157.94, fila: 7 },
    { fecha: "2026-03-29", descripcion: "DEPOSITO YAPPY - POS PE (3 TRANSACCIONES)", debito: 0, credito: 65.23, fila: 8 }
  ];
  STATE.decisiones = {};
  const h = paso2(cg, [], [], est, null, null, 7, 0.01, null, null);
  eq(contarRojas(h), 0, "el asiento acumulado compensó");
  eq(h.filter(esEnTransito).length, 0, "y NO queda en tránsito: ya está en el banco");

  // Con los creditos de UN SOLO dia no se acepta hacia atras: ahi lo normal es que el banco acredite
  // despues del deposito, y darlo por compensado seria aceptar plata acreditada antes de entregarse.
  const est1 = [
    { fecha: "2026-03-30", descripcion: "DEPOSITO", debito: 0, credito: 200.00, fila: 2 },
    { fecha: "2026-03-30", descripcion: "DEPOSITO", debito: 0, credito: 104.49, fila: 3 },
    { fecha: "2026-03-30", descripcion: "DEPOSITO", debito: 0, credito: 100.00, fila: 4 }
  ];
  STATE.decisiones = {};
  const h2 = paso2(cg, [], [], est1, null, null, 7, 0.01, null, null);
  eq(contarRojas(h2) + h2.filter(esEnTransito).length, 1, "con un solo día no se da por compensado");
});

test("el acumulado del mes cuadra aunque el banco lo haya acreditado en nueve dias", () => {
  // 30-abr-2026: "DEPOSITOS POR YAPPY DEL 1 AL 30 DE ABRIL" por 403.33 contra NUEVE depositos del estado.
  // El texto declara el rango pero sin año, asi que rangoDeposito no lo lee y no entra por el acumulado
  // del periodo; quedaba el cotejo por bloques, que probaba hasta 8 lineas. Con nueve se caia justo cuando
  // mas hacia falta, y las ocho que no cuadraban salian como "no aparece registrado en el diario".
  const nav = [{ fecha: "2026-04-30", debito: 403.33, credito: 0, descripcion: "DEPOSITOS POR YAPPY DEL 1 AL 30 DE ABRIL", referencia: "ME-00000001932", fila: 3 }];
  const montos = [[ "2026-04-02", 23.85 ], [ "2026-04-03", 39.27 ], [ "2026-04-08", 70.57 ], [ "2026-04-15", 52.40 ],
                  [ "2026-04-16", 14.00 ], [ "2026-04-18", 21.39 ], [ "2026-04-19", 65.22 ], [ "2026-04-26", 111.65 ],
                  [ "2026-04-28", 4.98 ]];
  const est = montos.map(function(m, i){
    return { fecha: m[0], descripcion: "DEPOSITO YAPPY - POS PE", debito: 0, credito: m[1], fila: i + 2 };
  });
  cerca(Math.round(montos.reduce(function(a, m){ return a + m[1]; }, 0)*100)/100, 403.33, "los nueve suman el asiento");
  const c = conciliarBancoEstado(nav, est, 7, 0.01, null);
  eq(c.faltanEnDiario.length, 0, "los nueve créditos cuadran contra el acumulado");
  eq(c.faltanEnBanco.length, 0);
  eq(c.bloques.length, 1);
  eq(c.bloques[0].creditos.length, 9);
});

// Hallazgo (abril 2026): "DEPOSITO DE VISA 1AL 30 DE ABRIL 2026" por 1,443.41 y "DEPOSITOS POR YAPPY DEL 1
// AL 30 DE ABRIL" por 403.33 no se reconocian como acumulados — el primero por el "1AL" pegado y sin "DEL",
// el segundo porque el texto no trae el año — y cada dia de esos dos metodos salia como diferencia roja.
test("el rango se reconoce con el dia pegado al AL y sin el DEL", () => {
  const r = rangoDeposito("DEPOSITO DE VISA 1AL 30 DE ABRIL 2026");
  if (!r) throw new Error("no reconoció el rango");
  eq(r.ym, "2026-04"); eq(r.diaIni, 1); eq(r.diaFin, 30);
});

test("sin año en el texto, el rango toma el año del asiento", () => {
  const r = rangoDeposito("DEPOSITOS POR YAPPY DEL 1 AL 30 DE ABRIL", "2026-04-30");
  if (!r) throw new Error("no reconoció el rango");
  eq(r.ym, "2026-04"); eq(r.diaIni, 1); eq(r.diaFin, 30);
  // Un acumulado se asienta al CERRAR el rango, nunca antes: si el mes del texto es posterior al del
  // asiento, el rango es del año anterior (el de diciembre se asienta en enero).
  const dic = rangoDeposito("DEPOSITOS POR YAPPY DEL 1 AL 31 DE DICIEMBRE", "2026-01-05");
  eq(dic.ym, "2025-12", "diciembre asentado en enero es del año anterior");
  // Sin fecha de asiento no se inventa el año.
  eq(rangoDeposito("DEPOSITOS POR YAPPY DEL 1 AL 30 DE ABRIL"), null, "sin año y sin asiento, no hay rango");
});

// Hallazgo (abril 2026): el asiento de fin de mes de la VISA de St. Georges no dice a que banco entro
// ("DEPOSITO DE VISA 1AL 30 DE ABRIL 2026"), asi que clasificarBancoPorTexto daba null y la linea se
// descartaba antes de llegar al cotejo. Los cuatro dias de VISA STG salian como diferencias rojas
// (77.01, 611.70, 260.97, 493.73) con el asiento hecho por el total exacto.
test("un acumulado que no dice banco se rutea por monto contra los dias sin asiento propio", () => {
  const reporte = [
    { fecha: "2026-04-09", banco: "STG", metodo: "VISA", monto: 77.01, cajera: "A" },
    { fecha: "2026-04-17", banco: "STG", metodo: "VISA", monto: 611.70, cajera: "A" },
    { fecha: "2026-04-28", banco: "STG", metodo: "VISA", monto: 260.97, cajera: "A" },
    { fecha: "2026-04-30", banco: "STG", metodo: "VISA", monto: 493.73, cajera: "A" },
    // La VISA de Banistmo tiene su asiento diario: el acumulado no puede comersela.
    { fecha: "2026-04-10", banco: "Banistmo", metodo: "VISA", monto: 800.00, cajera: "A" }
  ];
  const cg = [
    { fecha: "2026-04-10", debito: 0, credito: 800.00, descripcion: "DEPOSITO POR TARJETA VISA BANISTMO DEL 10/04/2026", referencia: "ME-1", fila: 5 },
    { fecha: "2026-04-30", debito: 0, credito: 1443.41, descripcion: "DEPOSITO DE VISA 1AL 30 DE ABRIL 2026", referencia: "ME-2", fila: 9 }
  ];
  const h = paso1(reporte, cg, null, 0.01, [], "2026-04-01", null);
  eq(contarRojas(h), 0, "el acumulado cubre los cuatro dias de STG");
});

test("el acumulado sin banco no toca un dia que ya tiene su asiento", () => {
  // El acumulado suma justo lo de un dia que YA esta asentado. Tomarlo dejaria el dia sin credito y el
  // acumulado dado por bueno: los dos lados mal. El dia asentado no es candidato, asi que no cuadra.
  const reporte = [{ fecha: "2026-04-10", banco: "Banistmo", metodo: "VISA", monto: 500.00, cajera: "A" }];
  const cg = [
    { fecha: "2026-04-10", debito: 0, credito: 500.00, descripcion: "DEPOSITO POR TARJETA VISA BANISTMO DEL 10/04/2026", referencia: "ME-1", fila: 5 },
    { fecha: "2026-04-30", debito: 0, credito: 500.00, descripcion: "DEPOSITO DE VISA 1AL 30 DE ABRIL 2026", referencia: "ME-2", fila: 9 }
  ];
  const h = paso1(reporte, cg, null, 0.01, [], "2026-04-01", null);
  const sinRutear = h.filter(function(x){ return String(x.texto||"").indexOf("no dice a qué banco entró") >= 0; });
  eq(sinRutear.length, 1, "el acumulado queda sin rutear y se avisa");
});

test("con dos formas de llegar al monto, el acumulado sin banco no se adivina", () => {
  // 100 + 200 y 150 + 150 dan los mismos 300: elegir una dejaria dos dias sin credito por decision de la
  // app. Se deja como hallazgo, igual que en el resto de las reglas de combinacion.
  const reporte = [
    { fecha: "2026-04-05", banco: "STG", metodo: "VISA", monto: 100.00, cajera: "A" },
    { fecha: "2026-04-06", banco: "STG", metodo: "VISA", monto: 200.00, cajera: "A" },
    { fecha: "2026-04-07", banco: "STG", metodo: "VISA", monto: 150.00, cajera: "A" },
    { fecha: "2026-04-08", banco: "STG", metodo: "VISA", monto: 150.00, cajera: "A" }
  ];
  const cg = [{ fecha: "2026-04-30", debito: 0, credito: 300.00, descripcion: "DEPOSITO DE VISA 1AL 30 DE ABRIL 2026", referencia: "ME-2", fila: 9 }];
  const h = paso1(reporte, cg, null, 0.01, [], "2026-04-01", null);
  const sinRutear = h.filter(function(x){ return String(x.texto||"").indexOf("no dice a qué banco entró") >= 0; });
  eq(sinRutear.length, 1, "con dos combinaciones posibles no se rutea");
});

// Hallazgo: el Yappy solo entra a Banco General, pero swapDeBanco daba por "registrado en otro banco"
// cada dia de Yappy cuyo Banco General quedaba vacio y Banistmo tenia excedente. Esos dias no contaban
// como cubiertos y el acumulado del mes salia con una diferencia inventada.
test("el Yappy de un dia no se toma por registrado en otro banco", () => {
  const reporte = [
    { fecha: "2026-04-14", banco: "Banco General", metodo: "YAPPY", monto: 52.40, cajera: "A" },
    { fecha: "2026-04-15", banco: "Banco General", metodo: "YAPPY", monto: 14.00, cajera: "A" },
    // Banistmo con excedente el 14: el reporte no lo trae y el diario si.
    { fecha: "2026-04-14", banco: "Banistmo", metodo: "VISA", monto: 100.00, cajera: "A" }
  ];
  const cg = [
    { fecha: "2026-04-14", debito: 0, credito: 900.00, descripcion: "DEPOSITO POR TARJETA VISA BANISTMO DEL 14/04/2026", referencia: "ME-1", fila: 5 },
    { fecha: "2026-04-30", debito: 0, credito: 66.40, descripcion: "DEPOSITOS POR YAPPY DEL 1 AL 30 DE ABRIL", referencia: "ME-2", fila: 9 }
  ];
  const h = paso1(reporte, cg, null, 0.01, [], "2026-04-01", null);
  const acum = h.filter(function(x){ return String(x.texto||"").indexOf("Depósito acumulado YAPPY") >= 0; });
  eq(acum.length, 0, "los dos dias de Yappy cuadran con el acumulado");
});

// Hallazgo (abril 2026): el reporte de cajeras trae 10 dias de Yappy por 612.95 y el asiento acumulado
// registro 403.33. La diferencia (209.62) es real y tiene que salir: el acumulado no puede taparla.
test("el acumulado que no alcanza la suma del reporte sale como diferencia", () => {
  const reporte = [
    { fecha: "2026-04-14", banco: "Banco General", metodo: "YAPPY", monto: 52.40, cajera: "A" },
    { fecha: "2026-04-15", banco: "Banco General", metodo: "YAPPY", monto: 14.00, cajera: "A" }
  ];
  const cg = [{ fecha: "2026-04-30", debito: 0, credito: 50.00, descripcion: "DEPOSITOS POR YAPPY DEL 1 AL 30 DE ABRIL", referencia: "ME-2", fila: 9 }];
  const h = paso1(reporte, cg, null, 0.01, [], "2026-04-01", null);
  const acum = h.filter(function(x){ return String(x.texto||"").indexOf("Depósito acumulado YAPPY") >= 0; });
  eq(acum.length, 1, "la diferencia del acumulado sale");
  cerca(acum[0].monto, 16.40, "el reporte suma 66.40 y el asiento 50.00");
});

// Hallazgo (abril 2026): el Yappy se asienta en UN solo crédito de fin de mes, así que la venta del día no
// tiene su crédito ese día. `ventasSinDeposito` lo denunciaba como "venta que entró y no salió por ningún
// depósito" — ocho veces en abril (111.56 el 25) — y en marzo esas partidas viajaron al resumen del mes
// siguiente con el banco del efectivo (STG) en vez de Banco General, donde no compensan nunca.
function ventasPendientes(h){
  return h.filter(function(x){ return String(x.concepto||"").indexOf("pendiente de identificar") >= 0; });
}
test("el método que un acumulado de fin de mes cubre no es una venta sin depositar", () => {
  const reporte = [
    { fecha: "2026-04-14", banco: "Banco General", metodo: "YAPPY", monto: 52.40, cajera: "A" },
    { fecha: "2026-04-15", banco: "Banco General", metodo: "YAPPY", monto: 14.00, cajera: "A" }
  ];
  const cg = [
    { fecha: "2026-04-14", debito: 52.40, credito: 0, descripcion: "REPORTE DE VENTA DEL 14/04/2026", referencia: "ME-1", fila: 1 },
    { fecha: "2026-04-15", debito: 14.00, credito: 0, descripcion: "REPORTE DE VENTA DEL 15/04/2026", referencia: "ME-2", fila: 2 },
    { fecha: "2026-04-30", debito: 0, credito: 66.40, descripcion: "DEPOSITOS POR YAPPY DEL 1 AL 30 DE ABRIL", referencia: "ME-3", fila: 3 }
  ];
  eq(ventasPendientes(paso1(reporte, cg, null, 0.01, [], "2026-04-01", null)).length, 0,
     "el acumulado cubre esos dos días");
});

test("sin el asiento acumulado, la venta sin depositar SÍ sale", () => {
  // La regla no puede taparlo por ser Yappy: lo tapa el asiento. Si no existe, es plata sin depositar.
  const reporte = [
    { fecha: "2026-04-14", banco: "Banco General", metodo: "YAPPY", monto: 52.40, cajera: "A" },
    { fecha: "2026-04-15", banco: "Banco General", metodo: "YAPPY", monto: 14.00, cajera: "A" }
  ];
  const cg = [
    { fecha: "2026-04-14", debito: 52.40, credito: 0, descripcion: "REPORTE DE VENTA DEL 14/04/2026", referencia: "ME-1", fila: 1 },
    { fecha: "2026-04-15", debito: 14.00, credito: 0, descripcion: "REPORTE DE VENTA DEL 15/04/2026", referencia: "ME-2", fila: 2 }
  ];
  const v = ventasPendientes(paso1(reporte, cg, null, 0.01, [], "2026-04-01", null));
  eq(v.length, 2, "las dos siguen saliendo");
  // Y el banco sale del MÉTODO que falta, no de donde compensó el efectivo: el Yappy va a Banco General.
  eq(v[0].banco, "Banco General", "el banco sale del método del informe");
  eq(v[1].banco, "Banco General");
});

// Hallazgo (abril 2026): un cobro con tarjeta partido entre los dos POS. El informe lo reportó el 28 y la
// contabilidad lo asentó el 29, así que salían dos diferencias de 38.17 que se cancelan. Pero la del 28 cae
// en los últimos días del mes y el Paso 1 la clasifica EN TRÁNSITO, así que colapsarCompensados —que solo
// miraba las de clase "diff"— no las juntaba: una salía roja y la otra viajaba al resumen del mes siguiente.
test("la mitad que quedó como fin de mes se cancela con su diferencia y no viaja al resumen", () => {
  const reporte = [
    { fecha: "2026-04-28", banco: "Banistmo", metodo: "VISA", monto: 38.17, cajera: "A" },
    { fecha: "2026-04-29", banco: "Banistmo", metodo: "VISA", monto: 100.00, cajera: "A" }
  ];
  // El asiento del 29 trae las dos: los 100 del día y los 38.17 del 28.
  const cg = [{ fecha: "2026-04-29", debito: 0, credito: 138.17,
                descripcion: "DEPOSITO POR TARJETA VISA BANISTMO DEL 29/04/2026", referencia: "ME-1", fila: 5 }];
  const h = paso1(reporte, cg, null, 0.01, [], "2026-04-01", null);
  eq(contarRojas(h), 0, "no queda ninguna diferencia");
  eq(h.filter(function(x){ return esEnTransito(x) && Math.abs(x.monto - 38.17) < 0.01; }).length, 0,
     "y la de fin de mes ya no viaja al resumen");
  const av = h.filter(function(x){ return String(x.concepto||"") === "Diferencias que se compensan"; });
  eq(av.length, 1, "queda un solo aviso");
});

test("dos partidas de fin de mes que se cancelan entre sí NO se colapsan", () => {
  // Sin ninguna diferencia real en el grupo no hay error de día que corregir, y colapsarlas las sacaría del
  // resumen del mes siguiente sin motivo.
  const reporte = [
    { fecha: "2026-04-28", banco: "Banistmo", metodo: "VISA", monto: 38.17, cajera: "A" },
    { fecha: "2026-04-29", banco: "Banistmo", metodo: "VISA", monto: 38.17, cajera: "A" }
  ];
  const h = paso1(reporte, [], null, 0.01, [], "2026-04-01", null);
  eq(h.filter(esEnTransito).length, 2, "las dos siguen en tránsito");
  eq(h.filter(function(x){ return String(x.concepto||"") === "Diferencias que se compensan"; }).length, 0);
});

// Hallazgo (abril 2026): el asiento describe el PROBLEMA y no el método ("DEPOSITO BANISTMO SE LE DESCONTO
// AL CLIENTE 38.17 EL DIA 28/4 EN ST GEORGES, BANISTMO NO REFLEJA BAUCHER..."), así que
// compatibleConRemision le prohibía tomar su propia remisión CLAVE — la misma fecha y el mismo importe.
test("un asiento que no nombra el método toma su remisión del mismo día", () => {
  const nav = [{ fecha: "2026-04-29", debito: 38.17, credito: 0, referencia: "ME-1", fila: 1,
                 descripcion: "DEPOSITO BANISTMO SE LE DESCONTO AL CLIENTE 38.17 EL DIA 28/4 EN ST GEORGES" }];
  const est = [{ fecha: "2026-04-29", debito: 0, credito: 38.17, fila: 2,
                 descripcion: "CR REMISION - CLAVE PAGO DE FACTURACION//01866314" }];
  const c = conciliarBancoEstado(nav, est, 7, 0.01, null);
  eq(c.faltanEnBanco.length, 0, "el asiento compensa");
  eq(c.faltanEnDiario.length, 0, "y la línea del estado queda registrada");
});

test("con dos líneas posibles del mismo importe, el asiento sin método no se adivina", () => {
  const nav = [{ fecha: "2026-04-29", debito: 38.17, credito: 0, referencia: "ME-1", fila: 1,
                 descripcion: "DEPOSITO BANISTMO SE LE DESCONTO AL CLIENTE 38.17 EL DIA 28/4" }];
  const est = [
    { fecha: "2026-04-29", debito: 0, credito: 38.17, fila: 2, descripcion: "CR REMISION - CLAVE PAGO DE FACTURACION//01" },
    { fecha: "2026-04-29", debito: 0, credito: 38.17, fila: 3, descripcion: "CR REMISION - CLAVE PAGO DE FACTURACION//02" }
  ];
  const c = conciliarBancoEstado(nav, est, 7, 0.01, null);
  eq(c.faltanEnBanco.length, 1, "no se elige ninguna");
  eq(c.faltanEnDiario.length, 2);
});

test("un asiento que SÍ nombra su método sigue sin poder tomar una remisión de otro", () => {
  // El resguardo de siempre: el efectivo no se come la remisión de una venta con tarjeta.
  const nav = [{ fecha: "2026-04-29", debito: 38.17, credito: 0, referencia: "ME-1", fila: 1,
                 descripcion: "DEPOSITO BRINKS DEL 29/04/2026" }];
  const est = [{ fecha: "2026-04-29", debito: 0, credito: 38.17, fila: 2,
                 descripcion: "CR REMISION - V/MC PAGO DE FACTURACION" }];
  const c = conciliarBancoEstado(nav, est, 7, 0.01, null);
  eq(c.faltanEnBanco.length, 1, "el efectivo no toma la remisión de tarjeta");
  eq(c.faltanEnDiario.length, 1);
});

// Hallazgo (marzo 2026): el asiento del Yappy del mes se digitó "DEPOSITOS POR YAPPY 404.49" — sin declarar
// "DEL 1 AL 31" —, así que el mecanismo de acumulados no lo veía y sus seis días salían como ventas sin
// depositar. Su plata YA había compensado: el estado de Banco General de marzo trae los seis depósitos.
test("un acumulado que no declara el rango igual cubre los días de su método", () => {
  const reporte = [
    { fecha: "2026-03-18", banco: "Banco General", metodo: "YAPPY", monto: 89.83, cajera: "A" },
    { fecha: "2026-03-19", banco: "Banco General", metodo: "YAPPY", monto: 24.59, cajera: "A" }
  ];
  const cg = [
    { fecha: "2026-03-18", debito: 89.83, credito: 0, descripcion: "REPORTE DE VENTA DEL 18/03/2026", referencia: "ME-1", fila: 1 },
    { fecha: "2026-03-19", debito: 24.59, credito: 0, descripcion: "REPORTE DE VENTA DEL 19/03/2026", referencia: "ME-2", fila: 2 },
    // Sin rango en el texto, y por MÁS de la suma: el de marzo traía además un depósito que no era Yappy.
    { fecha: "2026-03-31", debito: 0, credito: 404.49, descripcion: "DEPOSITOS POR YAPPY 404.49", referencia: "ME-3", fila: 3 }
  ];
  eq(ventasPendientes(paso1(reporte, cg, null, 0.01, [], "2026-03-01", null)).length, 0,
     "el asiento del cierre los cubre");
});

test("un acumulado sin rango que NO alcanza no cubre nada", () => {
  const reporte = [
    { fecha: "2026-03-18", banco: "Banco General", metodo: "YAPPY", monto: 89.83, cajera: "A" },
    { fecha: "2026-03-19", banco: "Banco General", metodo: "YAPPY", monto: 24.59, cajera: "A" }
  ];
  const cg = [
    { fecha: "2026-03-18", debito: 89.83, credito: 0, descripcion: "REPORTE DE VENTA DEL 18/03/2026", referencia: "ME-1", fila: 1 },
    { fecha: "2026-03-19", debito: 24.59, credito: 0, descripcion: "REPORTE DE VENTA DEL 19/03/2026", referencia: "ME-2", fila: 2 },
    { fecha: "2026-03-31", debito: 0, credito: 50.00, descripcion: "DEPOSITOS POR YAPPY 50.00", referencia: "ME-3", fila: 3 }
  ];
  eq(ventasPendientes(paso1(reporte, cg, null, 0.01, [], "2026-03-01", null)).length, 2,
     "con 50.00 no se cubren 114.42: las dos siguen saliendo");
});

// Hallazgo (abril 2026): el informe trae 612.95 de Yappy y el asiento acumulado 403.33, así que el acumulado
// salía con una diferencia de 209.62. Pero el asiento cuadra al centavo con los NUEVE depósitos que el banco
// acreditó: los 209.62 son el Yappy del 30-abr, que compensa en mayo. No es una diferencia, es tránsito.
test("la cola del rango que el banco aún no acreditó queda en tránsito, no como diferencia", () => {
  const reporte = [
    { fecha: "2026-04-14", banco: "Banco General", metodo: "YAPPY", monto: 52.40, cajera: "A" },
    { fecha: "2026-04-15", banco: "Banco General", metodo: "YAPPY", monto: 14.00, cajera: "A" },
    { fecha: "2026-04-30", banco: "Banco General", metodo: "YAPPY", monto: 209.62, cajera: "A" }
  ];
  const cg = [{ fecha: "2026-04-30", debito: 0, credito: 66.40,
                descripcion: "DEPOSITOS POR YAPPY DEL 1 AL 30 DE ABRIL", referencia: "ME-1", fila: 3 }];
  const h = paso1(reporte, cg, null, 0.01, [], "2026-04-01", null);
  const acum = h.filter(function(x){ return String(x.texto||"").indexOf("Depósito acumulado YAPPY") >= 0; });
  eq(acum.length, 0, "el acumulado no sale como diferencia");
  const t = h.filter(function(x){ return esEnTransito(x) && Math.abs(x.monto - 209.62) < 0.01; });
  eq(t.length, 1, "la cola queda en tránsito y viaja al resumen");
});

test("lo que sobra después de la cola de fin de mes sigue siendo diferencia", () => {
  // La cola explica 209.62 y la diferencia es 259.62: los 50 de más son una diferencia real.
  const reporte = [
    { fecha: "2026-04-14", banco: "Banco General", metodo: "YAPPY", monto: 50.00, cajera: "A" },
    { fecha: "2026-04-30", banco: "Banco General", metodo: "YAPPY", monto: 209.62, cajera: "A" }
  ];
  const cg = [{ fecha: "2026-04-30", debito: 0, credito: 0.01,
                descripcion: "DEPOSITOS POR YAPPY DEL 1 AL 30 DE ABRIL", referencia: "ME-1", fila: 3 }];
  const h = paso1(reporte, cg, null, 0.01, [], "2026-04-01", null);
  eq(h.filter(function(x){ return String(x.texto||"").indexOf("Depósito acumulado YAPPY") >= 0; }).length, 1,
     "la diferencia que la cola no explica sale igual");
});

// Hallazgo (abril 2026): al asiento del 15-abr se le cayó el "CK" y quedó "DEPOSITO DE BANISTMO DEL DEL
// 15/04/2026" — los otros doce depósitos de cheque del mes dicen "CK DEL". La app no sabía que era un
// depósito de cheques, así que el consolidado salía como diferencia roja Y ADEMÁS sus dos cheques (208.14 +
// 200.42) viajaban al resumen del mes siguiente: la misma plata contada dos veces. Los cheques tardan — esos
// dos entraron al banco el 20 de mayo.
test("el asiento que no dice CK se reconoce por el CHEQUE del informe de ese día", () => {
  const cg = [{ fecha: "2026-04-15", debito: 0, credito: 408.56, referencia: "ME-1", fila: 5,
                descripcion: "DEPOSITO DE BANISTMO DEL DEL 15/04/2026" }];
  const reporte = [{ fecha: "2026-04-15", banco: "Banistmo", metodo: "CHEQUE", monto: 408.56, cajera: "A" }];
  const det = [{ fecha: "2026-04-15", banco: "Banistmo", monto: 208.14, fila: 29 },
               { fecha: "2026-04-15", banco: "Banistmo", monto: 200.42, fila: 30 }];
  const h = paso2(cg, [], [], null, null, det, 7, 0.01, reporte, null, {});
  eq(contarRojas(h), 0, "el consolidado no sale como diferencia");
  eq(h.filter(esEnTransito).length, 2, "y sus dos cheques quedan en tránsito, que es lo que son");
});

test("si el importe no cuadra con el cheque del informe, sigue siendo diferencia", () => {
  // El resguardo: no se da por cheque cualquier asiento sin etiqueta. El informe tiene que respaldar el
  // importe EXACTO, o un crédito de tarjeta pasaría por depósito de cheques.
  const cg = [{ fecha: "2026-04-15", debito: 0, credito: 408.56, referencia: "ME-1", fila: 5,
                descripcion: "DEPOSITO DE BANISTMO DEL DEL 15/04/2026" }];
  const reporte = [{ fecha: "2026-04-15", banco: "Banistmo", metodo: "CHEQUE", monto: 300.00, cajera: "A" }];
  const det = [{ fecha: "2026-04-15", banco: "Banistmo", monto: 300.00, fila: 29 }];
  const h = paso2(cg, [], [], null, null, det, 7, 0.01, reporte, null, {});
  eq(contarRojas(h), 1, "408.56 contra 300.00 del informe: no es el depósito de esos cheques");
});

// Hallazgo (abril 2026): al informe de cajeras le falta la fila del 11-abr, así que el punto 3 no podía
// desglosar el asiento de 1,550.76 ("DEPOSITO POR TARJETA VISA BANISTMO") — que son VISA 982.09 + CLAVE
// 568.67, las dos acreditadas el 13-abr. poolDelMetodo reserva las remisiones V/MC para los depósitos que
// dicen VISA, así que la de CLAVE nunca podía entrar y el asiento salía como diferencia.
const REMIS_11 = [
  { fecha: "2026-04-13", debito: 0, credito: 324.39, descripcion: "CR REMISION - V/MC PAGO DE FACTURACION", fila: 2 },
  { fecha: "2026-04-13", debito: 0, credito: 57.47,  descripcion: "CR REMISION - CLAVE PAGO DE FACTURACION", fila: 3 },
  { fecha: "2026-04-13", debito: 0, credito: 982.09, descripcion: "CR REMISION - V/MC PAGO DE FACTURACION", fila: 4 },
  { fecha: "2026-04-13", debito: 0, credito: 568.67, descripcion: "CR REMISION - CLAVE PAGO DE FACTURACION", fila: 5 }
];
test("un asiento de tarjeta cuadra mezclando remisiones V/MC y CLAVE cuando no hay informe", () => {
  const cg = [{ fecha: "2026-04-11", debito: 0, credito: 1550.76, referencia: "ME-1", fila: 5,
                descripcion: "DEPOSITO POR TARJETA VISA BANISTMO DEL 11/04/2026" }];
  const h = paso2(cg, REMIS_11, [], null, null, null, 7, 0.01, null, null, {});
  eq(contarRojas(h), 0, "el asiento cuadra contra las dos remisiones");
  // Y toma las que le tocan: quedan libres las otras dos.
  const nav = [{ fecha: "2026-04-11", debito: 1550.76, credito: 0, referencia: "ME-1", fila: 5,
                 descripcion: "DEPOSITO POR TARJETA VISA BANISTMO DEL 11/04/2026" }];
  const c = conciliarBancoEstado(nav, REMIS_11, 7, 0.01, null);
  eq(c.faltanEnDiario.length, 2, "deja libres las otras dos remisiones");
  cerca(c.faltanEnDiario.reduce(function(a, x){ return a + x.monto; }, 0), 381.86, "las libres son 324.39 + 57.47");
});

test("con dos formas de sumar el asiento, no se mezcla nada", () => {
  // 500 + 300 y 600 + 200 dan los mismos 800: elegir una le robaría las remisiones al depósito que sí las
  // necesita. Se deja como diferencia, igual que en el resto de las reglas de combinación.
  const cg = [{ fecha: "2026-04-11", debito: 0, credito: 800.00, referencia: "ME-1", fila: 5,
                descripcion: "DEPOSITO POR TARJETA VISA BANISTMO DEL 11/04/2026" }];
  const est = [
    { fecha: "2026-04-13", debito: 0, credito: 500.00, descripcion: "CR REMISION - V/MC PAGO DE FACTURACION", fila: 2 },
    { fecha: "2026-04-13", debito: 0, credito: 300.00, descripcion: "CR REMISION - CLAVE PAGO DE FACTURACION", fila: 3 },
    { fecha: "2026-04-13", debito: 0, credito: 600.00, descripcion: "CR REMISION - V/MC PAGO DE FACTURACION", fila: 4 },
    { fecha: "2026-04-13", debito: 0, credito: 200.00, descripcion: "CR REMISION - CLAVE PAGO DE FACTURACION", fila: 5 }
  ];
  eq(contarRojas(paso2(cg, est, [], null, null, null, 7, 0.01, null, null, {})), 1, "con dos combinaciones no se adivina");
});

test("el efectivo no cuadra mezclando remisiones de tarjeta", () => {
  // El resguardo de siempre: solo un depósito de TARJETA puede compensar en remisiones de tarjeta.
  const cg = [{ fecha: "2026-04-11", debito: 0, credito: 1550.76, referencia: "ME-1", fila: 5,
                descripcion: "DEPOSITO BRINKS DEL 11/04/2026" }];
  const nav = [{ fecha: "2026-04-11", debito: 1550.76, credito: 0, referencia: "ME-1", fila: 5,
                 descripcion: "DEPOSITO BRINKS DEL 11/04/2026" }];
  const c = conciliarBancoEstado(nav, REMIS_11, 7, 0.01, null);
  eq(c.faltanEnBanco.length, 1, "el efectivo no toma remisiones de tarjeta");
});

/* --- resumen --- */
console.log("\n" + "=".repeat(52));
console.log("  " + ok + " pasaron, " + fail + " fallaron");
if (fail) { console.log("\nFallos:"); fails.forEach(f => console.log("  - " + f)); }
console.log("=".repeat(52));
process.exit(fail ? 1 : 0);
