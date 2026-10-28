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

**Un cheque tampoco llega siempre como "DEPOSITO".** El de Farid Salmanzadeh por **1,068.00** entró a St. Georges el 15-jul-2026 como `"Descripción"`, con su asiento `ME-00000001998` del mismo día. Así que la fila sin texto no es solo el redondeo: puede ser cualquier importe. Sin reconocerlo, el mismo movimiento se reportaba **dos veces mal** — el cheque del diario salía como *"pendiente por cambiar"* habiendo clareado, y su crédito del estado quedaba huérfano, así que el Paso 3 lo daba como no registrado en el diario.

`conciliarChequesPaso3` acepta las líneas sin descripción **por encima de `TOPE_REDONDEO`**. Las chicas se quedan afuera a propósito: son el redondeo del efectivo, y metidas ahí le darían a `buscarSubsetSuma` centavos de cualquier fecha con los que armar un importe — el falso positivo del 5.85 de enero.

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

### El efectivo del Paso 0 también es ACH + redondeo en días distintos

`comboMismoDia` no junta líneas de fechas distintas, y su restricción existe por una razón buena: sin ella un importe chico se arma con centavos de cualquier fecha — el falso positivo del 5.85 de enero. Pero el efectivo de un día **es** un ACH más su redondeo, y esas piezas caen en días distintos:

```
31-mar  DEPOSITO BRINKS DEL 31/03/2026  324.32  =  320.00  (ACH del 2-abr, retiro 01/04)
                                                 +    4.32  (redondeo del 1-abr)
```

El redondeo entró el día del **retiro** y el ACH dos días después — el ciclo del camión. El Paso 2 ya sabía todo esto (`redondeoNoPosteriorAlACH`); al Paso 0 no había llegado, así que la partida viajaba desde marzo.

`comboAchConRedondeo()` lo resuelve con cuatro guards: **un solo** ACH con retiro compatible, el redondeo **no posterior** a su ACH, suma **exacta**, y solución **única** tanto entre los redondeos como entre los ACH.

Un detalle que costó un test mal hecho: para probar la ambigüedad entre dos ACH, **los dos restos** tienen que ser de tamaño de redondeo (≤ `TOPE_REDONDEO`). Con un resto mayor, ese ACH no tiene con qué completarse y no hay ambigüedad que probar.

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

**Lo mismo vale para un ajuste que mueve el banco por su cuenta**, y ahí la referencia no sirve de discriminante porque el asiento es un `ME-`: el `Ajuste De Ret. Itbms Julio` de **0.42** lo acreditó St. Georges el 10-ago-2026 y su asiento `ME-00000002041` es del **31** — se digita al cerrar el mes, cuando se nota. Salía dos veces: el asiento como pendiente que viaja al mes siguiente y el crédito como no registrado.

- `esAjusteDeBanco()` lee la señal del **texto**, y la exige en los **dos lados**: `AJUSTE`/`REVERSO`/`REV.` junto con `RETENCION`/`RET.`/`COMISION`/`ITBMS`. Eso es lo que protege, no la ventana — que es larga a propósito (`VENT_AJUSTE = 45` días hábiles) porque el asiento llega al cierre.
- Los demás guards son los de la 2b: 1:1 por el importe exacto y candidato único.
**La reversa de un cargo que el banco duplicó y corrigió solo** no tiene asiento ni le corresponde tenerlo. El 24-ago-2026 St. Georges cobró `Retencion Clave 22-08` **dos veces** y acreditó la reversa:

```
24-ago  Retencion Clave 22-08 16005605      débito  13.02
24-ago  Retencion Clave 22-08 16005605      débito  13.02   ← cobrada dos veces
24-ago  Rev. Retencion Clave 22-08 160      crédito 13.02   ← y revertida una
```

Neto: **un** cargo, que es lo que el diario registra. No es una diferencia, es ruido del banco — pero no se silencia: `cargoDuplicadoDelEstado()` lo reconoce y el Paso 3 lo reporta como **informativo**, con la exclusión explícita.

- Lo que la convierte en reversa no es el texto solo —cualquier crédito podría decir *"Rev."*— sino que el **duplicado exista**: se exigen, el **mismo día** y por el **mismo importe exacto**, **dos o más** débitos del estado con el texto del crédito sin el `Rev.`. Con un solo cargo no hay nada duplicado y la reversa es plata que vuelve: **esa sí es una diferencia** y tiene que salir.
- El estado **corta la descripción a unos 30 caracteres** y el `Rev.` se come cinco, así que los textos no son iguales (`...22-08 160` contra `...22-08 16005605`): se compara por **prefijo**, con un mínimo de 12 caracteres para que identifique el cargo de verdad.
- Costó una iteración: `f` en el bucle de `faltanEnDiario` es un objeto del **pool**, que lleva `.monto` y **no** `.credito`. Mirando solo `.credito` la regla no disparaba nunca desde el paso, aunque la función aislada funcionara.

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

### La devolución de un depósito mal enviado la declara el banco

Un depósito enviado a la cuenta equivocada puede tardar **meses** en volver, y mientras tanto la partida viaja en el resumen. El 27-may-2026 St. Georges devolvió **11.70 en una sola línea** (`"Blvd A Petty Dev De Dep Mal Enviado"`) que son **dos partidas de 5.85**: la del 27-may y la del **6-dic-2025**, a 172 días hábiles — once veces la ventana del tránsito.

- La señal se lee del **banco**, no del asiento: uno dice *"REE DEPOSITO DE BLVD ENVIADO POR ERROR"* pero el otro dice solo *"deposito en transito"*. `esDevolucionEstado()` la reconoce y el Paso B usa `VENT_DEVOLUCION` (250 días hábiles).
- A cambio se exige **solución única**: con una ventana de un año, varias partidas chicas armarían el importe de muchas maneras.

**Esto no cierra el caso de mayo de 2026**, y conviene saber por qué: la partida del 27-may **nace en el propio mes** (la genera el Paso 2) y el Paso 0 solo recibe la de diciembre, así que las dos piezas nunca coinciden en un mismo mes — y en junio, cuando el resumen ya trae las dos, el crédito de 11.70 quedó en el estado de mayo. Es el mismo patrón del 76.50: **hay partidas que solo se cierran a mano**, descargándolas del resumen.

### La devolución se puede mandar mal dos veces, y una rebota

Un depósito que llega por error a la cuenta de Petty se devuelve a su dueño, y **la devolución puede salir mal otra vez**. St. Georges, 184.26:

```
12-ago  crédito 184.26  "Descripción"                             entró plata de SHOPPING MARKET
11-ago  ME-00000002022  "DEP ENVIADO POR ERROR A PETTY SHOP…"     Petty la registra
04-sep  débito  184.26  "Dev Petty A Market Ref Dep Mal Env"
05-sep  débito  184.26  "Petty A Mark Ref Dep Mal Enviado"        mandada dos veces
05-sep  crédito 184.26  "Dec De Ah Mal Enviado Graphic A Pett"    una rebota
05-sep  PAY0004549      SHOPPING MARKET  crédito 184.26           el diario, UNA sola vez
```

Banco: −184.26 −184.26 +184.26 = **−184.26**. Diario: **−184.26**. Cuadra — **el asiento está bien** y no hay nada que corregir en el sistema. El crédito del rebote salía como *"no aparece registrado en el diario contable"*.

Es la misma **forma** que la reversa duplicada de agosto (dos débitos, un crédito, un asiento) pero **no el mismo caso**: ahí el banco cobra un cargo **propio** dos veces y el texto del crédito es el del débito con un `Rev.` delante. Acá el texto es otro —otro redactado, otra dirección, otros nombres— y los débitos **no son del mismo día**, así que aflojar `cargoDuplicadoDelEstado` le abriría la puerta a cualquier crédito con un débito igual cerca. Va como regla aparte, `devolucionReenviadaDelEstado()`.

