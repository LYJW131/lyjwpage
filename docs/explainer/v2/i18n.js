// 文字表：播放器和章节标签的文字。各章自己的文字写在各自的 chNN.js 顶部（I18N.add），场景代码里不写字面文字。
// 键名：播放器 ui.*，章节标签 ch.NN，章内 chNN.*。每个键 [中文, English]；数据源里的歌名、剧名之类照原样。
// 事实口径以 docs/explainer/FACTS.md 为准：改这里的数字、端点、谁做什么之前先对照它。
(() => {
  const T = {
    // ---- 播放器 ----
    "ui.play": ["播放", "Play"],
    "ui.pause": ["暂停", "Pause"],
    "ui.lang": ["English", "中文"],
    // ---- 章节标签（进度条上），和 plan.js 一一对应 ----
    "ch.00": ["00 开场", "00 Opening"],
    "ch.01": ["01 采集", "01 Sources"],
    "ch.02": ["02 入口", "02 Ingress"],
    "ch.03": ["03 状态核心", "03 State core"],
    "ch.04": ["04 首屏", "04 First screen"],
    "ch.05": ["05 推送", "05 Live wire"],
    "ch.06": ["06 交付", "06 Delivery"],
    "ch.07": ["07 调频", "07 Cadence"],
    "ch.08": ["08 自检", "08 Self-check"],
    "ch.09": ["09 回顾", "09 Recap"],
    // 还没写的章：占位画面上的字（只在开发中出现）
    "ph.todo": ["这一章还没写", "Not written yet"],
  };


  const I18N = {
    lang: "zh",
    set(l) { this.lang = l === "en" ? "en" : "zh"; document.documentElement.lang = this.lang === "en" ? "en" : "zh-CN"; },
    tr: (key) => {
      const v = T[key];
      if (!v) { console.warn("缺文字：", key); return key; }
      return I18N.lang === "en" ? v[1] : v[0];
    },
    add(more) { Object.assign(T, more); },
  };
  window.I18N = I18N;
})();
