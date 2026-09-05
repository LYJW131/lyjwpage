# 编译和运行分两段：build 阶段出 dist，运行阶段只带生产依赖。
#
# 依赖走 `npm ci` + 库里那份 package-lock.json，不是 `npm install --no-package-lock`：
# 这个容器是「把目录拷到目标机器现场 build」的，不钉版本的话每次 build 拉到的都可能
# 是不同的补丁版，出问题时无从复现当时那次构建。
# 改了 package.json 记得重新生成锁文件：`npm install --package-lock-only`，
# **要在一个没有 node_modules 的干净目录里跑** —— 直接在这里跑会把 pnpm 的软链
# 农场（`link: true` 指向 ../../node_modules/.pnpm/…）写进去，那种锁文件在容器里没用。
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci && npm run build
RUN npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# 安装 CLI 时不要 HOME=/data：那是运行时的卷，build 写进去的东西会被挂卷盖掉。
ENV PATH="/usr/local/bin:${PATH}"
RUN apk add --no-cache ca-certificates curl bash gcompat libstdc++
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
# 五个 CLI：三家只为在容器里登录一次，cursor-agent / agy 还要在每轮里被调用
# （它们的 `/usage` 就是限额来源，见 src/cli-usage.ts）。凭据运行时落 /data，不拷 Mac 上那份。
# cursor-agent / agy 是 glibc 二进制，alpine + gcompat 能跑就跑；装不上**不挡镜像**
# （`|| true`），只是那两行限额发不出去，登录时看 `docker compose run` 的报错。
RUN npm install -g @anthropic-ai/claude-code @openai/codex @xai-official/grok \
  && (curl -fsS https://cursor.com/install | bash || echo "cursor-agent 装不上，跳过") \
  && (curl -fsSL https://antigravity.google/cli/install.sh | bash || echo "agy 装不上，跳过") \
  && (test -x /root/.local/bin/agent && cp /root/.local/bin/agent /usr/local/bin/agent && ln -sf /usr/local/bin/agent /usr/local/bin/cursor-agent || true) \
  && (test -x /root/.local/bin/agy && cp /root/.local/bin/agy /usr/local/bin/agy || true) \
  && mkdir -p /data \
  && chown -R node:node /data /app
ENV HOME=/data
USER node
VOLUME /data
CMD ["node", "dist/index.js"]
