# Highway — Contexto de proyecto para Claude Code

> Este archivo se carga automáticamente en cada sesión de Claude Code abierta en el repo.
> Describe **lo que el código hace hoy**. Si algo aquí no coincide con `index.html`, el error está en este documento y hay que corregirlo.

---

## 1. Qué es

**Highway** es una PWA de control de mantenimiento vehicular. Registra servicios realizados (aceite, frenos, filtros…), los compara contra intervalos configurables en km y días, y calcula qué está vencido, próximo a vencer o al día.

- **En producción:** https://andresgiannellif25.github.io/automanto
- **Repo:** `andresgiannellif25/automanto` — **el repo NO se renombra**, ni la URL
- **Idioma de la UI:** español

**El nombre visible es Highway; el identificador técnico sigue siendo `automanto`.** La separación es deliberada: renombrar el repo cambiaría la URL de Pages y rompería la instalación existente en el iPhone. Por el mismo motivo tampoco cambia ninguna clave de almacenamiento (`automanto_v3`, `automanto_db`, `automanto_pwa_dismiss`, `automanto_last_export`, `automanto_from_import`), ni el nombre de la caché del service worker, ni el prefijo de los archivos de backup: renombrarlos dejaría huérfanos los datos y los respaldos que ya existen, sin ganar nada.
- **Autor:** Andrés — estudiante de economía, no desarrollador de profesión. Explica el *porqué* de los cambios, no solo el *qué*.

---

## 2. Stack actual (deliberadamente minimalista)

| Capa | Elección | Motivo |
|---|---|---|
| App | Un solo `index.html` | Se puede enviar por correo y abrir con doble clic |
| UI | React 18 UMD vía cdnjs | Sin `npm install`, sin bundler |
| JSX | Babel Standalone en el navegador | Sin build step |
| Estilos | Sistema de diseño en CSS (tokens `:root` + clases) para las pantallas rediseñadas; objetos JS inline (`T`) en los restos heredados | Sin Tailwind ni CSS externo; ver §11 |
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
├── index.html             ← toda la app (~1700 líneas tras el rediseño; ver §11)
├── sw.js                  ← service worker
├── manifest.webmanifest   ← manifest PWA
├── icon-192.png           ← icono "any" y favicon
├── icon-512.png           ← icono "any" grande (instalación, splash)
├── icon-maskable.png      ← 512, opaco y a sangre, arte al 80%
├── icon-apple.png         ← 180, opaco, para apple-touch-icon
├── icon-src.png           ← arte original 1254×1254; no se sirve, sólo se versiona
├── tools/
│   └── generar-iconos.py  ← regenera los cuatro desde icon-src.png
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
- `LEGACY_ID` — mapa id numérico v1 → slug v2, usado sólo por `toV2()` (§5)
- `SAMPLE_R` — 3 registros de ejemplo, ya con `itvId`, **sólo vista previa** (ver §6)
- `CATS` — 12 categorías
- `CC` — color hex por categoría
- `DK` — descarte del banner de instalación; `EK`, `IK` — claves de `automanto_last_export` y `automanto_from_import` (§8, punto 1), todas de `localStorage`, ninguna del documento
- `isIOS()`, `isSafari()`, `isStandalone()`, `aplicaPurga7d()`, `comoInstalar()` — detección de navegador para el banner de instalación y el aviso de los 7 días de ITP (§8, punto 1). `isSafari()` excluye Chromium a mano: casi todo UA lleva `Safari/537.36`, incluido Chrome
- `checkPersistencia()`, `leerSW()`, `hashCorto()` — diagnóstico de persistencia y del service worker que alimenta el panel de Config (§7)

**c) Filas de intervalo en Config**
El componente `IRow` (edición inline de km/días con inputs **no controlados**) se **retiró en el rediseño** (§11). Ahora los intervalos se pintan con el helper `intervalRow` (km/días como pills de sólo lectura) y se editan por el modal (`openEditI` → `showItv`), que ya existía. El formulario del vehículo, en cambio, siempre fue controlado y lo sigue siendo.

Nota histórica de `IRow`: usaba inputs no controlados a propósito porque los controlados perdían el cursor en cada tecla dentro de iframes. Si algún día se vuelve a editar km/días inline, tenerlo presente.

**d) `App`**
Todo el estado y la UI. Estado principal:

