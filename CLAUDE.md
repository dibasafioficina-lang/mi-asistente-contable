# Mi Asistente Contable

Herramienta interna del equipo contable para cuadrar un sistema contable poco amigable, mediante módulos independientes de revisión/conciliación. Reemplaza y amplía a `conciliador-caja` y `conciliador-banco` (esos quedan solo como referencia de lógica de matching, no como base de código).

## Arquitectura

- **Formato**: un solo archivo HTML (`index.html`), sin build, sin dependencias instaladas — SPA con estado en memoria (`STATE`). Solo se persisten en `localStorage` las *preferencias de vista* y el detalle del Paso 0 (clave `miAsistenteContable.prefs`); los archivos subidos se pierden al recargar.
- **Lectura de Excel**: SheetJS (`xlsx.full.min.js` vía CDN, con `integrity` SRI — si se cambia de versión hay que recalcular el hash).
- **Texto que viene de un archivo se escapa con `esc()`** antes de entrar en `innerHTML`; las cifras que se muestran pasan por `fmt()` (formato `1,000.00`).

## Pruebas

```bash
npm i xlsx
node tests.js
```

`tests.js` congela los casos reales corregidos a mano (montos con coma decimal o `:` pegado al número, nombres con typos y la Ñ rota, alias de empleados, neteo, cuadre, y los casos de Yenifer / Itza / Esther / ME-1970). **Correrlo antes de publicar cualquier cambio.** Si un test falla y el comportamiento nuevo es el correcto, actualizar la expectativa dejando anotado el hallazgo que lo motivó.

## Flujo de trabajo (git)

Nada se queda sin guardar: el contenedor de una sesión remota se borra por inactividad y lo que no esté pusheado se pierde. Después de **cada** cambio:

1. Correr las pruebas (ver arriba).
2. Resumir qué cambió y **preguntar antes de commitear y pushear** — el push nunca va automático.
3. Con el visto bueno: commit descriptivo + `git push -u origin <rama de trabajo>`.
4. Avisar si el árbol queda sucio al cerrar el turno, aunque el cambio esté a medias.

Si el cambio tocó `index.html`, preguntar además si se republica la página privada de claude.ai, para que no quede detrás del repo. No abrir un pull request salvo que se pida explícitamente.

## Controles de integridad (Módulo 2)

Verifica su propia lectura contra los totales que el navegador declara al pie (`Saldo Total Mostrado`, `Balance Final`) y detecta comprobantes duplicados. Si el cuadre falla, o si hay comprobantes sin desglose por empleado, **los resultados se bloquean** — cualquier cifra por persona sería incompleta. Las transacciones anuladas (`ABORTED`) se excluyen junto con su contrapartida y se reportan como partida conciliatoria del cuadre.
- **Estilo**: paleta propia "ledger" (tonos papel/latón), definida en variables CSS al inicio del `<style>` — no hereda la paleta verde de conciliador-caja/banco.
- **Deploy**: GitHub Pages, repo actualizable periódicamente.
- **Usuarios**: equipo contable interno, trabajo 100% independiente por usuario (sin resultados compartidos, sin roles).

## Patrón de módulo

Cada módulo sigue la misma plantilla: N espacios de carga de Excel (identificados con nombre/patrón esperado + estado "Sin subir"/"Subido: [nombre]"), detección automática de columnas por nombre de encabezado (tolerante a acentos/mayúsculas, soporta encabezados en 1 o 2 filas), lógica de comparación propia del módulo, y un checklist de hallazgos agrupado por paso/etapa, exportable a Excel (columnas: paso, fecha, banco/cuenta, hallazgo, fuente, corregido).

Tipos de módulo según espacios de carga: conciliatorios (2), revisión de pendientes (1), multi-etapa (varios, con pasos encadenados).

## Módulos

| # | Nombre | Estado |
|---|--------|--------|
| 1 | Conciliador Caja y Banco | Construido — ver PRD específico abajo |
| 2 | Revisión de movimientos pendientes | Pendiente de definir |
| 3 | Conciliador de auxiliares | Pendiente de definir |

### Módulo 1 — Conciliador Caja y Banco

Valida en una sola pasada que la venta reportada manualmente por las cajeras llegó íntegra al banco pasando por la contabilidad, detectando: método de pago mal asignado, montos en tránsito, y descuadres en retenciones VISA.

**7 fuentes de datos** (todas por upload de Excel): reporte consolidado de caja, diario Caja General, diario Banistmo, diario STG, estado de cuenta Banistmo, estado de cuenta STG, retenciones VISA STG.

