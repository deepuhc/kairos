// Minimal CDP driver: connect to the running Chrome page, optionally click a
// nav tab by visible label, wait, then capture a full-page screenshot to disk.
// Usage: node cdp-shot.mjs <outPath> [navLabel]
import { writeFileSync } from 'node:fs';

const [, , outPath, navLabel] = process.argv;

const res = await fetch('http://localhost:9222/json');
const pages = await res.json();
const page = pages.find((p) => p.type === 'page' && p.url.includes('localhost:5173'));
if (!page) { console.error('Kairos page not found'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve) => {
    const msgId = ++id;
    pending.set(msgId, resolve);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await new Promise((r) => ws.addEventListener('open', r));
await send('Page.enable');
await send('Runtime.enable');

// Click a nav item by label text if requested. Kairos nav items live in the
// app shell; match any clickable element whose trimmed text equals the label.
if (navLabel) {
  const expr = `(() => {
    const want = ${JSON.stringify(navLabel.toLowerCase())};
    const match = (el) => {
      const lbl = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || '';
      if (lbl.trim().toLowerCase() === want) return true;
      return el.children.length === 0 && el.textContent && el.textContent.trim().toLowerCase() === want;
    };
    const search = (root) => {
      for (const el of root.querySelectorAll('*')) {
        if (match(el)) return el;
        if (el.shadowRoot) { const hit = search(el.shadowRoot); if (hit) return hit; }
      }
      return null;
    };
    const hit = search(document);
    if (hit) { hit.click(); return 'clicked:' + hit.tagName; }
    return 'not-found';
  })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  console.error('nav', navLabel, '->', r?.result?.value);
  await sleep(900);
}

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
console.error('saved', outPath);
ws.close();
process.exit(0);