```
vehicle   → datos del carro (incluye km actuales del odómetro)
records   → historial de servicios realizados (sólo datos propios)
itvs      → intervalos de mantenimiento
seeded    → si el usuario ya tiene datos propios
vDraft    → buffer de edición del vehículo (commit en blur)
updAt     → updatedAt del último guardado, para que el export lleve la fecha
            real de modificación del dato y no la de exportación
lastExp   → fecha del último export en este dispositivo (§8, punto 1)
fromImp   → si los datos de este dispositivo llegaron por importación (§8, punto 1)
stg       → diagnóstico de almacenamiento (persist/persisted), para el panel de Config
sw, swBusca → diagnóstico del service worker y resultado de "Buscar ahora" (§7)
swUpd, canInst, iosTip, puedeInst → banners de actualización e instalación (§7)
```

Refs espejo (`vRef`, `rRef`, `iRef`) para que `save()` lea el estado más reciente sin depender del closure. `updAt` es **estado, no ref**: el aviso de respaldo lo compara contra la fecha del export y necesita provocar re-render cuando cambia.

**e) Registro del service worker**
Script plano al final del `<body>`, guardado por esquema para no romper `file://`.

---

## 5. El núcleo: cálculo de `tracking`

Es el corazón de la app. Para cada intervalo:

1. Filtra los registros visibles donde `record.itvId === itv.id`
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

**Manifest** — `standalone`, `start_url` y `scope` relativos (`./`, necesario porque Pages sirve bajo `/automanto/`), tema negro, e iconos declarados con su tamaño real: 192 y 512 como `any`, y `icon-maskable.png` como `maskable`.

**Iconos** — se generan con `tools/generar-iconos.py` desde `icon-src.png`. Tres reglas que no conviene romper al tocarlos:

- El **maskable** debe ser opaco y a sangre, con el arte al 80% del lienzo. Android recorta un círculo del 80%: un icono con margen transparente sale con las esquinas vacías y la ilustración cortada. El fondo continúa el degradado del propio squircle para que el borde no se note.
- El **apple-touch-icon** debe ser opaco y sin esquinas redondeadas propias. iOS compone la transparencia sobre negro y luego aplica su redondeo; un PNG con esquinas transparentes sale con marco negro.
- Los iconos **`any` van en color real**. Cuantizarlos deja bandas visibles en el degradado, y con alfa Pillow sólo admite FASTOCTREE, que es la peor. El maskable sí se cuantiza (MEDIANCUT, sin alfa) porque ahí es indistinguible y ahorra la mitad.

**Service worker** — precachea en `install`: el documento, `index.html`, el manifest y los iconos pequeños, más los tres scripts de cdnjs. `icon-512.png` queda fuera a propósito: sólo lo usan la instalación y el splash, y no merece 190 KB en la primera carga de todo el mundo. Los recursos se piden uno a uno para que un fallo puntual del CDN no aborte la instalación entera.

**Estrategia de caché, y por qué:**

| Recurso | Estrategia | Razón |
|---|---|---|
| Documento (navegaciones) | stale-while-revalidate | ver abajo |
| cdnjs (React, ReactDOM, Babel) | cache-first sin revalidar | la URL lleva la versión: son inmutables |
| Recursos propios (icono, manifest) | stale-while-revalidate | cambian rara vez pero pueden cambiar |

El despliegue de este proyecto es "editar `index.html` y commitear". Ese flujo **no toca `sw.js`**, así que el navegador nunca ve un worker distinto y nunca lo reinstala. Un cache-first clásico dejaría al usuario clavado en la misma versión del HTML para siempre, con la caché manual como única salida.

Con stale-while-revalidate se sirve la copia cacheada al instante (rápido y offline) y en paralelo se pide la de red y se guarda. El despliegue nuevo entra en caché **en la misma visita** y se aplica en la siguiente carga. Cuando la copia de red difiere de la cacheada, el SW deja una marca y avisa a la página, que ofrece recargar: así el usuario puede tener la versión nueva ya en la primera visita. **Nadie tiene que acordarse de subir un número de versión.**

**Punto ciego conocido del banner** (esperado, no es un fallo): el aviso compara únicamente el documento. Si un despliegue modifica también `sw.js`, el worker nuevo se instala y su `install` precachea el `index.html` nuevo directamente, así que **la actualización se aplica en silencio, sin banner** — no queda nada que anunciar. El banner sólo aparece cuando cambia el documento y `sw.js` no.

