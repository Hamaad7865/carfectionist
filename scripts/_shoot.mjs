// Headless screenshots of signed-in pages, for before/after comparisons. Uses the installed
// Chrome over the DevTools protocol (no extra packages). Cookies come from _mint-session.mjs.
// Usage: node scripts/_shoot.mjs <cookies.json> <out_dir> <width>x<height> name=url [name=url ...]
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const [, , cookieFile, outDir, size, ...shots] = process.argv;
const [width, height] = size.split("x").map(Number);
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const port = 9300 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(process.env.TEMP || ".", "shoot-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch { /* not up yet */ }
}
if (!target) { chrome.kill(); throw new Error("chrome did not start"); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const n = ++id;
  pending.set(n, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});

await send("Page.enable");
await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
fs.mkdirSync(outDir, { recursive: true });
const cookies = JSON.parse(fs.readFileSync(cookieFile, "utf8"));
for (const shot of shots) {
  const [name, url] = [shot.slice(0, shot.indexOf("=")), shot.slice(shot.indexOf("=") + 1)];
  const u = new URL(url);
  for (const c of cookies) {
    const [cn, ...rest] = c.split("=");
    await send("Network.setCookie", { name: cn, value: rest.join("="), domain: u.hostname, path: "/" });
  }
  await send("Page.navigate", { url });
  await sleep(9000); // dev server compiles on first hit; charts animate in
  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(data, "base64"));
  const { result } = await send("Runtime.evaluate", { expression: "location.pathname" });
  console.log(`${name}: ${result.value}`);
}
ws.close();
chrome.kill();
