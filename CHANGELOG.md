## 4.2.2-zop (2026-07-18)

### Bug Fixes

* `contact.save()` now syncs new/updated contacts to the phone's address book. The version-based
  branch that called the native `WAWebSaveContactAction` action with positional arguments was
  removed — the native action only accepts an object today, so that branch silently produced
  contacts that never reached the phone. Always uses the object form (`saveContactActionV2`) now.
* hardened `alternateWid?.server` access in `contact.save()` (was unguarded, could throw for
  LID-only contacts with no cached phone-number mapping).
* version bumped to `4.2.2-zop` and the production bundle was regenerated.

## 4.2.0-zop (2026-05-15)

### Bug Fixes

* chat creation flow now falls back to `ensureChat(..., { createChat: true })` instead of the fragile `findChat(..., 'createChat')` path.
* `ensureChat` now creates the chat when `createChat` is enabled, while still reusing existing chats and resolving the LID first.
* version bumped to `4.2.0-zop` and the production bundle was regenerated.

## 3.22.1 (2026-02-28)


### Bug Fixes

* getMessages (msgs.push is not a function) ([#3364](https://github.com/wppconnect-team/wa-js/issues/3364)) ([bdd2224](https://github.com/wppconnect-team/wa-js/commit/bdd222400e594e98b74cadc06a3a21eef3f2ecd8))



