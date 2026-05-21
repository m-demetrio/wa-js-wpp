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

function getInteractiveFromProto(proto: any) {
  return (
    proto?.viewOnceMessage?.message?.interactiveMessage ||
    proto?.interactiveMessage
  );
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
    // NOTE: do NOT add biz/bot stanza nodes; WA Web server rejects them with
    //       ERROR_UNKNOWN (biz nodes are valid only in the mobile/Baileys protocol).
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
  //    level media key, wrap in viewOnceMessage.
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

  // 5. Legacy biz node injection for buttonsMessage and listMessage.
  //    Native flow (interactive) messages do NOT need biz nodes in WA Web —
  //    the server rejects stanzas with biz nodes from non-mobile clients.
  wrapModuleFunction(createFanoutMsgStanza, async (func, ...args) => {
    const proto: any = (args[0] as any)?.data ? args[1] : args[2];

    let legacyBizChild: websocket.WapNode | null = null;
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

    const result = await func(...args);

    if (!legacyBizChild) {
      return result;
    }

    const stanza: websocket.WapNode = (result as any)?.stanza || result;
    const content: websocket.WapNode[] =
      (stanza.content as websocket.WapNode[]) || (stanza as any).stanza.content;

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
