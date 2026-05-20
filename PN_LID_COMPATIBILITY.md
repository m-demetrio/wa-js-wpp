# PN/LID Compatibility Notes

## Problem Found

The branch already protects sending flows through `ensureChat`, `resolveChatLid`, and `findOrCreateLatestChatSafe`, but some read paths still assumed that the chat was stored under the exact Wid passed by the caller.

That assumption breaks when:

- the API receives a PN in `@c.us`;
- WhatsApp Web keeps the active chat record under `@lid`;
- label bookkeeping or list indexing compares a raw `parentId` or a direct `ChatStore.get()` result.

The result is a false negative lookup rather than a real missing chat.

## Files Changed

- [`src/chat/functions/get.ts`](./src/chat/functions/get.ts)
- [`src/chat/functions/list.ts`](./src/chat/functions/list.ts)
- [`src/chat/functions/getLastSeen.ts`](./src/chat/functions/getLastSeen.ts)
- [`src/chat/helpers/getWidCandidates.ts`](./src/chat/helpers/getWidCandidates.ts)
- [`src/chat/helpers/index.ts`](./src/chat/helpers/index.ts)
- [`src/labels/patch.ts`](./src/labels/patch.ts)
- [`BUGFIXES.md`](./BUGFIXES.md)

## What Changed

- `chat.get` now tries the requested Wid first, then reuses local contact information to resolve alternative PN/LID candidates before returning `undefined`.
- `chat.list` now falls back to a Wid-based comparison when the exact model reference is not found, which avoids pagination errors when the visible identifier differs from the stored one.
- `chat.getLastSeen` now goes through the same tolerant chat lookup path instead of querying the store directly.
- `patchLabelCount` now resolves label items through the tolerant chat lookup path before counting them as active chats.
- `getWidCandidates` was added as a small local helper to keep the PN/LID fallback logic consistent without creating a new async flow.

## Why This Was Done

- Keep the public API synchronous where it already was synchronous.
- Accept PN and LID as valid identifiers without forcing a global conversion policy.
- Reduce direct `ChatStore.get(wid)` assumptions in the code paths that still depended on exact serialized matches.
- Preserve the existing send pipeline, which is already guarded by `ensureChat`.

## Technical Risk

Low to medium.

- The lookup fallback only inspects in-memory contacts and chats.
- No network request was added to the synchronous `chat.get` path.
- The fallback order still prefers the exact Wid first, so the existing behavior remains the default.
- The remaining risk is around WhatsApp Web internals changing the shape of `ContactStore` or `LabelStore`.

## How To Test

Run the standard project checks first:

```bash
npm install
npm run lint
npm run build
npm test
```

Then validate in WhatsApp Web console:

1. `WPP.chat.get("55XXXXXXXXXXX@c.us")` when the chat is stored as `@c.us`.
2. `WPP.chat.get("55XXXXXXXXXXX@c.us")` when the contact has `lid` and the chat is stored as `@lid`.
3. `WPP.chat.get("55XXXXXXXXXXX@lid")` when the chat is stored as `@lid`.
4. `WPP.chat.list({ id: "55XXXXXXXXXXX@c.us" })` when the active chat is stored as `@lid`.
5. Label count and label listing against chats whose `parentId` points to `@c.us` or `@lid`.
6. Newsletter lookup still returns the newsletter chat unchanged.

## Scenarios Covered By The Code Change

- PN lookup through `chat.get`
- LID lookup through `chat.get`
- `chat.list` pagination anchor resolution
- label count resolution through `LabelStore` item parents
- last-seen lookup through tolerant chat resolution

## Scenarios That Still Need Attention Later

- Other direct `ChatStore.get(...)` call sites that are already working or are too hot to change without a dedicated test.
- The `shouldHaveAccountLid => false` patch in `src/chat/patch.ts`, which remains intentionally untouched.
- Any future label operation that starts comparing raw serialized IDs outside the current count/list path.
- Any WhatsApp Web update that changes the contact cache semantics for PN/LID mappings.
