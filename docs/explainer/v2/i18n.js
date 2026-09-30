(() => {
  const T = {
    "ui.play": ["播放", "Play"],
    "ui.pause": ["暂停", "Pause"],
    "ui.lang": ["English", "中文"],
    "ch.00": ["00 开场", "00 Opening"],
    "ch.01": ["01 采集", "01 Sources"],
    "ch.02": ["02 入口", "02 Ingress"],
    "ch.03": ["03 状态核心", "03 State core"],
    "ch.04": ["04 首屏", "04 First screen"],
    "ch.05": ["05 推送", "05 Live wire"],
    "ch.06": ["06 交付", "06 Delivery"],
    "ch.07": ["07 调频", "07 Cadence"],
    "ch.08": ["08 自检", "08 Self-check"],
    "ch.09": ["09 发布", "09 Release"],
    "ch.10": ["10 回顾", "10 Recap"],
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
