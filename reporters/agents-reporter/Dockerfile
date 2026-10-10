FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci && npm run build
RUN npm prune --omit=dev

# cursor-agent 与 agy 依赖 glibc；alpine + gcompat 缺 fcntl64 / __open。
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV NODE_USE_ENV_PROXY=1
# CLI 安装不能落到 HOME=/data，运行时挂卷会遮住构建产物。
ENV PATH="/usr/local/bin:${PATH}"
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl bash jq && rm -rf /var/lib/apt/lists/*
# CLI 合计约 2GB，必须排在 COPY 源码之前、一家一层：只改源码时整段命中缓存，机器上只拉小层；
# misaka-jp 从 GHCR 拉 GB 级单层会卡住。CLI_EPOCH 由 CI 按周给，CLI 最多旧一周。
ARG CLI_EPOCH=""
RUN npm install -g @anthropic-ai/claude-code && rm -rf /root/.npm
RUN npm install -g @openai/codex && rm -rf /root/.npm
RUN npm install -g @xai-official/grok && rm -rf /root/.npm
# cursor-agent 的入口只是包装脚本，必须保留 versions 目录并链接其中的实际程序。
RUN (curl -fsS https://cursor.com/install | bash || echo "cursor-agent 装不上，跳过") \
  && (test -d /root/.local/share/cursor-agent && mv /root/.local/share/cursor-agent /opt/cursor-agent && chmod -R a+rX /opt/cursor-agent \
      && ln -sf "$(ls -d /opt/cursor-agent/versions/*/cursor-agent | head -1)" /usr/local/bin/agent && ln -sf /usr/local/bin/agent /usr/local/bin/cursor-agent || true) \
  && rm -rf /root/.local
RUN (M=$(curl -fsSL "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/linux_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').json") \
      && U=$(echo "$M" | jq -r .url) && H=$(echo "$M" | jq -r .sha512) \
      && curl -fsSL "$U" -o /tmp/agy.tgz && echo "$H  /tmp/agy.tgz" | sha512sum -c - \
      && tar xzf /tmp/agy.tgz -C /tmp && mv /tmp/antigravity /usr/local/bin/agy && chmod 755 /usr/local/bin/agy && rm -f /tmp/agy.tgz \
      || echo "agy 装不上，跳过")
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
RUN mkdir -p /data && chown -R node:node /data /app
ENV HOME=/data
ARG GIT_SHA=""
ENV REPORTER_COMMIT=$GIT_SHA
USER node
VOLUME /data
CMD ["node", "dist/index.js"]
