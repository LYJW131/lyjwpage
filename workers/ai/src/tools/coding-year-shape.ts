import { addDays, indexYearMix } from "@shared/coding-year";
import { object } from "@shared/json";

// 年度图的 `mix` 是稀疏的 [日偏移, models 下标, token 数, …]，模型照下标查名字容易错位；换成按日期展开、新的在前的 `modelsByDay`，
// 好让分页先给最近的日子、query 按日期或模型名筛。它排在原始逐日数组前面：超长视图从尾部截断，不能截到它。
export function codingYearForModel(body: unknown): unknown {
  const data = object(object(body)?.data);
  if (!data || typeof data.origin !== "string" || !Array.isArray(data.models) || !Array.isArray(data.mix)) return body;
  const { models, mix, ...rest } = data;
  const origin = data.origin;
  const today = typeof data.todayAtSource === "string" ? data.todayAtSource : null;
  const modelsByDay = [...indexYearMix(models as string[], mix as number[][])]
    .map(([offset, shares]) => ({ date: addDays(origin, offset), models: Object.fromEntries(shares.map(({ model, tokens }) => [model, tokens])) }))
    .filter(({ date }) => today === null || date <= today)
    .sort((left, right) => right.date.localeCompare(left.date));
  return { ...(body as object), data: { modelsByDay, ...rest } };
}