**4 pasos encadenados**:
1. Reporte consolidado (por banco/día) vs. diario Caja General — solo se usan líneas de débito del diario (las de crédito llegan combinadas y duplicarían el total).
2. Diario Caja General vs. diario del banco correspondiente — banco detectado por texto en la descripción ("BTS"/"BANISTMO" → Banistmo, "STG" → STG).
3. Diario del banco vs. estado de cuenta real — matching 1:1 por monto ± tolerancia, ventana de días configurable, excluye silenciosamente partidas "ABORTED", revisa ambas direcciones.
4. Validación VISA STG — neto = Monto Bruto − Ret. Imp − Comisión − ITBMS, buscado entre líneas "Remisión V/Mc" del estado STG, solo fechas de banco ≥ fecha de venta.

**Parámetros configurables**: ventana de días (default 3), tolerancia en B/ (default 0.01).

**Pendiente de validar con datos de producción** (ver PRD del módulo): Paso 1 no probado aún con montos reales (el reporte de prueba compartido traía ceros); y si algún día el diario de Caja General no trae línea de débito separada por banco/método, el hallazgo del Paso 2 no se detectaría — asunción a confirmar.

## Cómo se comporta cada banco (validado con datos de producción)

Conocimiento del dominio que Diba fue confirmando sobre datos reales. Vive acá para no volver a investigarlo: cada punto costó una sesión de rastreo y está implementado con su prueba en `tests.js`.

### El ciclo del camión (Brinks → St. Georges)

El ACH de Brinks trae **la fecha del retiro en el local**, no la del depósito ni la de la acreditación:

```
Ach De Brinks Panama, S.A. - D08563bsafe 150526 David   →  retiró el 15/05/26
```

El ciclo es **asiento del día X → retiro X+1 → acreditación X+3 o X+4**, consistente en todo el mes. El desfase no es un error. Sin leer esa fecha, todos los ACH son intercambiables mientras el importe cuadre, y uno se va al día equivocado dejando huérfano al que le tocaba (mayo 2026: el asiento del 4-may se llevó el ACH del retiro del 13-may).

- `fechaRetiroBrinks(desc)` lee la fecha del texto · `retiroCompatible()` tolera hasta `ACH_ANTICIPO_MAX = 3` días hábiles de anticipo.

### El efectivo no llega al banco como "DEPOSITO"

Llega de tres formas, y ninguna dice "DEPOSITO":

1. **ACH de Brinks** — el efectivo que recoge el camión.
2. **Línea sin descripción** — St. Georges escribe el encabezado `"Descripción"` como texto de la fila cuando la transacción no trae ninguna. Son siempre importes chicos que acompañan al ACH del mismo día: el **redondeo del depósito** (el 2-mar-2026, el ACH de 2,380.00 vino con un crédito de 4.88). `sinDescripcion()` las reconoce.
3. **Depósito de ventanilla** — ese sí dice "DEPOSITO".

El efectivo de fin de mes es **Brinks + redondeo**, así que hay que reconocer las tres o no tiene contra qué compensar: el del 27 y 28 de feb de 2026 (282.32 + 2,384.88) viajó siete meses en el resumen por este motivo.

### El redondeo no se toma prestado de otro asiento

El redondeo se deposita el día del **retiro** y el ACH se acredita dos o tres días después, así que **normalmente** cae el día del ACH o antes. Los siete depósitos de efectivo de marzo de 2026:

| Asiento | ACH (retiro) | Redondeo | |
|---|---|---|---|
| 18-mar 309.82 | 305.00 el 20 (19/03) | 4.82 el **20** | mismo día |
| 19-mar 112.26 | 110.00 el 23 (20/03) | 2.26 el **20** | antes |
| 24-mar 377.26 | 375.00 el 26 (25/03) | 2.26 el **25** | antes |
| 26-mar 331.27 | 330.00 el 30 (27/03) | 1.27 el **30** | mismo día |

`combinacionMasCercana` completaba el importe con redondeos de **cualquier** fecha de la ventana, y se llevaba los del asiento siguiente: el 20-mar (166.92) se cuadró con el ACH de 165.00 del 23 más 1.27 y 0.65 del **30**, que son del 26-mar y del 27-mar. Suma exacta y contablemente falsa — y dejó huérfanos al 331.27 y al 145.65, que viajaron en el resumen a abril, mayo y junio.

- `redondeoNoPosteriorAlACH()` lo impide. **No exige mismo día**: eso habría roto el 19-mar y el 24-mar.
- Es el falso positivo del 5.85 de enero otra vez (armar un importe chico juntando centavos de cualquier fecha). El guard de mismo día quedó en `comboMismoDia` y nunca llegó a esta función — al tocar una, revisar la otra.

