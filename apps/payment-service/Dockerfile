FROM node:20-alpine AS builder

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api-gateway/package.json apps/api-gateway/package.json
COPY apps/transaction-service/package.json apps/transaction-service/package.json
COPY apps/payment-service/package.json apps/payment-service/package.json
COPY apps/worker-service/package.json apps/worker-service/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/logger/package.json packages/logger/package.json
COPY packages/metrics/package.json packages/metrics/package.json
COPY packages/tracing/package.json packages/tracing/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:20-alpine AS runner

WORKDIR /workspace
ENV NODE_ENV=production

COPY --from=builder /workspace/node_modules ./node_modules
COPY --from=builder /workspace/package.json ./package.json
COPY --from=builder /workspace/apps/payment-service/package.json ./apps/payment-service/package.json
COPY --from=builder /workspace/apps/payment-service/dist ./apps/payment-service/dist
COPY --from=builder /workspace/packages ./packages
RUN mkdir -p node_modules/@traceforge \
  && ln -s ../../packages/contracts node_modules/@traceforge/contracts \
  && ln -s ../../packages/config node_modules/@traceforge/config \
  && ln -s ../../packages/logger node_modules/@traceforge/logger \
  && ln -s ../../packages/metrics node_modules/@traceforge/metrics \
  && ln -s ../../packages/tracing node_modules/@traceforge/tracing

EXPOSE 3002
CMD ["node", "apps/payment-service/dist/main.js"]
