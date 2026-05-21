/*!
 * Copyright 2024 WPPConnect Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { WPPError } from '../../util';
import * as webpack from '../../webpack';
import { websocket } from '../../whatsapp';
import { DROP_ATTR } from '../../whatsapp/contants';
import { wrapModuleFunction } from '../../whatsapp/exportModule';
import {
  createFanoutMsgStanza,
  createMsgProtobuf,
  encodeMaybeMediaType,
  getABPropConfigValue,
  mediaTypeFromProtobuf,
  typeAttributeFromProtobuf,
} from '../../whatsapp/functions';
import { RawMessage } from '..';

export type MessageButtonsTypes =
  | {
      id: string;
      text: string;
    }
  | {
      phoneNumber: string;
      text: string;
    }
  | {
      url: string;
      text: string;
    }
  | {
      code: string;
      text: string;
    };

export interface MessageButtonsOptions {
  /**
   * List of buttons, with at least 1 option and a maximum of 3
   */
  buttons?: Array<MessageButtonsTypes>;
  /**
   * Title for buttons, only for text message
   */
  title?: string;
  /**
   * Footer text for buttons
   */
  footer?: string;
}

// ---------------------------------------------------------------------------
// Button builder
// ---------------------------------------------------------------------------

type NativeFlowButton = { name: string; buttonParamsJson: string };

function buildNativeFlowButtons(
  buttons: Array<MessageButtonsTypes>
): NativeFlowButton[] {
  return buttons.map((button, index) => {
    if ('phoneNumber' in button) {
      return {
        name: 'cta_call',
        buttonParamsJson: JSON.stringify({
          display_text: button.text,
          phone_number: button.phoneNumber,
        }),
      };
    }
    if ('url' in button) {
      return {
        name: 'cta_url',
        buttonParamsJson: JSON.stringify({
          display_text: button.text,
          url: button.url,
          merchant_url: button.url,
        }),
      };
    }
    if ('code' in button) {
      return {
        name: 'cta_copy',
        buttonParamsJson: JSON.stringify({
          display_text: button.text,
          copy_code: button.code,
        }),
      };
    }
    return {
      name: 'quick_reply',
      buttonParamsJson: JSON.stringify({
        display_text: button.text,
        id: (button as any).id || `${index}`,
      }),
    };
  });
}

function primaryFlowName(buttons: NativeFlowButton[]): string {
  if (buttons.length === 0) return 'quick_reply';
  const names = buttons.map((b) => b.name);
  return names.every((n) => n === names[0]) ? names[0] : 'mixed';
}

// ---------------------------------------------------------------------------
// Proto helpers
// ---------------------------------------------------------------------------

function getInteractiveFromProto(proto: any) {
  return (
    proto?.viewOnceMessage?.message?.interactiveMessage ||
    proto?.interactiveMessage
  );
}

// ---------------------------------------------------------------------------
// Stanza helpers
// ---------------------------------------------------------------------------

function hasNativeFlowInProto(proto: any): boolean {
  return Boolean(
    getInteractiveFromProto(proto)?.nativeFlowMessage?.buttons?.length
  );
}

function hasNativeFlowInMessage(message: any): boolean {
  return Boolean(
    message?.nativeFlowName ||
    (message?.interactiveType === 'native_flow' &&
      message?.interactivePayload?.buttons?.length)
  );
}

function getNativeFlowName(proto: any, message: any): string {
  const protoButtons =
    getInteractiveFromProto(proto)?.nativeFlowMessage?.buttons ?? [];
  if (protoButtons.length > 0) {
    const names = protoButtons
      .map((b: any) => b?.name)
      .filter((n: any): n is string => typeof n === 'string' && !!n);
    if (names.length > 0)
      return names.every((n: string) => n === names[0]) ? names[0] : 'mixed';
  }
  if (message?.nativeFlowName) return message.nativeFlowName;
  const payloadBtns = message?.interactivePayload?.buttons ?? [];
  const pn = payloadBtns
    .map((b: any) => b?.name)
    .filter((n: any): n is string => typeof n === 'string' && !!n);
  if (pn.length > 0)
    return pn.every((n: string) => n === pn[0]) ? pn[0] : 'mixed';
  return 'quick_reply';
}

function getChatWid(message: any, stanza?: websocket.WapNode) {
  return (
    message?.id?.remote ||
    message?.to ||
    message?.from ||
    stanza?.attrs?.to ||
    stanza?.attrs?.from
  );
}

function isPrivateChat(message: any, stanza?: websocket.WapNode): boolean {
  const wid = getChatWid(message, stanza);
  if (!wid) return false;
  if (typeof wid.isUser === 'function') return wid.isUser();
  if (typeof wid === 'string')
    return /@(c\.us|lid|bot|hosted|hosted\.lid)$/.test(wid);
  return false;
}

function hasNativeFlowBizNode(stanza: websocket.WapNode): boolean {
  if (!Array.isArray(stanza.content)) return false;
  return stanza.content.some((node: websocket.WapNode) => {
    const interactive = Array.isArray(node?.content)
      ? node.content.find(
          (child: websocket.WapNode) => child?.tag === 'interactive'
        )
      : undefined;
    return node?.tag === 'biz' && interactive?.attrs?.type === 'native_flow';
  });
}

