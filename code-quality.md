# AGENTS.md (TypeScript)

This file defines how an agent should write TypeScript code that looks well-crafted, consistent, and maintainable. The goal is simple: ship changes that a strong human engineer would approve on first review.

## Prime directive
- **Match the existing repo style and architecture first.**
- Prefer boring, explicit code over clever abstractions.
- Optimize for correctness, readability, and maintainability.

## Before you write code
1. **Scan the local conventions**
   - Naming: files, exports, types, folders.
   - Error handling: thrown vs returned, retry policies, logging patterns.
   - Formatting: Prettier, ESLint rules, import order.
2. **Confirm the boundary and ownership**
   - Where does data enter and leave the system (HTTP, WebSocket, storage, IPC)?
   - Which module should own state and which should be pure?

## TypeScript quality bar
### Types
- Use **strict TypeScript** assumptions:
  - No `any` unless there is a documented reason and it is isolated.
  - Prefer `unknown` at boundaries, then validate and narrow.
  - Use discriminated unions for message types and state machines.
- Keep exported APIs tight:
  - Export types that represent the contract.
  - Avoid exporting mutable singletons or internal state objects.

### Runtime validation at boundaries
- Validate all inbound data:
  - HTTP request bodies and query params
  - WebSocket messages
  - storage reads
  - `postMessage`/IPC payloads
- Prefer a schema validator (zod/valibot) where practical.
- If not using a validator, write explicit type guards that validate required fields, not just a `type` string.

### Async correctness
- No floating promises.
- Make cancellation explicit when relevant (AbortController, timeouts).
- Be intentional about retries and backoff, never infinite retry loops.

## Code structure rules
### Modularity
- Put side effects behind thin adapters:
  - `fetch`, `WebSocket`, storage, filesystem, browser APIs
- Keep core logic in pure functions that can be unit-tested.

### Avoid pointless abstractions
Do not introduce:
- helper functions that just rename parameters
- wrappers that add no behavior
- “generic utils” that are used once

If a new helper exists, it must reduce duplication meaningfully or centralize policy.

### Comments
- No narration comments that restate the code.
- Comments must explain:
  - why a decision exists
  - constraints
  - tradeoffs
  - edge cases

## Testing expectations
- Add tests for:
  - state transitions
  - protocol parsing/validation
  - retry/backoff logic
  - tricky edge cases and regression fixes
- Prefer unit tests over integration tests unless the bug is integration-specific.
- Tests should read like specs: clear names, clear setup, minimal mocking.

## Tooling and hygiene
### Lint, format, typecheck
- Ensure there is a single command that gates quality:
  - typecheck
  - lint
  - format check
  - tests
- Keep config changes minimal and consistent.

### Diff hygiene
- Keep PRs small and scoped.
- Avoid large reformats mixed with behavior changes.
- Remove:
  - unused imports
  - dead code
  - placeholder variables
  - TODO spam

## Protocols and message passing
- Centralize protocol definitions in a single module.
- Add a protocol version if the system could evolve.
- Treat all inbound messages as untrusted.
- Prefer explicit result envelopes:
  - `{ ok: true, data }` or `{ ok: false, error }`

## Error handling policy
- Categorize errors:
  - transient (retryable)
  - auth/protocol (not retryable)
  - unexpected (log once, fail safe)
- Log with stable fields:
  - component
  - context
  - attempt
  - identifiers (requestId, sessionId) when safe
- Never log secrets.

## Final “human polish” pass (required)
Before finishing:
1. Read the diff top to bottom as a reviewer.
2. Rename anything ambiguous.
3. Delete redundancy and narration comments.
4. Verify types are tight and boundaries are validated.
5. Run: typecheck + lint + format check + tests.
6. Ensure commit message explains intent, not implementation detail.

## Output expectations
- Code should be consistent, minimal, and testable.
- A reviewer should be able to answer:
  - what changed
  - why it changed
  - how it fails
  - how it is tested
