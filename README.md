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

Repo completo: **~25MB**. Cada arcada pesa entre 2,6MB y 3,0MB (~1MB en la versión ligera para móviles), más la malla-proxy de selección.

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


## Realismo del modelo 3D (materiales anatómicos y raíces)

Los cuatro `.glb` ya no usan la textura pintada original: se procesaron con `herramientas/procesar_arcadas.mjs`, que a partir de esa textura separa cada vértice en **diente** o **encía** y deja la malla con dos primitivas y dos materiales (`esmalte` y `encia`), más un color por vértice horneado:

- **Esmalte** `#F5F0E6` con un toque de **dentina** `#E6CFA6` en el tercio cervical (donde el esmalte es más delgado y la dentina se transparenta).
- **Surcos y fisuras** oscurecidos y **cúspides / rebordes marginales** aclarados, calculados con la curvatura de la malla a dos escalas (fina para fisuras, amplia para fosas y troneras).
- La superficie dentaria que queda **por debajo del margen gingival** se pinta como raíz `#E8D4B9`.
- **Encía** `#F8C8C8`, con encía marginal y papilas más saturadas y sombra en los surcos.

En el visor, `esmalte` es un `MeshPhysicalMaterial` con clearcoat suave y `sheen` (halo translúcido en los bordes) y `encia` otro con clearcoat para el aspecto húmedo; ambos se iluminan con un entorno PMREM (`RoomEnvironment`) además de las luces de la escena. Las intensidades de las luces se bajaron: con los materiales nuevos, las anteriores quemaban a blanco las caras oclusales y escondían los surcos.

**Raíces:** el modelo original solo tiene coronas. El script mide cada pieza (eje largo, nivel cervical, ancho mesiodistal) y escribe `raices_*.json`; el visor genera la raíz por torno (`LatheGeometry`) según la morfología de cada tipo de pieza — unirradicular en incisivos, canino más largo, dos raíces en molares inferiores, tres en superiores, primer premolar superior bifurcado, y raíces más cortas y divergentes en temporales. **No son las raíces reales del paciente: son una representación anatómica estándar.** La capa **Raíces** (última de la barra verde) las muestra u oculta; cuando está activa la encía se vuelve translúcida para poder verlas. Una pieza marcada como ausente o con implante oculta su raíz.

Quitar las texturas de color bajó el repo de ~76MB a ~48MB, así que además carga más rápido.

Para regenerar los `.glb` desde los originales:

```bash
node herramientas/procesar_arcadas.mjs arcada_inferior.glb dientes_posiciones.json salida.glb raices_inferior.json
```

Necesita `@gltf-transform/cli`, `draco3dgltf` y `sharp`. Los originales con textura ya no están en el repo: se conservan en el historial de git (commit `e0a77a0`).


## Anatomía interna, referencias clínicas y vistas (estándar tipo Primal)

El botón **🦴 Anatomía** de la barra superior abre una barra con tres bloques:

**Estructuras** (se encienden y apagan por separado). Cuando hay una capa más profunda encendida, las de afuera se vuelven translúcidas solas:

| Capa | Color | Qué es |
|---|---|---|
| Encía | `#E8A8B0` / `#F0C8D0` marginal | La encía del modelo escaneado |
| Esmalte | `#F5F0E6`, bordes `#F0E8D8` | Superficie real del escaneo |
| Dentina | `#F2E2C4` | Núcleo coronario y radicular, generado |
| Pulpa y conductos | `#D8B5A0` | Cámara pulpar con cuernos y conducto por raíz |
| Ligamento | `#E7C6BC` | Vaina fina entre raíz y hueso |
| Hueso alveolar | `#E0D5C0` | Reborde con festón interdental |

**Vistas**: frontal, lateral derecha e izquierda, oclusal y 3/4, con vuelo suave de cámara. **Corte sagital** activa un plano de corte que pasa por la pieza seleccionada, para ver cámara y conducto por dentro.

**Referencias**: número **FDI** sobre cada pieza (el contorno lleva el color del estado), **anillo de estado**, **puntos de contacto**, **línea de oclusión** y **enfoque al tocar** (al elegir una pieza la cámara la centra y se abre su ficha con nombre, tipo, estado, número de raíces y de conductos). Al pasar el cursor aparece la etiqueta de la estructura: cúspide, surco central, cuello cervical, raíz mesial, ligamento, hueso…

**Código de estado** (se calcula de lo ya marcado en la ficha): 🟢 sano · 🔴 patológico (requerido) · 🟡 en observación · 🔵 tratado (realizado o previo) · ⚪ ausente · 🟣 prótesis o implante.

