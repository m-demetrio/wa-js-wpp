# Native Flow Buttons — Investigação e Estado Atual

Branch: `fix/native-flow-buttons`  
Baseado em: `c2444e944e`  
Última atualização: 2026-05-21

---

## Contexto

Os botões interativos (`quick_reply`, `cta_url`, `cta_call`, `cta_copy`) enviados via `WPP.chat.sendTextMessage` com opção `buttons` estavam falhando com:

```
ack: -1
messageSendResult: ERROR_UNKNOWN
```

O objetivo era fazê-los enviar com `ack: 1` e `messageSendResult: 'OK'`.

---

## O que funciona como referência

### `sendPixKeyMessage`

Usa o seguinte rawMessage e funciona (`ack: 1`):

```typescript
{
  type: 'interactive',
  caption: '',                    // ← VAZIO — crítico
  nativeFlowName: 'payment_info',
  interactiveType: 'native_flow',
  interactivePayload: {
    buttons: [{ buttonParamsJson: '...', name: 'payment_info' }],
    messageVersion: 1,
  },
  messageSecret: Uint8Array(32),  // ← sem subtype, urlText, urlNumber
}
```

### Dica dos mantenedores (grupo WPPConnect — Pedro / Edgard)

- O **biz node** precisa ser adicionado em `prepareMessageButtons.ts`
- O formato do biz node é: `biz > interactive[type=native_flow, v=1] > native_flow[name=flowName]`
- Para chats privados (1:1), também é necessário o **bot node**: `bot[biz_bot='1']`
- O **payload tem que estar correto** — Pedro criou `sendCarrossel.ts` como exemplo
- Edgard confirmou: fazendo isso os botões voltaram a funcionar (testado com ✓✓ no celular do remetente)
- Nota: destinatários no **WhatsApp Web veem "não é possível exibir essa mensagem"** — isso é **normal/esperado** para native flow

---

## Causa raiz identificada

### Caption não vazia → conflito de proto

Quando `message.caption` é não vazio em uma mensagem `type: 'interactive'`, o `createMsgProtobuf` do WA gera um campo `conversation` ou `extendedTextMessage` **junto** com `viewOnceMessage.message.interactiveMessage`.

O servidor WA rejeita a mensagem com `ERROR_UNKNOWN` pois dois campos de conteúdo estão presentes no proto ao mesmo tempo.

### Campos extras do `sendTextMessage`

`sendTextMessage` inicializa o rawMessage com `subtype: null`, `urlText: null`, `urlNumber: null`. O `sendPixKeyMessage` não tem esses campos. Eles podem fazer o WA tomar um caminho de serialização diferente.

---

## Commits realizados (do mais antigo ao mais novo)

| Hash | Descrição |
|------|-----------|
| `c06ef892ff` | Reescrita inicial: native flow com biz/bot node injection |
| `63180df2ed` | Removeu biz/bot (teste) — Pix voltou, botões continuaram falhando |
| `00efe1f06c` | Restaurou biz/bot + delete do campo `body` |
| `b596e39001` | **Fix de regressão do Pix**: adicionou flag `_wppNativeFlowBizBot` para escopar a injeção de biz/bot apenas para mensagens de `prepareMessageButtons` |
| `7e6816375b` | Adicionou wrapper `createMsgProtobuf` para limpar `conversation`/`extendedTextMessage` e injetar caption no body |
| `68d943d550` | **Fix principal**: `caption: ''` (vazio como Pix) + delete `subtype`/`urlText`/`urlNumber` + body/title/footer guardados em `_wppBodyText`/`_wppTitleText`/`_wppFooterText` para injeção no wrapper |

---

## Estado atual do código

### `prepareMessageButtons.ts` — caminho texto (`message.type === 'chat'`)

```typescript
const text = (message as any).body || message.caption || '';
delete (message as any).body;
delete (message as any).subtype;    // ← novo
delete (message as any).urlText;    // ← novo
delete (message as any).urlNumber;  // ← novo

message.type = 'interactive' as any;
message.caption = '';               // ← VAZIO (antes era = text)
message.title = options.title;
message.footer = options.footer;
(message as any).nativeFlowName = flowName;
(message as any).interactiveType = 'native_flow';
(message as any).interactivePayload = { buttons: nativeFlowButtons, messageVersion: 1 };
(message as any).messageSecret = self.crypto.getRandomValues(new Uint8Array(32));
message.isFromTemplate = false;
(message as any)._wppBodyText = text;           // ← novo
(message as any)._wppTitleText = options.title || '';  // ← novo
(message as any)._wppFooterText = options.footer || ''; // ← novo
(message as any)._wppNativeFlowBizBot = true;
```

