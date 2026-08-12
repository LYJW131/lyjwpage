import { OnlineCount } from "@/components/live/online-count";
import { Container } from "@/components/ui/section";
import { buildTime, commit } from "@/lib/build-info";

/**
 * 页脚：左边这份产物是什么时候、从哪个提交构建出来的，右边此刻多少人在看。
 *
 * 服务端组件 —— 构建信息在这里就是字面量，不用进客户端产物。只有在线人数
 * 那一小块是客户端的。
 */
export function Footer() {
  return (
    <footer className="screen-line-top">
      {/*
        间隔点用相邻兄弟的伪元素画，不写成一个个 <span>：构建信息取不到时对应
        元素整个不渲染，相邻关系会自动重排，不用把「前面还有没有东西」一路传下去。
      */}
      <Container className="label-mono flex flex-wrap items-center justify-center gap-x-2 gap-y-2 px-4 py-6 text-muted-foreground [&>*+*]:before:mr-2 [&>*+*]:before:text-muted-foreground/50 [&>*+*]:before:content-['·']">
        {commit && (
          <a
            href={commit.url}
            target="_blank"
            rel="noreferrer"
            // label-mono 会把字母转大写，sha 得躲开：大写的 commit 哈希不是
            // 它平时的样子，看着像另一个东西
            className="normal-case transition-colors hover:text-foreground"
          >
            {commit.short}
          </a>
        )}
        {buildTime && <span>构建于 {buildTime}</span>}

        <OnlineCount />
      </Container>
    </footer>
  );
}
