# 编译和运行分两段：build 阶段出 dist，运行阶段只带生产依赖。
# 这一份运行时只有 sharp，prune 之后把生产 node_modules 拷进第二段。
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