- Lo que la protege es lo mismo de allá: que el **duplicado exista**. Se exigen **dos o más** débitos del estado por el **importe exacto** y con la misma señal de depósito mal enviado, dentro de `VENT_DEVOLUCION_REENVIO` (5 días hábiles; el caso real es 1).
- Con **un solo** débito el crédito es plata que vuelve de verdad: **esa sí es una diferencia** y tiene que salir. Es el 11.70 del 27-may de arriba, que sigue rojo.
- **La descripción viene cortada y eso decidía la regla.** El estado corta a unos 30 caracteres: el débito del 4-sep queda en `"…Ref Dep Mal Env"` y el del 5-sep alcanza a decir `"Mal Enviado"`. `esDevolucionEstado` buscaba la frase entera, así que reconocía **uno solo** de los dos y el guard de "dos o más" no disparaba nunca. Ahora busca `MAL ENV`. Es el mismo problema del `Rev.` que se comía cinco caracteres en la reversa de agosto — **al tocar una, revisar la otra**.

### El navegador declara el desglose debajo del movimiento

Caja General agrupa en **una** línea lo que el diario del banco trae separado, y el rótulo de esa línea es el de la **primera parte**, no el del total. El `ME-00000002070` del 30-sep-2026:

```
DEPOSITO POR TARJETA CLAVE BANISTMO DEL 30/9/2026   crédito 676.70
  258.25                                             ← la CLAVE
  DEPOSITO POR TARJETA VISA BANISTMO DEL 30/9/2026   ← rótulo de la parte siguiente
  418.45                                             ← la VISA
```

El mismo comprobante trae el patrón en el efectivo: `BRINKS 152.04` = `150.00` + `DEPOSITO DEL 29/9/2026` `2.04`.

`parseDiario` las descartaba (`if(!iso) continue; // fila secundaria (glosa de detalle)`), así que `partes` quedaba en `[{CLAVE, 676.70}]`. `yaCubiertoEnTransito` podía descontar la parte CLAVE del Paso 3 (258.25) pero la VISA de 418.45 no encontraba parte de su método, caía a `buscarSubsetSuma`, no cuadraba contra el 676.70 y **entraba al resumen**: 418.45 contados dos veces. Que se salvara el 258.25 fue **suerte del rótulo** — con el encabezado al revés se duplicaba el otro.

- `partesDeSubLineas()` las lee. Dos guards: la suma tiene que dar **exacto** el importe del movimiento, y tiene que haber **dos partes o más** (con una sola no se gana nada sobre lo que ya se deduce del encabezado).
- Número o texto se decide **antes** de llamar a `money()`: un rótulo pasado por `money()` quedaría registrado como celda ilegible y el paso reportaría un problema de lectura que no existe.
- El desglose **declarado** gana sobre el deducido de los débitos (`partes: x.partesSub || x._partesReingreso`): el 676.70 tiene un solo débito, rotulado CLAVE.

**El desglose cruza de mes por la columna `Desglose` del resumen**, y ahí hace trabajo de verdad: el `1,057.48` del 31-jul-2026 resultó ser `CLAVE 548.73 + VISA 508.75`, y con el corte declarado el Paso C del Paso 0 descargó la CLAVE (el banco la acreditó el 3-ago) y arrastró solo el resto.

### El espejo: el redondeo entró y el camión no

`achDelCamionConResto` cubre el caso en que el ACH ya compensó y falta el redondeo (el 1.92 del 20-mar-2026). Al revés pasa igual de seguido y no había nada que lo reconociera: el redondeo se deposita el día del **retiro** y el ACH se acredita dos o tres días después, así que **a fin de mes el redondeo entra y el ACH se va al mes siguiente**.

```
Caja General  29-sep  DEPOSITO BRINKS DEL 29/9/2026  338.12 = 335.00 + 3.12   (sub-líneas)
Estado STG    30-sep  "Descripción"                  crédito  3.12   ← el redondeo YA entró
Estado STG            el ACH de 335.00 no está: se acreditó el 1-oct
```

La partida viajaba por los **338.12 completos**, así que en octubre iba a buscar 338.12 y encontrar 335.00 — no cuadra, y vuelve a viajar.

`redondeoDelCamionSinACH()` se apoya en el desglose **declarado**, no en adivinar el corte: exactamente dos partes, una de tamaño de redondeo y la otra no, y **una sola** línea sin descripción libre que coincida con la chica por el importe exacto. Corre **después** del cotejo normal y de `achDelCamionConResto`, así que llegar ahí ya significa que ni el total ni el ACH-con-resto cuadraron.

**Cerró el 76.50 del 27-may** que estaba documentado arriba como "solo se cierra a mano": con el 1.50 descargado en mayo, los 75.00 compensaron solos en junio.

### El cotejo general se lleva los redondeos si nadie los aparta

`reservadoParaEfectivo` esconde del cotejo general los ACH de Brinks pero **no** los redondeos, y eso es a propósito (reservarlos todos rompía el Yappy de 4,198.23 de mayo). Pero sin ninguna reserva el general se los lleva igual.

Agosto de 2026 lo mostró al partirse el `1,057.48`: el cotejo general se llevó los **catorce** redondeos del mes y el efectivo de catorce días salió como *"el camión entró, falta el redondeo"* **con su plata completa en el banco** — `0.06, 0.53, 0.67, 0.72, 0.75, 1.62, 1.90, 2.09, 2.55, 2.85, 2.92, 3.57, 10.50` y el de `153.48`. Se verificaron los catorce, uno por uno, en el estado de STG. El resumen pasaba de **18 partidas a 32**.

El medio es reservar **solo el redondeo que una línea de efectivo puede nombrar**: el resto exacto entre su importe y **un** ACH con retiro compatible, y **una sola** línea sin descripción que lo cubra. Lo que no se puede probar no se reserva, así que el general conserva las líneas sueltas con las que arma los acumulados de fin de mes.

- `marcarRedondeosDelEfectivo()` lo hace, con el mismo par (ACH único + resto de tamaño de redondeo) que usa `achDelCamionConResto` — pero acá solo sirve para **apartar** la línea, no para compensar.
- Marca los objetos del pool, que son compartidos: apartar no duplica.
- **Al tocar `reservadoParaEfectivo`, revisar esta**: son las dos mitades de la misma decisión.

### No todo pendiente es un depósito que falta

El asiento de venta puede estar **digitado por más de lo que se cobró**, y entonces el pendiente no tiene contrapartida en ningún banco: esa plata nunca existió. El `ME-00000001915` del 11-abr-2026:

| Línea | Monto |
|---|---|
| Débito `REPORTE DE VENTA DEL 11/04/2026` | **2,111.02** |
| Crédito `DEPOSITO BRINKS` (330.00 + 2.10) | 332.10 |
| Crédito `DEPOSITO DE BANISTMO CK` | 164.08 |
| Crédito `VISA + CLAVE BANISTMO` (982.09 + 568.67) | 1,550.76 |
| **Diferencia** | **64.08** |

El informe de cajeras de ese día declara **2,046.94**, exacto a los créditos. El `2,111.02` no aparece en ningún otro documento —ni en el reporte, ni en el estado de Banistmo, ni en el navegador del banco, ni en las retenciones VISA—, así que el outlier es el asiento. La partida viajó de abril a julio diciendo *"aún NO compensó este mes"* todos los meses, mandando a buscar al banco algo que no existe.

- `diferenciaDeDigitacion()` lo reconoce: `ventaReportadaDia()` suma todos los métodos del informe de ese día (los de banco más el efectivo, que `parseReporteConsolidado` devuelve aparte en `.efectivo`) y se exige que `débito − venta declarada` **coincida con el pendiente**, dentro de los centavos del faltante/sobrante. Si no coincide, hay dos cosas distintas pasando el mismo día y rotularlo como error de digitación mandaría a corregir un asiento que está bien.
- **La partida igual viaja al resumen**: el débito está posteado y el saldo de Caja General lo tiene dentro. Lo que cambia es el rótulo, no el arrastre.
- **El Paso 1 no lo ve** porque cotea por banco/día y el débito de venta es una línea sola sin banco en el texto. El hallazgo que se lee cada mes lo emite el **Paso 0**, leyendo el resumen — así que la marca tiene que cruzar de un mes al siguiente por la columna **Motivo** (`digitado`, igual que `restoRedondeo`). Al tocar una, revisar la otra.
- El banco que muestra es **deducido** (`bancoDelEfectivo`), no real: ningún banco lo debe. Acá dio STG cuando todos los depósitos del 11-abr son Banistmo.

