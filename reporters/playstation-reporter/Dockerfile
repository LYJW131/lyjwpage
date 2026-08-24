# 编译和运行分两段：build 阶段出 dist，运行阶段只带生产依赖。
# PSN 的鉴权和业务请求依赖 psn-api，prune 后把它作为生产依赖拷进运行镜像。
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
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
# token 状态文件默认落在 ./state/（PSN_STATE_FILE 可改）。目录先建好并交给 node，
# 否则 compose 那个卷会以 root 身份挂进来，非 root 的进程写不进去，
# 于是每次重启都退回「要一份新 NPSSO」—— 而重新生成 NPSSO 会作废上一串。
RUN mkdir -p /app/state && chown node:node /app/state
USER node
CMD ["node", "dist/index.js"]
