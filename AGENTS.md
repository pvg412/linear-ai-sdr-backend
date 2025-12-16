# Repository Guidelines

## Project Structure & Modules
- Application source lives in `src` with Fastify bootstrapping in `src/main.ts` and `src/server.ts`.
- Domain logic is grouped under `src/modules` (AI, lead, lead-db, scraper, search-task, telegram) with DI wiring in `src/container.ts`.
- Shared config sits in `src/config` (environment validation via Zod). Test helpers live in `src/test`.
- Database schema and migrations are in `prisma/`; generated client outputs to `node_modules/.prisma` during dev.
- Docker support (`Dockerfile`, `docker-compose.yml`) targets a Postgres-backed API.

## Build, Test, and Development Commands
- Install: `pnpm install` (workspace managed by `pnpm-workspace.yaml`).
- Dev server with reload: `pnpm dev` (ts-node-dev + path aliases).
- Compile for production: `pnpm build` then run `pnpm start` (uses `dist/main.js`).
- Prisma workflows: `pnpm prisma:migrate` for local schema changes; `pnpm prisma:generate` after edits to `prisma/schema.prisma`.
- Tests: `pnpm test` or `pnpm test:watch`; lint with `pnpm lint` and auto-fix via `pnpm lint:fix`.

## Coding Style & Naming
- TypeScript strict mode; path alias `@/*` maps to `src/*`.
- ESLint config extends TypeScript recommended rules; unused vars must be prefixed with `_`; promises must be handled.
- Prefer module-scoped constants for strings and URLs; keep imports ordered by package → local.
- Use camelCase for variables/functions, PascalCase for classes/types, and kebab-case for file names unless a framework requires otherwise.

## Testing Guidelines
- Vitest is the test runner; bootstrap logic lives in `src/test/setup.ts`.
- Co-locate unit tests near modules or in `src/test` and name with `.spec.ts`.
- Aim for coverage on critical service methods (scraper integrations, lead status transitions, env validation). Mock external HTTP/Telegram/OpenAI calls.
- Run `pnpm test` before opening a PR; include new fixtures/mocks when adding providers.

## Commit & Pull Request Practices
- Follow the existing conventional pattern: `feat(scope): summary` / `fix(scope): summary`; scope can be `docker`, `env`, or module names.
- Keep commits focused (schema changes + migration in one commit). Do not commit secrets or `.env` files.
- PRs should describe behavior changes, list key commands run (tests/lint/migrations), and link issues. Include API contract notes or screenshots for user-facing changes.

## Security & Configuration
- Required env vars are validated via `src/config/env.ts`; ensure `.env` (or deployment secrets) provides DB URL, OpenAI, Telegram, and scraper credentials.
- When adding new providers, enforce URL/API key checks in the env schema and avoid logging sensitive values.
