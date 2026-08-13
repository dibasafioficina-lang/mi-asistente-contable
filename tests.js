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

test("sin el Paso 0, esas mismas líneas SÍ son diferencia", () => {
  const h = paso3([], [], EST_VISA(), [], null, null, 3, 0.01, null, null);
  eq(h.filter(x => (x.clase || "diff") === "diff").length, 2, "sin el resumen en tránsito no hay con qué cotejarlas");
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

/* ---- Conciliación de SALIDAS: pagos del diario ↔ cargos del banco ---- */
test("la planilla partida por el banco cuadra contra el asiento único", () => {
  const diario = [{ fecha: "2026-01-26", debito: 0, credito: 1589.71, descripcion: "SEGUNDA QUINCENA DE ENERO 2026", referencia: "ME-00000001851", fila: 30 }];
  const estado = [273.98, 169.67, 180.81, 235.26, 238.72, 246.88, 244.39].map((m, i) => (
    { fecha: "2026-01-26", debito: m, credito: 0, descripcion: "DB PAGO DE PLANILLA DETALLADA BLE//PLL SEG DE ENERO DE 2026", fila: 60 + i }));
  const r = conciliarSalidas(diario, estado, 3, 0.01);
  eq(r.sinCobrar.length, 0, "el asiento cuadra");
  eq(r.sinAsiento.length, 0, "y consume los 7 débitos");
});

test("los cargos propios del banco se cotejan EN BLOQUE contra el asiento mensual", () => {
  const diario = [{ fecha: "2026-01-31", debito: 0, credito: 100, descripcion: "CARGOS BANCARIOS 45.27", referencia: "ME-1", fila: 50 }];
  const estado = [
    { fecha: "2026-01-05", debito: 60, credito: 0, descripcion: "DB COMISION POR TRANSACCION DE ACH", fila: 3 },
    { fecha: "2026-01-06", debito: 72.71, credito: 0, descripcion: "DB ITBMS", fila: 4 }
  ];
  const r = conciliarSalidas(diario, estado, 3, 0.01);
  eq(r.sinAsiento.length, 0, "no se reportan uno por uno");
  eq(r.bloque.n, 2);
  cerca(r.bloque.dif, 32.71, "la diferencia del bloque es UN hallazgo, no dos");
  eq(r.bloque.ok, false);
});

// El estado trae la Ó rota por el encoding: "DB COMISIÃ“N POR BAJO SALDO" no matcheaba "COMISION".
test("un cargo con el acento roto igual cuenta como cargo bancario", () => {
  eq(esCargoBancario("DB COMISIÃ“N POR BAJO SALDO//COBRO COM JUN 26"), true);
  eq(esCargoBancario("Retencion Clave 29-01 16005605"), true);
  eq(esCargoBancario("Timbre Por Cheques Emitidos Ene-2026"), true);
  eq(esCargoBancario("DB PAGO DE PLANILLA DETALLADA BLE"), false);
  eq(esCargoBancario("Cheque 7831"), false);
});

test("un pago que el banco no cobró queda en tránsito, no como diferencia", () => {
  const diario = [{ fecha: "2026-01-30", debito: 0, credito: 551.29, descripcion: "INDUSTRIAS MODERNAS, S.A. - Pago:PAY0004121", referencia: "PAY0004121", fila: 40 }];
  const r = conciliarSalidas(diario, [], 3, 0.01);
  eq(r.sinCobrar.length, 1);
  eq(r.sinAsiento.length, 0);
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

/* --- resumen --- */
console.log("\n" + "=".repeat(52));
console.log("  " + ok + " pasaron, " + fail + " fallaron");
if (fail) { console.log("\nFallos:"); fails.forEach(f => console.log("  - " + f)); }
console.log("=".repeat(52));
process.exit(fail ? 1 : 0);
