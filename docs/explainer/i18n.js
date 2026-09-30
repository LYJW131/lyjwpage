(() => {
  const params = new URLSearchParams(location.search);
  let lang = params.get("lang");
  if (lang !== "en" && lang !== "zh") {
    lang = "zh";
    try { if (localStorage.getItem("lyjw-explainer-lang") === "en") lang = "en"; } catch {}
  }
  window.LANG = lang;
  document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
  const EN = window.EXPLAINER_EN || {};
  const PATTERNS = window.EXPLAINER_EN_PATTERNS || [];
  const CJK = /[　-〿㐀-鿿＀-￯]/;
  const missing = (window.__missing = new Set());
  function one(s) {
    const text = String(s), key = text.trim();
    if (!key || !CJK.test(key)) return text;
    let v = EN[key];
    if (v == null) for (const [re, to] of PATTERNS) if (re.test(key)) { v = key.replace(re, to); break; }
    if (v == null) { missing.add(key); return text; }
    return text.replace(key, () => v);
  }
  const html = (h) => String(h).split(/(<[^>]*>)/).map((p) => (p.startsWith("<") ? p : one(p))).join("");
  window.__tr = lang === "en" ? one : (s) => s;
  if (lang !== "en") return;

  // 气泡打字时每帧写的是半句，整句已在 say() 里换过，这里跳过
  const skip = (el) => el && (el.id === "bTyped" || el.id === "bMeasure");
  const ih = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  Object.defineProperty(Element.prototype, "innerHTML", { ...ih, set(v) { ih.set.call(this, skip(this) ? v : html(v)); } });
  const tc = Object.getOwnPropertyDescriptor(Node.prototype, "textContent");
  Object.defineProperty(Node.prototype, "textContent", { ...tc, set(v) { tc.set.call(this, v == null || skip(this) ? v : one(v)); } });

  document.title = one(document.title);
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (CJK.test(n.data) && !/^(SCRIPT|STYLE)$/.test(n.parentNode.nodeName)) n.data = one(n.data);
  for (const el of document.querySelectorAll("[aria-label]")) el.setAttribute("aria-label", one(el.getAttribute("aria-label")));
})();