**El redondeo propio sí puede atrasarse meses**, así que "no posterior al ACH" vale para *elegir* el redondeo del pool, no como ley del banco: el 1.92 del efectivo del 20-mar entró por "Descripción" el **3 de junio**, cuando su ACH de 165.00 había entrado el 23-mar. Por eso el Paso 2 ya no es todo o nada: `achDelCamionConResto()` reconoce el ACH **único** con retiro compatible cuyo resto tenga tamaño de redondeo (tope 20), informa que el camión entró y arrastra **solo el resto** — antes sacaba una diferencia por los 166.92 completos mientras otro paso ya arrastraba el 1.92, o sea dos relatos de la misma plata.

### Las líneas del efectivo no las toca el cotejo general

El cotejo general del Paso 2 (depósitos, cheques, tarjetas) y la sección de efectivo comparten el pool de créditos, y el general corre primero. Una línea menos al arrancar le hace armar otra combinación, y arrastra: en junio de 2026, quitarle **una** línea de 1.92 le hizo llevarse los **siete** ACH de Brinks y redondeos de principio de mes, y el efectivo del 1, 2, 3 y 6 de junio salió como **cuatro diferencias falsas** teniendo su plata completa en el banco.

- `reservadoParaEfectivo()` esconde del cotejo general los **ACH de Brinks**: son efectivo del camión por definición, así que ni un cheque ni una tarjeta pueden tomarlos. El Paso 3 ya lo separa así (`esEfectivoConNombre` lo deja fuera de su pasada 4, *"si no, un Brinks de 38.17 se comería la remisión de tarjeta de 38.17 del mismo día"*).
- **El redondeo NO se reserva**, y es a propósito: reservarlo le quita al cotejo general líneas que usa para armar los acumulados de fin de mes, y el Yappy de 4,198.23 de mayo dejaba de cuadrar (5 rojas en el Paso 3).
- Los objetos del pool se comparten, así que `usado` sigue siendo global: la reserva esconde, no duplica.

Con los ACH reservados, el resto de un redondeo puede recibir **ventana larga** (150 días hábiles) sin costo: el 1.92 del 20-mar compensa el 3-jun y junio se mantiene en cero rojas. Esa ventana la da el **motivo** que el resumen conserva salto a salto, no el importe — si se re-rotula como una pendiente cualquiera, vuelve a los 15 días y nunca llega.

### El ACH puede venir consolidado

Brinks recoge el efectivo de Caja General **junto con plata que no pasa por Caja General** —la caja menuda que los dueños prestan, registrada solo en el diario del banco (`PDN-…`)— y el banco acredita todo en una línea:

```
18-may  6,215.00  Ach De Brinks ... 150526   =   215.00  (ME-00000001945, efectivo del 14-may)
                                              + 6,000.00  (PDN-000000057, préstamo interno)
```

Y el asiento del día puede estar **partido** entre camión y ventanilla, que el banco acredita por separado: los 218.94 del 14-may son 215.00 dentro del ACH + 3.94 de ventanilla como línea suelta.

Se acepta solo si el resto del ACH está **explicado** por débitos del diario del banco sin comprobante `ME-` (los que no vienen de Caja General). Un resto sin explicar no alcanza: cualquier depósito grande se tragaría cualquier efectivo chico.

### El tránsito tiene tres movimientos, no dos

Una partida en tránsito lleva **tres** asientos, y el tercero solo corresponde si el segundo se hizo:

| Cuándo | Asiento |
|---|---|
| Al depositar | Débito Banco / Crédito Caja General |
| Al cerrar el mes (**reingreso**) | Débito Caja General / Crédito Banco |
| Cuando el banco compensa (**descargo**) | Débito Banco / Crédito Caja General |

El reingreso es del mes anterior y el navegador del mes no lo trae, así que `corregirAcreditadasReingresadas` lo **deduce** de que la apertura coincida con el total del resumen. La coincidencia no distingue "reingresó" de "hay otra cosa dentro por el mismo importe": en febrero de 2026 dio por reingresadas 13 partidas y solo dos lo estaban. **Las deducidas van marcadas «por confirmar» y el asiento advierte que hay que verificar el navegador del mes anterior antes de registrar** — sin reingreso, el descargo duplica el débito al banco.

### Una partida en tránsito puede quedar partida entre dos meses

El banco acredita un medio de pago en un mes y el otro en el siguiente, así que ningún mes tiene las dos piezas:

```
27-may   DEPOSITO BRINKS DEL 27/5/2026   76.50   =   1.50  (estado de mayo, 30-may, línea sin descripción)
                                                 +  75.00  (estado de junio, 2-jun, ACH retiro 010626)
```