No requiere arreglo: tocar `sw.js` es infrecuente por diseño, y en ese caso el usuario recibe la versión nueva igual, sólo que sin aviso. Verificado con el panel de diagnóstico de Config: tras un despliegue que sólo cambió `index.html`, el banner aparece y luego caché y servidor coinciden.

`CACHE = "automanto-v2"` sólo hay que tocarlo si cambia la *forma* de lo cacheado; `activate` borra cualquier caché con otro nombre. Se subió a v2 al reemplazar el juego de iconos, para que las cachés viejas soltaran el `icon.png` de 1,5 MB.

**La página no debe conocer el nombre de la caché.** Cuando lo conocía, subir el worker a v2 dejó el lector de la marca apuntando a `automanto-v1` y el banner se rompió en silencio. Ahora la marca se busca con `caches.match()`, que recorre todas.

**Cómo se aplica la actualización (botón "Actualizar").** No basta con `location.reload()`: reseteaba la pestaña a Inicio y corría una carrera con la caché del SW (el aviso salía antes de guardar el documento nuevo, así que la recarga podía servir la copia vieja y el banner reaparecía). El flujo actual: `aplicarActualizacion` le manda al SW el mensaje `APLICAR_ACTUALIZACION`; el SW **purga el documento cacheado y la marca** y confirma con `AUTOMANTO_UPDATE_APPLIED`; recién entonces la página recarga (con timeout de respaldo por si el SW no responde), de modo que la siguiente carga trae la versión fresca sí o sí. Además **conserva la pestaña abierta** (`sessionStorage`, clave `hw_apply_tab`) para no saltar a Inicio. En `sw.js`, `revalidate` guarda el documento nuevo **antes** de avisar, eliminando la carrera también para el camino sin mensaje. El banner es un **render único** (no hay versión de escritorio aparte). Detalle de transición: la **primera** actualización a una versión con este cambio la sirve todavía el `index.html`/`sw.js` viejos, así que usa el mecanismo previo; de ahí en adelante, el nuevo.

**Dos trampas que costaron depurar** (no reintroducirlas):

1. `fetch(peticiónDeNavegación, init)` lanza `TypeError`: el constructor de `Request` rechaza un init no vacío si el origen está en modo `navigate`. La petición de revalidación se construye limpia desde la URL.
2. El `Response` cacheado se devuelve al navegador **y** se compara con el de red. Hay que clonarlo *antes* de devolverlo: en cuanto el navegador empieza a leerlo, su cuerpo queda consumido y `clone()` falla, abortando la revalidación en silencio.

**Instalación** — `beforeinstallprompt` en Chrome/Android ofrece el diálogo nativo. iOS no emite ese evento nunca, así que ahí se muestran las instrucciones del gesto manual (`comoInstalar()`, distinta para iOS, Safari de escritorio y el resto). Si ya está instalada (`display-mode: standalone` o `navigator.standalone`) no se muestra nada. El descarte se recuerda en `localStorage`, pero el evento `beforeinstallprompt` se captura igual aunque el banner esté descartado: si no, el bloque de Config no tendría cómo ofrecer la instalación.

**Panel de diagnóstico del service worker** (Config) — sin un Mac no se puede inspeccionar el worker de un iPhone, así que el estado se expone en la propia app. `leerSW()` muestra si la página está controlada y por qué script, los tres estados del registro (`active`/`waiting`/`installing`), las cachés presentes, si hay una marca de actualización pendiente sin consumir, y la huella (`hashCorto`) del documento servido desde caché.

El botón **"Buscar ahora"** llama a `registration.update()` y además compara la huella de la caché contra la del servidor — la pregunta que de verdad importa: ¿hay versión nueva, y la app la está viendo? La petición de comparación lleva un parámetro de caché-bust único (`?diag=...`); sin él, el propio worker la serviría desde su caché y el panel compararía la caché consigo misma, mintiendo siempre que ya está actualizada.

---

## 8. Deuda técnica y limitaciones (en orden de prioridad)

Auditado contra el código el 2026-07-28.

