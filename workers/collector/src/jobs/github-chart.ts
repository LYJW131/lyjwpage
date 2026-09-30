import { LAG_KEYS, writeLag } from "@shared/lag";
import { fetchGithubChart } from "@/lib/github-chart";

import { ok, skipMissing, type Job } from "../job";

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
