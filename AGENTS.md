# Repository Guidelines

## Project Structure

```
src/
  main.ts                  # Entrypoint: dotenv, server boot, graceful shutdown
  server.ts                # Fastify app builder: plugins, auth guard, route registration
  container.ts             # Inversify DI container; calls registerXxxModule() in dependency order
  config/
    env.ts                 # Zod-validated environment schema (Env type + loadEnv())
    constants.ts           # Module-scoped numeric/string constants (as const objects)
  modules/                 # Domain logic (auth, chat, lead, lead-search, company-research, etc.)
  capabilities/            # External service adapters (scraper providers, lead-db providers)
    shared/                # Cross-provider utilities (axios helpers, lead normalize/validate)
  infra/                   # Cross-cutting: prisma, queue (BullMQ), realtime (WS hub), gRPC client, auth, errors
  plugins/                 # Fastify plugins (websocket)
  types/                   # Global type augmentations (fastify.d.ts)
  generated/               # Auto-generated code (Prisma client, protobuf) — gitignored
  test/
    setup.ts               # Vitest global setup: .env.test, migrate, seed, cleanup between tests
prisma/
  schema.prisma            # Database schema
  migrations/              # Prisma migration files
```

## Build, Lint, and Test Commands

| Command | Description |
|---------|-------------|
| `pnpm install` | Install dependencies (pnpm workspace) |
| `pnpm dev` | Dev server with hot reload (ts-node-dev + path aliases) |
| `pnpm build` | Compile for production (`tsc && tsc-alias`) |
| `pnpm start` | Run compiled output (`node dist/main.js`) |
| `pnpm lint` | Run ESLint (flat config, type-checked rules) |
| `pnpm lint:fix` | Auto-fix lint errors |
| `pnpm test` | Run all tests via Vitest (sequential, no parallelism) |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm prisma:generate` | Regenerate Prisma client after schema changes |
| `pnpm prisma:migrate` | Create and apply a new dev migration |

### Running a Single Test

```bash
# By file path
pnpm vitest run src/modules/lead/persistence/lead.repository.test.ts

# By name pattern (matches describe/it text)
pnpm vitest run -t "buildLeadWhere"

