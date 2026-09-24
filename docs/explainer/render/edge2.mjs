// 播放器边界（走本地 http 预览服务，方便拦截请求）：node edge2.mjs http://localhost:4817/
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";
const [base] = process.argv.slice(2);
const b = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const ok = (name, cond, extra) => console.log(cond ? "PASS" : "FAIL", name, extra ? JSON.stringify(extra) : "");
const st = (p) => p.evaluate(() => { const a = document.getElementById("music"); return { src: a.src.split("/").pop(), t: +a.currentTime.toFixed(2), shown: +(+document.getElementById("scrub").value).toFixed(2), paused: a.paused, pp: document.getElementById("pp").textContent, tc: document.getElementById("tc").textContent, on: [...document.querySelectorAll("#sty button.on")].map((x) => x.dataset.style).join(), pressed: [...document.querySelectorAll('#sty button[aria-pressed="true"]')].map((x) => x.dataset.style).join() }; });
async function page(opts = {}) {
  const ctx = await b.newContext({ viewport: opts.vp || { width: 1280, height: 760 }, ...(opts.ctx || {}) });
  const p = await ctx.newPage();
  p.__errs = [];
  p.on("pageerror", (e) => p.__errs.push(e.message));
  if (opts.route) await opts.route(p);
  await p.goto(base);
  await p.evaluate(() => window.__ready);
  return p;
}
const wait = (p, ms) => p.waitForTimeout(ms);
const errs = [];

