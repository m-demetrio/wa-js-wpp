# Native Flow Buttons

This branch contains an experimental patch for sending `interactiveMessage.nativeFlowMessage` payloads in WA-JS.

## Data model

- `hydratedButtons` is the legacy/template-oriented shape used so the sender device can render buttons locally.
- `nativeFlowMessage` is the newer payload format that WhatsApp Web expects for interactive buttons.
- `prepareMessageButtons()` keeps both shapes on the message object so local rendering still works.

## Why the `viewOnceMessage` wrapper matters

The button payload is wrapped into:

```ts
viewOnceMessage: {
  message: {
    interactiveMessage,
  },
}
```

That wrapper is required for the protobuf serialization path used by WhatsApp Web.

## Why the `biz` stanza node matters

The payload alone is not enough. The stanza also needs a `biz` node with:

- `interactive` attrs `{ type: 'native_flow', v: '1' }`
- nested `native_flow` attrs `{ v: '9', name: nativeFlowName }`

Without this node, the message may look correct locally but fail to deliver or render on the recipient side.

## Native flow name

The patch derives a `nativeFlowName` from the button types:

- all `quick_reply` buttons -> `quick_reply`
- all `cta_url` buttons -> `cta_url`
- mixed button types -> `mixed`

## Scope

This implementation is experimental and may break when WhatsApp Web changes its protobuf or stanza layout.

