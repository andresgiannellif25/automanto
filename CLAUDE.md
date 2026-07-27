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
├── index.html             ← toda la app (~700 líneas)
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

**⚠️ Punto frágil conocido:** el vínculo registro↔intervalo es por **coincidencia exacta de string** (`service === name`). Por eso `saveItv` reescribe en cascada el campo `service` de los registros al renombrar un intervalo. La migración a un `itvId` estable es la deuda técnica #1 y está planificada.

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

1. **Vínculo por string** entre registro e intervalo → migrar a `itvId`
2. **Un solo vehículo** por instalación → el modelo de datos no contempla flota
3. **Sin sincronización** — datos locales por dispositivo
4. **Safari iOS purga el almacenamiento** tras ~7 días de inactividad → mitigado a medias con exportar/importar
5. **Sin notificaciones push**
6. **Babel en el navegador** — compila en cada carga; ahora sale de caché, así que penaliza el arranque pero no la red
7. **Sin tests, sin validación de esquema** al importar JSON
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
