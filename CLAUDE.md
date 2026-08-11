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
