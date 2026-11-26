/* Satu Titik - service worker (v4)
   Tujuan: aplikasi tetap bisa dibuka tanpa internet, tapi unduhan awal kecil.
   - File inti (index.html, ikon, manifest) disimpan saat pemasangan.
   - Musik (folder media/) diunduh di latar belakang setelah aplikasi terbuka
     (halaman mengirim pesan "precache-media"), lalu dibaca dari cache saat offline.
   - Naikkan VERSION setiap kali file inti atau daftar media berubah. */
const VERSION = "v7";
const CORE = "satutitik-core-" + VERSION;
const MEDIA = "satutitik-media-" + VERSION;
const SDK = "satutitik-sdk-" + VERSION;
const KEEP = [CORE, MEDIA, SDK];

const CORE_FILES = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "kebijakan-privasi.html",
  "icon-192.png",
  "icon-512.png",
  "icon-512-maskable.png",
  "apple-touch-icon.png",
  "favicon-64.png"
];
const MEDIA_FILES = [
  "media/musik-medis.mp3",
  "media/musik-detektif.mp3"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CORE)
      .then(c => Promise.allSettled(CORE_FILES.map(u => c.add(new Request(u, {cache: "reload"})))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !KEEP.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* unduh media satu per satu agar tidak membebani jaringan sekaligus; yang sudah ada dilewati */
async function precacheMedia(){
  const c = await caches.open(MEDIA);
  for(const u of MEDIA_FILES){
    try{
      if(await c.match(u)) continue;
      const r = await fetch(u, {cache: "reload"});
      if(r && r.status === 200) await c.put(u, r);
    }catch(err){ /* offline atau gagal: dicoba lagi pada kunjungan berikutnya */ }
  }
}
self.addEventListener("message", e => {
  if(e.data === "precache-media") e.waitUntil(precacheMedia());
  if(e.data === "skip-waiting") self.skipWaiting();
});

/* balas permintaan Range (video/audio) dari file utuh di cache */
async function rangeFromCache(req, res){
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") || "");
  if(!m) return res;
  const buf = await res.arrayBuffer(), size = buf.byteLength;
  let start = m[1] === "" ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  let end = m[1] === "" || m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if(start >= size || start > end){
    return new Response(null, {status: 416, headers: {"Content-Range": "bytes */" + size}});
  }
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": res.headers.get("Content-Type") || "application/octet-stream",
      "Content-Length": String(end - start + 1),
      "Content-Range": "bytes " + start + "-" + end + "/" + size,
      "Accept-Ranges": "bytes"
    }
  });
}

async function mediaFetch(req){
  const c = await caches.open(MEDIA);
  const hit = await c.match(req.url);
  if(hit) return req.headers.has("range") ? rangeFromCache(req, hit) : hit;
  return fetch(req);   /* belum ada di cache: ambil dari jaringan (jangan simpan potongan Range) */
}

/* halaman: jaringan dulu (supaya pembaruan cepat sampai), jatuh ke cache bila lambat atau offline */
async function pageFetch(req){
  const c = await caches.open(CORE);
  try{
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(req, {signal: ctl.signal});
    clearTimeout(t);
    if(r && r.status === 200 && new URL(req.url).origin === self.location.origin){
      const u = new URL(req.url); u.search = ""; u.hash = "";
      c.put(u.href, r.clone());   /* satu salinan saja, apa pun parameter link-nya (?menu=, ?turnamen=, dst.) supaya cache tidak membengkak */
    }
    return r;
  }catch(err){
    return (await c.match(req, {ignoreSearch: true}))
      || (await c.match("index.html"))
      || (await c.match("./"))
      || Response.error();
  }
}

/* file lain di domain sendiri: pakai cache, perbarui diam-diam di belakang */
async function swr(req, cacheName){
  const c = await caches.open(cacheName);
  const hit = await c.match(req);
  const net = fetch(req).then(r => { if(r && r.status === 200) c.put(req, r.clone()); return r; }).catch(() => null);
  return hit || (await net) || Response.error();
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);

  /* SDK Firebase dari gstatic: disimpan supaya aplikasi tidak gagal memuat modul saat offline */
  if(url.origin === "https://www.gstatic.com" && url.pathname.startsWith("/firebasejs/")){
    e.respondWith(swr(req, SDK)); return;
  }
  if(url.origin !== self.location.origin) return;                 /* Firestore, API lain: biarkan lewat */
  if(url.pathname.indexOf("/.well-known/") !== -1) return;        /* assetlinks.json: jangan disimpan */
  if(url.pathname.endsWith("/sw.js")) return;
  /* permintaan jam server (?_st=...): selalu ke jaringan, jangan dijawab atau disimpan cache, supaya header Date-nya asli */
  if(url.searchParams.has("_st")) return;

  if(url.pathname.indexOf("/media/") !== -1){ e.respondWith(mediaFetch(req)); return; }
  if(req.mode === "navigate" || req.destination === "document"){ e.respondWith(pageFetch(req)); return; }
  e.respondWith(swr(req, CORE));
});