### Un asiento ya emparejado no se cobra dos veces

La **pasada 1** de `conciliarBancoEstado` era la única sin el guard `if(d.usado) return`, así que un asiento que las pasadas 0 (efectivo del día consolidado) o 0b (acumulado del período) ya habían cuadrado **volvía a buscar match** y se robaba líneas del estado que le tocaban a otro.

Agosto de 2026:

```
pasada 0:  05-ago  DEPOSITO BRINKS 90.00   ↔  07-ago  ACH Brinks 90.00 (retiro 06/08)   ✓ correcto
pasada 1:  05-ago  DEPOSITO BRINKS 90.00   ↔  12-ago  20.01 + 19.98 + 50.00 = 89.99     ✗ otra vez
```

89.99 está a **un centavo** de 90.00, justo dentro de la tolerancia. Con esas dos piezas consumidas, el `DEP DE FALTANTES` de **46.10** del 11-ago —que el banco acreditó partido en `6.11 + 20.01 + 19.98` el 12— se quedaba sin nada, y la misma plata salía **dos veces mal**: el asiento como *"pendiente por compensar en banco"* teniendo su crédito, y el 6.11 como *"no aparece registrado en el diario"*.

- El diario incluso declara el desglose en sus sub-líneas (`7/5 6.11`, `4/4 20.01`, `4/5 19.98`), pero no hacía falta leerlo: con el guard, `buscarSubsetSuma` arma la combinación correcta sola.
- Es el falso positivo de siempre —un importe armado con lo primero que sume— pero del lado del **asiento**, no de las líneas. Las otras pasadas (2, 2b, 2c, 3) ya traían el guard.

### Un lote de cheques se acredita cheque por cheque, en días distintos

Los cheques del día se depositan **juntos** en un solo asiento y el banco los acredita **uno por uno**: cada cheque clarea cuando clarea.

```
31-jul   DEPOSITO POR CK BANISTMO DEL 31/7/2026  506.99  (ME-00000002012)
                                                 =  247.66  (3-ago)
                                                 +  259.33  (11-ago)
```

Seis días hábiles entre las dos piezas. `comboMismoDia` no las junta —exige mismo día— y `comboAchConRedondeo`, que es la excepción que ya existe para días distintos, solo corre para el efectivo. Así que la partida viajaba mes tras mes **inflando el resumen en 506.99 con su plata completa en el banco**.

El **Paso A2** ya sabe de cheques repartidos en varios depósitos (el caso de febrero de arriba), pero exige el **desglose declarado**: esta partida es toda cheque, no mixta, así que no hay desglose que declarar.

La restricción de mismo día de `comboMismoDia` existe por una razón buena —sin ella un importe chico se arma con céntimos de cualquier fecha, el falso positivo del 5.85 de enero—, así que aflojarla pide guards que la reemplacen. `comboLoteDeCheques()`:

- Solo para partidas de **cheques** (`esChequeTransito`): un lote de cheques es lo que el banco acredita pieza por pieza. Una tarjeta no.
- Solo líneas que el estado llama **DEPOSITO**. Eso saca de juego los redondeos y las líneas sin descripción, que son justamente los céntimos con los que se armó el 5.85.
- Suma **exacta** y solución **única** entre los depósitos libres de la ventana. Con dos formas de llegar al total se deja pendiente.
- Entre `minN` y tres líneas. El Paso 0 pide **2** porque su 1:1 ya corrió con la misma ventana; el Paso 2 pide **1** (ver abajo).

En agosto de 2026 había **cuatro** depósitos libres en Banistmo (247.66, 179.62, 259.33, 139.59) y **una sola** forma de armar 506.99.

**La misma regla hacía falta en el Paso 2**, porque tres pasos tenían **tres ventanas** para lo mismo:

| Paso | Ventana para un cheque |
|---|---|
| Paso 0 (`ventanaTransito`) | 90 |
| Paso 2 | **7** — la ventana general |
| Paso 3 (`conciliarChequesPaso3`) | 366 |

Julio de 2026 lo mostró: el cheque de **112.13** del 1-jul entró el **22** (14 días hábiles) y el de **558.08** del 4-jul entró como `336.59 + 44.69` el **17** más `176.80` el **22** (12 y 17 días). Los dos quedaban *"pendiente por cambiar"* en el Paso 2 y el Paso 3 —con su ventana larga— los cuadraba: **670.21 viajaban al resumen teniendo su plata completa en el banco**. Dos relatos de la misma plata.

- El Paso 2 reusa `comboLoteDeCheques` con `minN = 1`, porque su 1:1 ya corrió con la ventana **corta**, y con `VENTANA_CHEQUE_BANCO = 366` — el mismo número del Paso 3, que en la práctica significa "dentro del mes".
- Va **antes** de buscar en otros bancos: si clareó en el suyo con rezago, no hay nada que buscar.
- Se reporta como **informativo** con el motivo *"el cheque clareó con rezago"*, nombrando los depósitos y sus fechas — igual que `acreditadoEnRango`.
- Las otras **nueve** pendientes de julio siguen pendientes: esos cheques sí están sin cambiar, y el Paso 3 también las deja así.

### Un cheque en circulación puede volver como reembolso, no como depósito

Un cheque recibido puede **no cambiarse nunca** y que quien lo giró devuelva la plata por **transferencia** meses después:

```
19-mar   Cheque (detalle individual)  500.00   ← queda en circulación
06-ago   CR TRANSFERENCIA ENTRE CUENTAS PROPIAS//PRP BOUTI A PETTY   crédito 500.00
```

**Dos cosas lo bloqueaban, y la ventana era la menos importante:**

- **El pool.** `poolDe()` manda un cheque pendiente a `poolDep`, que son **solo los créditos cuyo texto dice "DEPOSITO"** (`esDepositoEstado`). Un reembolso por transferencia no lo dice, así que la línea **no estaba en el pool** y el cheque no la veía nunca. Medido: subir la ventana del cheque de 90 a 250 **tampoco** lo resolvía.
- **La ventana.** 90 días para un cheque contra **140** reales. Y ojo: `distanciaBancaria` **cae a días calendario** cuando la fecha queda fuera del calendario bancario del mes que se corre (`CAL_BANCARIO` solo cubre ese mes), así que para una partida vieja la ventana es de calendario, no hábil.

Es el mismo patrón que ya está arriba —*"un cheque tampoco llega siempre como DEPOSITO"*— pero esa lección había quedado solo en `conciliarChequesPaso3`; **al Paso 0 no había llegado**.

El **Paso B2** cruza el límite del pool a propósito, así que lo que protege son los guards:

- La partida tiene que ser un **cheque** (`esChequeTransito`): son las que quedan en circulación meses.
- El crédito tiene que declararse reembolso (`esReembolsoEstado`: `REEMBOLSO`/`REINTEGRO`/`DEVOLUCION`/`TRANSFERENCIA ENTRE CUENTAS`), o sea decir que **no es un depósito normal**.
- **1:1 por el importe exacto**, nunca una combinación.
- **Candidato único por los dos lados**: un solo crédito de ese importe y un solo cheque pendiente de ese importe. Con dos de cualquiera se deja como diferencia — con una ventana de un año, elegir sería adivinar.
- El hallazgo lo **dice**: el cheque nunca se cambió, así que hay que **darlo de baja** en el sistema en vez de seguir esperando que claree. No es lo mismo que un cheque cobrado.

