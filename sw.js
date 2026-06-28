// ==========================================================
// sw.js - 學習數據分析儀表板 Service Worker
// 策略：
//   - HTML / 未版本化 JS：Network First，避免舊殼卡住新版
//   - 帶 ?v= 的 JS / vendor / icons：Cache First
//   - data/*.json 與 data/*.json.gz：Network First + 離線資料快取
// 更新：2026-06-17 docs4 新版模組與 warning/cross 資料支援
// ==========================================================

const CACHE_PREFIX = 'la-dash-v10-docs4';
const DATA_CACHE_PREFIX = 'la-dash-v10-docs4-data';
const BUILD_VERSION = '202606281356';

const CACHE_VERSION = `${CACHE_PREFIX}-${BUILD_VERSION}`;
const DATA_CACHE = `${DATA_CACHE_PREFIX}-${BUILD_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-120.png',
  './icons/icon-167.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/vendor/pwacompat.min.js',
  './js/vendor/chart.umd.min.js',
  './js/vendor/chartjs-plugin-annotation.min.js',
  './js/frame-guard.js',
  './js/filter-engine.js?v=202606281356',
  './js/main.js?v=202606281356',
  './js/vendor/d3.min.js',
  './js/chart-registry.js?v=202606281356',
  './js/behavior-loader.js?v=202606281356',
  './js/tab-behavior-radar.js?v=202606281356',
  './js/tab-behavior-correlation.js?v=202606281356',
  './js/tab-behavior-time.js?v=202606281356',
  './js/tab-behavior-lsa.js?v=202606281356',
  './js/tab-behavior-cross.js?v=202606281356',
  './js/tab-behavior-warning.js?v=202606281356',
  './js/behavior-init.js?v=202606281356',
  './js/at-risk-report.js?v=202606281356',
  './js/print-panel.js?v=202606281356',
  './js/ui-toggles.js?v=202606281356',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch((err) => {
        console.warn('[SW] App shell cache failed:', err);
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) || key.startsWith(DATA_CACHE_PREFIX))
          .filter((key) => key !== CACHE_VERSION && key !== DATA_CACHE)
          .map((key) => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isDataRequest(url)) {
    event.respondWith(networkFirstData(request));
    return;
  }

  if (url.pathname.endsWith('frame-guard.js')) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.endsWith('.js') && url.searchParams.has('v')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.pathname.includes('/js/vendor/') || isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.pathname.endsWith('.js')) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(networkFirst(request));
});

function isDataRequest(url) {
  return /\/data\/.+\.(json|json\.gz)$/i.test(url.pathname);
}

function isStaticAsset(url) {
  return /\.(css|png|svg|ico|webmanifest|manifest|woff2?)$/i.test(url.pathname);
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      await safePut(cache, request, response.clone());
    }
    return response;
  } catch {
    return new Response('離線中，此資源尚未快取', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function networkFirstData(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DATA_CACHE);
      await safePut(cache, request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request, { cacheName: DATA_CACHE });
    if (cached) {
      console.log('[SW] Offline: serving cached data:', request.url);
      return cached;
    }

    return new Response(JSON.stringify({
      error: 'offline',
      message: '目前離線且無快取資料，請連線後重新整理',
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      await safePut(cache, request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('離線中', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function safePut(cache, request, response) {
  try {
    await cache.put(request, response);
  } catch (e) {
    if (e?.name === 'QuotaExceededError') {
      console.warn('[SW] Cache quota exceeded, pruning...');
      await pruneCache(cache);
      try {
        await cache.put(request, response);
      } catch (err) {
        console.warn('[SW] Cache put failed after pruning:', err);
      }
    } else {
      console.warn('[SW] Cache put failed:', e);
    }
  }
}

async function pruneCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= 40) return;
  await Promise.all(keys.slice(0, keys.length - 40).map((key) => cache.delete(key)));
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data?.type === 'GET_VERSION' && event.ports?.[0]) {
    event.ports[0].postMessage({ version: CACHE_VERSION, build: BUILD_VERSION });
  }
});
