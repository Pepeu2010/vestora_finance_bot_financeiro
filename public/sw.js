const CACHE_NAME = "bot-financeiro-v40";
const STATIC_CACHE = "bot-financeiro-static-v40";
const DYNAMIC_CACHE = "bot-financeiro-dynamic-v40";

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icon.svg",
  "/favicon.svg",
  "/sw.js"
];

const MAX_DYNAMIC_ITEMS = 100;
const OFFLINE_MESSAGE = {
  answer: "Você está offline. Quando a conexão voltar, suas mensagens serão sincronizadas automaticamente."
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn("SW: Some static assets could not be cached:", err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== DYNAMIC_CACHE && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") {
    if (request.method === "POST" && url.pathname === "/api/chat") {
      event.respondWith(handleChatRequest(request));
      return;
    }
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request, DYNAMIC_CACHE));
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname.endsWith(".js") || url.pathname.endsWith(".css")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, STATIC_CACHE));
    return;
  }

  event.respondWith(cacheFirst(request, DYNAMIC_CACHE));
});

async function handleChatRequest(request) {
  try {
    const response = await fetch(request);
    const data = await response.json();
    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: response.headers
    });
  } catch {
    return new Response(JSON.stringify(OFFLINE_MESSAGE), {
      status: 503,
      headers: { "Content-Type": "application/json" }
    });
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) {
    fetchAndCache(request, cacheName).catch(() => {});
    return cached;
  }
  return fetchAndCache(request, cacheName);
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone()).catch(() => {});
      trimCache(cacheName, MAX_DYNAMIC_ITEMS);
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    if (request.mode === "navigate") {
      return caches.match("/") || new Response("Offline", { status: 503 });
    }

    return new Response("Offline", { status: 503 });
  }
}

async function fetchAndCache(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error("No cached response available");
  }
}

async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    const deleteCount = keys.length - maxItems;
    for (let i = 0; i < deleteCount; i++) {
      await cache.delete(keys[i]);
    }
  }
}

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") {
    self.skipWaiting();
  }
});

self.addEventListener("sync", (event) => {
  if (event.tag === "sync-messages") {
    event.waitUntil(syncPendingMessages());
  }
});

async function syncPendingMessages() {
  console.log("SW: Syncing pending messages...");
}

self.addEventListener("push", (event) => {
  const data = event.data?.json() || {};
  const title = data.title || "Bot Financeiro";
  const options = {
    body: data.body || "Nova mensagem",
    icon: "/icon.svg",
    badge: "/favicon.svg",
    tag: "bot-financeiro-notification",
    requireInteraction: false
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      if (clients.length > 0) {
        clients[0].focus();
      } else {
        self.clients.openWindow("/");
      }
    })
  );
});