# Single file in watch mode
pnpm vitest watch src/modules/lead/persistence/lead.repository.test.ts
```

**Important**: Vitest is configured to include only `src/**/*.test.ts` files (see `vitest.config.ts`).
Some legacy `.spec.ts` files exist but are NOT picked up by the default test run.
New tests must use the `.test.ts` extension.

## Code Style

### TypeScript Configuration

- **Strict mode** enabled (`strict: true` in tsconfig.json)
- **Target**: ES2020, CommonJS modules
- **Path alias**: `@/*` maps to `src/*` — always prefer `@/` over deep relative paths for cross-module imports
- `experimentalDecorators` and `emitDecoratorMetadata` enabled (required by Inversify)
- `noUnusedLocals` and `noUnusedParameters` enabled — prefix intentionally unused params with `_`

### Naming Conventions

- **Files**: `kebab-case.ts` (e.g., `lead-search.controller.ts`, `chat.command.service.ts`)
- **Variables/functions**: `camelCase`
- **Classes/types/interfaces**: `PascalCase`
- **DI token objects**: `SCREAMING_SNAKE_CASE` (e.g., `CHAT_TYPES`, `QUEUE_TYPES`)
- **Error codes**: `SCREAMING_SNAKE_CASE` prefixed by domain (e.g., `CHAT_THREAD_NOT_FOUND`, `APIFY_UNAUTHORIZED`)
- **Constants objects**: `SCREAMING_SNAKE_CASE` with `as const` (e.g., `SCRAPER_CONSTANTS`, `GRPC_TIMEOUTS`)

### Module File Naming Pattern

Each module follows `{module-name}.{role}.ts`:

| Role | File | Purpose |
|------|------|---------|
| Controller | `*.controller.ts` | Route registration, input validation, delegates to services |
| Module | `*.module.ts` | DI registration (`registerXxxModule(container)`) |
| Types | `*.types.ts` | Symbol-keyed DI tokens (`Symbol.for(...)`) |
| Service | `*.command.service.ts` / `*.query.service.ts` | CQRS split: writes vs reads |
| Repository | `*.repository.ts` | Prisma database access (in `persistence/` subdirectory) |
| Schemas | `*.schemas.ts` | Zod validation schemas (in `schemas/` subdirectory) |
| DTOs | `*.dto.ts` | TypeScript interfaces for data transfer |
| Errors | `*.errors.ts` | Provider-specific error wrappers (`wrapXxxError()`) |

### Import Ordering

Separate groups with blank lines, in this order:

1. Node built-ins (`import { readFileSync } from "node:fs"`)
2. External packages (`inversify`, `@prisma/client`, `fastify`, `zod`, etc.)
3. Local absolute imports via `@/` alias (`@/infra/...`, `@/config/...`, `@/modules/...`)
4. Local relative imports (`./lead.types`, `../persistence/...`)

Use `import type` when importing only types.

### Error Handling

- Throw `UserFacingError` (from `@/infra/userFacingError`) for all user-visible errors.
- Constructor takes `{ userMessage, code?, debugMessage?, details? }`.
- The global Fastify error handler maps `code` to HTTP status (400, 401, 403, 404, 409, 422, 429). Unknown codes become 500.
- For external provider errors, create a `wrapXxxError()` function in a `*.errors.ts` file that catches provider exceptions and re-throws as `UserFacingError`.
- Never expose internal error messages or stack traces to clients.
- Use `debugMessage` for logs-only context that should not reach the client.

### Dependency Injection (Inversify)

- Define Symbol tokens in `*.types.ts`:
  ```ts
  export const FOO_TYPES = {
    FooService: Symbol.for("FooService"),
  } as const;
  ```
- Register bindings in `*.module.ts` via `registerFooModule(container: Container)`.
- Use `@injectable()` on classes, `@inject(TOKEN)` on constructor params.
- Default scope is singleton (`.inSingletonScope()`).
- Use `.toDynamicValue()` for optional deps (e.g., Redis/queue may not be configured).
- Add new module registration calls to `src/container.ts` in dependency order.

### Database (Prisma)

- Access via `getPrisma()` from `@/infra/prisma` — lazy singleton, NOT DI-managed.
- Repositories assign it as a class field: `private readonly prisma = getPrisma();`
- After editing `prisma/schema.prisma`, run `pnpm prisma:generate` then `pnpm prisma:migrate`.
- Use `isP2002Unique()` from `@/infra/observability` to handle unique constraint violations.

### Controller Patterns

- Export a `registerXxxRoutes(app: FastifyInstance)` function.
- Resolve DI dependencies from `container.get<T>(TOKEN)` at the top of the function.
- Extract user with `requireRequestUser(req)` or `requireRequestUserId(req)`.
- Validate input with Zod `.parse()` (body, params, query) — not Fastify-native schemas.
- Never put business logic in controllers; delegate to services.

## Testing Guidelines

- **Runner**: Vitest with globals enabled (`describe`, `it`, `expect` available without import).
- **Setup**: `src/test/setup.ts` runs migrations, seeds provider capabilities, cleans tables between tests.
- **Test location**: Co-locate near the code. Use `__tests__/` subdirectories for provider tests, or place at module root.
- **File extension**: `.test.ts` (required by vitest config `include` pattern).
- **Mocking**: Use `vi.fn()` and `vi.spyOn()`. Inject mock Prisma via `Object.defineProperty(service, "prisma", { value: mockPrisma })`.
- **Error assertions**: `await expect(fn()).rejects.toThrow(UserFacingError)`
- **External calls**: Always mock HTTP clients (axios) and external APIs. Never make real network calls in tests.
- Run `pnpm test` before opening a PR.

## Commit Conventions

- Format: `feat(scope): summary` / `fix(scope): summary`
- Scopes: module names (`chat`, `lead-search`), `docker`, `env`, `prisma`, `infra`
- Keep commits focused — schema changes + migration go together.
- Never commit `.env` files or secrets.

## Security

- All env vars validated via Zod in `src/config/env.ts`. Add new vars there with appropriate validation.
- JWT secret must be at least 32 characters; the default is rejected in production.
- Never log sensitive values (API keys, tokens, passwords).
- Swagger UI is disabled in production (`NODE_ENV === "production"`).
