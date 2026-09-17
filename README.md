# Odontograma 3D Clínico — Fassiara

Visor 3D de odontograma (Three.js) con presupuesto, consentimiento informado con firma, y sincronización con GoHighLevel. Personalizado para **Fassiara — Clínica Odontológica y Estética**, Huánuco, Perú.

## Localización a Perú — qué se cambió y qué falta revisar

Este proyecto venía configurado para Chile (moneda, formato de DNI, colores de otra clínica). Se corrigió:

- **Moneda:** de CLP (`$...CLP`) a Soles (`S/ ...`), en el botón de presupuesto, el modal, el PDF clínico y el payload de GoHighLevel (`moneda: 'PEN'`).
- **Formato regional:** `es-CL` → `es-PE` en todos los `toLocaleString()`/`toLocaleDateString()` (afecta separador de miles y formato de fecha).
- **Identificación del paciente:** `RUT` → `DNI` en los formularios y PDFs.
- **Teléfono:** placeholder de ejemplo actualizado a formato peruano (`+51 987 654 321`).
- **Nombre del odontólogo:** ya no viene precargado con el nombre del desarrollador original del template; ahora es un campo vacío con placeholder, con un texto de respaldo genérico ("Odontólogo Tratante") si se deja en blanco.
- **Terminología clínica:** "Ficha" (término chileno) → "Historia Clínica" (término peruano estándar), tanto en el botón de descarga como en el nombre del archivo PDF generado.
- **N.° de colegiatura (COP):** se agregó un campo opcional junto al nombre del odontólogo, en el formulario de consentimiento y en el de orden de laboratorio, para el número de colegiatura del Colegio Odontológico del Perú — esto no existía en la versión chilena porque allá el colegio profesional no es obligatorio de la misma forma. Si se llena, aparece junto al nombre del odontólogo en el PDF ("— COP 12345").
- **Marca:** paleta de colores cambiada de azul a los tonos rosa/coral del logo de Fassiara, con acento dorado; "FASSIARA" y "Huánuco, Perú" agregados a los encabezados de ambos PDFs y a la barra superior.

⚠️ **Pendiente — requiere acción del equipo de Fassiara antes de usar con pacientes reales:**

1. **Lista de precios (`ARANCELES`, cerca de la línea 865 de `index.html`):** los montos en soles son un punto de partida estimado a partir de precios de mercado de clínicas privadas en Perú (2026) — **no son los precios reales de Fassiara**. Hay que reemplazarlos por la tarifa propia de la clínica.
2. **Webhook de GoHighLevel:** `ODONTOGRAMA_WEBHOOK_URL` y `ODONTOGRAMA_WEBHOOK_SECRET` siguen siendo placeholders — hace falta un backend propio (o el de quien administre el GHL de Fassiara) para recibirlos. Sin esto configurado, el botón "Sincronizar con GHL" no funcionará; el botón de PDF sí funciona de forma independiente.

## Estado: completo y listo para subir a GitHub

```
mi-odontograma-3d/
├── index.html                             ✅ real, con la integración GHL ya conectada
├── arcada_inferior.glb                    ✅ comprimido con Draco (118MB → 17MB)
├── arcada_superior.glb                    ✅ comprimido con Draco (93MB → 12MB)
├── arcada_temporal_inferior.glb           ✅ comprimido con Draco (130MB → 27MB)
├── arcada_temporal_superior.glb           ✅ comprimido con Draco (104MB → 22MB)
├── dientes_posiciones.json                ✅
├── dientes_superiores_posiciones.json     ✅
├── dientes_temporales_inferiores.json     ✅
├── dientes_temporales_superiores.json     ✅
├── .nojekyll                              ✅ evita que GitHub Pages procese esto como Jekyll
├── .gitignore                             ✅
└── .github/workflows/deploy-pages.yml     ✅ deploy automático a Pages en cada push a main
```

