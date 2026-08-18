# 编译和运行分两段：build 阶段出 dist，运行阶段只带生产依赖。
# 这一份运行时零依赖（连 fetch 都是 Node 自带的），prune 之后 node_modules
# 几乎是空的，仍拷过去是为了两份上报器共用同一套骨架。
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm install --no-package-lock && npm run build
RUN npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
USER node
CMD ["node", "dist/index.js"]
