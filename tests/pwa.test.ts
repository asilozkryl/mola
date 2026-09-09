import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

function worker() {
  const handlers = new Map<string, (event: any) => void>();
  const shown: { title: string; options: any }[] = [];
  const opened: string[] = [];
  runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    URL, Response, fetch: async () => { throw new Error('offline'); },
    caches: { match: async (path: string) => new Response(path), open: async () => ({ addAll: async () => {} }), keys: async () => [] },
    self: { location: { origin: 'https://mola.example' }, addEventListener: (type: string, handler: (event: any) => void) => handlers.set(type, handler),
      registration: { showNotification: async (title: string, options: any) => { shown.push({ title, options }); } },
      clients: { matchAll: async () => [], openWindow: async (url: string) => { opened.push(url); }, claim: async () => {} }, skipWaiting: async () => {},
    },
  });
  return { handlers, shown, opened };
}
test('service worker never intercepts private API, uploads, chat assets or non-GET requests', () => {
  const { handlers } = worker();
  for (const [path, method] of [['/api/auth/me','GET'], ['/api/channels/private/messages','GET'], ['/api/attachments/private','GET'], ['/socket.io/?transport=polling','GET'], ['/assets/private.js','GET'], ['/offline.html','POST']]) {
    let intercepted = false;
    handlers.get('fetch')!({ request: { url: `https://mola.example${path}`, method, mode: 'cors' }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, path);
  }
});
test('offline navigation falls back only to the public connection screen', async () => {
  const { handlers } = worker();
  let response: Promise<Response> | undefined;
  handlers.get('fetch')!({ request: { url: 'https://mola.example/?invite=private-token', method: 'GET', mode: 'navigate' }, respondWith: (value: Promise<Response>) => { response = value; } });
  assert.equal(await (await response!).text(), '/offline.html');
});
test('push payloads cannot display private contents or navigate outside the app', async () => {
  const { handlers, shown, opened } = worker();
  let work: Promise<unknown> | undefined;
  const waitUntil = (value: Promise<unknown>) => { work = value; };
  handlers.get('push')!({ data: { json: () => ({ title: 'Untrusted', body: 'Private message', url: 'https://evil.example/', tag: 'n1' }) }, waitUntil });
  await work;
  assert.equal(shown[0].title, 'Mola');
  assert.equal(shown[0].options.body, 'Yeni bir bildirimin var.');
  assert.equal(shown[0].options.data.url, 'https://mola.example/');
  handlers.get('notificationclick')!({ notification: { close() {}, data: { url: 'https://evil.example/' } }, waitUntil });
  await work;
  assert.deepEqual(opened, ['https://mola.example/']);
});
test('push deep links keep only validated workspace and message identifiers', async () => {
  const { handlers, shown } = worker();
  let work: Promise<unknown> | undefined;
  const workspace = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const message = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  handlers.get('push')!({ data: { json: () => ({ url: `/?workspace=${workspace}&message=${message}&token=secret` }) }, waitUntil: (value: Promise<unknown>) => { work = value; } });
  await work;
  assert.equal(shown[0].options.data.url, `https://mola.example/?workspace=${workspace}&message=${message}`);
});

test("server diagnostic push keeps generic content and focuses without a conversation target", async () => {
  const { handlers, shown } = worker();
  let work: Promise<unknown> | undefined;
  handlers.get("push")!({
    data: {
      json: () => ({
        test: true,
        title: "Private title",
        body: "Private message",
        url: "/?message=bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
        tag: "diagnostic-1",
      }),
    },
    waitUntil: (value: Promise<unknown>) => {
      work = value;
    },
  });
  await work;
  assert.equal(shown[0].title, "Mola");
  assert.equal(shown[0].options.body, "Test bildirimin bu cihaza ulaştı.");
  assert.equal(shown[0].options.data.url, "https://mola.example/");
  assert.equal(shown[0].options.data.test, true);
  assert.equal(shown[0].options.tag, "diagnostic-1");
});

test("malformed and primitive push payloads remain safe generic notifications", async () => {
  const { handlers, shown } = worker();
  for (const value of [null, false, 12, "text", { test: "true" }]) {
    let work: Promise<unknown> | undefined;
    handlers.get("push")!({
      data: { json: () => value },
      waitUntil: (pending: Promise<unknown>) => {
        work = pending;
      },
    });
    await work;
  }
  assert.equal(shown.length, 5);
  for (const item of shown) {
    assert.equal(item.options.body, "Yeni bir bildirimin var.");
    assert.equal(item.options.data.test, false);
    assert.equal(item.options.data.url, "https://mola.example/");
  }
});
