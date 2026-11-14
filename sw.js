/* Satu Titik: service worker. Aplikasi disimpan di perangkat, jadi bisa dibuka tanpa internet.
   - Halaman & file aplikasi: dari cache dulu (cepat, offline), lalu diperbarui diam-diam saat online.
   - Permintaan jam/menu-baru.json (cache:"no-store"), POST, dan situs lain: tidak disentuh, langsung ke jaringan.
   Naikkan angka VERSI bila ingin memaksa semua pengguna memuat ulang berkas. */
const VERSI = "satutitik-v1";
self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSI).then(c => Promise.all(["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "kebijakan-privasi.html"].map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSI).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const r = e.request, u = new URL(r.url);
  if(r.method !== "GET" || u.origin !== location.origin || r.cache === "no-store") return;
  e.respondWith(caches.open(VERSI).then(async c => {
    const hit = await c.match(r, {ignoreSearch: r.mode === "navigate"});
    const net = fetch(r).then(res => { if(res && res.ok) c.put(r, res.clone()); return res; }).catch(() => null);
    if(hit){ e.waitUntil(net); return hit; }
    const res = await net;
    return res || (r.mode === "navigate" ? (await c.match("./") || await c.match("index.html")) : null) || Response.error();
  }));
});
