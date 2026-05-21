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
// Internal helpers
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
// Stanza helpers (used inside webpack.onFullReady)
// ---------------------------------------------------------------------------

function getInteractiveFromProto(proto: any) {
  return (
    proto?.viewOnceMessage?.message?.interactiveMessage ||
    proto?.interactiveMessage
  );
}

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
  // 1. Media path: interactiveMessage was wrapped in viewOnceMessage by createMsgProtobuf
  const protoButtons =
    getInteractiveFromProto(proto)?.nativeFlowMessage?.buttons ?? [];
  if (protoButtons.length > 0) {
    const names = protoButtons
      .map((b: any) => b?.name)
      .filter((n: any): n is string => typeof n === 'string' && !!n);
    if (names.length > 0) {
      return names.every((n: string) => n === names[0]) ? names[0] : 'mixed';
    }
  }

  // 2. Text path: message model carries nativeFlowName / interactivePayload
  if (message?.nativeFlowName) return message.nativeFlowName;

  const payloadButtons = message?.interactivePayload?.buttons ?? [];
  const pNames = payloadButtons
    .map((b: any) => b?.name)
    .filter((n: any): n is string => typeof n === 'string' && !!n);
  if (pNames.length > 0) {
    return pNames.every((n: string) => n === pNames[0]) ? pNames[0] : 'mixed';
  }

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

  message.title = options.title;
  message.footer = options.footer;

  const nativeFlowButtons = buildNativeFlowButtons(options.buttons);
  const flowName = primaryFlowName(nativeFlowButtons);

  if (message.type === 'chat') {
    // Text message: use the same proven path as sendPixKeyMessage.
    // WA handles type:'interactive' + interactivePayload natively — no legacy
    // isFromTemplate flag, no TemplateButtonCollection, no ack:-1.
    message.type = 'interactive' as any;
    message.caption = message.body || message.caption || ' ';
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
    return message;
  }

  // Media message (image, video, document…): set interactiveMessage so the
  // createMsgProtobuf wrapper below can embed the media into the header and
  // wrap the whole thing in viewOnceMessage.
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

  return message;
}

// ---------------------------------------------------------------------------
// Webpack module patches
// ---------------------------------------------------------------------------

webpack.onFullReady(() => {
  // 1. Intercept protobuf build for media messages:
  //    move the media content into interactiveMessage.header, delete the top-
  //    level media key, add deviceListMetadata, wrap in viewOnceMessage.
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

      r.messageContextInfo = {
        ...(r.messageContextInfo || {}),
        deviceListMetadata: {},
        deviceListMetadataVersion: 2,
      };

      r.viewOnceMessage = {
        message: {
          interactiveMessage: message.interactiveMessage,
        },
      };
    }

    return r;
  });

  // 2. Drop legacy 'button' media-type attribute — keeps WA from mis-routing
  //    the stanza as a media upload.
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

  // 4. Return the correct stanza type attribute for interactive messages.
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

  // 5. Inject biz/bot stanza nodes required for native flow rendering on the
  //    recipient device.  Also keep legacy biz node injection for buttonsMessage
  //    and listMessage for backward compatibility.
  wrapModuleFunction(createFanoutMsgStanza, async (func, ...args) => {
    // createFanoutMsgStanza args layout:
    //   args[0] = { data: MsgModel } | MsgModel
    //   when args[0].data exists: proto = args[1]
    //   otherwise:               proto = args[2]
    const message = (args[0] as any)?.data || args[0];
    const proto: any = (args[0] as any)?.data ? args[1] : args[2];

    const isNativeFlow =
      hasNativeFlowInProto(proto) || hasNativeFlowInMessage(message);

    // Legacy buttons / list biz node (no native flow involved)
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

    if (isNativeFlow && Array.isArray(stanza?.content)) {
      const flowName = getNativeFlowName(proto, message);

      if (!hasNativeFlowBizNode(stanza)) {
        stanza.content.push(createNativeFlowBizNode(flowName));
      }

      // Private (1:1) chats also require a bot node
      if (isPrivateChat(message, stanza) && !hasBotNode(stanza)) {
        stanza.content.push(createBotNode());
      }

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
      if (!already) {
        (bizNode.content as websocket.WapNode[]).push(legacyBizChild);
      }
    }

    return result;
  });

  // 6. Keep native flow functional — WA's A/B prop disables stanza unwrapping
  //    which would strip the viewOnceMessage wrapper we rely on.
  wrapModuleFunction(getABPropConfigValue, (func, ...args) => {
    const [key] = args;
    if (key === 'web_unwrap_message_for_stanza_attributes') return false;
    return func(...args);
  });
});
