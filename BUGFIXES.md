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

## Usage notes

- When sending to a plain number, the helper automatically adds the right suffix, so calls such as `sendTextMessage('5511999999999', 'Hello')` work without throwing.
- For new contacts, keep using `sendFileMessage` and `sendTextMessage`; the helper makes sure the chat and LID exist before sending, without extra chat-creation calls.

## Optimization notes

- LID resolution is reused within the same send flow, which reduces redundant internal API calls and keeps the helper lighter without changing behavior.
- If you need smaller bundles, consider code splitting with dynamic `import()` in downstream projects; the webpack size warnings are informational and do not block the build.
