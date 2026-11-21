// Minimal DevTools-protocol client: open a page, evaluate, report computed colors.
// Usage: node cdp.mjs <debug-port> <url> [state-dir-to-switch-theme-in]
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";

const [port, url, stateDir] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let targets;
for (let i = 0; i < 40 && !targets; i++) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  } catch {
    await sleep(250);
  }
}
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));

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
  JSON.parse((await send("Runtime.evaluate", { expression })).result.result.value);

const READ = `JSON.stringify({
  body: getComputedStyle(document.body).backgroundColor,
  text: getComputedStyle(document.body).color,
  button: getComputedStyle(document.getElementById("c")).backgroundColor,
})`;

await send("Page.navigate", { url });
await sleep(4000);
const before = await evaluate(READ);
let after = null;

if (stateDir) {
  const colors = `${stateDir}/theme/colors.toml`;
  writeFileSync(colors, readFileSync(colors, "utf8").replace(/^background = .*$/m, 'background = "#2a1418"'));
  writeFileSync(`${stateDir}/theme.generation`, "2\n");
  await sleep(3000);
  after = await evaluate(READ);
}

console.log(JSON.stringify({ before, after }));
ws.close();
