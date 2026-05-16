// Service Worker — システム英単語テストのオフライン対応
//
// 戦略：
//   - install 時に index.html / words.csv / Tailwind CDN をプリキャッシュ
//   - fetch は stale-while-revalidate（キャッシュを即返却しつつ裏で最新を取得して更新）
//   - 完全オフラインかつキャッシュなしのナビゲーションは index.html にフォールバック
//
// アプリ／CSVを更新したら CACHE_VERSION をバンプする。
const CACHE_VERSION = "v1-2026-05-16";
const CACHE_NAME = `system-eitango-${CACHE_VERSION}`;

// 同一オリジン（CORS不要）
const PRECACHE_SAME_ORIGIN = [
  "./",
  "./index.html",
  "./words.csv",
];

// クロスオリジン（CORSヘッダー無しのCDN等は no-cors で取得し opaque response として保存）
const PRECACHE_CROSS_ORIGIN = [
  "https://cdn.tailwindcss.com/3.4.17",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(PRECACHE_SAME_ORIGIN);
      // クロスオリジンは個別に no-cors で取得（失敗しても install 全体は失敗させない）
      await Promise.all(
        PRECACHE_CROSS_ORIGIN.map(async (url) => {
          try {
            const res = await fetch(url, { mode: "no-cors", cache: "no-cache" });
            await cache.put(url, res);
          } catch (e) {
            console.warn("cross-origin precache failed:", url, e);
          }
        })
      );
      await self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith(
    caches.match(req).then((cached) => {
      // 裏側で最新を取得してキャッシュ更新（stale-while-revalidate）
      const fetchPromise = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => null);

      if (cached) return cached;

      return fetchPromise.then((res) => {
        if (res) return res;
        // 完全オフラインかつキャッシュなし：ナビゲーションは index.html に
        if (req.mode === "navigate") {
          return caches.match("./index.html");
        }
        return new Response("Offline", { status: 503, statusText: "Offline" });
      });
    })
  );
});