1. **Safari iOS borra el almacenamiento tras ~7 días.** Sigue vigente. Prioridad alta: hay indicios de una pérdida previa de 23 intervalos personalizados.

   No es desalojo por falta de espacio, es **ITP**: WebKit borra todo el almacenamiento escribible por script (localStorage, IndexedDB, Cache, registro del SW) tras 7 días de uso de Safari sin interacción con el sitio.

   **Lo que sí protege:** estar **instalada en pantalla de inicio**. Las apps instaladas no forman parte de Safari y llevan su propio contador de días de uso, que se reinicia al usarlas. Ésa es la exención documentada para este caso concreto, y es la razón de peso para que el banner de instalación del §7 exista.

   **Lo que NO protege:** `navigator.storage.persist()`, pese a lo que parece. Se pide al arrancar (`checkPersistencia`) y el resultado se registra en consola **y** se muestra en un bloque de Config con cinco estados posibles (protegido / protección parcial / sin proteger / no disponible / no se pudo comprobar), más el espacio usado. Pero WebKit concede ese permiso *por heurísticas, sobre todo si ya estás instalado en pantalla de inicio*. En una pestaña normal de Safari lo habitual es que lo deniegue — justo el escenario donde haría falta. Protege sobre todo del desalojo por presión de espacio. Verificado empíricamente: en Chromium sobre localhost devuelve `false`.

   El texto de "sin proteger" distingue si aplica o no la purga de los 7 días (`aplicaPurga7d()`): en Chrome/Firefox de escritorio el riesgo real es otro (desalojo por espacio), y advertir de un plazo que no aplica ahí sería falso.

   Requiere además Safari 17 / iOS 17: antes, `navigator.storage` puede no existir. La llamada está guardada.

   **Tercera capa: aviso de respaldo.** Red de seguridad para lo que las dos anteriores no cubren — pérdida o reseteo del dispositivo, o cualquier fallo imprevisto. En Config, dentro del bloque de respaldo, se muestra el estado del último export.

   La métrica no es el tiempo desde el export sino **si lo que hay ahora está en alguna copia**: se compara `updatedAt` contra la fecha guardada del último export. Alguien que exportó y no volvió a tocar la app no tiene nada en riesgo por muchos meses que pasen, y avisarle sería ruido que enseña a ignorar el aviso.

   | Estado | Color |
   |---|---|
   | Sin datos propios (modo ejemplo) | no se muestra nada |
   | Nunca exportó, con datos | naranja |
   | ídem, pero los datos llegaron importados | naranja, otra redacción |
   | Exportó y no hubo cambios desde entonces | verde |
   | Cambios sin respaldar, < 30 días | neutro |
   | Cambios sin respaldar, 30–90 días | naranja |
   | Cambios sin respaldar, > 90 días | rojo |

   Dos decisiones deliberadas, ambas por el mismo motivo — el contador describe **este dispositivo**, no el dato:

   - La fecha vive en `automanto_last_export`, **fuera** de `automanto_v3`, y no se incluye en el JSON exportado. Si viajara dentro del backup, un teléfono nuevo heredaría el contador del viejo al importar y se creería respaldado sin estarlo.
   - **Importar no actualiza la fecha.** Un documento importado puede traer datos viejos, y haberlo importado no dice nada sobre si lo que se edite después está a salvo.
   - `automanto_from_import` marca que los datos de este dispositivo llegaron importados, y sólo cambia la **redacción** del aviso de "nunca exportaste": ahí sí existe un archivo de origen, aunque no cubra lo editado después. Persiste en localStorage porque si no, recargar cambiaría el texto con los mismos datos. Tampoco viaja en el export, por la razón inversa a las anteriores: el dispositivo que importa heredaría el `false` del dispositivo donde los datos se crearon a mano.

   **Riesgo residual:** un usuario que abra la app en una pestaña, nunca la instale y nunca exporte sigue expuesto. El aviso se lo dice, pero no puede exportar por él.
2. **Un solo vehículo** por instalación → el modelo de datos no contempla flota
3. **Sin sincronización** — datos locales por dispositivo
4. ~~**Vínculo por string**~~ — **saldado**. El vínculo es `itvId` desde C1–C4; no queda ninguna comparación por nombre en el código
5. **Sin notificaciones push**
6. **Babel en el navegador** — compila en cada carga; ahora sale de caché, así que penaliza el arranque pero no la red
7. **Sin tests automatizados**. La validación al importar es mínima: se comprueba que el JSON parsee y que tenga forma de backup, pero no se valida el contenido campo a campo
8. ~~**`icon.png` pesa 1,5 MB**~~ — **saldado**. El juego de iconos suma 309 KB y sólo 118 KB entran al precache

### Bug conocido: zona de contenido en negro (cosmético, intermitente)

**No investigar más por ahora**, salvo que se vuelva reproducible o más frecuente. Se anota para no volver a diagnosticarlo desde cero.

