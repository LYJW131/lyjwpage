# 编译和运行分两段，和 agents-reporter 一个写法：build 阶段出 dist，运行阶段只带编译产物。
# 没有运行时依赖，只有 typescript / @types/node 两个开发依赖，锁在 package-lock.json 里。
# 改了 package.json 记得在一个没有 node_modules 的干净目录里重新生成锁文件
# （直接在这里跑会把 pnpm 的软链写进去，那种锁文件在容器里没用）。
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci && npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY package.json ./
# 构建这份镜像的提交，每封上报都带上（见 src/push-ledger.ts）
ARG GIT_SHA=""
ENV REPORTER_COMMIT=$GIT_SHA
# /proc 和挂进来的宿主机 /etc 都是全局可读，不需要 root。状态卷 data/ 在机器上是
# nobody（65534）的，沿用从前 Python 镜像的这个用户，换镜像不用再 chown。
USER nobody
CMD ["node", "dist/index.js"]
