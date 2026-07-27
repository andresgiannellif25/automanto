/* AutoManto — service worker
 *
 * Estrategia, y por qué:
 *
 * El despliegue de este proyecto es "editar index.html y commitear". Ese
 * flujo no toca sw.js, así que el navegador nunca ve un service worker
 * distinto y nunca vuelve a instalarlo. Un cache-first clásico dejaría al
 * usuario con la misma versión del HTML para siempre, y la única salida
 * sería limpiar la caché a mano.
 *
 * Por eso el documento usa stale-while-revalidate: se sirve la copia en
 * caché al instante (rápido y funciona sin conexión) y en paralelo se pide
 * la de red y se guarda. El despliegue nuevo entra en la caché en la misma
 * visita, y se aplica en la siguiente carga. Cuando la copia de red difiere
 * de la cacheada avisamos a la página, que ofrece recargar: así el usuario
 * puede tener la versión nueva en la primera visita si quiere, sin que
 * nadie tenga que acordarse de subir un número de versión.
 *
 * Los scripts de cdnjs llevan la versión en la URL, así que son inmutables:
 * cache-first sin revalidar.
 */

const CACHE = "automanto-v1";

/* Marca de "hay versión nueva en caché". Existe además del postMessage porque
   la revalidación ocurre durante la navegación, casi siempre antes de que la
   página haya montado y puesto su listener: el mensaje se perdería. La página
   la lee al arrancar y la consume. */
const MARK = "https://automanto.local/update-pending";

const CDN = [
  "https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.2/babel.min.js",
];

const LOCAL = ["./", "./index.html", "./icon.png", "./manifest.webmanifest"];

/* Clave canónica del documento: todas las navegaciones dentro del scope
   comparten una sola entrada, sin importar la query string. */
const docKey = () => new Request(self.registration.scope, { mode: "same-origin" });

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // Uno a uno: si cdnjs falla puntualmente, la instalación no se aborta entera.
    await Promise.all([...LOCAL, ...CDN].map(async u => {
      try {
        const req = new Request(u, { cache: "reload", mode: u.startsWith("http") ? "cors" : "same-origin" });
        const res = await fetch(req);
        if (res && (res.ok || res.type === "opaque")) await c.put(u.startsWith("http") ? u : new Request(u), res);
      } catch (_) { /* se recuperará en la primera visita con red */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function notifyUpdate() {
  const cs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  cs.forEach(c => c.postMessage({ type: "AUTOMANTO_UPDATE_READY" }));
}

/* Pide la copia de red, la guarda, y avisa si el documento cambió.
 *
 * Ojo: no se puede hacer fetch(peticiónDeNavegación, init). El constructor de
 * Request lanza TypeError si el origen está en modo "navigate" y el init no
 * está vacío, así que la petición de red se construye limpia desde la URL. */
async function revalidate(cache, key, req, isDoc, cachedClone) {
  try {
    const netReq = new Request(isDoc ? key.url : req.url, {
      cache: "no-cache", mode: "same-origin", credentials: "same-origin"
    });
    const res = await fetch(netReq);
    if (!res || !res.ok || res.status !== 200) return null;
    // Los dos clones se toman antes de leer nada: una vez que se consume un
    // cuerpo ya no se puede volver a clonar.
    const paraCache = res.clone();
    const paraComparar = res.clone();
    if (isDoc && cachedClone) {
      const [nuevo, viejo] = await Promise.all([paraComparar.text(), cachedClone.text()]);
      if (nuevo !== viejo) { await cache.put(MARK, new Response("1")); await notifyUpdate(); }
    }
    await cache.put(key, paraCache);
    return res;
  } catch (_) {
    return null;
  }
}

async function cacheFirst(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) await c.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(event, isDoc) {
  const c = await caches.open(CACHE);
  const key = isDoc ? docKey() : event.request;
  const cached = await c.match(key, { ignoreSearch: isDoc });
  // El clon se toma ya: `cached` se devuelve al navegador y en cuanto empiece
  // a leerlo su cuerpo queda consumido y deja de poder clonarse.
  const cachedClone = cached ? cached.clone() : null;
  const netP = revalidate(c, key, event.request, isDoc, cachedClone);
  // Mantiene vivo el worker hasta que termine la revalidación en segundo plano.
  try { event.waitUntil(netP); } catch (_) {}
  if (cached) return cached;
  const res = await netP;
  return res || new Response(
    "AutoManto no está disponible sin conexión todavía. Abre la app una vez con red para guardarla.",
    { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
  );
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  if (url.hostname === "cdnjs.cloudflare.com") {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (url.origin !== self.location.origin) return;

  event.respondWith(staleWhileRevalidate(event, req.mode === "navigate"));
});
