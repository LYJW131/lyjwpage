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
ARG GIT_SHA=""
ENV REPORTER_COMMIT=$GIT_SHA
USER nobody
CMD ["node", "dist/index.js"]
