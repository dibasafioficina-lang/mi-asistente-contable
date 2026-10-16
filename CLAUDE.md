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

### Dónde nace un descuadre de apertura

Siempre en el cierre del mes anterior o antes, nunca en el mes que se está corriendo. Si el mismo importe aparece todos los meses es **un solo asiento sin registrar que se arrastra**, no un hallazgo nuevo de cada mes: el descargo del tránsito de enero de 2026 (2,679.15) reapareció idéntico en marzo, abril y mayo.
