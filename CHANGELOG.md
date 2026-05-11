## 4.1.0 (2026-05-11)

### Bug Fixes

* chat creation flow now falls back to `ensureChat(..., { createChat: true })` instead of the fragile `findChat(..., 'createChat')` path.
* `ensureChat` now creates the chat when `createChat` is enabled, while still reusing existing chats and resolving the LID first.
* version bumped to `4.1.0` and the production bundle was regenerated.

## 3.22.1 (2026-02-28)


### Bug Fixes

* getMessages (msgs.push is not a function) ([#3364](https://github.com/wppconnect-team/wa-js/issues/3364)) ([bdd2224](https://github.com/wppconnect-team/wa-js/commit/bdd222400e594e98b74cadc06a3a21eef3f2ecd8))



