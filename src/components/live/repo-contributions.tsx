import Image from "next/image";
import type { GithubRepoPayload } from "@/lib/types";

const colors = ["#3e70c9", "#3d7f50", "#d66b35", "#8255c7", "#c84d3d", "#b8962a", "#0f9b9b"];
const number = new Intl.NumberFormat("en-US");

export function RepoContributions({ data }: { data: GithubRepoPayload | undefined }) {
  const max = Math.max(1, ...data?.weeks.map(week => week.commits) ?? []);
  return <section id="github-repo" className="min-w-0 scroll-mt-28" aria-label="仓库贡献">
    <div className="flex h-12 items-center justify-between gap-3 px-4">
      <span className="text-[11px] text-muted-foreground">贡献 · 最近 {data?.weeks.length ?? 6} 周</span>
      <span className="text-[10px] tabular-nums" title="仓库累计代码增删"><span className="text-emerald-600 dark:text-emerald-400">+{data ? number.format(data.totals.additions) : "—"}</span><span className="ml-2 text-red-500">−{data ? number.format(data.totals.deletions) : "—"}</span></span>
    </div>
    <div className="px-4 pb-5 pt-2">
      <div className="relative">
        <div className="pointer-events-none absolute inset-x-0 top-6 bottom-6 flex flex-col justify-between" aria-hidden>{[0, 1, 2].map(tick => <div key={tick} className="border-t border-line/50" />)}</div>
        <div className="relative grid grid-cols-6 gap-3 md:gap-8" role="img" aria-label={`最近 ${data?.weeks.length ?? 0} 周提交，按贡献者分色`}>
          {data?.weeks.map(week => <div key={week.weekStart} className="min-w-0 text-center">
            <div className="flex h-44 flex-col justify-end md:h-52">
              <span className="mb-2 text-xs tabular-nums">{number.format(week.commits)}</span>
              <div className="mx-auto flex w-full max-w-24 shrink-0 flex-col-reverse" style={{ height: `${week.commits / max * 80}%` }} title={`${new Date(week.weekStart).toISOString().slice(5, 10)} 起：${week.commits} 次提交`}>
                {data.contributors.map((person, i) => {
                  const commits = person.weeks.find(item => item.weekStart === week.weekStart)?.commits ?? 0;
                  return commits > 0 ? <span key={person.login} style={{ height: `${commits / week.commits * 100}%`, backgroundColor: colors[i % colors.length] }} title={`${person.login} · ${commits} 次提交`} /> : null;
                })}
              </div>
            </div>
            <div className="mt-2 text-[10px] tabular-nums text-muted-foreground">{new Date(week.weekStart).toISOString().slice(5, 10).replace("-", "/")}</div>
          </div>)}
        </div>
      </div>
    </div>
    <div className="grid grid-cols-2 gap-x-5 gap-y-4 px-4 py-4 md:grid-cols-5">
      {data?.contributors.slice(0, 5).map((person, i) => <a key={person.login} href={`https://github.com/${person.login}`} target="_blank" rel="noreferrer"
        className="group min-w-0 text-[11px]"
        title={`${person.login} · ${number.format(person.commits)} 次提交 · +${number.format(person.additions)} / −${number.format(person.deletions)}`}>
        <div className="flex min-w-0 items-center gap-2">
          {person.avatarUrl ? <Image src={`${person.avatarUrl}${person.avatarUrl.includes("?") ? "&" : "?"}s=48`} width={20} height={20} unoptimized alt="" className="size-5 shrink-0 rounded-full" /> : <span className="size-5 text-center">{person.login[0]}</span>}
          <span className="truncate group-hover:underline">{person.login}</span>
        </div>
        <div className="mt-2 flex items-center gap-2 tabular-nums"><span className="size-1.5 rounded-full" style={{ backgroundColor: colors[i % colors.length] }} /><span>{number.format(person.commits)}</span><span className="text-[9px] text-muted-foreground">commits</span></div>
        <div className="mt-1 text-[9px] tabular-nums text-muted-foreground"><span>+{number.format(person.additions)}</span><span className="ml-2">−{number.format(person.deletions)}</span></div>
      </a>)}
    </div>
  </section>;
}
