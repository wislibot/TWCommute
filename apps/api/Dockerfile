# Build from the repository root: docker build -f apps/api/Dockerfile .
FROM node:22-slim
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @twc/api...
ENV NODE_ENV=production
WORKDIR /repo/apps/api
USER node
EXPOSE 3000
CMD ["pnpm", "start"]