El pool de compensación del Paso 0 son **solo los créditos del estado del mes que se corre**, y se exige suma exacta: en mayo faltaban los 75.00 y en junio falta el 1.50, así que la partida viaja entera mes tras mes y su plata se le vuelve a pedir al banco.

- `consumirTransitoPrevio` tiene un **Paso C** que descarga las partes que sí compensaron y arrastra solo el resto — pero sigue el **desglose que declara el asiento**, parte por parte, con suma exacta y combinación única.
- **Sin desglose no se parte nada.** El corte no se puede deducir del banco: mayo de 2026 tenía 24 líneas de redondeo libres en St. Georges y **dos** de 1.50, así que cualquier resto chico se "explicaría" de varias formas. El 76.50 necesita que el corte lo declare el asiento (columna `Desglose` del resumen).
- Cuando queda **un solo** ACH de Brinks que podría ser la parte gruesa, el hallazgo **propone** el desglose a anotar y nombra la fecha de retiro. Solo informa: no consume la línea ni mueve plata.
- La sugerencia **no exige** `retiroCompatible`, y es a propósito: el efectivo del 27-may se retiró el 1-jun, cinco días hábiles después, porque el camión no pasa todos los días al cerrar el mes. Ese margen no se puede aflojar para *compensar* —hace intercambiables los ACH, que es lo que `ACH_ANTICIPO_MAX` evita—, pero sugerir no compensa, así que el texto advierte cuando el retiro cae fuera del ciclo X+1 y lo confirma quien concilia.

### El cobro a un tercero se registra después de que el banco lo acredita

El Paso 3 filtra por **sentido**: `"adelante"` descarta créditos anteriores al asiento (*"el banco no acredita antes del depósito"*) y `"atras"` descarta asientos posteriores al crédito. El supuesto vale para un depósito propio —nadie deposita antes de registrarlo— pero **no** para un cobro que llega por iniciativa de quien paga: el banco acredita cuando el tercero transfiere y contabilidad lo registra cuando se entera.

```
21-jul  232.15  Pago De Cxc Y Cxp De Tejar A Petty      (estado de cuenta)
22-jul  232.15  TEJAR, S.A - Pago:RCP00248 CASH         (diario, digitado el 23)
```

Salía como *"no aparece registrado en el diario"* teniendo su asiento exacto a **un día**. La prueba por contraste está en el mismo mes: el de **2,000.00** de Tejar sí cuadraba, porque su `RCP00252` es del mismo día — la única diferencia era la fecha.

- El discriminante es la **referencia**, no el texto: el navegador del banco usa `ME-` (MAN-ENTRY) para los asientos de caja, `PAY` (AP-PAY) para los pagos y **`RCP` (AR-PAY) para los recibos de cobro**. Solo esos reciben la excusa del sentido.
- La pasada 2b exige **1:1 por el importe exacto** (nunca una combinación, que es lo que armaría un falso positivo) y **candidato único**: con dos recibos del mismo importe en la ventana no se adivina cuál.

### Con importes iguales se empareja el más cercano en fecha

`buscarCombinacion` tomaba el **primer** candidato del array que coincidía en importe. Con varios importes iguales en la ventana eso empareja **en cascada** y deja uno huérfano. Los cuatro préstamos de Topy de julio de 2026 cuadran uno a uno:

| Estado de cuenta | Diario |
|---|---|
| 3-jul 1,000 | 3-jul `RCP00251` 1,000 |
| 16-jul 2,000 | 15-jul `RCP00245` 2,000 |
| 22-jul 2,000 | 22-jul `RCP00249` 2,000 |
| 30-jul 2,000 | 29-jul `RCP00250` 2,000 |

Pero el recibo del 15 se llevó el crédito del **22**, el del 22 el del **30**, y el crédito del 16 salió como *"no aparece registrado en el diario"* con su recibo exacto a **un día**.

- Es el mismo problema del ACH del retiro del 13-may: importes intercambiables y uno se va al día equivocado. `combinacionMasCercana` ya elegía por distancia mínima; ese criterio **nunca había llegado** a `buscarCombinacion`.
- La cercanía decide **entre** candidatos del mismo importe; no afloja la ventana ni el sentido.

### Dónde nace un descuadre de apertura

Siempre en el cierre del mes anterior o antes, nunca en el mes que se está corriendo. Si el mismo importe aparece todos los meses es **un solo asiento sin registrar que se arrastra**, no un hallazgo nuevo de cada mes: el descargo del tránsito de enero de 2026 (2,679.15) reapareció idéntico en marzo, abril y mayo.