`esChequeTransito()` quedó como **única** definición de "esto es un cheque en tránsito", usada por `ventanaTransito` y por el Paso B2: con dos copias del mismo regex, tocar una y olvidar la otra ya costó caro antes.

### El banco del efectivo se vota, y la ventanilla puede ir a otro

`efDec.banco` sale de un conteo de **votos**: los ACH de Brinks del mes más las partidas de efectivo del resumen anterior. Eso vota siempre al banco del **camión** —St. Georges—, pero la **ventanilla** puede ir a otro banco.

```
Reporte 28-mar       Ventanilla                       189.31   (no hubo Brink)
Caja General         DEPOSITO DEL 28/03/2026           31.40   (ME-00000001904)
                                                      ──────
pendiente                                             157.91   ← la partida, con banco STG
```
```
Estado BANCO GENERAL  28-mar   DEPOSITO               157.94   ✓
```

Los **0.03** son el `FALTANTE DEL 28/03/2026`, cuyo crédito está en el mismo comprobante: al banco entraron 31.40 + 157.94 = 189.34, o sea la ventanilla más el faltante. Por eso el depósito no coincide al céntimo con el pendiente y se admite el margen `TOL_CENTAVOS_DIA = 0.15`, el mismo que usa `metodoDelPendiente`.

`depositoDelEfectivo()` lo identifica **por importe**, con un guard de unicidad global: **un** solo banco con **un** solo `DEPOSITO` libre que encaje. El hallazgo pasa a decir dónde está la plata y **qué asiento falta** (`Débito Banco General / Crédito Caja General`).

**El banco de la partida NO se cambia, y eso se midió.** Puesta en Banco General, la partida llega al Paso 0 de julio y se come **tres** créditos de Yappy de ese banco que suman **157.91 exacto** (`8.16 + 114.75 + 35.00`) y les tocaban a los depósitos del 3, 20 y 22 de julio, que salían huérfanos. Suma exacta y contablemente falsa — el falso positivo de siempre. Y no hay nada que ganar: la línea que la compensa está en el estado de **marzo** y ningún mes posterior lo trae.

- La partida **sigue en tránsito**: Caja General no la acreditó, así que esos pesos siguen dentro de la cuenta. Lo que falta no es que el banco compense, es el **asiento**.
- El texto avisa de la discrepancia: *"en el resumen va como STG, que es donde compensa el efectivo del mes, pero esta plata está en Banco General… se cierra con el asiento, no esperando al banco"*.
- Al Paso 1 se le pasan los estados de cuenta **solo** para esto. El Paso 1 no concilia contra el banco: eso es del Paso 2.

### El informe de retenciones fecha la VISA el día que VISA la procesa

`ventasSinDeposito` descuenta la VISA de St. Georges con `visaDia[c.fecha]`, que sale del informe de retenciones y se busca **el mismo día** del asiento. Pero el informe fecha la venta el día en que **VISA la procesa**, que puede ser el siguiente:

```
Caja General      10-mar   ME-00000001885   venta 1,234.47 − créditos 1,024.35 = 210.12
Reporte cajera    10-mar   VISA STG                                              210.15
Informe VISA      11-mar   "03/11/2026"  Sub total fecha: bruto                  210.15   ← un día después
```

Con `visaDia["2026-03-10"]` vacío, los 210.12 salían como *"la venta entró a Caja General y no salió por ningún depósito"*. La partida viajó de **marzo a agosto** y le restaba 210.12 al cuadre de apertura de cada mes: al sacarla, el de agosto pasó de **324.12 a 114.00**.

**Las fechas se leen bien** — el informe usa `MM/DD/YYYY` y la app lo lee como `2026-03-11`; no hay bug de formato. Lo que había que aceptar es que el crédito de la VISA de STG llega en el **acumulado de fin de mes**, con informe o sin él:

- No se parchea la fecha. Si el reporte de cajeras declara que ese pendiente **es** la VISA de St. Georges, el crédito llega a fin de mes por definición. El guard es el de `metodoDelPendiente`: **un solo** método del día que coincida con el pendiente.
- La excusa es **solo** de la VISA de STG. La VISA de Banistmo y la CLAVE de STG siguen siendo depósitos que faltan: el acumulado de fin de mes es de la VISA de St. Georges.
- Si la VISA no llegara de verdad, no se silencia: el **Paso 2** cotea el acumulado de fin de mes contra las remisiones del estado y el **Paso 4** valida las retenciones.
- Los **0.03** entre 210.15 y 210.12 son los centavos del faltante/sobrante del día, el mismo patrón del 157.91 de arriba.

### La VISA se acredita NETA, y el reingresado puede compensar en su propio mes

Un `reingresado en el mismo comprobante` no se comparaba contra el estado, porque *"el banco lo acredita el mes siguiente"*. Para la CLAVE es cierto; para la VISA **no**. El `ME-00000001986` del 30-jun-2026:

```
Caja General  30-jun  "DEPOSITO POR TARJETA VISA STG"   280.21 = VISA 91.26 + CLAVE 188.95
Informe VISA  30-jun  bruto 91.26 − retenciones 4.47  =  neto 86.79
Estado STG    30-jun  "Remisión V/Mc … Liq. No. 3914827"  crédito  86.79   ← la VISA, NETA, el mismo día
Estado STG    01-jul  "Remision Clave"                    crédito 188.95   ← la CLAVE, el mes siguiente
```

El 280.21 viajaba entero, en julio el Paso 0 descargaba la CLAVE y los **91.26 quedaban pendientes para siempre**: su crédito vivía en el estado de **junio** y ningún mes posterior lo trae. En agosto, septiembre y octubre seguía pidiéndole al banco plata que ya había pagado.

`parteReingresoCompensada()` lo cierra, y lo que lo hace seguro es que no se adivina nada — el informe declara el bruto y su neto, y el estado tiene **una sola** remisión libre de ese neto:

- La parte tiene que decir su **método** (VISA o CLAVE) y la línea tiene que ser la remisión **de ese método**.
- Para la VISA el objetivo es el **neto**, y solo cuando el informe trae **una** entrada de ese bruto exacto. Sin informe, o con dos entradas del mismo bruto, se busca por el bruto como siempre.
- **1:1 por el importe exacto** y candidata **única**.
- La línea no puede ser **anterior** al asiento.

**El desglose de una sola parte también se escribe y se lee**, y eso no es cosmética: cuando una parte ya compensó, lo que viaja es el **resto**, y su método puede no ser el del concepto. El 280.21 se llama *"DEPOSITO POR TARJETA VISA STG"* y lo que queda es la **CLAVE** de 188.95 — `poolDe()` la buscaba entre las remisiones de la VISA, donde nunca iba a aparecer. Ahora el desglose declarado elige el pool (`desgloseTexto` y `leerDesglose` aceptan una sola parte; la suma exacta sigue siendo el guard). Con el pool correcto, la CLAVE compensó sola en julio y la partida del 30-jun quedó **cerrada por completo**.

Tres consolidados cayeron con la misma regla: el `280.21` del 30-jun, el `1,057.48` del 31-jul (VISA 508.75 neta en julio, CLAVE 548.73 el 3-ago → cerrada) y el `397.00` del 31-ago (VISA 227.11 neta, queda la CLAVE de 169.89).

### El acumulado del mes lo cuentan los dos pasos, o lo cuentan dos veces

Un asiento que declara un **rango** lo acredita el banco en decenas de depósitos diarios. El Paso 2 ya lo reconocía (`acreditadoEnRango`), pero esa decisión **no cruzaba al Paso 3**, que cotea el diario del **banco** contra el estado. Enero de 2026 de BOUTI:

```
Caja General       31-ene  ME-00000001877  "DEPOSITOS POR YAPPY DEL 1 AL 31 DE ENERO"  27,648.46
Diario Banco Gral  31-ene  ME-00000001877  un solo débito                              27,648.46
Estado Banco Gral   1 al 31  169 depósitos                                             27,648.46   ← exacto
```