// 1. 切到拿不到的配乐：退回原来那首，接着放
{
  const p = await page({ route: (p) => p.route("**/music-lofi.mp3", (r) => r.abort()) });
  await p.click('#start button[data-style="piano"]'); await wait(p, 2000);
  const a = await st(p);
  await p.evaluate(() => document.getElementById("ui").classList.add("show"));
  await p.click('#sty button[data-style="lofi"]'); await wait(p, 2500);
  const c = await st(p);
  ok("新配乐加载失败 → 退回钢琴并接着放", c.src === "music-piano.mp3" && !c.paused && c.t >= a.t && c.on === "piano" && c.pressed === "piano" && c.pp === "暂停", { a, c });
  errs.push(...p.__errs); await p.context().close();
}
// 2. 两首都拿不到：停下，按钮变「重试」；恢复网络后点重试能放
{
  let block = true;
  const p = await page({ route: (p) => p.route(/music-(piano|lofi)\.mp3/, (r) => (block ? r.abort() : r.continue())) });
  await p.click('#start button[data-style="piano"]'); await wait(p, 1500);
  const a = await st(p);
  ok("开场那首拿不到 → 退回默认芯片接着放", a.src === "music-chip.mp3" && !a.paused, { a });
  await p.evaluate(() => document.getElementById("ui").classList.add("show"));
  await p.click('#sty button[data-style="lofi"]'); await wait(p, 1500);
  const c = await st(p);
  ok("Lo-fi 拿不到 → 退回芯片", c.src === "music-chip.mp3" && !c.paused, { c });
  await p.unroute(/music-(piano|lofi)\.mp3/);
  await p.route(/music-(piano|lofi|chip)\.mp3/, (r) => r.abort());
  await p.click('#sty button[data-style="piano"]'); await wait(p, 1500);
  const d = await st(p);
  ok("退回去也拿不到 → 停下、显示重试", d.pp === "重试" && d.tc === "加载失败", { d });
  await p.unroute(/music-(piano|lofi|chip)\.mp3/);
  await p.click("#pp"); await wait(p, 2000);
  const e = await st(p);
  ok("恢复后点重试 → 接着放", !e.paused && e.pp === "暂停" && e.tc !== "加载失败" && e.t >= d.t, { e });
  errs.push(...p.__errs); await p.context().close();
}
// 3. 放完后切风格再按播放：一次就从头放
{
  const p = await page();
  await p.click('#start button[data-style="chip"]'); await wait(p, 1200);
  await p.evaluate(() => { const r = document.getElementById("scrub"); r.value = window.__duration - 0.6; r.dispatchEvent(new Event("input")); });
  await wait(p, 2500);
  const a = await st(p);
  await p.evaluate(() => document.getElementById("ui").classList.add("show"));
  await p.click('#sty button[data-style="piano"]'); await wait(p, 1200);
  await p.click("#pp"); await wait(p, 1500);
  const c = await st(p);
  ok("放完 → 切风格 → 按一次播放就从头放", a.paused && !c.paused && c.t > 0.2 && c.t < 3, { a, c });
  // 4. 按住空格只切一次
  const before = (await st(p)).paused;
  await p.keyboard.down("Space"); await wait(p, 900); await p.keyboard.up("Space"); await wait(p, 200);
  const x = await st(p);
  ok("按住空格只切换一次", x.paused !== before, { before, after: x.paused });
  // 9. 进度条方向键 ±5 s
  await p.focus("#scrub"); const t0 = (await st(p)).shown;
  await p.keyboard.press("ArrowRight"); await wait(p, 300);
  const t1 = (await st(p)).shown;
  ok("进度条按右键前进约 5 s", t1 - t0 > 4.5 && t1 - t0 < 5.8, { t0, t1 });
  errs.push(...p.__errs); await p.context().close();
}
// 5. 鼠标点过按钮再移出：底栏收起；键盘 Tab：底栏出现
{
  const p = await page();
  await p.click('#start button[data-style="chip"]'); await wait(p, 3400); // 开场 flash 3 s 过后
  await p.mouse.move(640, 700); await wait(p, 400);
  const hov = await p.evaluate(() => +getComputedStyle(document.getElementById("ui")).opacity);
  await p.click('#sty button[data-style="lofi"]'); await wait(p, 3400);
  await p.mouse.move(640, 300);
  await p.evaluate(() => document.dispatchEvent(new MouseEvent("mouseout", { relatedTarget: null })));
  await p.mouse.move(-5, -5).catch(() => {});
  const cdp = await p.context().newCDPSession(p);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: -10, y: -10 }).catch(() => {});
  await wait(p, 500);
  const out = await p.evaluate(() => ({ op: +getComputedStyle(document.getElementById("ui")).opacity, hover: document.body.matches(":hover"), fv: document.getElementById("ui").matches(":has(:focus-visible)") }));
  ok("悬停时底栏出现", hov > 0.95, { hov });
  ok("点过按钮、指针离开后底栏收起（不再被焦点钉住）", out.fv === false && (out.hover || out.op < 0.05), out);
  await p.keyboard.press("Tab"); await wait(p, 400);
  const kb = await p.evaluate(() => ({ fv: document.getElementById("ui").matches(":has(:focus-visible)"), op: +getComputedStyle(document.getElementById("ui")).opacity }));
  ok("键盘 Tab 进底栏时可见", kb.fv && kb.op > 0.95, kb);
  errs.push(...p.__errs); await p.context().close();
}
// 6. 触屏：点一下画面底栏出现，3 s 后收起；隐藏时点底栏位置不会误触按钮
{
  const p = await page({ vp: { width: 390, height: 844 }, ctx: { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } });
  await p.tap('#start button[data-style="chip"]'); await wait(p, 3500);
  const hidden = await p.evaluate(() => ({ op: +getComputedStyle(document.getElementById("ui")).opacity, pe: getComputedStyle(document.getElementById("ui")).pointerEvents }));
  const paused0 = (await st(p)).paused;
  const r = await p.evaluate(() => document.getElementById("pp").getBoundingClientRect().toJSON());
  await p.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2); await wait(p, 300);
  const afterTap = await p.evaluate(() => ({ op: +getComputedStyle(document.getElementById("ui")).opacity, paused: document.getElementById("music").paused }));
  ok("触屏：底栏隐藏时点它的位置不会误触，只会叫出底栏", hidden.op < 0.05 && hidden.pe === "none" && afterTap.op > 0.5 && afterTap.paused === paused0, { hidden, afterTap, paused0 });
  await wait(p, 3300);
  const later = await p.evaluate(() => +getComputedStyle(document.getElementById("ui")).opacity);
  ok("触屏：3 s 后底栏自己收起", later < 0.05, { later });
  const btn = await p.evaluate(() => [...document.querySelectorAll("#ui button")].filter((x) => !x.hidden).map((x) => Math.round(x.getBoundingClientRect().height)));
  ok("触屏按钮高度 ≥ 44", btn.every((h) => h >= 44), btn);
  errs.push(...p.__errs); await p.context().close();
}
// 横屏手机按钮
{
  const p = await page({ vp: { width: 844, height: 390 }, ctx: { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } });
  await p.tap('#start button[data-style="chip"]'); await wait(p, 500);
  const btn = await p.evaluate(() => [...document.querySelectorAll("#ui button")].filter((x) => !x.hidden).map((x) => Math.round(x.getBoundingClientRect().height)));
  ok("横屏手机按钮高度 ≥ 44", btn.every((h) => h >= 44), btn);
  errs.push(...p.__errs); await p.context().close();
}
// 7. 封面：卡片挡住 Clawd 时藏起来；手机竖屏照常露出
for (const [w, h, mob] of [[1280, 720], [1280, 760], [1440, 900], [1920, 1080], [375, 812, true]]) {
  const p = await page({ vp: { width: w, height: h }, ctx: mob ? { isMobile: true, hasTouch: true } : {} });
  const r = await p.evaluate(() => {
    const cw = Engine.crabWrap, c = cw.firstElementChild.getBoundingClientRect(), k = document.querySelector("#start .pick").getBoundingClientRect();
    return { layerOp: cw.parentElement.style.opacity || "1", overlap: c.bottom > k.top && c.top < k.bottom && c.right > k.left && c.left < k.right };
  });
  ok(`封面 ${w}×${h}：${r.overlap ? "被挡 → 藏起" : "没挡 → 露出"}`, r.overlap ? r.layerOp === "0" : r.layerOp === "1", r);
  await p.screenshot({ path: `${process.env.OUT || tmpdir()}/cover-${w}x${h}.png` });
  errs.push(...p.__errs); await p.context().close();
}
// 8. 慢网：点开始后到出声前停在封面，显示「加载中…」
{
  const p = await page({ route: (p) => p.route("**/music-piano.mp3", async (r) => { await new Promise((z) => setTimeout(z, 1500)); await r.continue(); }) });
  await p.click('#start button[data-style="piano"]'); await wait(p, 600);
  const a = await p.evaluate(() => ({ tc: document.getElementById("tc").textContent, titleVisible: !!document.querySelector(".big-title, .ttl") }));
  const shot = `${process.env.OUT || tmpdir()}/loading.png`; await p.screenshot({ path: shot });
  await wait(p, 2500);
  const c = await st(p);
  ok("慢网：出声前显示「加载中…」，之后正常走时", a.tc === "加载中…" && !c.paused && c.tc !== "加载中…", { a, c });
  errs.push(...p.__errs); await p.context().close();
}
console.log("page errors:", errs.length ? errs : "none");
await b.close();
