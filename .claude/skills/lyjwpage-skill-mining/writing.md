# 写给 agent 看的文档：怎么写才会被照做

写或改 skill、`AGENTS.md`、`HUMAN.md`、简报时逐条对照。每条后面是出处；出处是 Anthropic 的 Claude 文档与博客，冲突时以它们的最新版为准。

## 触发描述与指针

- `description` 先写最主要的用途，再写站主实际会说的触发词；它在每一轮都占上下文，超出 1,536 字符的部分会被截掉。源：[Claude Code skills](https://code.claude.com/docs/en/skills)
- 文档里指向别的文件的那一行（`AGENTS.md` 里点名 skill、skill 里点名引用文件）决定 agent 会不会去读。内容写了却没被读到，先把这一行写得更具体、更显眼，再考虑把内容搬过来。源：[Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)「Observe how Claude navigates Skills」
- 同一个东西全文只用一个叫法。源：同上「Use consistent terminology」

## 写什么

- 逐行问：删了它，Claude 会不会做错？不会就删整句。模型默认就会做的事、看文件和命令就能知道的事都不写；写看不出来的约定、坑和取舍理由。源：[Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)「Write an effective CLAUDE.md」；[The new rules of context engineering](https://claude.dev/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models/)
- 用正面说法写要做什么（「写成连贯的段落」而不是「不要用 markdown」）；只有真正的硬禁区才用「不…」，并写上该怎么做。源：[Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)「Tell Claude what to do instead of what not to do」
- 规则后面跟一句为什么，模型会据此推到没写到的情况；只写一句，不铺开叙述。源：同上「Add context to improve performance」；Claude Code skills「State what to do rather than narrating how or why」
- 不用 `CRITICAL`、`MUST`、「务必」这类加重语气，新模型会因此过度触发；某一条反复被跳过时，只给那一条加重。源：Prompting best practices；Best practices for Claude Code
- 能判断的地方给目标和判断依据，不给死规则；只有脆弱、顺序不能错的操作写死命令。源：Skill authoring best practices「Set appropriate degrees of freedom」；context engineering 博客「skills as lightweight guides」

## 结构

- 多步流程给一份可复制到状态行的清单，每一步写清什么算做完（能检查的条件，例如「一条已经跑过、会变红的命令」），校验不过就回到上一步。源：Skill authoring best practices「Workflows and feedback loops」；Best practices for Claude Code「Give Claude a way to verify its work」
- `SKILL.md` 保持 500 行以内；只在部分情况用到的细节拆进同目录文件，从 `SKILL.md` 直接链接，只链一层；超过 100 行的引用文件开头放目录。源：Skill authoring best practices「Progressive disclosure patterns」
- 每次都必须发生、不许例外的事做成确定性检查（测试、`docs:check` 这类脚本、钩子），不写成规则：写在文档里的是建议，钩子和检查才是保证。源：Best practices for Claude Code「Set up hooks」「The over-specified CLAUDE.md」

## 验证

- 写完让一个没看过对话的子代理只拿这份文档做原任务（Claude A 写、Claude B 用），对比有没有这份文档时的做法；要给哪几种模型用就在哪几种模型上试。源：Skill authoring best practices「Evaluation and iteration」「Test with all models you plan to use」
