# Native Flow Quick Reply Patch

This experiment mirrors the Baileys/Whaileys patch sent by Pedro for a first-pass `quick_reply` test.

- Keep the interactive payload wrapped in `viewOnceMessage`.
- Add `biz -> interactive { type: 'native_flow', v: '1' }`.
- Add `native_flow { name: 'quick_reply' }`.
- Do not use `mixed`, `cta_url`, or an inner `v: '9'` on `native_flow`.

