# 编译和运行分两段：build 阶段出 dist，运行阶段只带生产依赖。
# 这一份运行时只有 sharp，prune 之后把生产 node_modules 拷进第二段。
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
USER node
CMD ["node", "dist/index.js"]
