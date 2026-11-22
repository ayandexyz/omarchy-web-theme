// Puts the test extension into one palette source before a check runs.
// Usage: node ext.mjs <debug-port> host          # file URL access off -> native host
//        node ext.mjs <debug-port> files <home>  # read theme files under <home>
// Extensions loaded with --load-extension get file URL access by default.
const [port, mode, home] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = async () => (await fetch(`http://127.0.0.1:${port}/json`)).json();

function connect(url) {
  const ws = new WebSocket(url);
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    pending.get(m.id)?.(m);
  });
  const send = (method, params = {}) =>
    new Promise((r) => {
      const id = ++nextId;
      pending.set(id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) =>
    (await send("Runtime.evaluate", { expression, awaitPromise: true })).result.result.value;
  return new Promise((r) => ws.addEventListener("open", () => r({ ws, send, evaluate })));
}

async function worker() {
  for (let i = 0; i < 40; i++) {
    try {
      const t = (await targets()).find((t) => t.type === "service_worker" && t.url.endsWith("/background.js"));
      if (t) return t;
    } catch {}
    await sleep(250);
  }
  throw new Error("extension service worker not found");
}

const sw = await worker();
const id = sw.url.split("/")[2];

if (mode === "host") {
  // What the user does on chrome://extensions. Reloading an unpacked
  // extension needs developer mode, or Chrome disables it.
  const page = await connect((await targets()).find((t) => t.type === "page").webSocketDebuggerUrl);
  await page.send("Page.navigate", { url: "chrome://extensions/" });
  await sleep(1000);
  await page.evaluate("chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true })");
  await page.evaluate(
    `chrome.developerPrivate.updateExtensionConfiguration({ extensionId: ${JSON.stringify(id)}, fileAccess: false })`,
  );
  page.ws.close();
  await worker();
} else if (mode === "files") {
  const c = await connect(sw.webSocketDebuggerUrl);
  await c.evaluate(`chrome.storage.local.set({ homeDir: ${JSON.stringify(home)} })`);
  c.ws.close();
} else {
  throw new Error(`unknown mode: ${mode}`);
}
