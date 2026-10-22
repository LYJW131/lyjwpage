FROM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci && npm run build
RUN npm prune --omit=dev

# cursor-agent 与 agy 依赖 glibc；alpine + gcompat 缺 fcntl64 / __open。
FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
WORKDIR /app
ENV NODE_ENV=production
ENV NODE_USE_ENV_PROXY=1
# CLI 安装不能落到 HOME=/data，运行时挂卷会遮住构建产物。
ENV PATH="/usr/local/bin:${PATH}"
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl bash jq && rm -rf /var/lib/apt/lists/*
# CLI 合计约 2GB，必须排在 COPY 源码之前、一家一层：只改源码时整段命中缓存，机器上只拉小层；
# misaka-jp 从 GHCR 拉 GB 级单层会卡住。版本与散列都是下面的 ARG，升级步骤见 README「cursor / devin / antigravity」。
ARG CLAUDE_CODE_VERSION=2.1.308
ARG CODEX_VERSION=0.163.0
ARG GROK_VERSION=1.0.67
RUN npm install -g "@anthropic-ai/claude-code@$CLAUDE_CODE_VERSION" && rm -rf /root/.npm
RUN npm install -g "@openai/codex@$CODEX_VERSION" && rm -rf /root/.npm
RUN npm install -g "@xai-official/grok@$GROK_VERSION" && rm -rf /root/.npm
# cursor-agent 的入口只是包装脚本，必须保留 versions 目录并链接其中的实际程序。
ARG CURSOR_AGENT_VERSION=2026.10.19-6bbf2c4
ARG CURSOR_AGENT_SHA256_X64=cf80cc18d8b33bf33e762353977ca1868cfc45290c92c0ffdcef83bb8b37b44f
ARG CURSOR_AGENT_SHA256_ARM64=71a90f12a8b8183a71442b7ed4037bddc1a0f88114ec4fb9ec92782acb8e7d84
RUN set -eu; \
  case "$(uname -m)" in \
    x86_64) A=x64; H=$CURSOR_AGENT_SHA256_X64 ;; \
    aarch64) A=arm64; H=$CURSOR_AGENT_SHA256_ARM64 ;; \
    *) echo "cursor-agent 不支持 $(uname -m)" >&2; exit 1 ;; \
  esac; \
  curl -fsSL "https://downloads.cursor.com/lab/$CURSOR_AGENT_VERSION/linux/$A/agent-cli-package.tar.gz" -o /tmp/cursor.tgz; \
  echo "$H  /tmp/cursor.tgz" | sha256sum -c -; \
  D=/opt/cursor-agent/versions/$CURSOR_AGENT_VERSION; mkdir -p "$D"; \
  tar --strip-components=1 -xzf /tmp/cursor.tgz -C "$D"; rm -f /tmp/cursor.tgz; \
  chmod -R a+rX /opt/cursor-agent; \
  ln -sf "$D/cursor-agent" /usr/local/bin/agent; ln -sf /usr/local/bin/agent /usr/local/bin/cursor-agent
ARG AGY_VERSION=1.4.5-4952523841339392
ARG AGY_SHA512_AMD64=fd30e8d256e28c4a6d0f5fddaa0f74b47c8c5a8e9fa2285cb03f85093e90eca0406f1c2fa57a0386bb820e21ed427e27c2315a01453dfda401c2223b2639ab30
ARG AGY_SHA512_ARM64=cf60004b48015a2737dcb56ce11227fef3a722f2e9329c13318e290951e350c395118bd8680c1042b2fdee9d2ead05fb84bb2596fa2d0012a44bc068655d34eb
RUN set -eu; \
  case "$(uname -m)" in \
    x86_64) U=linux-x64/cli_linux_x64.tar.gz; H=$AGY_SHA512_AMD64 ;; \
    aarch64) U=linux-arm/cli_linux_arm64.tar.gz; H=$AGY_SHA512_ARM64 ;; \
    *) echo "agy 不支持 $(uname -m)" >&2; exit 1 ;; \
  esac; \
  curl -fsSL "https://storage.googleapis.com/antigravity-public/antigravity-cli/$AGY_VERSION/$U" -o /tmp/agy.tgz; \
  echo "$H  /tmp/agy.tgz" | sha512sum -c -; \
  tar xzf /tmp/agy.tgz -C /tmp; mv /tmp/antigravity /usr/local/bin/agy; chmod 755 /usr/local/bin/agy; rm -f /tmp/agy.tgz
# 官方安装脚本把程序装进 $HOME/.local/share/devin，与凭据同目录，会被 /data 卷遮住；按版本化地址自己下载、校验 sha256。
ARG DEVIN_VERSION=3000.11.92
ARG DEVIN_SHA256_X86_64=2d829139682e038cf122510f1170eee3d7060bcc7ebf92445cbc5d28c9fbcfa0
ARG DEVIN_SHA256_AARCH64=881e83b0df06dd57a307004e299407c2c3745f288546e0a339a67fbebe7cb6c0
RUN set -eu; \
  case "$(uname -m)" in \
    x86_64) T=x86_64-unknown-linux; H=$DEVIN_SHA256_X86_64 ;; \
    aarch64) T=aarch64-unknown-linux; H=$DEVIN_SHA256_AARCH64 ;; \
    *) echo "devin 不支持 $(uname -m)" >&2; exit 1 ;; \
  esac; \
  curl -fsSL "https://static.devin.ai/cli/$DEVIN_VERSION/devin-$DEVIN_VERSION-$T.tar.gz" -o /tmp/devin.tgz; \
  echo "$H  /tmp/devin.tgz" | sha256sum -c -; \
  mkdir -p /opt/devin; tar xzf /tmp/devin.tgz -C /opt/devin; rm -f /tmp/devin.tgz; \
  chmod -R a+rX /opt/devin; ln -sf /opt/devin/bin/devin /usr/local/bin/devin
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
