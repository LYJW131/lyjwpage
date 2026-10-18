import type { VoronoiLayout } from "./voronoi-layout";

// lyjw 选定的布局：STRETCH 1.3 下 seed 2290 的解，份额取 LYJW131 README 卡片定稿那一刻（opus-5-5 22.12B … other 12.83B）。
// 存储里还没有布局时从这里起步；之后由定时任务按重排规则写回存储。
export const INITIAL_VORONOI_LAYOUT: VoronoiLayout = {
  cells: [
    { model: "claude-opus-5-5", color: "#3178c6", site: [185.71673861213924, 314.3756969543188], weight: 10042.339277904292 },
    { model: "claude-opus-5", color: "#e34c26", site: [428.1934530171812, 349.75178788522294], weight: 3452.940277326947 },
    { model: "swe-2-max", color: "#f1e05a", site: [64.50121809875243, 225.0391555944661], weight: -1052.1236110127154 },
    { model: "gpt-5.6-sol", color: "#89e051", site: [243.33328764278255, 186.11606851199463], weight: -2219.3117050944056 },
    { model: "gpt-6.1-sol", color: "#00add8", site: [495.7547614492664, 212.28342559015115], weight: -4408.575498167025 },
    { model: "claude-sonnet-5-5", color: "#dea584", site: [46.37305902350619, 371.3159960025387], weight: -7489.750856665348 },
    { model: "claude-fable-5", color: "#db61a2", site: [145.6642074326141, 179.6898210626851], weight: -3677.3554054838937 },
    { model: "other", color: "#6e7681", site: [373.68429090802545, 233.95522294374206], weight: 5351.837521194318 },
  ],
  chosenScore: 196.09320600113998,
  chosenAt: 1792280947000,
  seed: 2290,
  accepted: ["wedge"],
};
