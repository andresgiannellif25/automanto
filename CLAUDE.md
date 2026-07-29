# AutoManto — Contexto de proyecto para Claude Code

> Este archivo se carga automáticamente en cada sesión de Claude Code abierta en el repo.
> Describe **lo que el código hace hoy**. Si algo aquí no coincide con `index.html`, el error está en este documento y hay que corregirlo.

---

## 1. Qué es

**AutoManto** es una PWA de control de mantenimiento vehicular. Registra servicios realizados (aceite, frenos, filtros…), los compara contra intervalos configurables en km y días, y calcula qué está vencido, próximo a vencer o al día.

- **En producción:** https://andresgiannellif25.github.io/automanto
- **Repo:** `andresgiannellif25/automanto`
- **Idioma de la UI:** español
- **Autor:** Andrés — estudiante de economía, no desarrollador de profesión. Explica el *porqué* de los cambios, no solo el *qué*.

---

## 2. Stack actual (deliberadamente minimalista)

| Capa | Elección | Motivo |
|---|---|---|
| App | Un solo `index.html` | Se puede enviar por correo y abrir con doble clic |
| UI | React 18 UMD vía cdnjs | Sin `npm install`, sin bundler |
| JSX | Babel Standalone en el navegador | Sin build step |
| Estilos | Objetos JS inline | Sin CSS externo ni Tailwind |
| Datos | `localStorage` + `IndexedDB` | Doble escritura, lectura preferente de localStorage |
| PWA | `manifest.webmanifest` + `sw.js`, archivos aparte | **Obligatorio:** ver abajo |
| Hosting | GitHub Pages | Gratis, deploy = commit |

### Por qué la PWA no puede ir dentro de index.html

Un service worker **sólo puede registrarse desde un archivo con esquema HTTP(S)**. `navigator.serviceWorker.register()` rechaza `blob:` y `data:` con `TypeError: The URL protocol of the script is not supported`. No es una limitación de un navegador concreto: lo exige el spec. Cualquier diseño de "SW inline" es inviable, y una versión anterior de este documento lo describía como si funcionara.

**Restricción vigente:** `index.html` sigue siendo autocontenido y funciona abriéndolo desde `file://`. El registro del SW está guardado por esquema, así que con doble clic la app funciona igual, simplemente sin capacidad offline ni instalación (en `file://` no existen los service workers de todas formas). Los otros dos archivos sólo importan cuando la app se sirve por HTTP(S).

No introducir build step, npm ni imports de módulos sin discutirlo antes (ver §9).

---

## 3. Estructura del repo

```
automanto/
├── index.html             ← toda la app (~810 líneas)
├── sw.js                  ← service worker
├── manifest.webmanifest   ← manifest PWA
├── icon.png               ← ícono 1254×1254, usado como any y maskable
├── .gitignore             ← ignora .claude/ (config local de Claude Code)
├── README.md
└── CLAUDE.md              ← este archivo
```

---

## 4. Arquitectura interna de index.html

En orden de aparición:

**a) Capa de almacenamiento**
`idbOpen / idbGet / idbSet`, `lsGet / lsSet`, `pJSON`, `storageLoad`, `storageSave`.
Escribe en ambos backends; lee primero de localStorage y cae a IndexedDB.
Clave: `automanto_v3`.

`storageSave` estampa `schemaVersion` y `updatedAt` en cada guardado y devuelve la marca. Es el único dueño de esos campos. `SCHEMA` es la constante de versión del documento.

**b) Constantes**
- `DEFAULT_INT` — 24 intervalos predefinidos `{id, cat, name, km, days, note, custom}`
- `SAMPLE_R` — 3 registros de ejemplo, **sólo vista previa** (ver §6)
- `CATS` — 12 categorías
- `CC` — color hex por categoría
- `DK`, `isIOS()`, `isStandalone()` — detección para el banner de instalación

**c) `IRow`**
Fila de intervalo en Config. Usa inputs **no controlados** (`defaultValue` + `ref`, commit en `onBlur`) a propósito: los controlados perdían el cursor en cada tecla dentro de iframes. **No convertir a controlados.**

**d) `App`**
Todo el estado y la UI. Estado principal:

```
vehicle   → datos del carro (incluye km actuales del odómetro)
records   → historial de servicios realizados (sólo datos propios)
itvs      → intervalos de mantenimiento
seeded    → si el usuario ya tiene datos propios
vDraft    → buffer de edición del vehículo (commit en blur)
```

Refs espejo (`vRef`, `rRef`, `iRef`) para que `save()` lea el estado más reciente sin depender del closure. `uRef` guarda el `updatedAt` del último guardado conocido, para que el export lleve la fecha real de modificación del dato y no la de exportación.

**e) Registro del service worker**
Script plano al final del `<body>`, guardado por esquema para no romper `file://`.

---

## 5. El núcleo: cálculo de `tracking`

Es el corazón de la app. Para cada intervalo:

