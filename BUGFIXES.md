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
- **`contact.save()` STILL did not sync after the 4.2.5-zop fix (phoneNumber resolution)**: tested
  live, `WPP.contact.save()` saved locally but the phone still didn't get it. Diffing the payload
  `save()` builds against the already-proven-working manual bypass (`saveContactActionV2` called
  direct with the exact same fields) found two real gaps: (1) `lid` went as bare digits
  (`lid.user`), the proven bypass uses the serialized form (`<digits>@lid`); (2)
  `isConvertingContactType`/`isExistingContact` were never sent — not even part of the
  `SaveContactActionParamsV2` interface — but the native action's captured source (DevTools) shows
  it destructures `isConvertingContactType` together with `firstName`/`lastName` right at the top
  of the function body, suggesting it gates internal routing before the `phoneNumber` branch even
  runs. `save()` now sends serialized `lid` and always-explicit
  `isConvertingContactType: false`/`isExistingContact` (derived from `ContactModel.type === 'in'`),
  matching the payload that already synced live.
- **`contact.save()` still did not sync to the phone's address book after the fix below (4.2.5-zop)**:
  the version-branch fix removed the broken positional-argument call, but `phoneNumber`/`lid`
  resolution still used `ApiContact.getAlternateUserWid`/`lidPnCache` directly — cache-only, no
  server fallback. A `@lid` contact whose PN↔LID mapping hadn't reached this device yet resolved
  `phoneNumber` to `null` silently, so the native action still took the username-only (no-sync)
  branch even with the object-form fix in place. `save()` now resolves through `getPnLidEntry()`,
  which already does cache-first + `queryExists()` server fallback — and `getPnLidEntry()` itself
  was missing that fallback in the `@lid`→phoneNumber direction (only had it for `@c.us`→lid), so
  that was added too.
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
- **`global[chunkName] = chunk` (added by the previous fix above) could itself throw and kill the
  whole bundle**: current WhatsApp Web mostly runs on the Meta/Haste module system, not classic
  webpack, so `webpackChunkwhatsapp_web_client` may exist as a non-writable/incompatible property
  rather than a plain mutable array. A plain assignment to a non-writable property throws in
  strict mode — and since `injectLoader()` runs at the very top of `src/index.ts` (the bundle's
  entry module), an uncaught throw there aborts the entire module before it finishes evaluating,
  so webpack's own `self.WPP = <entry exports>` bootstrap (which only runs after the entry module
  returns) never executes. `window.WPP` silently never exists, even though the `<script onload>`
  event still fires normally (load/error events reflect network fetch, not runtime exceptions).
  Both the reattachment and the priming `chunk.push(...)` are now wrapped in `try/catch`.

## Usage notes

- When sending to a plain number, the helper automatically adds the right suffix, so calls such as `sendTextMessage('5511999999999', 'Hello')` work without throwing.
- For new contacts, keep using `sendFileMessage` and `sendTextMessage`; the helper makes sure the chat and LID exist before sending, without extra chat-creation calls.

## Optimization notes

- LID resolution is reused within the same send flow, which reduces redundant internal API calls and keeps the helper lighter without changing behavior.
- If you need smaller bundles, consider code splitting with dynamic `import()` in downstream projects; the webpack size warnings are informational and do not block the build.