**Síntoma.** Cambiando rápido entre Inicio y Registros, la zona de contenido queda en negro. El header y la barra de pestañas se siguen viendo bien. Ocasional, no reproducible a voluntad.

**Condiciones observadas:** sólo con la app **instalada** —no ocurre en Safari normal con la misma prueba—, sólo en **modo oscuro**, y entre Inicio ↔ Registros. Ya ocurría **antes de cualquier importación de respaldo**, así que esa acción queda descartada.

**Por qué se ve así, y por qué sólo en oscuro.** El contenedor de scroll (`flex:1, overflowY:auto`) **no tiene fondo propio**: es transparente y deja ver el del elemento raíz. En oscuro ese fondo es `#000000` puro; en claro es `#F2F2F7`, casi idéntico al fondo normal de la app entre tarjetas. Lo más probable es que el fallo no sea exclusivo del modo oscuro: es que **sólo se nota** ahí.

**Hipótesis descartadas, con evidencia:**

- **`-webkit-overflow-scrolling: touch`** — descartada. Apple removió la implementación en iOS 13; la propiedad todavía parsea pero no tiene efecto. En un iPhone actual es código muerto y no puede ser la causa. (Quitarla de los tres sitios donde aparece sigue siendo limpieza válida, pero **no es un arreglo de este bug** y no debe presentarse como tal.)
- **Overlay o spinner residual sin desmontar** — descartada. 100 cambios de pestaña, incluidos 60 sin pausa alguna: cero elementos `position:fixed` residuales.
- **Orden de pintado entre cambio de tema y de pestaña** — descartada. 40 iteraciones entrelazando ambos: sin anomalías.
- **Árbol de React que se vacía** — descartada. El contenedor nunca quedó sin hijos ni con altura anómala, y no hubo errores de JavaScript.

**Sospecha sin confirmar:** fallo de repintado o composición de WebKit en esa capa. Encaja con que el DOM esté intacto mientras la pantalla no lo está, y con que sólo aparezca en modo instalado.

**Por qué no se pudo reproducir:** un fallo de composición es invisible desde JavaScript —el DOM y los estilos están correctos mientras la pantalla no lo está— y este entorno de desarrollo no permite inspeccionar píxeles. Además Chromium no es WebKit: `CSS.supports('-webkit-overflow-scrolling','touch')` devuelve `false`, así que la ruta sospechosa ni siquiera existe ahí.

**El dato que haría avanzar el diagnóstico:** cuando ocurra, ¿se recupera haciendo scroll sobre la zona negra, sin cambiar de pestaña? Si sí, es repintado y el contenido estaba ahí. Si no, hay que buscar en el layout.

---

## 9. Convenciones a respetar

- **Idioma: español latinoamericano neutro, siempre.** Con "tú", nunca voseo ("tienes", no "tenés"; "puedes", no "podés"; "dime", no "decime"). Sin modismos de ningún país en particular.

  Aplica a **todo**: el texto de la interfaz, los comentarios del código, los mensajes de commit y —sobre todo— **las explicaciones dirigidas a Andrés**: informes, razonamientos, respuestas en la conversación. No es sólo una convención de producto, es cómo se le habla.
- Nombres de variables cortos ya establecidos (`T` = tema, `CC` = colores de categoría, `fT`/`fR` = listas filtradas, `dispR` = registros mostrados). Mantener consistencia.
- **Tema: claro por defecto, con modo oscuro real (Fase 5).** `dark` arranca en `false` **salvo** que exista la preferencia local `hw_theme==="dark"`. El seguimiento de `prefers-color-scheme` sigue **desactivado** (comentado): el tema lo manda la app, no el SO. El toggle (`D.dark` / `D.light` para los restos heredados) ahora, además, marca `<html data-theme>` para activar el bloque de tokens oscuros de las pantallas nuevas. Ver §11 (Fase 5)
- **Safe-area del notch: forma larga, nunca dentro del shorthand `padding`** (WebkitiOS descarta la declaración entera). El offset vive en `.hw-main` (`padding-top:env(safe-area-inset-top)`); la barra inferior usa `padding-bottom:env(safe-area-inset-bottom)` (§11)
- Cambios **incrementales y verificables**, no reescrituras completas
- Antes de tocar el modelo de datos, avisar: puede romper los backups JSON existentes
- Si un cambio requiere abandonar el archivo único (build step, npm, backend), **plantearlo como decisión** con pros y contras antes de implementarlo