1. Filtra los registros visibles donde `record.service === itv.name`
2. Ordena **por fecha descendente**, con km como desempate, y toma el primero → `lKm`, `lDt`
3. `nKm = lKm + itv.km`, `nDt = lDt + itv.days`
4. Holguras: `kmL = nKm - kmActuales`, `dL = díasHasta(nDt)`
5. Estado:
   - `overdue` → `kmL ≤ 0` o `dL ≤ 0`
   - `soon` → `kmL ≤ 15%` del intervalo, o `dL ≤ 30`
   - `ok` → hay registro previo y no aplica lo anterior
   - `pending` → nunca se ha registrado ese servicio

**Vínculo registro↔intervalo: `record.itvId`, y sólo eso.** No queda ninguna comparación por nombre. `record.service` se conserva como etiqueta histórica —lo que se escribió aquel día— y no participa en el cálculo.

Consecuencia buscada: renombrar un intervalo **no toca los registros**. El vínculo sobrevive porque es el id, así que ya no existe la cascada que reescribía `service`. En Seguimiento se ve el nombre actual del intervalo; en Registros, el texto original de cada servicio. Que difieran es correcto, no un fallo.

Para que el vínculo no quede invisible cuando difieren, la tarjeta de Registros muestra una línea `Intervalo: <nombre actual>` **sólo si el nombre del intervalo no coincide con el `service` del registro**. Si coinciden —el caso normal— no se muestra nada: repetir el mismo texto sería ruido.

**Registros sueltos** (`suelto()`): un registro está suelto si `itvId` es null —"Otro", elegido a propósito— o si apunta a un intervalo que ya no existe, típicamente uno personalizado que se borró. El segundo caso era invisible: el id no era null, así que no saltaba ningún aviso, y no casaba con nada, así que tampoco contaba en ninguna parte. Los dos casos muestran ahora el aviso "Sin seguimiento" con la acción "Vincular a…" en la pestaña Registros.

**Migración** — `migrate()` se aplica en los tres puntos de entrada: `storageLoad()`, `importData()` (antes del `confirm`, para poder contar los huérfanos reales) y los datos semilla, que ya nacen en v2.

No mira `schemaVersion` a propósito: es una etiqueta y puede mentir. `toV2()` decide elemento por elemento y es idempotente, así que se aplica siempre. Un documento marcado como v2 pero sin `itvId` se migra igual.

La migración **no se reescribe a disco al cargar**. Se aplica en memoria y se persiste con el siguiente guardado normal. Evita una escritura silenciosa en cada arranque, y como es idempotente no cuesta nada repetirla.

Ids: los 24 predefinidos usan slugs (`oil-engine`…), mapeados desde el id numérico de v1 vía `LEGACY_ID` — **por id, nunca por nombre**, porque el nombre pudo renombrarse. Los personalizados usan `crypto.randomUUID()`, con fallback para `file://`, donde no hay contexto seguro.

---

## 6. Datos de ejemplo

`SAMPLE_R` **no** es el estado inicial de `records`. `records` nace vacío y los ejemplos se muestran sólo mientras `seeded` es falso:

- `seeded` se activa al cargar un documento guardado o al guardar por primera vez. No se persiste: la existencia del documento ya es la señal.
- `dispR` es lo que se muestra; `records` es lo único que se escribe.
- En modo ejemplo las acciones de editar y borrar están ocultas, porque apuntarían a ids ausentes de `records`.
- Exportar avisa en vez de descargar un backup vacío.

---

## 7. La capa PWA

**Manifest** — `standalone`, `start_url` y `scope` relativos (`./`, necesario porque Pages sirve bajo `/automanto/`), tema negro, `icon.png` declarado con su tamaño real como `any` y como `maskable`.

**Service worker** — precachea en `install`: el documento, `index.html`, `icon.png`, el manifest y los tres scripts de cdnjs. Los recursos se piden uno a uno para que un fallo puntual del CDN no aborte la instalación entera.

**Estrategia de caché, y por qué:**

| Recurso | Estrategia | Razón |
|---|---|---|
| Documento (navegaciones) | stale-while-revalidate | ver abajo |
| cdnjs (React, ReactDOM, Babel) | cache-first sin revalidar | la URL lleva la versión: son inmutables |
| Recursos propios (icono, manifest) | stale-while-revalidate | cambian rara vez pero pueden cambiar |

El despliegue de este proyecto es "editar `index.html` y commitear". Ese flujo **no toca `sw.js`**, así que el navegador nunca ve un worker distinto y nunca lo reinstala. Un cache-first clásico dejaría al usuario clavado en la misma versión del HTML para siempre, con la caché manual como única salida.

Con stale-while-revalidate se sirve la copia cacheada al instante (rápido y offline) y en paralelo se pide la de red y se guarda. El despliegue nuevo entra en caché **en la misma visita** y se aplica en la siguiente carga. Cuando la copia de red difiere de la cacheada, el SW deja una marca y avisa a la página, que ofrece recargar: así el usuario puede tener la versión nueva ya en la primera visita. **Nadie tiene que acordarse de subir un número de versión.**