El Paso 2 decía *"ya está completo en el estado de cuenta"* y el Paso 3, en el mismo mes, sacaba **160 huérfanos por 25,997.96** más el asiento como pendiente. La misma plata, dos relatos, y por los dos lados: **162 rojas donde había cero diferencias**.

- `lineasDelAcumuladoEnRango()` es ahora la **única** definición, usada por los dos pasos. El Paso 3 marca las líneas con `_acumRango` para que `faltanEnDiario` no las reporte, y saca el asiento como **informativo** en vez de pendiente.
- Los guards no cambiaron: el asiento tiene que declarar **rango y método**, y **todos** los créditos de ese método dentro del rango tienen que sumar **exacto**. Si hubiera otro asiento del mismo método adentro, el total ya no daría.
- Con **una sola** línea no entra: el cotejo normal ya la encuentra.
- El rango que declara el asiento es de **venta** y el banco acredita el último día al siguiente, así que se prueba el rango literal y, si no cuadra, se estira el cierre a fin de mes. Estirar no afloja nada — la suma exacta sigue mandando.

**Lo que esto no arregla, a propósito**: el Paso 1 sigue sacando la diferencia contra el **reporte de cajeras** (en BOUTI, **−25,908.88**), y tiene razón. El banco y el asiento cuadran al centavo entre sí; el que no participa es el reporte. Eso es un dato del negocio —plata que no pasa por la caja— y la app no lo puede resolver sola.

### El primer mes de otra empresa

El dominio de arriba se validó sobre Petty, pero **transfiere casi entero**: el reporte de cajeras y los navegadores de BOUTI usan el mismo formato y el mismo vocabulario (`DEPOSITO BRINKS`, `DEPOSITO POR TARJETA CLAVE STG`), y el Paso 1 rutea sus tres bancos sin tocar nada. Lo que no transfiere es la **lectura del Paso 0**, porque ese archivo lo arma cada quien:

- **El resumen puede no estar en la primera hoja.** El que exporta la app sí lo está; el de un mes armado a mano no. BOUTI trae la conciliación bancaria del sistema en `Hoja1` y `Hoja2` y la tabla que la app lee en **`Hoja3`**. `parseTransitoPrevio` busca el encabezado en **todas** las hojas y toma la primera que lo traiga.
- **Una fecha puede llegar como serial de Excel.** Una celda con formato de fecha llega como `Date`, pero una columna escrita a mano puede quedar en número crudo: `45789` en vez de `05/12/2025`, y esa partida **se perdía sin avisar**. `toISODate` lo convierte con el origen `1899-12-30`, exigiendo rango razonable para no confundir un importe con una fecha.

Y un recordatorio que costó dos vueltas: **el estado de cuenta puede ser de otro mes**. BOUTI mandó dos veces el de julio llamándolo enero, y eso solo generaba **159 rojas falsas**. El archivo lo declara en su fila 3 (*"Movimientos desde 01-jul-2026 hasta 31-jul-2026"*) — mirarla antes de interpretar nada.

### Dónde nace un descuadre de apertura

Siempre en el cierre del mes anterior o antes, nunca en el mes que se está corriendo. Si el mismo importe aparece todos los meses es **un solo asiento sin registrar que se arrastra**, no un hallazgo nuevo de cada mes: el descargo del tránsito de enero de 2026 (2,679.15) reapareció idéntico en marzo, abril y mayo.

### Una cuenta más del mismo banco no es "otro banco"

`STG Super` y `STG Bordados` son dos cuentas más de St. Georges, opcionales, con las mismas funciones en los Pasos 2 y 3. Lo que cuesta no es el cotejo —ese es el mismo— sino el **ruteo**, porque el nombre de las dos contiene `GEORGE`:

```
DEPOSITO POR TARJETA CLAVE ST. GEORGES BORDADOS DEL 5/10/2026
```

`clasificarBancoPorTexto` probaba `STG|GEORGE` y devolvía `"STG"`, así que toda la plata de Bordados se iba a la cuenta principal y **las tres quedaban mal**: la principal con depósitos que no son suyos y las otras dos sin los que sí. Las cuentas adicionales se prueban **antes** del banco base.

- **La seña sola no alcanza en la descripción de un asiento.** `SUPER` puede ser un tercero —`SUPER 99` es un cliente— así que se exige además la mención del banco base. Sin base la línea queda **sin banco** y el paso la reporta, que es lo que se quiere: que salga, no que se adivine a qué cuenta va. Y la seña es palabra completa: `SUPERMERCADO` no es la cuenta Super.
- **En el nombre de cuenta del navegador sí alcanza**, porque ahí no hay texto de tercero: lo escribe contabilidad. Sin eso, `identificarArchivo` daba `diarioStg` para el archivo de Bordados y la casilla correcta lo rechazaba por *"no corresponde"*.
- **El encabezado no distingue una cuenta de otra.** Los estados de las tres cuentas de St. Georges exportan igual, así que `bancoDeEstado` devuelve `stg` para las tres y la validación de casilla **no puede** avisar si se subió el estado equivocado. Protege de meter ahí un Banistmo, no de confundir entre cuentas del mismo banco — eso lo mira quien sube el archivo, y la ayuda de la casilla lo dice.
- `CUENTAS_EXTRA` es la **única** declaración: casillas, ayudas, opcionales por paso, calendario bancario, control de períodos, integridad y los cuatro pasos se derivan de ahí. Cablearlas una por una como Banistmo/STG/Banco General significaba repetir el cableado en una veintena de lugares, y olvidar uno no revienta: el paso corre y deja la cuenta fuera del cotejo sin avisar.
- Al Paso 3 las cuentas extra entran **sin** `retVisa`: el informe de retenciones es de la cuenta principal, que es la que recibe las remisiones de VISA. Pasárselo a otra la haría buscar un neto que ahí no entra nunca.
- Entran también al **Paso 0** (para que una partida en tránsito suya pueda compensar) y al **Paso 1** (solo para `depositoDelEfectivo`, que exige banco único: sumar cuentas ahí hace la regla más exigente, nunca más suelta).

### El depósito ruteado a un banco sin estado de cuenta desaparecía

El cotejo del Paso 2 recorre los bancos que **tienen estado**, así que un crédito de Caja General que el ruteo manda a un banco ausente de ese mapa **no lo miraba nadie**: no cuadraba, no quedaba pendiente, no salía en ninguna parte. El paso podía terminar en **cero diferencias con esa plata afuera** — el mismo silencio de `money()` devolviendo 0 ante una celda ilegible.

Ya pasaba con **Banco General** (todo lo que dice `YAPPY` se rutea ahí) y no se había notado porque su estado siempre se sube. Las cuentas adicionales, que son opcionales de verdad, abren el hueco en cuanto alguien sube el navegador de Caja General y no el estado de la cuenta.

- El Paso 2 agrupa esas líneas por banco y las reporta como **diferencia roja**, diciendo cuántas son, por cuánto, y que el resultado del paso está incompleto en ese importe.
- El Paso 0 ya tenía su guard (`banco no reconocido`), pero su mensaje mandaba a **corregir la columna Banco** del archivo. Para una cuenta que la app **sí** conoce eso manda a corregir lo que está bien: ahora se reporta aparte (`cuenta sin estado de cuenta`) y el texto manda a subir el estado en el Paso 2. Si no hay **ningún** estado, de eso avisa el bloque general y el per-cuenta se calla — si no, repetiría el mismo mensaje tantas veces como bancos traiga el resumen.

### El estado de cuenta puede venir partido por mes

La banca en línea exporta el mes y nada más, pero un archivo armado a mano puede traer el año entero con una hoja por mes. Shopping mandó dos así en enero de 2026, y de formas distintas:

| Archivo | Primera hoja (la que la app leía) | La hoja que correspondía |
|---|---|---|
| Estado STG **Bordados** | mezcla ene→sep, 843 líneas | `Ene 2026`, 118 líneas |
| Estado STG **Super** | `Julio 2026 (2)` | `Enero 2026`, 498 líneas |

