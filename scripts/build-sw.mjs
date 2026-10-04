import { readdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}
const all = files("dist").filter((p) => !p.endsWith("sw.js"));
const urls = all.map(
  (p) => "/" + p.replaceAll("\\", "/").replace(/^dist\//, ""),
);
const version = createHash("sha256")
  .update(all.map((p) => readFileSync(p)).join(""))
  .digest("hex")
  .slice(0, 12);
writeFileSync(
  "dist/sw.js",
  `const CACHE='ng-assistant-${version}',FILES=${JSON.stringify(["/", ...urls])};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('ng-assistant-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  // Static same-origin files do not vary by Origin. Vite preview sets Vary: Origin,
  // while crossorigin module/style requests carry Origin and precache requests do not.
  event.respondWith(caches.match(event.request,{ignoreVary:true}).then(cached=>{
    if(cached)return cached;
    return fetch(event.request).catch(()=>event.request.mode==='navigate'?caches.match('/'):Response.error());
  }));
});`,
);
