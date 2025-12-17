## Provider Integrations (Lead DB)

### Goal
External lead databases (providers) all differ in filters, enums/allowlists, job flows (export/poll/download), and response formats.  
We isolate provider-specific logic to keep the core Lead DB flow consistent and safe.

### Core rules
- **No `any`**. Use `unknown + type guards` or **Zod** parsing.
- **Adapter must stay thin**: orchestration only, no heavy mapping/parsing inside it.
- **Client is HTTP-only**: network calls + polling + Zod validation of responses.
- **FilterMapper is input-only**: canonical filters → provider payload.
- **LeadMapper is output-only**: provider rows → `NormalizedLeadForCreate`.
- **Errors layer**: translate provider errors → `UserFacingError` when possible.
- Always keep the final output in **our unified Lead shape**.

### Guarantees (must have)
- **A: Runtime schema validation**  
  Every external response is parsed via **Zod** (in `*.schemas.ts` and used in `*.client.ts`).
- **B: Single normalization + validation layer**  
  Use `shared/leadNormalize.ts` for string/url/domain/email cleanup and `shared/leadValidate.ts`
  (`validateNormalizedLeads`) before returning leads from adapter.
- **C: Contract tests (fixtures)**  
  Each provider must have fixtures and tests to ensure schemas + mapping don’t drift.

---

## Recommended structure
src/capabilities/lead-db
shared/
polling.ts
axiosError.ts
leadNormalize.ts
leadValidate.ts
providers/
<provider>/
<provider>.adapter.ts
<provider>.client.ts
<provider>.filterMapper.ts
<provider>.schemas.ts
<provider>.leadMapper.ts
<provider>.errors.ts
allowlists/
resolvers/
fixtures/
tests/

---

## File responsibilities

### `<provider>.adapter.ts`
**Purpose:** entry point registered in the LeadDb orchestrator.  
**Does:**
- build payload via `filterMapper`
- execute provider flow via `client`
- map rows via `leadMapper`
- validate via `validateNormalizedLeads(...)`
- wrap known errors via `errors.ts`

**Does NOT:**
- HTTP calls, Zod schemas, large mapping logic.

---

### `<provider>.client.ts`
**Purpose:** provider protocol implementation (HTTP + polling + downloads).  
**Does:**
- call provider endpoints
- poll status via `shared/polling.ts`
- parse responses via Zod schemas (Guarantee A)

**Does NOT:**
- know about `LeadDbQuery` or `NormalizedLeadForCreate`.

---

### `<provider>.schemas.ts`
**Purpose:** runtime contract for provider responses (Zod).  
**Does:**
- define and export schemas + inferred types
- use `z.object` / `z.looseObject` (avoid deprecated `.passthrough()`)

---

### `<provider>.filterMapper.ts`
**Purpose:** canonical filters → provider payload.  
**Does:**
- read `query.filters` (preferred) and `query.apolloFilters` (legacy)
- apply allowlists/resolvers
- optionally support `query.providerOverrides[PROVIDER]` (rare)

**Does NOT:**
- HTTP calls or lead validation.

---

### `<provider>.leadMapper.ts`
**Purpose:** provider rows → `NormalizedLeadForCreate[]`.  
**Does:**
- map fields into our standard Lead shape
- use `shared/leadNormalize.ts`

**Does NOT:**
- parse provider rows with Zod (client already does)
- call `validateNormalizedLeads` (adapter does).

---

### `<provider>.errors.ts`
**Purpose:** provider error translation.  
**Does:**
- detect axios errors via `shared/axiosError.ts`
- map known cases to `UserFacingError`

---

## Contract tests (Guarantee C)
Each provider must include:

**Fixtures** (`providers/<provider>/__fixtures__/`):
- `start.response.json` (optional)
- `status.response.json` (optional)
- `rows.response.json` (required)
- `error.response.json` (required for at least one known failure)

**Contract test** (`providers/<provider>/__tests__/<provider>.contract.spec.ts`):
- parse fixtures with `*.schemas.ts` (Guarantee A)
- map rows with `*.leadMapper.ts`
- validate with `validateNormalizedLeads({ mode: "strict" })` (Guarantee B)
- test `errors.ts` wrapping on the error fixture

**Fixture rules:**
- strip PII (real emails/phones), no tokens/keys
- keep shape close to real provider responses

---

## Checklist for a new provider
1) Add env vars + Zod env validation (`src/config/env.ts`)
2) Implement: `schemas`, `client`, `filterMapper`, `leadMapper`, `errors`, `adapter`
3) Register adapter in DI (`src/container.ts`)
4) Add fixtures + contract tests
5) Run `pnpm test`
