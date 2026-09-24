// 抽帧检查：node frames.mjs <index.html> <输出目录> t1 t2 ...   （打印排版自检警告）
import { chromium } from "playwright-core";
import fs from "node:fs";
const [html, outDir, ...times] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("console:", m.type(), m.text()); });
p.on("pageerror", (e) => console.log("pageerror:", e.message));
await p.goto("file://" + html + "?export");
await p.evaluate(() => window.__ready);
for (const t of times) {
  await p.evaluate((t) => window.__seek(t), +t);
  await p.screenshot({ path: `${outDir}/f_${String(t).replace(".", "_")}.png` });
}
const warn = await p.evaluate(() => window.__warn());
if (warn.length) console.log("WARN:\n  " + warn.join("\n  "));
await b.close();
console.log("done", times.length);
