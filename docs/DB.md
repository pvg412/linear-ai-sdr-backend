# Prisma schema description

---

## User
**Purpose:** user of the system (owner of chats, creator of leads/searches).

---

## LeadSearch
**Purpose:** entity "lead search" (query + limit + status + thread binding).

---

## LeadSearchRun
**Purpose:** attempt to execute `LeadSearch` for a specific provider (attempt/fallback), stores request/response metadata.

---

## Lead
**Purpose:** normalized lead card in your DB (uniqueness by email / linkedin).

---

## LeadProviderRef
**Purpose:** connects Lead with external provider ID (for idempotency).

---

## LeadSearchLead
**Purpose:** join table "which leads entered a specific LeadSearch" + status/assignment/notes.

---

## LeadSearchRunResult
**Purpose:** join table "which leads returned a specific run" + raw provider data.

---

## LeadProviderCapability
**Purpose:** reference "which provider supports which kind", with label/description.

---

## ChatThread
**Purpose:** chat/thread of messages (in the current schema may be in a folder).

---

## ChatMessage
**Purpose:** message in the chat (TEXT / JSON / EVENT), may be related to LeadSearch.
