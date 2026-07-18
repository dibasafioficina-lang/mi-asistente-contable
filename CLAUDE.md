# Mi Asistente Contable

Herramienta interna del equipo contable para cuadrar un sistema contable poco amigable, mediante módulos independientes de revisión/conciliación. Reemplaza y amplía a `conciliador-caja` y `conciliador-banco` (esos quedan solo como referencia de lógica de matching, no como base de código).

## Arquitectura

- **Formato**: un solo archivo HTML (`index.html`), sin build, sin dependencias instaladas — SPA con estado en memoria (`STATE`), sin persistencia entre sesiones (no usa `localStorage`).
- **Lectura de Excel**: SheetJS (`xlsx.full.min.js` vía CDN). Siempre upload de archivo completo, nunca copiar/pegar.
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
