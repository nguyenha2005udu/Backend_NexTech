# API Gateway. Build context là gốc repo (guides/NT_Docker_Local_Guide.md §3):
#   docker compose build api-gateway
FROM node:22-slim AS build
WORKDIR /repo

# Chép package.json của mọi workspace trước để tận dụng cache; npm ci đối chiếu lockfile chung.
# Mỗi service khi có package.json (Phase 2–4, 8) thêm một dòng COPY ở đây.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/service-kit/package.json packages/service-kit/
COPY gateway/package.json gateway/
COPY services/identity/package.json services/identity/
COPY services/promotion/package.json services/promotion/
RUN npm ci

COPY gateway gateway
RUN npm run build -w gateway
RUN npm prune --omit=dev

FROM node:22-slim
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/package.json ./
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/gateway ./gateway
USER node
EXPOSE 8080
CMD ["node", "gateway/dist/main.js"]
