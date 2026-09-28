import { LAG_KEYS, writeLag } from "@shared/lag";
import { fetchGithubChart } from "@/lib/github-chart";

import { ok, skipMissing, type Job } from "../job";

/**
 * GitHub 贡献日历（GraphQL，一年的日序列），每 10 分钟一轮。取不到就不写，
 * 可滞后层里上一份原样留着；`?since=` 的切片由读取端在这份整年数据上做。
 */
export const githubChartJob: Job = {
  name: "github-chart",
  everyMinutes: 10,
  offset: 1,
  maxRuntimeMinutes: 2,
  async run({ env }) {
    const token = env.GITHUB_TOKEN?.trim();
    if (!token) return skipMissing("github-chart", ["GITHUB_TOKEN"]);
    const chart = await fetchGithubChart(token);
    await writeLag(env.LAG, LAG_KEYS.githubChart, chart);
    return ok(`${chart.counts.length} days`);
  },
};
