# Bugfix Notes

## Overview

These fixes stabilize sending flows for new contacts or contacts migrated to LID and reduce failures caused by internal module changes when the WhatsApp Web bundle changes. They cover text, files, PTT/audio, short video/PTV, and label operations.

## Applied changes

- **Chat ID normalization**: any numeric or suffixed identifier (`@c.us`, `@g.us`, `@lid`) is converted to a `Wid` before fetching or creating the chat. This prevents `Invalid wid` errors and avoids duplicate chats for the same contact.
- **LID resolution before storage writes**: whenever a chat belongs to a user, the LID is resolved or reused from the contact to keep storage aligned with WhatsApp Web and avoid "Chat not found" during message sends or label updates.
- **Safe chat creation fallback**: operations that need a chat, such as media sending, archive, pin, mark read/recording, and labels, go through the centralized `ensureChat` helper. Existing chats are reused and a new one is created only when required.
- **PN/LID lookup hardening**: read paths that still depended on exact `ChatStore.get(wid)` matches now reuse local PN/LID candidates before returning `undefined`, which keeps list, label count, and last-seen lookups aligned with the store that WhatsApp Web actually uses.
- **PTT and PTV compatibility**: chat resolution is unified so PTT audio and PTV video use the same safe LID resolution path, avoiding media-specific failures.
- **Resilient open and forward flows**: UI-facing functions like opening a chat, jumping to a message, starting from the first unread message, and forwarding messages also use the helper. They accept plain numbers or classic WIDs without duplication or `Invalid wid`.
- **Unread item normalization**: `chat.unread_count_changed` events now deduplicate by chat `_serialized`, and open-chat functions accept `ChatModel`, `Wid`, or a plain number, preventing errors when clicking unread notifications after a contact migrates to LID.
- **Internal module recovery**: module lookup heuristics for auth, network, and stream were widened to handle `default` exports or alternate names when the bundle is updated.
- **`contact.save()` did not sync to the phone's address book**: the version-branch in
  `contact/functions/save.ts` called the native `WAWebSaveContactAction` action with positional
  arguments for "legacy" WhatsApp Web versions. The current native action only accepts a single
  object parameter (`saveContactActionV2` and the old `saveContactAction` name resolve to the
  exact same native binding) — when the positional branch ran, the native function received a
  bare string instead of an object, so every property read as `undefined` and it silently fell
  into the username-only save path (creates/updates the local contact but never pushes it to the
  phone). Fixed by always calling `saveContactActionV2` with the object form, removing the
  version check and the dead positional branch entirely. Also hardened `alternateWid?.server`
  (was an unguarded property access that could throw for LID-only contacts with no cached
  phone-number mapping).
- **`injectLoader()` locked `loaderType = 'webpack'` prematurely, causing permanent injection
  timeout**: `webpack/index.ts` set `loaderType = 'webpack'` just because
  `window.webpackChunkwhatsapp_web_client` already had items when `injectLoader()` ran — before
  any real `webpackRequire` was captured (that only happens inside the chunk-push callback). Since
  that array almost always already has items by the time injection runs, this branch fired
  immediately on every load. Two consequences: (1) the `metaTimer` fallback (which detects
  `window.require`/`window.__d` — the Meta/Haste module system some WhatsApp Web builds use
  instead of classic webpack — and would have worked) only runs while `loaderType === 'unknown'`,
  so it died before ever getting a chance; (2) the webpack path itself never truly completed
  either, since `loaderType` was already "set" independent of whether the chunk-push callback ever
  fired. Net effect: `webpackRequire` stayed `undefined` forever, `isReady`/`isFullReady` never
  flipped `true`, and any consumer waiting on `onFullReady`/an injection-ready promise timed out
  permanently — worse with slower-loading sessions (e.g., large unread/history backlogs push the
  moment webpack chunks populate earlier relative to when the real handshake completes). Fixed by
  removing the premature assignment — `loaderType` is now only set inside the real chunk-push
  callback (webpack path) or by `metaTimer` (Meta/Haste path). Also fixed a related latent bug:
  the chunk array was never actually reattached to `global[webpackChunkwhatsapp_web_client]` when
  it didn't already exist (the prior code called `Object.defineProperty` with the array itself as
  the descriptor, which does not assign the property) — `global[chunkName] = chunk` now runs
  unconditionally so the later `chunk.push(...)` reaches the real webpack runtime once it loads.

## Usage notes

- When sending to a plain number, the helper automatically adds the right suffix, so calls such as `sendTextMessage('5511999999999', 'Hello')` work without throwing.
- For new contacts, keep using `sendFileMessage` and `sendTextMessage`; the helper makes sure the chat and LID exist before sending, without extra chat-creation calls.

## Optimization notes

- LID resolution is reused within the same send flow, which reduces redundant internal API calls and keeps the helper lighter without changing behavior.
- If you need smaller bundles, consider code splitting with dynamic `import()` in downstream projects; the webpack size warnings are informational and do not block the build.
