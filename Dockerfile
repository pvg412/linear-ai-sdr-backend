FROM node:22-alpine AS base
WORKDIR /app

RUN corepack enable

# ---------- deps stage ----------
FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---------- build stage ----------
FROM base AS build

ARG DATABASE_URL="postgresql://user:password@localhost:5432/dummy"
ENV DATABASE_URL=${DATABASE_URL}
  
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY src ./src
  
RUN pnpm prisma generate
RUN pnpm build

# ---------- runtime stage ----------
FROM base AS prod

ENV NODE_ENV=production
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

COPY --from=deps /app/node_modules ./node_modules

COPY --from=build /app/dist ./dist

COPY prisma ./prisma
COPY prisma.config.ts ./

ENV PORT=3000
EXPOSE 3000

CMD ["sh", "-c", "pnpm prisma migrate deploy && node dist/main.js"]
