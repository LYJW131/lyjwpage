// 全片章节表：章节顺序和小节数的唯一来源，抄自 docs/explainer/SCRIPT.md 的章节表（改小节数先改 SCRIPT，再改这里）。
// film.js 排时间轴、Score.build 拼配乐都只认这张表：
//   - 章节文件（chNN.js）自己写的 bars 和这里不一致时报错，以这里为准；
//   - 还没写的章（没有 chNN.js / music/chNN.js）用占位画面和占位配乐顶上，整片始终能从头播到尾。
// 108 BPM，一小节 20/9 秒（约 2.22 秒）；144 小节 = 5 分 20 秒。
window.PLAN = [
  { id: "ch00", bars: 10 }, // 这张卡片从哪来（0:00）
  { id: "ch01", bars: 20 }, // 野外观测站（0:22）
  { id: "ch02", bars: 16 }, // 门禁与分拣（1:07）
  { id: "ch03", bars: 16 }, // 一间屋子的账房（1:42）
  { id: "ch04", bars: 12 }, // 活字印版（2:18）
  { id: "ch05", bars: 18 }, // 电报线（2:44）
  { id: "ch06", bars: 14 }, // 两条线路（3:24）
  { id: "ch07", bars: 12 }, // 节拍器（3:56）
  { id: "ch08", bars: 12 }, // 心电图与地层（4:22）
  { id: "ch09", bars: 14 }, // 一首歌的旅程（4:49 → 5:20）
];
// 各章画面、各章配乐各自往这两个数组里登记（见 CONVENTIONS.md）
window.CHAPTERS = window.CHAPTERS || [];
window.SCORE_PARTS = window.SCORE_PARTS || [];
