// 换配乐的边界：播放中切换不闪回片头、连点两次、切换途中暂停、暂停时切换、切换途中拖进度
import { chromium } from "playwright-core";
const [html] = process.argv.slice(2);
const b = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const p = await b.newPage({ viewport: { width: 1280, height: 760 } });
const errs = [];
p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
p.on("pageerror", (e) => errs.push(e.message));
await p.goto("file://" + html);
await p.evaluate(() => window.__ready);
const st = () => p.evaluate(() => { const a = document.getElementById("music"); return { src: a.src.split("/").pop(), t: +a.currentTime.toFixed(2), shown: +(+document.getElementById("scrub").value).toFixed(2), paused: a.paused, pp: document.getElementById("pp").textContent, on: [...document.querySelectorAll("#sty button.on")].map((x) => x.dataset.style).join() }; });
const ok = (name, cond, extra) => console.log(cond ? "PASS" : "FAIL", name, extra ? JSON.stringify(extra) : "");
ok("开场前底栏不可聚焦", await p.evaluate(() => document.getElementById("ui").inert === true));
await p.click('#start button[data-style="piano"]');
ok("开场后底栏可用", await p.evaluate(() => document.getElementById("ui").inert === false));
await p.waitForTimeout(2500);
// 每帧记下画面用的进度
await p.evaluate(() => { window.__trace = []; (function f() { window.__trace.push(+document.getElementById("scrub").value); if (window.__trace.length < 2000) requestAnimationFrame(f); })(); });
await p.evaluate(() => document.getElementById("ui").classList.add("show"));
const s0 = await st();
await p.click('#sty button[data-style="lofi"]');
await p.waitForTimeout(60);
await p.click('#sty button[data-style="pluck"]');
await p.waitForTimeout(1500);
const s1 = await st();
const minShown = await p.evaluate(() => Math.min(...window.__trace));
ok("播放中连切两次：画面不回片头", minShown >= s0.shown - 0.05, { before: s0.shown, minShown });
// 无头 Chrome 每次（重新）开播后虚拟声卡约 0.6 s 不走时，这里只要求：换到位、没回退、在播、再过 1 s 进度照常走
await p.waitForTimeout(1000);
const s1b = await st();
ok("连切后接着放、进度连续", s1.src === "music-pluck.mp3" && !s1.paused && s1.t >= s0.t && !s1b.paused && s1b.t - s1.t > 0.7, { s0, s1, s1b });
// 切换途中暂停
await p.click('#sty button[data-style="chip"]');
await p.click("#pp");
await p.waitForTimeout(1200);
const s2 = await st();
const s2b = await (async () => { await p.waitForTimeout(600); return st(); })();
ok("切换途中按暂停：真的停住", s2.paused && s2b.t === s2.t && s2.pp === "播放" && s2.src === "music-chip.mp3", { s2, s2b });
// 暂停时切换
await p.click('#sty button[data-style="piano"]');
await p.waitForTimeout(1200);
const s3 = await st();
ok("暂停时切换：保持暂停、位置不变", s3.paused && Math.abs(s3.t - s2.t) < 0.05 && s3.src === "music-piano.mp3", { s3 });
// 切换途中拖进度
await p.click('#sty button[data-style="lofi"]');
await p.evaluate(() => { const r = document.getElementById("scrub"); r.value = 100; r.dispatchEvent(new Event("input")); });
await p.waitForTimeout(1200);
const s4 = await st();
ok("切换途中拖到 100 s", Math.abs(s4.t - 100) < 0.05 && s4.paused && s4.shown === s4.t, { s4 });
await p.click("#pp");
await p.waitForTimeout(1000);
const s5 = await st();
ok("再按播放从 100 s 接着放", !s5.paused && s5.t > 100.5 && s5.t < 101.6 && s5.pp === "暂停", { s5 });
// 键盘聚焦时底栏显形
await p.evaluate(() => document.getElementById("ui").classList.remove("show"));
await p.mouse.move(640, 5); await p.mouse.move(-1, -1).catch(() => {});
await p.keyboard.press("Tab"); await p.waitForTimeout(700);
ok("键盘聚焦时底栏可见", (await p.evaluate(() => +getComputedStyle(document.getElementById("ui")).opacity)) > 0.95);
// 重开页面：上次选的有角标
await p.reload(); await p.evaluate(() => window.__ready);
const last = await p.evaluate(() => [...document.querySelectorAll("#start button.last")].map((x) => x.dataset.style + ":" + getComputedStyle(x, "::after").content));
ok("重开后上次的风格带角标", last.length === 1 && last[0].startsWith("lofi"), last);
console.log("errors:", errs.length ? errs : "none");
await b.close();