Leyendo la primera hoja, a Bordados se le metían **725 líneas de otros meses** al cotejo de enero y a Super se le leía **el mes equivocado entero**. Para enero de Bordados no cambió ninguna cifra, pero en un mes con más movimiento una línea de agosto se engancha con un depósito de enero por coincidencia de importe — el falso positivo de siempre, con ocho meses de líneas para elegir.

`hojaDelMes()` corre dentro de `parseEstadoCuenta`, así que **ningún punto de lectura puede olvidarse de ella**: los cuatro pasos, el calendario bancario, el control de períodos y los controles de integridad parsean los estados por su cuenta y cada uno la habría necesitado por separado.

- **El mes no se adivina**: `fijarMesTrabajo()` lo saca de `diagnosticarPeriodos`, o sea de la **misma votación por mayoría** que ya usaba el control de períodos. No hay una segunda definición del mes de trabajo. Se fija en `computaPaso`, que es por donde pasan los dos caminos (los 3 pasos y "ejecutar solo este paso"), así que ninguno se queda sin él.
- **Si la primera hoja mezcla meses**, la hoja del mes tiene que traer **exactamente las mismas líneas** de ese mes. Una de más o una de menos y no se toca nada: si no coinciden, las dos no dicen lo mismo y elegir movería las cifras en silencio.
- **Si la primera hoja es de otro mes** no hay líneas con qué comparar, así que el conteo no aplica — pero la hoja del mes existe y es la que corresponde leer. Es el caso de Super.
- **Si el libro no tiene ninguna hoja del mes de trabajo, no se elige nada.** Ahí el control de períodos tiene que gritar: es la trampa de BOUTI (mandó el estado de julio llamándolo enero, 159 rojas falsas) y taparla cambiando de hoja sería peor que el problema.
- **Solución única**, como en todo el resto: con dos hojas candidatas del mismo mes no se elige ninguna.
- **No es silencioso.** `HOJAS_ELEGIDAS` guarda qué se leyó y el panel de períodos lo muestra con el motivo. Cambiar qué archivo se lee sin decirlo deja a quien concilia mirando cifras de otra hoja.
- `SIN_SELECCION_HOJA` corta la recursión (`parseEstadoCuenta` llama a `hojaDelMes` y `hojaDelMes` parsea hojas candidatas) y es también lo que hace que la votación del mes se haga sobre los archivos **tal como vienen**. La elección se memoriza en el objeto de las filas (`_selMes`/`_selHoja`): sin eso, un libro de 11 hojas se reparsea entero en cada uno de los ~8 puntos de lectura de una corrida.

### Shopping no es Petty: el volumen cambia

El navegador de Caja General de Shopping trae **34,090 movimientos** (Petty traía unos cientos), porque esa cuenta registra **cada venta de contado** —14,485 líneas `CONTADO CONTADO - Cobro:PBUI…`— y no solo los depósitos del día. Consecuencias medidas en enero de 2026:

- **El Paso 2 tarda minutos**, no segundos. En el navegador parece colgado.
- **B/ 135,481.23 en 167 líneas `Deposito Contable: DP-… CASH`** que el reporte de cajeras no declara. Eso es el 73% de las rojas del Paso 1 (25 diferencias de Efectivo por B/ 127,034.75) y vuelve a salir en el Paso 2. No es un error de la app: es plata que entra a Caja General sin pasar por la caja registradora, el mismo patrón del Yappy de BOUTI pero mucho más grande.
- **El saldo de Caja General es negativo** (apertura −3,374.56, cierre −149.08). En Petty siempre fue positivo.
- Los 83 cheques pendientes por cambiar del Paso 2 suman **B/ 22,413.82**, que coincide exacto con el total que declara la hoja `DESGOLCE DE CK` del propio reporte: ningún cheque de enero se cambió, y el reporte y la app están de acuerdo.

### El ruteo por banco estaba copiado en tres lugares

La misma decisión —"¿de qué cuenta es esto?"— vivía en tres funciones distintas, y cada copia olvidada manda plata a la cuenta equivocada:

| Dónde | Qué mira |
|---|---|
| `clasificarBancoPorTexto` | la descripción de un asiento del diario |
| `identificarArchivo` | el nombre de cuenta de un navegador |
| `parseReporteConsolidado` | el encabezado de columna del informe de cajeras |

Al agregar STG Super y STG Bordados se arreglaron las dos primeras y **la tercera se pasó**. Shopping iba a agregarle columnas de esas cuentas al informe, y pasaba una de dos cosas, las dos malas:

- Columna `Visa / Sr.George Super` → contiene `GEORGE`, así que la venta se sumaba a la **cuenta principal** (medido: 300 en vez de 100).
- Columna `Visa / Super` → no nombra ningún banco, caía en `colsFuera` y quedaba **fuera del cotejo**, en silencio.

Ahora hay **una sola** función para los rótulos que escribe contabilidad, `cuentaExtraDeRotulo()`, usada por el navegador y por el informe. La seña sola alcanza ahí porque un rótulo no trae texto de terceros; la descripción de un asiento sí, y por eso `cuentaExtraDeTexto()` sigue exigiendo además el banco base. Son dos reglas distintas a propósito, pero una sola por caso.

Se mira el texto **completo** de la columna (grupo + sub-encabezado), así que funciona escriba quien exporta `Visa Super`, `Visa Sr.George Super` o `Visa STG Super`.

### Cuánto tarda una corrida grande

**220 segundos** la cadena de los 4 pasos con los 14 archivos de Shopping de enero de 2026 (34,090 movimientos de Caja General). En el navegador la página parece trabada casi 4 minutos. No es un error — es el volumen — pero conviene tenerlo medido antes de salir a buscar un cuelgue que no existe.

### Una columna del informe que nombra dos métodos no se adivina

El bucle de métodos (`metodosValidos = ["VISA","CLAVE","ACH","CHEQUE","YAPPY"]`) tomaba el **primero de su lista** que apareciera en el texto de la columna. Shopping mandó en enero de 2026 una columna `VISA CLAVE / SUPER` por **B/ 30,958.04** —que es la columna de CLAVE— y se leía como **VISA**:

- su venta se iba al método equivocado **sin avisar**,
- el Paso 1 le pedía al banco una VISA que no existe,
- y dejaba sin cotejar la CLAVE que sí.

Con dos métodos en el mismo rótulo no hay forma de saber cuál es, así que la columna queda **fuera del cotejo y se reporta**. Es el criterio de `corregirErrata`, que no corrige una palabra que está igual de cerca de `COMISION` y de `REMISION`: ante el empate, no se elige.

- Va como **diferencia roja**, no como informativo, y **aparte** de `sinMapear`: esa venta sí tiene que llegar al banco, lo que falta es poder decir por cuál método. Mezclarla con los vales y los certificados —que de verdad no entran al banco— la daría por explicada.
- El texto nombra los dos métodos que encontró y dice qué hacer: dejar un solo método en el encabezado.

### El informe de cajeras de una empresa con varias cuentas del mismo banco

Agregar las cuentas al informe no es agregar columnas: es **repartir** lo que ya estaba. Shopping lo intentó dos veces y las dos fallaron del mismo modo, y conviene reconocer el síntoma:

| Intento | Qué hizo | Qué pasó |
|---|---|---|
| 1º | sumó Super y Bordados **dentro** de `Visa/Clave Sr.George` | STG pasó de 46,710.00 a 86,671.91 contra 45,736.40 de Caja General |
| 2º | agregó columnas de Super **sin sacarlas** de `Sr.George` | la misma venta contada dos veces: STG 86,671.91 **más** STG Super 18,749.91 |

El contraste que lo delata está en el propio archivo: antes de tocarlo, el informe declaraba STG 46,710.00 contra 45,736.40 de Caja General —menos de mil de diferencia— y después de "corregirlo" quedó 40,935.51 arriba. **Si al separar las cuentas el total de la principal no baja, no se separó nada: se duplicó.**