Repo completo: **76MB**. Ningún archivo individual supera los 27MB — cómodo bajo el límite de 100MB de GitHub.

## Por qué los .glb están comprimidos

Los 4 modelos originales pesaban 93–130MB cada uno (445MB en total) — 3 de los 4 superaban el límite duro de 100MB por archivo de GitHub, así que un `git push` normal los habría rechazado. Git LFS no es alternativa acá: GitHub confirma en su propia documentación que **Git LFS no funciona con GitHub Pages** (sirve el archivo puntero, no el contenido real).

La solución fue re-exportar los 4 `.glb` con compresión Draco (`gltf-transform draco`), que reduce el tamaño ~5-7x sin tocar el detalle geométrico — mismo número de vértices y triángulos, solo una codificación más eficiente. Confirmé con `gltf-transform inspect` que el conteo de vértices es idéntico antes y después.

Esto agrega una dependencia: `index.html` ahora carga `DRACOLoader.js` (mismo CDN que el resto de Three.js) y lo conecta al `GLTFLoader` para poder decodificar los archivos. El decoder en sí se sirve desde `gstatic.com` (la fuente que recomienda el propio equipo de Draco) — no hace falta alojar nada extra.

**Si en algún momento reemplazas estos `.glb` por versiones nuevas sin comprimir**, hay que volver a pasarlas por `gltf-transform draco archivo.glb archivo.glb` antes de subirlas — si no, se puede volver a topar con el límite de GitHub.

## La integración con GHL ya está conectada

`syncToGHLWithConsent()` ahora hace un `fetch()` real al webhook (antes solo mostraba una alerta y no mandaba nada a ningún lado). Antes de publicar, reemplazar estas dos constantes cerca del inicio del `<script>`:

```js
const ODONTOGRAMA_WEBHOOK_URL = ''; // vacío = sincronización desactivada
const ODONTOGRAMA_WEBHOOK_SECRET = '';
```

Ver `../odontograma-ghl-integration/GHL_SETUP.md` para el resto de la configuración (custom fields, pipeline, variables de entorno del backend). El backend vive aparte, en el EC2 existente — no en este repo.

⚠️ **Nota de seguridad real:** `ODONTOGRAMA_WEBHOOK_SECRET` corre en el navegador del paciente — cualquiera puede verlo con "Ver código fuente". No es autenticación, solo filtra tráfico accidental. No pongas ahí nada más sensible.

Además, al sincronizar con GHL, el visor genera el mismo PDF clínico que el botón "Descargar PDF" (con la firma incrustada) y lo manda al backend para que quede adjunto al contacto en GHL — antes esa parte no existía.

## Deploy

### Opción A — GitHub Pages (recomendado, workflow ya incluido)
1. Sube este repo a GitHub.
2. `Settings → Pages → Source: GitHub Actions`. El workflow en `.github/workflows/deploy-pages.yml` publica automáticamente en cada push a `main`.
3. URL resultante: `https://<usuario>.github.io/mi-odontograma-3d/`

### Opción B — Vercel
1. Importa el repo en Vercel.
2. Framework preset: **Other** (sitio estático, sin build step). Output directory: `/`.

Cualquiera de las dos sirve — el sitio es 100% estático, sin build step, así que no hay diferencia funcional entre ambas.

## Rendimiento — algo a tener en cuenta, no bloqueante

Incluso comprimidos, los modelos siguen siendo grandes para un asset web (12–27MB cada uno) porque el mallado original tiene ~3 millones de triángulos por arcada — mucho más detalle del que se percibe en pantalla. Si en algún momento el tiempo de carga en celular es un problema, la siguiente palanca (no aplicada acá porque cambia la geometría, a diferencia de Draco) es simplificar el mallado con `gltf-transform simplify` — vale la pena probarlo primero y revisarlo visualmente antes de reemplazar los archivos reales, dado que esto es una herramienta clínica.
