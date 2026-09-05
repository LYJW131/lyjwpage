# 编译和运行分两段：build 阶段出 dist，运行阶段只带生产依赖。
#
# 依赖走 `npm ci` + 库里那份 package-lock.json，不是 `npm install --no-package-lock`：
# 这个容器是「把目录拷到目标机器现场 build」的，不钉版本的话每次 build 拉到的都可能
# 是不同的补丁版，出问题时无从复现当时那次构建。
# 改了 package.json 记得重新生成锁文件：`npm install --package-lock-only`，
# **要在一个没有 node_modules 的干净目录里跑** —— 直接在这里跑会把 pnpm 的软链
# 农场（`link: true` 指向 ../../node_modules/.pnpm/…）写进去，那种锁文件在容器里没用。
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci && npm run build
RUN npm prune --omit=dev

# 运行段用 Debian：cursor-agent 自带的 node 和 agy 都是 glibc 二进制，alpine + gcompat 缺 fcntl64 / __open 跑不起来
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
# 上报器自己的 fetch 走 HTTP(S)_PROXY：Node 24 起认这个开关，22 的 undici 不看代理变量
ENV NODE_USE_ENV_PROXY=1
# 安装 CLI 时不要 HOME=/data：那是运行时的卷，build 写进去的东西会被挂卷盖掉。
ENV PATH="/usr/local/bin:${PATH}"
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl bash jq && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
# 五个 CLI 只为在容器里登录一次。限额运行时直打各家接口，不再调 CLI。
# 凭据运行时落 /data，不拷 Mac 上那份。
# cursor-agent / agy 装不上**不挡镜像**
# （`|| true`），只是那两家登录不了，登录时看 `docker compose run` 的报错。
# agy 不走它的安装脚本（脚本按 libc 选清单、还依赖 ~/.local/bin），按 linux_<arch> 的清单自己下、自己校验。
# cursor-agent 的 `agent` 只是壳脚本，真身在 versions/<v>/ 下，得整目录留着、链到 versions 里那份。
RUN npm install -g @anthropic-ai/claude-code @openai/codex @xai-official/grok \
  && (curl -fsS https://cursor.com/install | bash || echo "cursor-agent 装不上，跳过") \
  && (M=$(curl -fsSL "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/linux_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').json") \
      && U=$(echo "$M" | jq -r .url) && H=$(echo "$M" | jq -r .sha512) \
      && curl -fsSL "$U" -o /tmp/agy.tgz && echo "$H  /tmp/agy.tgz" | sha512sum -c - \
      && tar xzf /tmp/agy.tgz -C /tmp && mv /tmp/antigravity /usr/local/bin/agy && chmod 755 /usr/local/bin/agy && rm -f /tmp/agy.tgz \
      || echo "agy 装不上，跳过") \
  && (test -d /root/.local/share/cursor-agent && mv /root/.local/share/cursor-agent /opt/cursor-agent && chmod -R a+rX /opt/cursor-agent \
      && ln -sf "$(ls -d /opt/cursor-agent/versions/*/cursor-agent | head -1)" /usr/local/bin/agent && ln -sf /usr/local/bin/agent /usr/local/bin/cursor-agent || true) \
  && mkdir -p /data \
  && chown -R node:node /data /app
ENV HOME=/data
USER node
VOLUME /data
CMD ["node", "dist/index.js"]