Un detalle de forma que no estorba: el archivo puede traer bloques de otra tabla pegados al costado (`SHOPPING SUPER` por 349,176.28 y `SHOPPING BORDADOS` por 27,096.00, antes de la columna `Cajera`). La app los ignora porque no nombran ningún método, y eso es lo correcto — pero conviene confirmar con quien lo armó que son referencia y no venta.

### Una fecha en texto MM/DD salía con mes 13, 14, 15…

La fecha en **texto** del informe de cajeras pasaba derecho a `toISODate(raw,false)`, que asume DD/MM sin mirar nada. La 2ª pestaña del informe de Shopping de enero de 2026 (`DESGOLCE DE CK`) está escrita en MM/DD:

```
"01/13/2026"   →   "2026-13-01"     mes 13
```

Un mes 13 no es una fecha y **nadie se daba cuenta**: esas 19 filas quedaban en un día inexistente y, con sus pares del día correcto, sacaban **54 diferencias falsas** en el Paso 1 por B/ 45,692.26 en bruto — 27 pares de igual importe y signo opuesto, **neto cero**. El neto delata el patrón: la plata está toda, lo que está mal es la fecha.

```
2026-01-31   −1,878.97
2026-31-01   +1,878.97
```

El arreglo tiene dos mitades, las dos por **aritmética** y no por adivinanza:

- **Una fecha imposible no se emite.** Si una de las dos orientaciones da un mes que no existe, no hay nada que elegir: `"01/13/2026"` solo puede ser el 13 de enero. Cuando las dos son posibles se mira el mes dominante de la hoja, y si eso tampoco decide queda la lectura DD/MM, que es la de siempre — así que no hay regresión.
- **Una hoja escrita en MM/DD ahora enseña su orientación.** `mesesDominantesReporte` solo contaba el caso `DD/MM` inequívoco (primer campo >12). Si el **segundo** campo pasa de 12 tampoco puede ser un mes, así que el mes es el primero. Sin eso, `meses` quedaba **vacío** en esa hoja y sus 10 celdas que llegan como `Date` se leían al revés también (sin mes dominante se cae a la lectura tal cual).

Las dos hojas del mismo archivo pueden estar escritas distinto: `SHOPPING ENERO` daba `meses=[1]` y 0 fechas imposibles mientras `DESGOLCE DE CK` daba `meses=[]` y 19. **Cada hoja aprende su propia orientación** — son dos llamadas distintas a `mesesDominantesReporte`.

### Repartir las cuentas en el informe de cajeras, paso por paso

Shopping tardó cuatro intentos y los tres primeros fallaron del mismo modo. El síntoma es siempre el mismo y conviene reconocerlo: **si al separar las cuentas el total de la principal no baja, no se separó nada — se duplicó.**

| Intento | Qué hizo | STG en el informe |
|---|---|---|
| — | antes de tocar nada | 46,710.00 (contra 45,736.40 de Caja General) |
| 1º | sumó Super y Bordados **dentro** de `Visa/Clave Sr.George` | 86,671.91 |
| 2º | agregó columnas de Super **sin sacarlas** de `Sr.George` | 86,671.91 + Super 18,749.91 aparte |
| 3º | quitó Super | 52,442.98 |
| 4º | agregó Bordados y lo restó de `Sr.George` | **47,076.22** ✓ |

Y dos cosas que se aprendieron en el camino:

- **Una cuenta cuya venta no pasa por Caja General no va en este informe.** Super declara 349,176.28 de venta (280,000 de efectivo del camión) y Caja General no tiene **una sola línea** suya. Meter ese efectivo al cotejo general llevaba las 25 diferencias del Paso 1 de 127,000 a más de 400,000, todas falsas. Super **sí** se concilia en el Paso 3, contra su propio navegador y su propio estado, que no dependen de Caja General.
- **Separar por método puede no tener contra qué cuadrar.** De las 23 líneas de Bordados en Caja General, 20 dicen solo `"POR TARJETA"` sin método (4,972.96 de 5,366.77). Se temía que el reparto `Visa Bordados` / `Clave Bordados` dejara 20 diferencias; medido, dio **cero** — el cotejo cuadra el total del día. La corrección de verdad sería que el asiento diga el método, pero eso es el sistema, no el informe.

### El comprobante dice de qué cuenta es cuando el texto no lo dice

Caja General registra los depósitos de una cuenta así:

```
Deposito Contable: DP-00005410 Realizado Con: CASH
Deposito Web: DP-00005348 Realizado Con: CASH
```

No nombra el banco ni la cuenta, así que `clasificarBancoPorTexto` devolvía **null** y esas líneas caían al balón del efectivo, que se le atribuye al banco **votado** (`bancoDelEfectivo`). En enero de 2026 de Shopping eran **175 líneas por B/ 141,038.76** contra la cuenta equivocada: el 96% de las rojas del Paso 2 y el 70% de las del Paso 1.

La prueba de a quién pertenecen no se adivinó, se midió:

| | Líneas | B/ |
|---|---|---|
| Caja General, créditos con comprobante `DP-` | 175 | 141,038.76 |
| Navegador de **STG Super**, líneas `DP-` | 178 | 141,038.76 |
| **Coinciden comprobante Y importe** | **175 de 175** | 141,038.76 |

Y ningún otro navegador tenía **una sola** línea `DP-`: ni STG, ni Banistmo, ni Banco General, ni Bordados. El propio resumen del Paso 0 ya lo decía: sus 21 partidas de Super vienen rotuladas `"Deposito Contable - St. George Deposito / Super"` con comprobantes `DP-00004923` a `DP-00005338`, y los de enero siguen la serie.

Es el mismo criterio que ya decide en el Paso 3, donde la **referencia** (`ME-` de caja, `PAY` de pagos, `RCP` de recibos) manda sobre el texto.

- `fijarComprobantesDeBanco(raws)` arma el mapa `comprobante → cuenta` leyendo los **navegadores de banco**. Solo comprobantes `DP-`, y **un comprobante que aparezca en dos cuentas no se mapea** — ante el empate no se elige, como en todo el resto.
- **El texto siempre gana**: el comprobante es el último recurso y solo actúa cuando el texto no nombró ningún banco. Una línea que diga `BANISTMO` va a Banistmo aunque su `DP-` esté mapeado a otra cuenta.
- Vive en un global por corrida, como `CAL_BANCARIO` y `MES_TRABAJO`, y se fija en `computaPaso`. `clasificarBancoPorTexto` se llama desde **una veintena de lugares** y pasarle los navegadores a cada uno dejaría alguno afuera — el mismo motivo por el que `hojaDelMes` vive dentro de `parseEstadoCuenta`.
- El comprobante se lee **del texto de la descripción**, donde ya viene (`DP-00005410`), así que no hace falta cambiar ninguna firma.

**Lo que protege a las demás empresas**: sin navegadores con comprobantes `DP-` el mapa queda **vacío** y el ruteo es exactamente el de antes. Petty usa `ME-` y `PDN-`; BOUTI, `ME-`. Hay una prueba que congela ese caso.

### Dos preguntas distintas: ¿pasa por la caja, o por Caja General?

Costó una vuelta entera confundirlas, y el error fue mío al leer la respuesta de Diba. Para una cuenta como Super son dos cosas independientes:

| | Super |
|---|---|
| Su **venta** pasa por el informe de cajeras | **No** → sus columnas no van en ese archivo |
| Sus **depósitos** pasan por Caja General | **Sí** → como `DP-… CASH`, B/ 141,038.76 en enero |

Las dos respuestas conviven, y cada una decide algo distinto:

- Por la primera, las 8 columnas de Super salieron del informe (meter sus 280,000 de efectivo al cotejo general llevaba las 25 diferencias del Paso 1 de 127,000 a más de 400,000, todas falsas).
- Por la segunda, el **navegador y el estado de Super sí hacen falta**, y en los tres lados: el Paso 0 los necesita para que sus 21 partidas en tránsito (13,419.58) tengan contra qué compensar —con el estado subido el Paso 0 pasó de 12 a 20 partidas compensadas—, el Paso 2 para cotejar los `DP-`, y el Paso 3 para conciliar la cuenta contra su propio estado.