### Wrapper `createMsgProtobuf` — branch `_wppNativeFlowBizBot`

```typescript
} else if ((message as any)?._wppNativeFlowBizBot) {
  // Limpeza defensiva
  if (typeof r.conversation !== 'undefined') delete r.conversation;
  if (typeof r.extendedTextMessage !== 'undefined') delete r.extendedTextMessage;

  // Injeta body/title/footer no interactiveMessage
  const bodyText = (message as any)._wppBodyText || '';
  const titleText = (message as any)._wppTitleText || '';
  const footerText = (message as any)._wppFooterText || '';
  const interactive = r.viewOnceMessage?.message?.interactiveMessage || r.interactiveMessage;
  if (interactive) {
    if (bodyText) { if (!interactive.body) interactive.body = {}; interactive.body.text = bodyText; }
    if (titleText) { if (!interactive.header) interactive.header = {}; interactive.header.title = titleText; }
    if (footerText) { if (!interactive.footer) interactive.footer = {}; interactive.footer.text = footerText; }
  }
}
```

### Wrapper `createFanoutMsgStanza` — injeção biz/bot

```typescript
if (isNativeFlow && message?._wppNativeFlowBizBot && Array.isArray(stanza?.content)) {
  const flowName = getNativeFlowName(proto, message);
  if (!hasNativeFlowBizNode(stanza)) stanza.content.push(createNativeFlowBizNode(flowName));
  if (isPrivateChat(message, stanza) && !hasBotNode(stanza)) stanza.content.push(createBotNode());
  return result;
}
if (isNativeFlow && !message?._wppNativeFlowBizBot) return result; // Pix passa sem biz/bot
```

---

## Status dos testes

| Funcionalidade | Status |
|----------------|--------|
| `sendPixKeyMessage` | ✅ `ack: 1` (funcionando após `b596e39001`) |
| `sendTextMessage` com botões (`quick_reply`) | ❌ Ainda não confirmado com `ack: 1` |
| `sendTextMessage` com botões (`cta_url`) | ❌ Ainda não confirmado |

> **Nota**: o commit `68d943d550` (caption vazia) ainda **não foi testado** pelo usuário.

---

## Próximos passos sugeridos

Se `68d943d550` ainda não resolver, a próxima estratégia é adicionar logs de diagnóstico dentro do wrapper `createMsgProtobuf` para comparar o proto gerado para botões vs. Pix:

```javascript
// Colar no DevTools após injetar o bundle
// Interceptar temporariamente para ver o proto
```

### O que verificar no proto

1. `r.viewOnceMessage?.message?.interactiveMessage` existe?
2. `r.conversation` ou `r.extendedTextMessage` ainda aparecem?
3. `interactiveMessage.nativeFlowMessage.buttons` está populado?
4. Estrutura do stanza (biz/bot nodes presentes)?

### Comparação direta Pix vs Botão

Adicionar `console.log('proto:', JSON.stringify(r))` dentro do wrapper para ambos os casos e comparar os objetos.

---

## Como testar no Chrome DevTools

```javascript
// 1. Injete o dist/wppconnect-wa.js no console do WhatsApp Web

// 2. Teste botões
const r = await WPP.chat.sendTextMessage('5511XXXXXXXXX@c.us', 'Escolha:', {
  buttons: [
    { id: '1', text: 'Opção 1' },
    { id: '2', text: 'Opção 2' },
  ]
});
console.log('ack:', r.ack, 'result:', await r.sendMsgResult);

// 3. Teste Pix (não pode regredir)
const p = await WPP.chat.sendPixKeyMessage('5511XXXXXXXXX@c.us', {
  keyType: 'CPF',
  name: 'Teste',
  key: '12345678900',
});
console.log('pix ack:', p.ack, 'result:', await p.sendMsgResult);
```

**Esperado**: `ack: 1` e `messageSendResult: 'OK'` para ambos.