function hasBotNode(stanza: websocket.WapNode): boolean {
  return Array.isArray(stanza.content)
    ? stanza.content.some((n: websocket.WapNode) => n?.tag === 'bot')
    : false;
}

function createNativeFlowBizNode(flowName: string): websocket.WapNode {
  return {
    tag: 'biz',
    attrs: {},
    content: [
      {
        tag: 'interactive',
        attrs: { type: 'native_flow', v: '1' },
        content: [
          {
            tag: 'native_flow',
            attrs: { name: flowName },
            content: undefined,
          },
        ],
      },
    ],
  } as unknown as websocket.WapNode;
}

function createBotNode(): websocket.WapNode {
  return {
    tag: 'bot',
    attrs: { biz_bot: '1' },
    content: undefined,
  } as unknown as websocket.WapNode;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Prepare a message for buttons
 *
 * @category Message
 * @internal
 */
export function prepareMessageButtons<T extends RawMessage>(
  message: T,
  options: MessageButtonsOptions
): T {
  if (!options.buttons) {
    return message as any;
  }

  if (!Array.isArray(options.buttons)) {
    throw new WPPError('buttons_not_a_array', 'Buttons options is not a array');
  } else if (message.type !== 'chat' && options.buttons.length > 2) {
    throw new WPPError(
      'not_alowed_more_then_three_buttons',
      'Not allowed more then three buttons in file messages'
    );
  } else if (options.buttons.length === 0 || options.buttons.length > 3) {
    throw new WPPError(
      'buttons_must_between_1_and_3_options',
      'Buttons options must have between 1 and 3 options'
    );
  } else if (
    options.buttons.find((i: any) => i.phoneNumber || i.url) &&
    options.buttons.find((i: any) => i.id && i.text)
  ) {
    throw new WPPError(
      'reply_and_cta_btn_not_allowed',
      'It is not possible to send reply buttons and action buttons togetherButtons options must have between 1 and 3 options'
    );
  }

  const nativeFlowButtons = buildNativeFlowButtons(options.buttons);
  const flowName = primaryFlowName(nativeFlowButtons);

  if (message.type === 'chat') {
    // Extract text before clearing the original body field.
    // WA's createMsgProtobuf would also produce a conversation/extendedTextMessage
    // from `body`, creating a conflicting proto alongside the interactiveMessage
    // and causing ERROR_UNKNOWN from the server.
    const text = (message as any).body || message.caption || ' ';
    delete (message as any).body;

    message.type = 'interactive' as any;
    message.caption = text;
    message.title = options.title;
    message.footer = options.footer;
    (message as any).nativeFlowName = flowName;
    (message as any).interactiveType = 'native_flow';
    (message as any).interactivePayload = {
      buttons: nativeFlowButtons,
      messageVersion: 1,
    };
    (message as any).messageSecret = self.crypto.getRandomValues(
      new Uint8Array(32)
    );
    message.isFromTemplate = false;
    // Marker used by createFanoutMsgStanza to inject biz/bot only for button
    // messages — prevents interfering with other native-flow types (e.g. Pix).
    (message as any)._wppNativeFlowBizBot = true;
    return message;
  }

  // Media message: set interactiveMessage so the createMsgProtobuf wrapper
  // can embed the media into the header and wrap in viewOnceMessage.
  message.title = options.title;
  message.footer = options.footer;
  message.interactiveMessage = {
    header: {
      title: options.title || ' ',
      hasMediaAttachment: false,
    },
    body: {
      text: message.body || message.caption || ' ',
    },
    footer: {
      text: options.footer || ' ',
    },
    nativeFlowMessage: {
      buttons: nativeFlowButtons,
    },
  };
  message.isFromTemplate = false;
  (message as any)._wppNativeFlowBizBot = true;

  return message;
}

// ---------------------------------------------------------------------------
// Webpack module patches
// ---------------------------------------------------------------------------

webpack.onFullReady(() => {
  // 1. For media messages: move media content into interactiveMessage.header
  //    and wrap the proto in viewOnceMessage.
  wrapModuleFunction(createMsgProtobuf, (func, ...args) => {
    const [message] = args;
    const r = func(...args);

    if (message.interactiveMessage?.nativeFlowMessage?.buttons !== undefined) {
      const mediaParts = [
        'documentMessage',
        'documentWithCaptionMessage',
        'imageMessage',
        'locationMessage',
        'videoMessage',
      ];

      for (let part of mediaParts) {
        if (part in r) {
          const partName = part;
          if (part === 'documentWithCaptionMessage') part = 'documentMessage';
          message.interactiveMessage.header = {
            ...message.interactiveMessage.header,
            [`${part}`]: r[partName]?.message?.documentMessage || r[partName],
            hasMediaAttachment: true,
          };
          delete r[partName];
          break;
        }
      }

      if (typeof r.extendedTextMessage !== 'undefined')
        delete r.extendedTextMessage;
      if (typeof r.conversation !== 'undefined') delete r.conversation;

      r.viewOnceMessage = {
        message: {
          interactiveMessage: message.interactiveMessage,
        },
      };
    }

    return r;
  });

  // 2. Drop legacy 'button' media-type attribute.
  wrapModuleFunction(encodeMaybeMediaType, (func, ...args) => {
    const [type] = args;
    if (type === 'button') return DROP_ATTR;
    return func(...args);
  });

  // 3. Fix mediaTypeFromProtobuf for documentWithCaption template messages.
  wrapModuleFunction(mediaTypeFromProtobuf, (func, ...args) => {
    const [proto] = args;
    if (
      proto.documentWithCaptionMessage?.message?.templateMessage
        ?.hydratedTemplate
    ) {
      return func(
        proto.documentWithCaptionMessage.message.templateMessage
          .hydratedTemplate
      );
    }
    return func(...args);
  });

  // 4. Correct stanza type attribute for interactive messages.
  wrapModuleFunction(typeAttributeFromProtobuf, (func, ...args) => {
    const [proto] = args;

    const interactive = getInteractiveFromProto(proto);
    if (interactive) {
      const keys = Object.keys(interactive);
      const mediaParts = [
        'documentMessage',
        'documentWithCaptionMessage',
        'imageMessage',
        'locationMessage',
        'videoMessage',
      ];
      return mediaParts.some((p) => keys.includes(p)) ? 'media' : 'text';
    }

    if (
      proto?.documentWithCaptionMessage?.message?.templateMessage
        ?.hydratedTemplate
    ) {
      const keys = Object.keys(
        proto.documentWithCaptionMessage.message.templateMessage
          .hydratedTemplate
      );
      const mediaParts = [
        'documentMessage',
        'imageMessage',
        'locationMessage',
        'videoMessage',
      ];
      return mediaParts.some((p) => keys.includes(p)) ? 'media' : 'text';
    }

    if (
      proto?.buttonsMessage?.headerType === 1 ||
      proto?.buttonsMessage?.headerType === 2
    ) {
      return 'text';
    }

    return func(...args);
  });

  // 5. Inject biz/bot stanza nodes for native flow messages.
  //    The biz node signals the server that this stanza carries a native flow
  //    interactive message and is required for buttons to render on the
  //    recipient's device.  The bot node (private chats only) is also required
  //    per the WA protocol.
  //
  //    Legacy biz node for buttonsMessage / listMessage is preserved.
  wrapModuleFunction(createFanoutMsgStanza, async (func, ...args) => {
    const message = (args[0] as any)?.data || args[0];
    const proto: any = (args[0] as any)?.data ? args[1] : args[2];

    const isNativeFlow =
      hasNativeFlowInProto(proto) || hasNativeFlowInMessage(message);

    // Legacy biz node for deprecated buttonsMessage / listMessage
    let legacyBizChild: websocket.WapNode | null = null;
    if (!isNativeFlow) {
      if (proto?.buttonsMessage) {
        legacyBizChild = websocket.smax('buttons');
      } else if (proto?.listMessage) {
        const listType = 2;
        const types = ['unknown', 'single_select', 'product_list'];
        legacyBizChild = websocket.smax('list', {
          v: '2',
          type: types[listType],
        });
      }
    }

    const result = await func(...args);

    if (!isNativeFlow && !legacyBizChild) {
      return result;
    }

    const stanza: websocket.WapNode = (result as any)?.stanza || result;

    if (
      isNativeFlow &&
      message?._wppNativeFlowBizBot &&
      Array.isArray(stanza?.content)
    ) {
      const flowName = getNativeFlowName(proto, message);

      if (!hasNativeFlowBizNode(stanza)) {
        stanza.content.push(createNativeFlowBizNode(flowName));
      }

      // Private (1:1) chats require a bot node; groups must NOT have it
      if (isPrivateChat(message, stanza) && !hasBotNode(stanza)) {
        stanza.content.push(createBotNode());
      }

      return result;
    }

    if (isNativeFlow && !message?._wppNativeFlowBizBot) {
      return result;
    }

    // Legacy: inject biz > [buttons|list] node
    if (legacyBizChild) {
      const content: websocket.WapNode[] =
        (stanza.content as websocket.WapNode[]) ||
        (stanza as any).stanza.content;

      let bizNode = content.find((c) => c.tag === 'biz');
      if (!bizNode) {
        bizNode = websocket.smax('biz', {}, null);
        content.push(bizNode);
      }
      if (!Array.isArray(bizNode.content)) bizNode.content = [];
      const already = (bizNode.content as websocket.WapNode[]).some(
        (c) => c.tag === legacyBizChild!.tag
      );
      if (!already)
        (bizNode.content as websocket.WapNode[]).push(legacyBizChild);
    }

    return result;
  });

  // 6. Prevent WA from unwrapping the viewOnceMessage wrapper.
  wrapModuleFunction(getABPropConfigValue, (func, ...args) => {
    const [key] = args;
    if (key === 'web_unwrap_message_for_stanza_attributes') return false;
    return func(...args);
  });
});