### Qué es real y qué es una representación

- **Real (del escaneo):** la forma de coronas y encía, sus surcos, cúspides y el contorno festoneado del margen gingival.
- **Generado por el visor:** raíces, dentina, cámara pulpar, conductos, ligamento y hueso alveolar. Siguen la morfología estándar de cada tipo de pieza y las medidas de esa pieza en el modelo (eje, nivel cervical, ancho y grosor), **pero no son la anatomía interna real del paciente**. Sirven para explicar y para docencia, no para diagnóstico.
- **No incluido:** remodelar cada corona con sus lóbulos de desarrollo o rehacer los surcos pieza por pieza exigiría reemplazar el modelo base por una librería dental esculpida (licencia aparte). Lo que sí se hizo fue resaltar la anatomía que el escaneo ya tiene, con sombreado por curvatura.

El dorado `#D4AF37` de Fassiara se usa solo en la interfaz (bordes de la barra, línea de oclusión), nunca sobre dientes ni tejidos. El fondo es un degradado neutro y la luz principal entra a 45° desde arriba.


## Rendimiento

El visor movía 3,09 millones de triángulos por cuadro y cada movimiento del cursor lanzaba un rayo contra esa misma malla (0,5–0,8 s por consulta): de ahí venía la lentitud. Lo que se hizo:

| Medida | Antes | Ahora |
|---|---|---|
| Triángulos dibujados | 3.089.236 | 1.367.890 |
| Carga hasta "Listo" | 16,6 s | ~5 s |
| Consulta del cursor / clic | 500–800 ms | 3–5 ms |
| Cuadros dibujados en reposo | ~60/s | 0 |
| Peso por arcada | 7,7–11,5 MB | 2,6–3,0 MB (+0,1–0,2 MB de malla-proxy) |

- **Geometría.** Cada primitiva se simplifica por separado con meshoptimizer: los dientes conservan el 62% de sus triángulos (curvatura y surcos intactos) y la encía el 22%, suficiente para que el festoneado del margen siga siendo continuo. Se descartan las caras traseras (`FrontSide`) salvo en la arcada superior, cuya malla viene espejada.
- **Texturas.** Ya no hay ninguna: el color va por vértice y el relieve lo da la malla. Se eliminaron el mapa de color y el de normales de 2048 px que seguían viajando en el archivo.
- **Compresión.** Draco con cuantización a 12 bits en las arcadas y 14/16 bits en la malla-proxy.
- **Malla-proxy** (`proxy_*.glb`, ~30.000 triángulos, invisible): lleva el número de pieza y la zona anatómica por vértice. El cursor y la selección consultan esta malla, no el escaneo. Es lo que devolvió la fluidez al pasar el ratón.
- **Dibujo bajo demanda.** Solo se redibuja cuando algo cambia (cámara, capas, marcas). En reposo el visor no consume nada.
- **Carga diferida.** Dentina, cámara pulpar, conductos, ligamento y hueso se generan la primera vez que se enciende su capa (unos 50 ms), no al abrir la arcada.
- **Equipos modestos.** Si el navegador es táctil con pantalla chica, o declara ≤4 GB de memoria o ≤4 núcleos, se carga `arcada_*_lite.glb` (18% de los triángulos de los dientes, 7% de la encía), se baja el pixel ratio a 1,25 y se prescinde de la tercera luz. En total, 2 o 3 luces según el equipo; no hay sombras dinámicas (el volumen viene del sombreado por curvatura horneado en los vértices).

### Acabado visual

El brillo del esmalte viene del material, no de subir la luz: `MeshPhysicalMaterial` con barniz (`clearcoat` 0.72, rugosidad 0.09) y `sheen` azulado, que da el halo translúcido de bordes y cúspides. La encía usa el mismo recurso con más barniz y menos reflejo (aspecto húmedo, no plástico). Se probó mapeo tonal ACES y se descartó: apagaba los colores exactos de la paleta.

Las raíces ya no son conos de revolución: se barren anillos a lo largo de un eje curvo, con el cuello algo más ancho, adelgazamiento progresivo y ápice redondeado. Las transiciones esmalte → dentina cervical → raíz se hornean con rampas más largas, para que no queden líneas de corte.

Si aun así el equipo no alcanza unos 38 cuadros por segundo, el visor baja solo al nivel ligero durante esa sesión (se mide la mediana de los cuadros, pasados los primeros 3 segundos de carga).

Colores, dorado de interfaz, numeración FDI, código de estado, vistas, corte y etiquetas se mantienen igual.


