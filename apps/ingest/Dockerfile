# Build from the repository root: docker build -f apps/ingest/Dockerfile .
FROM node:22-slim
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @twc/ingest...
ENV NODE_ENV=production
WORKDIR /repo/apps/ingest
USER node
EXPOSE 8081
CMD ["pnpm", "start"]