---

## 10. Hacia dónde va

**Este repo queda dedicado en exclusiva a la versión personal**: uso propio y de gente cercana, simple y sin servidor. Ése es su alcance definitivo, no una etapa previa a otra cosa.

La versión comercial —concesionarios, cuentas de usuario, backend— **vivirá en un repo aparte, todavía no creado**. No es una rama de éste ni un fork técnico: son dos proyectos independientes desde el origen, con su propia clave de almacenamiento y su propio dominio antes de cargar ningún dato real.

Consecuencia práctica para cualquier sesión abierta aquí: **no introduzcas cuentas, backend ni multi-tenancy en este repo.** Si una petición parece llevar hacia ahí, es señal de que pertenece al otro proyecto y conviene decirlo antes de escribir código. Las decisiones de producto (nicho, modelo de negocio, validación de demanda) se discuten **en otro canal** — no las asumas resueltas.

**El trabajo técnico útil aquí es:**
- Saldar la deuda técnica de §8 — el punto 1 (vínculo por string) ya está saldado
- Preparar el modelo de datos para multi-vehículo, que sigue siendo útil para uso personal (más de un coche en la familia)
- Mantener la app simple y sin dependencias: es la característica que la hace mantenible por una sola persona

---

## 11. Rediseño visual (modo claro y oscuro) — estado actual

En una sesión de rediseño se rehízo la interfaz de las cuatro pantallas a partir de mockups (Claude Design), **en modo claro** (Fases 1–4); en una sesión posterior se añadió el **modo oscuro** como capa de paleta (Fase 5). Convive con la arquitectura previa: la lógica (§4–§7) no cambió; lo que cambió es la **capa de presentación**.

### Enfoque general

- **Claro por defecto, oscuro opcional.** `dark` arranca en `false` salvo preferencia guardada. El seguimiento automático de `prefers-color-scheme` sigue **desactivado** (comentado): el tema lo decide la app, no el SO. El modo oscuro es una **capa de paleta** sobre lo mismo (Fase 5, más abajo), no un segundo diseño.
- **Sistema de diseño en CSS.** En el `<style>` hay un bloque `:root` con tokens de marca (escalas azul/neutros/estado, radios, sombras) y utilidades (`.ic`, `.mono`), con **tipografía de sistema** (sin Google Fonts). Las pantallas nuevas se estilan con **clases CSS**; los modales heredados aún usan objetos inline (`T`). Un **sprite SVG** oculto (`<symbol id="i-...">`) provee los íconos; se usan con `<use href="#i-...">`.
- **Responsive, punto de quiebre 900px.** Shell `.hw-shell`: móvil (<900) = columna con **barra inferior** (`.hw-tabbar` + FAB central `.hw-fab`); escritorio (≥900) = fila con **barra lateral** (`.hw-side`). Las pantallas con layout distinto por formato duplican el marcado y alternan con `.hw-mob`/`.hw-desk` (display por media query); Config usa un solo marcado que refluye a 2 columnas (`.cfg-cols`).
- **Cada pantalla trae su propio encabezado.** El header compartido viejo se eliminó por completo.

### Las cuatro fases

1. **Navegación + FAB.** Barra inferior (móvil) y lateral (escritorio) con los 4 destinos; el FAB central llama a `openAdd` (el handler de alta de siempre). El modal de alta de registro recibió el envoltorio visual nuevo (scrim con blur, radio, asa).
2. **Inicio.** Saludo dinámico + hero del **servicio más urgente real** + chips de conteo + lista de servicios, todo derivado de `tracking` con los **mismos umbrales** (`homeList` = intervalos con historial ordenados por urgencia; `heroItem`). Se **retiraron** las tarjetas KPI (km/gasto) y "Últimos servicios"; el gasto total se reubicó en Registros.
3. **Seguimiento y Registros.** Helpers `segCard` / `regCard` / `regHero` (móvil y escritorio). Íconos por categoría (`ICON` / `icoFor`). Seguimiento: filtro segmentado con conteos + chips + tarjetas con estado/holgura, badge "Personalizado" y estado "Sin datos". Registros: hero de gasto con desglose (`gasto`), tarjetas con las **dos variantes de huérfano** y el selector "Vincular a…".
4. **Configuración.** Layout responsive de 2 columnas (`.cfg-cols`). Panel de vehículo azul con los 10 campos editables inline. Intervalos con `intervalRow` (km/días en pills; se editan por el modal). Respaldo y Almacenamiento como tarjetas `.stat` con caja de ícono: escudos para los 5 estados de persistencia (`i-shield` / `i-shield-half` / `i-shield-x` / `i-db` / `i-help`), campana/check para el respaldo. Interruptor de tema `i-sun`/`i-moon`. El panel de diagnóstico del SW se conservó.