`CACHE = "automanto-v1"` sólo hay que tocarlo si cambia la *forma* de lo cacheado; `activate` borra cualquier caché con otro nombre.

**Dos trampas que costaron depurar** (no reintroducirlas):

1. `fetch(peticiónDeNavegación, init)` lanza `TypeError`: el constructor de `Request` rechaza un init no vacío si el origen está en modo `navigate`. La petición de revalidación se construye limpia desde la URL.
2. El `Response` cacheado se devuelve al navegador **y** se compara con el de red. Hay que clonarlo *antes* de devolverlo: en cuanto el navegador empieza a leerlo, su cuerpo queda consumido y `clone()` falla, abortando la revalidación en silencio.

**Instalación** — `beforeinstallprompt` en Chrome/Android ofrece el diálogo nativo. iOS no emite ese evento nunca, así que ahí se muestran las instrucciones del gesto manual. Si ya está instalada (`display-mode: standalone` o `navigator.standalone`) no se muestra nada. El descarte se recuerda en `localStorage`.

---

## 8. Deuda técnica y limitaciones (en orden de prioridad)

Auditado contra el código el 2026-07-28.

1. **Safari iOS borra el almacenamiento tras ~7 días.** Sigue vigente. Prioridad alta: hay indicios de una pérdida previa de 23 intervalos personalizados.

   No es desalojo por falta de espacio, es **ITP**: WebKit borra todo el almacenamiento escribible por script (localStorage, IndexedDB, Cache, registro del SW) tras 7 días de uso de Safari sin interacción con el sitio.

   **Lo que sí protege:** estar **instalada en pantalla de inicio**. Las apps instaladas no forman parte de Safari y llevan su propio contador de días de uso, que se reinicia al usarlas. Ésa es la exención documentada para este caso concreto, y es la razón de peso para que el banner de instalación del §7 exista.

   **Lo que NO protege:** `navigator.storage.persist()`, pese a lo que parece. Se pide al arrancar y se registra el resultado en consola (`checkPersistencia`), pero WebKit concede ese permiso *por heurísticas, sobre todo si ya estás instalado en pantalla de inicio*. En una pestaña normal de Safari lo habitual es que lo deniegue — justo el escenario donde haría falta. Protege sobre todo del desalojo por presión de espacio. Verificado empíricamente: en Chromium sobre localhost devuelve `false`.

   Requiere además Safari 17 / iOS 17: antes, `navigator.storage` puede no existir. La llamada está guardada.

   **Riesgo residual:** un usuario que abra la app en una pestaña y nunca la instale sigue expuesto exactamente igual que antes. La única mitigación para él sigue siendo exportar a mano.
2. **Un solo vehículo** por instalación → el modelo de datos no contempla flota
3. **Sin sincronización** — datos locales por dispositivo
4. ~~**Vínculo por string**~~ — **saldado**. El vínculo es `itvId` desde C1–C4; no queda ninguna comparación por nombre en el código
5. **Sin notificaciones push**
6. **Babel en el navegador** — compila en cada carga; ahora sale de caché, así que penaliza el arranque pero no la red
7. **Sin tests automatizados**. La validación al importar es mínima: se comprueba que el JSON parsee y que tenga forma de backup, pero no se valida el contenido campo a campo
8. **`icon.png` pesa 1,5 MB** y se precachea entero; convendría una versión reducida

---

## 9. Convenciones a respetar

- Todo el texto de UI en **español**
- Nombres de variables cortos ya establecidos (`T` = tema, `CC` = colores de categoría, `fT`/`fR` = listas filtradas, `dispR` = registros mostrados). Mantener consistencia.
- Tema claro/oscuro vía `D.dark` / `D.light`, seleccionado con `prefers-color-scheme` y toggle manual
- Respetar `env(safe-area-inset-*)` en header y tab bar (ya corregido para iPhone con notch)
- Cambios **incrementales y verificables**, no reescrituras completas
- Antes de tocar el modelo de datos, avisar: puede romper los backups JSON existentes
- Si un cambio requiere abandonar el archivo único (build step, npm, backend), **plantearlo como decisión** con pros y contras antes de implementarlo

---

## 10. Hacia dónde va

Objetivo declarado: convertir AutoManto en un **producto/negocio**, no solo una app publicada.

Eso implica, en algún momento: cuentas de usuario, datos en la nube, sincronización entre dispositivos y cobros. Las decisiones de producto (nicho, modelo de negocio, validación de demanda) se están discutiendo **en paralelo en otro canal** — no las asumas resueltas.

Hay decidido un cambio de nombre a **Highway**, pendiente a propósito. Todo sigue como AutoManto por ahora.

**Mientras tanto, el trabajo técnico útil es:**
- Saldar la deuda técnica de §8, sobre todo el punto 1
- Preparar el modelo de datos para multi-vehículo
- Dejar la capa de almacenamiento lo bastante desacoplada como para poder cambiar `localStorage` por una API remota sin reescribir la app