## Ficha del paciente: guardado automático, archivo y deshacer

- **Se guarda sola.** Cada cambio (marcas, alertas médicas, datos del formulario) se guarda en el propio navegador, con un retardo de 0,7 s para no escribir en cada clic. Al abrir la aplicación, si quedó trabajo sin terminar aparece un aviso con el nombre del paciente y la hora, y se puede **Recuperar** o **Empezar de cero**.
- **Guardar y abrir archivo.** Botón **💾 Ficha** de la barra superior: exporta un `.json` con todo lo marcado y los datos del formulario (`Odontograma_<paciente>_<fecha>.json`), y permite volver a abrirlo en otro equipo o en la próxima cita para comparar. El mismo panel borra la copia local.
- **Deshacer y rehacer.** Botones ↶ ↷ en la barra superior y atajos Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z también). Guarda los últimos 60 pasos. Antes, el único arreglo era "Borrar Pieza", que borraba todo lo de ese diente.

Cómo está hecho: `estadoFicha()` junta en un objeto las variables donde vive lo marcado (`clinicalRecords`, `perioRecords`, `bridges`, `removableRecords`, `occlusionRecords`, `atmRecords`, `esteticaRecords`, `pediatricRecords`, `orthoRecords`, `medicalAlerts`, `registrosGenerales`) más los campos del formulario; `aplicarFicha()` los vuelve a volcar **sin reasignar** las constantes y repinta capas, presupuesto y banner de alertas. El historial guarda fotos en JSON de ese mismo objeto.

⚠️ **Privacidad:** la copia automática incluye el nombre, el DNI y el teléfono del paciente, y queda en el navegador de ese equipo (no se envía a ningún servidor). En un equipo compartido conviene usar **Borrar copia de este equipo** al terminar la jornada.


## Trabajo clínico: plan por fases, documentos y registro

- **Plan en fases.** El presupuesto se agrupa solo en Fase 1 (urgencias y saneamiento), Fase 2 (rehabilitación) y Fase 3 (estética, ortodoncia y mantenimiento), con subtotal por fase. Aparece así tanto en pantalla como en los PDF.
- **Presupuesto como documento aparte** (botón dentro del presupuesto): hoja propia con las fases, el total, la validez de 30 días y las líneas de firma. Es lo que se le entrega al paciente.
- **Periodontograma en la Historia Clínica.** Página con los 6 sitios por pieza (profundidad / recesión, punto de sangrado), movilidad, furca y el resumen: sitios registrados, porcentaje de sangrado y bolsas de 4 mm o más.
- **Consentimientos por procedimiento.** Según lo marcado se añaden los textos que corresponden —exodoncia, endodoncia, implante, prótesis, ortodoncia o estética— con sus riesgos, y las dos líneas de firma.
- **Registro fotográfico.** Cada pieza admite una foto (en tablet abre la cámara). Se guarda reducida a 900 px en JPEG, se ve en la ficha de la pieza y sale en el informe con su fecha.
- **Fecha y hora por pieza.** Cada vez que cambia lo marcado de una pieza se guarda la hora; se muestra en su ficha.
- **Avisos de coherencia.** Sin bloquear nada, advierten de combinaciones que suelen ser un error: pieza ausente con tratamientos, implante con endodoncia, exodoncia junto a restauración, pilar de puente ausente.

## Herramientas del consultorio

- **Tarifa editable.** Panel de precios por especialidad; se guarda en el equipo y manda sobre los precios de referencia. Permite exportar e importar la tarifa y volver a los valores de referencia.
- **Modo paciente.** Oculta toda la interfaz clínica y deja solo el modelo, para explicar el tratamiento en el sillón. Se sale con Esc o con el botón.
- **Comparar con una visita anterior.** Se abre la ficha guardada de otra cita y se listan los cambios (nuevo, tratado, resuelto, cambió), además de marcar esas piezas con un anillo de color sobre el modelo.
- **Etiquetas en tablet.** Las etiquetas anatómicas, que antes solo salían al pasar el cursor, ahora aparecen al mantener el dedo sobre el modelo.
- **Funciona sin internet.** `manifest.webmanifest` y `sw.js` hacen que la aplicación se pueda instalar en la tablet y que abra y cargue los modelos aunque se caiga la conexión (probado desconectando la red tras la primera visita).
- **Carga progresiva.** Primero se muestra la malla ligera y, cuando llega, se cambia por la detallada; la malla-proxy se reutiliza, así que se puede tocar una pieza desde el primer segundo.

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
