const CACHE = "finca-v1";
const DATOS = "finca-avisos";
const BASE = ["./", "./index.html", "./manifest.webmanifest", "./icono-192.png", "./icono-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== DATOS).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET" || new URL(r.url).origin !== location.origin) return;
  const clave = r.mode === "navigate" ? "./index.html" : r;
  e.respondWith(caches.open(CACHE).then(async c => {
    const guardado = await c.match(clave, { ignoreSearch: true });
    const red = fetch(r).then(res => {
      if (res && res.ok) c.put(clave, res.clone());
      return res;
    }).catch(() => null);
    if (guardado) {
      e.waitUntil(red);
      return guardado;
    }
    return (await red) || new Response("Sin señal", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }));
});

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const menosDias = (s, n) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() - n); return iso(d); };

async function leer(nombre) {
  const c = await caches.open(DATOS);
  const r = await c.match(nombre);
  return r ? r.json() : null;
}

async function escribir(nombre, datos) {
  const c = await caches.open(DATOS);
  await c.put(nombre, new Response(JSON.stringify(datos), { headers: { "Content-Type": "application/json" } }));
}

async function revisar(forzar) {
  if (self.Notification && Notification.permission !== "granted") return;
  const r = await leer("./__avisos.json");
  if (!r || !r.hayTrab) return;
  if (!forzar) {
    const ventanas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (ventanas.some(w => w.visibilityState === "visible")) return;
  }
  const enviados = (await leer("./__enviados.json")) || {};
  const ahora = new Date(), hoy = iso(ahora), lista = [];
  const a = r.activos || {};
  if (a.anotar && r.diasTrabajo.includes(ahora.getDay()) && ahora.getHours() >= r.hora && !r.anotados.includes(hoy) && !enviados["anotar-" + hoy]) {
    lista.push({ clave: "anotar-" + hoy, tag: "anotar", titulo: "Falta anotar el día", cuerpo: "Todavía no se ha anotado quién vino hoy.", url: "./#hoy" });
  }
  for (const p of r.pagos || []) {
    if (p.fecha > hoy || p.fecha < menosDias(hoy, 1)) continue;
    const cuotas = a.cuotas && p.cuotas.length ? `Lleva cuota de préstamo: ${p.cuotas.join(", ")}.` : "";
    if (a.pago && !enviados["pago-" + p.tipo + p.fecha]) {
      lista.push({ clave: "pago-" + p.tipo + p.fecha, tag: "pago-" + p.tipo, titulo: `Hoy toca pagar la planilla ${p.nombre}`, cuerpo: [p.texto, cuotas].filter(Boolean).join(" "), url: "./#pagar" });
    } else if (!a.pago && cuotas && !enviados["cuota-" + p.tipo + p.fecha]) {
      lista.push({ clave: "cuota-" + p.tipo + p.fecha, tag: "cuota-" + p.tipo, titulo: "Cuotas de préstamo", cuerpo: cuotas, url: "./#pagar" });
    }
  }
  if (a.respaldo && r.respaldoLuego !== hoy) {
    const dias = r.ultimoRespaldo ? Math.floor((ahora - new Date(r.ultimoRespaldo)) / 864e5) : 99;
    const ultimoAviso = enviados.respaldo ? Math.floor((ahora - new Date(enviados.respaldo)) / 864e5) : 99;
    if (dias >= 7 && ultimoAviso >= 7) {
      lista.push({ clave: "respaldo", valor: ahora.toISOString(), tag: "respaldo", titulo: "Guarde un respaldo", cuerpo: r.ultimoRespaldo ? `El último fue hace ${dias} días.` : "Todavía no ha guardado ninguno.", url: "./#config" });
    }
  }
  for (const n of lista) {
    await self.registration.showNotification(n.titulo, { body: n.cuerpo, tag: n.tag, icon: "icono-192.png", lang: "es", data: { url: n.url } });
    enviados[n.clave] = n.valor || 1;
  }
  if (lista.length) {
    const limite = menosDias(hoy, 40);
    for (const k of Object.keys(enviados)) { const f = k.slice(-10); if (/^\d{4}-\d{2}-\d{2}$/.test(f) && f < limite) delete enviados[k]; }
    await escribir("./__enviados.json", enviados);
  }
}

self.addEventListener("periodicsync", e => { if (e.tag === "avisos-finca") e.waitUntil(revisar(false)); });
self.addEventListener("message", e => {
  if (e.data === "revisar") e.waitUntil(revisar(false));
  if (e.data === "prueba") e.waitUntil(self.registration.showNotification("Avisos activados", { body: "Así le van a llegar los avisos de la planilla.", tag: "prueba", icon: "icono-192.png", lang: "es", data: { url: "./#config" } }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(ws => {
    const w = ws.find(x => x.url.startsWith(self.registration.scope));
    if (w) { w.navigate(url).catch(() => {}); return w.focus(); }
    return self.clients.openWindow(url);
  }));
});
