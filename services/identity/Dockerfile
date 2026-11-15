# identity-service. Build context là gốc repo (guides/NT_Docker_Local_Guide.md §3):
#   docker compose build identity-service
FROM node:22-slim AS build
WORKDIR /repo

# Chép package.json của mọi workspace đã có trước để tận dụng cache; npm ci đối chiếu lockfile chung.
# Thêm service mới (có package.json) thì thêm một dòng COPY ở đây và ở mọi Dockerfile khác.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/service-kit/package.json packages/service-kit/
COPY gateway/package.json gateway/
COPY services/identity/package.json services/identity/
COPY services/promotion/package.json services/promotion/
RUN npm ci

COPY packages/service-kit packages/service-kit
COPY services/identity services/identity
RUN npm run build -w @nextech/service-kit && npm run build -w identity-service
RUN npm prune --omit=dev

FROM node:22-slim
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/package.json ./
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/service-kit ./packages/service-kit
COPY --from=build /repo/services/identity ./services/identity
USER node
EXPOSE 3001
CMD ["node", "services/identity/dist/main.js"]
