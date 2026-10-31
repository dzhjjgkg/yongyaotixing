/**
 * 用药提醒 - Service Worker
 * 提供离线支持和后台通知
 */

const CACHE_NAME = 'medicine-reminder-v3';
const BASE = self.location.pathname.replace(/\/[^/]*$/, '');
const ASSETS = [
    BASE + '/',
    BASE + '/index.html',
    BASE + '/style.css',
    BASE + '/app.js',
    BASE + '/manifest.json',
];

// 安装事件 - 缓存资源
self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function (cache) {
            console.log('缓存资源中...');
            return cache.addAll(ASSETS);
        })
    );
    self.skipWaiting();
});

// 激活事件 - 清理旧缓存
self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(
                keys.filter(function (key) {
                    return key !== CACHE_NAME;
                }).map(function (key) {
                    return caches.delete(key);
                })
            );
        })
    );
    self.clients.claim();
});

// 请求拦截 - 缓存优先策略
self.addEventListener('fetch', function (event) {
    event.respondWith(
        caches.match(event.request).then(function (cachedResponse) {
            return cachedResponse || fetch(event.request).then(function (response) {
                return caches.open(CACHE_NAME).then(function (cache) {
                    cache.put(event.request, response.clone());
                    return response;
                });
            });
        })
    );
});

// 定时后台同步（如果浏览器支持）
self.addEventListener('periodicsync', function (event) {
    if (event.tag === 'medicine-reminder-check') {
        event.waitUntil(checkAndNotify());
    }
});

// 推送通知
self.addEventListener('push', function (event) {
    const data = event.data ? event.data.json() : {};
    const options = {
        body: data.body || '该吃药了！请按时服药。',
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">💊</text></svg>',
        badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">💊</text></svg>',
        tag: 'medicine-reminder',
        requireInteraction: true,
        vibrate: [200, 100, 200, 100, 400],
        data: {
            url: '/',
        },
    };

    event.waitUntil(
        self.registration.showNotification('💊 用药提醒', options)
    );
});

// 通知点击
self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(function (clientList) {
            for (var i = 0; i < clientList.length; i++) {
                var client = clientList[i];
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(BASE + '/');
            }
        })
    );
});

// 检查是否需要提醒
function checkAndNotify() {
    return self.clients.matchAll().then(function (clients) {
        clients.forEach(function (client) {
            client.postMessage({
                type: 'check-reminder',
            });
        });
    });
}