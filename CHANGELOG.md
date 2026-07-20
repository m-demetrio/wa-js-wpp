## 4.2.6-zop (2026-07-20)

### Bug Fixes

* `contact.save()` still did not sync after 4.2.5-zop fixed `phoneNumber` resolution — testado ao
  vivo, `WPP.contact.save()` salvou local mas não sincronizou com o telefone. Comparando o payload
  que `save()` monta com o payload já comprovado (bypass manual `saveContactActionV2` direto) achei
  duas diferenças reais: (1) `lid` ia como `<digits>` (`lid.user`), o bypass testado usa a forma
  serializada `<digits>@lid`; (2) `isConvertingContactType`/`isExistingContact` nunca eram
  enviados — nem faziam parte da interface `SaveContactActionParamsV2` — mas a captura via
  DevTools da ação nativa (`BUGFIXES.md`) mostra que ela desestrutura `isConvertingContactType`
  junto com `firstName`/`lastName` logo no início do corpo, sinal de que participa do roteamento
  interno antes mesmo do branch `phoneNumber`. `save()` agora envia `lid` serializado e
  `isConvertingContactType: false`/`isExistingContact` (deduzido de `ContactModel.type === 'in'`)
  sempre explícitos, igual ao payload que já sincronizou ao vivo.
* version bumped to `4.2.6-zop` and the production bundle was regenerated.

## 4.2.5-zop (2026-07-20)

### Bug Fixes

* `contact.save()` still did not sync to the phone's address book even after 4.2.2-zop fixed the
  positional-argument branch: `phoneNumber`/`lid` resolution in `contact/functions/save.ts` used
  `ApiContact.getAlternateUserWid`/`lidPnCache`, which only reads the LID↔phoneNumber mapping from
  local device cache — no server fallback. For contacts recently migrated to `@lid` whose mapping
  hadn't reached this device yet, resolution silently returned `null` for `phoneNumber`; the native
  action then took the username-only branch (saves locally, never syncs to the phone) with no
  error. `save()` now resolves via `getPnLidEntry()` (cache-first, falls back to `queryExists()`
  against the server) instead of the synchronous cache-only lookup.
* `getPnLidEntry()` itself had the same gap in the `@lid` direction: given a `@lid` id, it only
  checked `lidPnCache.getPhoneNumber()` (local cache) with no fallback, unlike the `@c.us` branch
  which already called `queryExists()` on a cache miss. Added the matching server fallback so both
  directions (`@c.us`→lid and `@lid`→phoneNumber) behave the same way.
* version bumped to `4.2.5-zop` and the production bundle was regenerated.

## 4.2.4-zop (2026-07-18)

### Bug Fixes

* `injectLoader()` no longer throws when `webpackChunkwhatsapp_web_client` exists as a
  non-writable property (or is otherwise incompatible) — current WhatsApp Web builds mostly run
  on the Meta/Haste module system (`__d`/`require`), not classic webpack, so this array may not
  behave like a plain array at all. An uncaught throw here previously aborted the whole entry
  module (`injectLoader()` runs at the top of `src/index.ts`), which meant `self.WPP = ...`
  (webpack's own bootstrap, which only runs after the entry module finishes) never executed —
  `window.WPP` silently never existed, even though the `<script onload>` event still fired
  normally. Both the reattachment (`global[chunkName] = chunk`) and the priming `chunk.push(...)`
  are now wrapped in `try/catch` so a failure here can't take down the whole bundle; the `metaTimer`
  fallback still gets its chance either way.
* version bumped to `4.2.4-zop` and the production bundle was regenerated.

## 4.2.3-zop (2026-07-18)

### Bug Fixes

* `injectLoader()` no longer locks `loaderType` to `'webpack'` just because
  `webpackChunkwhatsapp_web_client` already had items — that happened before any real
  `webpackRequire` was captured and permanently killed the `metaTimer` fallback, causing injection
  to time out forever on builds that need the Meta/Haste (`__d`/`require`) path.
* `global[webpackChunkwhatsapp_web_client]` is now actually reassigned when the chunk array didn't
  exist yet (previous `Object.defineProperty` call was a no-op — passed the array itself as the
  descriptor instead of assigning the property).
* version bumped to `4.2.3-zop` and the production bundle was regenerated.

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