### El saludo

Lee el **primer nombre de `vehicle.owner`** (dato versionado) y el momento del día (`saludoHora`, cortes 05–12 días / 12–19 tardes / 19–05 noches). Si `vehicle.owner` está vacío, no se muestra.

### Fixes posteriores a las fases (no reintroducir)

- **Clic del hero tapado por la marca de agua.** `.glow`/`.wm` son `position:absolute`; como hijos posicionados se pintan **encima** del botón estático e interceptaban el clic. Fix: `pointer-events:none` en los adornos. Verificado con `elementFromPoint`.
- **Safe-area del notch: forma larga, no shorthand.** `env(safe-area-inset-top)` dentro del **shorthand** `padding` lo **descarta WebKit** (cae la declaración entera → contenido a y=0, bajo la isla). Se usa la **forma larga** `padding-top`, y el offset vive en `.hw-main`, así el banner de actualización y todo lo de arriba quedan bajo la isla. Ver §9.
- **Propietario unificado.** El saludo lee `vehicle.owner`; se eliminó el campo y la clave separados `highway_owner`, que además se limpia de localStorage al cargar.
- **Actualización del SW por mensaje.** Ver §7: `aplicarActualizacion` → `APLICAR_ACTUALIZACION` → el SW purga documento+marca → `AUTOMANTO_UPDATE_APPLIED` → recarga conservando la pestaña. Reemplaza el `location.reload()` a secas, que reseteaba a Inicio y corría una carrera con la caché.

### Fase 5: modo oscuro (capa de paleta)

Modo oscuro real, implementado como **una sola capa de paleta** sobre las 4 pantallas, sin tocar layout, componentes ni lógica. Base en los mockups oscuros (segundo `:root` con ~30 variables sobrescritas: neutrales invertidos, azules aclarados para fondo oscuro, estados más brillantes, sombras en negro).

- **Mecanismo = el toggle que ya existía.** El estado `dark` de React sigue siendo la única fuente de verdad (el botón ☀️/🌙 de Config). Un `useEffect` sobre `dark` marca `document.documentElement` con `data-theme="dark|light"`, fija `color-scheme`, actualiza la meta `theme-color` (`#0c121c` / `#f6f8fb`) y persiste `hw_theme`. El bloque de tokens oscuros vive en `:root[data-theme="dark"]`. Ese atributo es el **puente** entre el toggle (React) y los tokens (CSS): las pantallas nuevas se pintan con `var(--...)`, así que el tema tiene que aplicarse en el CSS, no sólo en el árbol de React. **No es un tema paralelo.**
- **El gradiente de marca no se toca.** El hero conserva su identidad; en oscuro sólo cambian su **sombra** (`--shadow-brand` oscura) y el texto de su botón, que pasa de `--blue-700` (se aclara y pierde contraste sobre el blanco) a `--brand`.
- **Persistencia + sin destello.** La preferencia se guarda en `hw_theme` (dato **local del dispositivo**, no versionado, no viaja en respaldos — mismo patrón que `hw_apply_tab` / `automanto_last_export`). Un script inline en el `<head>` la aplica **antes del primer pintado**, así el tema sobrevive a recargas (incluida la del flujo "Actualizar", que resetea el estado de React) sin parpadeo claro→oscuro.
- **Overrides puntuales** (donde el color claro estaba fijo en la clase, no en un token), copiados de los diseños oscuros: fondo de `.hw-tabbar`; botón del hero (`.a-cta` / `.d-hero .foot button` → `--brand`); chips de categoría (`.cchip`, mezcla sobre transparente); cajas de huérfano y demo (`.r-orphan` / `.r-demo`: fondo ámbar **translúcido** `rgba(245,147,16,.12)`, texto `#f7b64a`); botones de peligro (`.r-btn.danger` / `.irow .ib.danger` / `.tool button` → rojo claro); herramienta temporal (`.tool`, rojo translúcido — si no, la mezcla rojo+blanco daba un fondo casi blanco); botón del diagnóstico del SW (`.swfoot button` → `--brand`, porque `--blue-600` se aclara).
- **Por qué `color-scheme` importa.** Fijarlo hace que el texto sin token explícito (p. ej. el badge "Sin datos", que hereda `canvastext`) sea theme-aware: negro en claro, blanco en oscuro. También alinea controles nativos y la barra de estado del PWA.
- **Modal de intervalo migrado a tokens.** El modal de agregar/editar intervalo (`showItv`) usa ahora clases `.imodal` sobre el sistema de tokens (`:root[data-theme]`), coherente con el resto en claro y oscuro (hoja `--surface-page`, campos `--surface-card`, botón primario con gradiente de marca). Verificado con valores computados en ambos modos. El **modal de registro** (`showRec`) y los banners de instalación/actualización siguen con estilos inline del objeto heredado `T` (`D.dark` = grises iOS `#1c1c1e`): se ven bien y legibles, pero su reconciliación con los tokens azulados queda como pulido pendiente. `T`/`D` **no** se pudo retirar porque esos usos (más el shell, el loading y el estado de respaldo) siguen vivos.
- **Verificado** con valores computados reales: contraste del texto ámbar en huérfanos **9.47:1**, badges de estado 6.29:1 (Vencido) / 16.9:1 (pendiente), sombra oscura del hero, persistencia tras recarga sin destello, sin fondos casi-blancos sueltos, sin errores de consola.