Al preguntar por una cuenta nueva conviene preguntar las dos cosas por separado.

### El efectivo por cuenta se probó y se midió PEOR: no se implementó

Queda acá para no volver a intentarlo sin leer esto. La idea era correr el bloque de efectivo del Paso 2 **cuenta por cuenta** en vez de contra el banco votado, para que los 175 depósitos `DP-` de Super se buscaran en el estado de Super. Se implementó entero (incluido separar `bancoSoloTexto` de `bancoDeComprobante`, el bucle por grupo, `marcarRedondeosDelEfectivo` por cuenta y la exclusión del efectivo ajeno en la comparación del Paso 1) y el resultado medido fue:

| | Paso 1 | Paso 2 | Suma |
|---|---|---|---|
| v2026.10.48, antes del ruteo por comprobante | 123,115 | 118,849 | 241,964 |
| **v2026.10.49, solo ruteo por comprobante** | **8,059** | 141,806 | **149,865** |
| v2026.10.50, efectivo por cuenta | 8,059 | **203,244** | 211,303 |

**La v49 es la mejor de las tres y la v50 se revirtió.**

El motivo es la **forma del dato**, no el código. El efectivo de Super no es "un día → un ACH" como en Petty:

```
Depósitos DP- en Caja General    175 líneas    B/ 141,038.76     importes con centavos
ACH de Brinks en el estado        22 líneas    B/ 128,946.00     importes REDONDOS (múltiplos de 5)
Líneas "Descripción" (redondeos)  30 líneas    B/      298.58
                                                ──────────────
                                     sin explicar  B/  11,794.18
```

Y el corte no es por día: el ACH del retiro del 7-ene trae 3,890.00 contra 4,155.86 depositados ese día; el del 9-ene trae 3,945.00 contra 1,690.50. Los seis ACH acreditados el 30-ene corresponden a retiros del 22 al 28.

Así que cuadrarlo exigiría **buscar un subconjunto de 175 depósitos que sume cada ACH** — con 175 candidatos eso encuentra *alguna* combinación para casi cualquier importe, que es exactamente el falso positivo contra el que todo el resto de este documento previene. No se hace.

**Lo que sí vale**: el ruteo por comprobante de la v49 (el Paso 1 pasó de 123,115 a 8,059), y que el Paso 3 concilie esa cuenta contra su propio estado, donde ya le va mejor con los mismos datos (51 rojas por 28,849.04 contra las 157 por 129,230.11 del Paso 2). Si algún día hay que cuadrarlo de verdad, el camino es que el asiento **declare el desglose** —qué depósitos entraron en qué retiro—, igual que la columna `Desglose` del resumen resolvió la partida partida entre dos meses.

### Las dos preguntas del efectivo (lo que se intentó y NO está en el código)

Esto es el detalle de lo que se revirtió, por si alguien lo vuelve a pensar. **`bancoSoloTexto()`, `bancoDeComprobante()` y `efDec.bancoPorFila` no existen en el código**: la v49 tiene el comprobante dentro de `clasificarBancoPorTexto` y nada más. Lo único que sobrevivió es `fijarComprobantesDeBanco()`.

La idea era separar dos preguntas que hoy están juntas:

| Pregunta | Para qué serviría |
|---|---|
| ¿El **asiento nombra** un banco? | decidir si la línea es *efectivo sin banco*, y entonces la trabaja la sección de efectivo, que sabe del ciclo del camión |
| ¿De qué **cuenta** es? | decidir contra qué estado de cuenta se cotea |

Juntas, las líneas `DP-` salen de la sección de efectivo y caen al **cotejo general**, que empareja 1:1 o por combinación del **mismo día** — y el banco acredita varios días consolidados en un ACH, así que no cuadran. Separarlas las devolvía a la maquinaria correcta, y además hacía falta:

- correr el bloque de efectivo del Paso 2 **cuenta por cuenta** (hoy corre una sola vez, contra el banco votado);
- soltar `marcarRedondeosDelEfectivo` del banco votado (`efH.banco !== banco`), para apartarle su redondeo a cada cuenta;
- y que el **Paso 1 no comparara** contra el informe de cajeras el efectivo de una cuenta cuya venta no pasa por ahí (inflaba el lado de Caja General: 25 días por B/ 120,631.15).

Todo eso se escribió, se midió y salió **peor** (ver la tabla de arriba), porque el problema no era el ruteo sino la forma del dato. Si se retoma, retomarlo entero y midiendo — y recordar que la propiedad a preservar es que **con una sola cuenta de efectivo el resultado no cambie en nada**, que es el caso de Petty y de BOUTI.

### El informe de VISA viene por afiliado, y el estado dice de cuál es cada remisión

VISA liquida por **comercio afiliado**, y una empresa con varias cuentas de St. Georges tiene un afiliado por cuenta. El informe **consolidado** suma los tres, así que su neto diario no coincide con ninguna remisión individual. Enero de 2026 de Shopping: de los 30 netos del informe `016000317`, **ninguno** aparecía en ningún estado — 37 rojas por B/ 49,827.76 en el Paso 3 — y sin embargo la suma de las tres cuentas daba el total **al centavo**:

| Cuenta | Afiliado | Neto del informe | Remisiones del estado |
|---|---|---|---|
| STG principal | `016005613` | 25,364.66 | 25,364.66 |
| STG Super | `016026729` | 18,333.84 | 18,333.84 |
| STG Bordados | `016030653` | 2,618.24 | 2,618.24 |
| *(consolidado)* | `016000317` | 46,316.74 | = la suma de los tres |

Lo que lo resuelve es que **la remisión del estado nombra el afiliado**, y no solo en Shopping — en Petty también:

```
Remisión V/Mc 016005613 Liq. No. 3768763      STG principal de Shopping
Remisión V/Mc 016026729 Liq. No. 3769613      STG Super
Remisión V/Mc 016030653 Liq. No. 3769578      STG Bordados
Remisión V/Mc 016005605 Liq. No. 3992027      STG de Petty
```

Así que el mapa `afiliado → cuenta` **lo declaran los datos**, no una configuración: se lee de los dos lados y tienen que coincidir.

- `afiliadoDeRemision(desc)` lo saca de la línea del estado; `afiliadoDeHojaVisa(rows, nombre)` de la hoja del informe — por su columna `ID Sucursal`, por su encabezado `Comercio: … (016000317)` o, en último caso, por el nombre de la hoja. Las dos formas hacen falta: el consolidado **no trae** columna `ID Sucursal` y las hojas por cuenta sí.
- `retVisaPorCuenta(rowsVisa, estados)` arma `{cuenta: {fecha: retención}}`. Los guards: la cuenta tiene que nombrar **un solo** afiliado en sus remisiones, el afiliado tiene que mapear a **una sola** cuenta, y **una hoja que ninguna cuenta reclama queda afuera y se reporta** — ese es el consolidado, que sumado a las otras contaría todo dos veces.
- En el Paso 2 la retención ya no está atada a `banco==="STG"`: `retDeBanco(bk)` da la de **la cuenta que se está cotejando**. En el Paso 3 cada `cfg` recibe la suya, incluidas las cuentas adicionales — que antes no recibían ninguna a propósito, porque el informe era uno solo y era de la principal.
- **Compatibilidad**: con una sola hoja reclamada por una sola cuenta, el resultado es el mismo dato en la misma cuenta que antes; y si no se puede mapear nada, se usa el camino viejo (la primera hoja para la principal de St. Georges).

**Pedir el informe separado por afiliado es mejor que pedir el consolidado**, porque el consolidado no se puede repartir: su neto diario es la suma y no hay forma de saber qué parte es de cada cuenta sin inventar el corte.