### Reorganización de Configuración (overlays)

Configuración agrupó contenido que estaba suelto en dos botones de entrada (`.cfg-entry`) que abren overlays con el patrón de modal ya establecido (`.imodal`, mismos tokens). Es reorganización de UI: los elementos se movieron, no se reescribió su lógica.

- **Intervalos de servicio** (`showItvList`). Un botón abre un overlay con la lista de **predefinidos** y una subdivisión aparte, con su propio encabezado, para los **personalizados**. La distinción no es solo el encabezado: cada fila personalizada lleva el badge `.pers` "Personalizado" y su botón de borrar (los predefinidos no). Crear/editar desde ahí abre el modal `showItv` encima (se renderiza después en el DOM, así queda por arriba). Antes estos intervalos estaban sueltos en Configuración; se movieron, no se duplican.
- **Herramientas de desarrollador** (`showDev`). Un botón abre un overlay que agrupa el **diagnóstico del service worker** ("Buscar ahora" → `buscarActualizacion`) y la **herramienta temporal de reinicio** (`resetDemo`). Ambos se movieron verbatim; su lógica no cambió. Queda visible siempre, sin gesto oculto ni condición, por decisión explícita.
- Verificado en claro y oscuro con valores computados: los dos overlays abren/cierran, la distinción predef/personalizado es visual (pill de color), el diagnóstico produce resultado ("Buscar ahora") y el reinicio repone los datos demo — todo igual desde su nueva ubicación. Sin errores de consola.

> **Nota (no es tarea a resolver ahora):** "Herramientas de desarrollador" queda expuesto como cualquier otro botón. Cuando la app tenga usuarios reales, habrá que decidir si se oculta, se restringe o se retira — en particular la herramienta de reinicio, que borra datos sin recuperación. Hoy es deliberadamente visible para poder probar.

### Pendientes abiertos del rediseño

- **Herramienta temporal de reinicio de datos** (`resetDemo`, ahora dentro del overlay "Herramientas de desarrollador"): **sigue en uso para pruebas — NO quitar todavía.** Debe eliminarse antes de dar el rediseño por terminado. Ver la nota sobre exposición a usuarios reales, arriba.
- **Modal de editar intervalo (`showItv`):** ✅ resuelto — migrado al sistema de tokens (clases `.imodal`), coherente en claro y oscuro; ya no usa `T` inline.
- **Strings en voseo preexistentes:** ✅ resuelto — pasados a tú neutro: "Pulsá"→"Pulsa", "Buscá"→"Busca" (`comoInstalar`), "perdés"→"pierdes" y "Tenés"→"Tienes" (aviso/estado de respaldo), más "tenés"→"tienes" en un comentario. Grep final sin voseo. ("Instalala" ya no existía en el archivo.)
- **Modo oscuro real:** hecho (Fase 5, arriba). Pulido menor restante: reconciliar el **modal de registro** (`showRec`) y los banners de instalación/actualización —aún en `T`/`D.dark`, grises iOS— con los tokens azulados nuevos.
