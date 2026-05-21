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
import {
  TemplateButtonCollection,
  TemplateButtonModel,
  websocket,
} from '../../whatsapp';
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
import { encryptAndParserMsgButtons } from './buttonsParser';
import {
  createInteractiveMessageEnvelope,
  createQuickReplyInteractiveMessage,
} from './interactiveMessage';

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

function getInteractiveMessage(proto: any) {
  return (
    proto?.viewOnceMessage?.message?.interactiveMessage ||
    proto?.viewOnceMessageV2?.message?.interactiveMessage ||
    proto?.viewOnceMessageV2Extension?.message?.interactiveMessage ||
    proto?.ephemeralMessage?.message?.interactiveMessage ||
    proto?.templateMessage?.message?.interactiveMessage ||
    proto?.interactiveMessage
  );
}

function getNativeFlowButtons(proto: any) {
  return getInteractiveMessage(proto)?.nativeFlowMessage?.buttons || [];
}

function getNativeFlowButtonNames(proto: any) {
  return getNativeFlowButtons(proto)
    .map((button: any) => button?.name)
    .filter(
      (name: any): name is string => typeof name === 'string' && name.length > 0
    );
}

function getNativeFlowName(proto: any): string {
  const names = [...new Set(getNativeFlowButtonNames(proto))];

  if (names.length === 1) {
    return names[0] as string;
  }

  if (names.length > 1) {
    return 'mixed';
  }

  return 'quick_reply';
}

function ensureNodeContent(node: websocket.WapNode) {
  if (!Array.isArray(node.content)) {
    node.content = [];
  }

  return node.content as websocket.WapNode[];
}

function getStanzaContent(node: any): websocket.WapNode[] {
  const content =
    node?.content ??
    node?.stanza?.content ??
    node?.node?.stanza?.content ??
    node?.stanzaContent ??
    [];

  return Array.isArray(content) ? content : [];
}

function dumpWapNode(node: websocket.WapNode | null | undefined): any {
  if (!node) {
    return null;
  }

  return {
    tag: node.tag,
    attrs: node.attrs,
    content: Array.isArray(node.content)
      ? node.content.map((child) => dumpWapNode(child))
      : node.content,
  };
}

function ensureNativeFlowBizNode(
  content: websocket.WapNode[],
  nativeFlowName: string
) {
  let bizNode = content.find((node) => node.tag === 'biz');

  if (!bizNode) {
    bizNode = websocket.smax('biz', {}, null);
    content.push(bizNode);
  }

  const bizContent = ensureNodeContent(bizNode);
  let interactiveNode = bizContent.find(
    (node) => node.tag === 'interactive' && node.attrs?.type === 'native_flow'
  );

  if (!interactiveNode) {
    interactiveNode = websocket.smax(
      'interactive',
      { type: 'native_flow', v: '1' },
      null
    );
    bizContent.push(interactiveNode);
  }

  const interactiveContent = ensureNodeContent(interactiveNode);
  let nativeFlowNode = interactiveContent.find(
    (node) => node.tag === 'native_flow' && node.attrs?.name === nativeFlowName
  );

  if (!nativeFlowNode) {
    nativeFlowNode = interactiveContent.find(
      (node) => node.tag === 'native_flow'
    );
  }

  if (!nativeFlowNode) {
    nativeFlowNode = websocket.smax(
      'native_flow',
      { name: nativeFlowName },
      null
    );
    interactiveContent.push(nativeFlowNode);
  } else {
    nativeFlowNode.attrs = {
      ...(nativeFlowNode.attrs || {}),
      name: nativeFlowName,
    };
  }

  return nativeFlowNode;
}

function hasNativeFlowMessage(proto: any) {
  return Boolean(getNativeFlowButtons(proto).length);
}

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

  const isQuickReplyOnly = options.buttons.every(
    (button) =>
      !('phoneNumber' in button) && !('url' in button) && !('code' in button)
  );

  if (isQuickReplyOnly) {
    const quickReplyButtons = options.buttons as Array<{
      id?: string;
      text: string;
    }>;
    const nativeFlowButtons: Array<{
      name: string;
      buttonParamsJson: string;
    }> = quickReplyButtons.map((button, index) => ({
      name: 'quick_reply',
      buttonParamsJson: JSON.stringify({
        display_text: button.text,
        id: button.id || `${index}`,
      }),
    }));

    Object.assign(
      message,
      createInteractiveMessageEnvelope({
        caption: message.body || message.caption || ' ',
        footer: options.footer,
        title: options.title,
        includeType: false,
        messageSecret: false,
      })
    );
    message.interactiveMessage = createQuickReplyInteractiveMessage({
      title: options.title,
      body: message.body || message.caption || ' ',
      footer: options.footer,
      buttons: nativeFlowButtons,
    });
  }

  // Keep local button rendering enabled while testing native flow payloads.
  message.isFromTemplate = true;
  message.buttons = new TemplateButtonCollection();
  message.hydratedButtons = options.buttons.map((button, index) => {
    if ('phoneNumber' in button) {
      return {
        index: index,
        callButton: {
          displayText: button.text,
          phoneNumber: button.phoneNumber,
        },
      };
    }
    if ('url' in button) {
      return {
        index: index,
        urlButton: {
          displayText: button.text,
          url: button.url,
        },
      };
    }
    if ('code' in button) {
      return {
        index: index,
        urlButton: {
          displayText: button.text,
          url: `https://www.whatsapp.com/otp/code/?otp_type=COPY_CODE&code=otp${button.code}`,
        },
      };
    }

    return {
      index: index,
      quickReplyButton: {
        displayText: button.text,
        id: button.id || `${index}`,
      },
    };
  });

  message.buttons.add(
    message.hydratedButtons.map((e, t: number) => {
      const i = `${null != e.index ? e.index : t}`;

      if (e.urlButton) {
        return new TemplateButtonModel({
          id: i,
          displayText: e.urlButton?.displayText,
          url: e.urlButton?.url,
          subtype: 'url',
        });
      }

      if (e.callButton) {
        return new TemplateButtonModel({
          id: i,
          displayText: e.callButton.displayText,
          phoneNumber: e.callButton.phoneNumber,
          subtype: 'call',
        });
      }

      return new TemplateButtonModel({
        id: i,
        displayText: e.quickReplyButton?.displayText,
        selectionId: e.quickReplyButton?.id,
        subtype: 'quick_reply',
      });
    })
  );

  return message;
}

webpack.onFullReady(() => {
  wrapModuleFunction(createMsgProtobuf, (func, ...args) => {
    const [message] = args;
    const debugMessage = message as any;
    const r = func(...args);
    const interactiveMessage = getInteractiveMessage(message);

    console.log('[native-flow] createMsgProtobuf', {
      viewOnceInteractiveMessage:
        debugMessage?.viewOnceMessage?.message?.interactiveMessage,
      interactiveMessage: debugMessage?.interactiveMessage,
      nativeFlowMessage: interactiveMessage?.nativeFlowMessage,
    });

    if (interactiveMessage?.nativeFlowMessage?.buttons !== undefined) {
      const sourceInteractiveMessage =
        message.interactiveMessage || interactiveMessage;
      const mediaPart = [
        'documentMessage',
        'documentWithCaptionMessage',
        'imageMessage',
        'locationMessage',
        'videoMessage',
      ];
      for (let part of mediaPart) {
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
          interactiveMessage: sourceInteractiveMessage,
        },
      };
    }
    return r;
  });

  wrapModuleFunction(encodeMaybeMediaType, (func, ...args) => {
    const [type] = args;
    if (type === 'button') {
      return DROP_ATTR;
    }
    return func(...args);
  });

  wrapModuleFunction(mediaTypeFromProtobuf, (func, ...args) => {
    const [proto] = args;
    if (
      proto.documentWithCaptionMessage?.message?.templateMessage
        ?.hydratedTemplate
    ) {
      return func(
        proto.documentWithCaptionMessage?.message?.templateMessage
          ?.hydratedTemplate
      );
    }
    return func(...args);
  });

  wrapModuleFunction(typeAttributeFromProtobuf, (func, ...args) => {
    const [proto] = args;

    const interactiveMessage = getInteractiveMessage(proto);

    if (interactiveMessage) {
      const keys = Object.keys(interactiveMessage);

      const messagePart = [
        'documentMessage',
        'documentWithCaptionMessage',
        'imageMessage',
        'locationMessage',
        'videoMessage',
      ];

      if (messagePart.some((part) => keys.includes(part))) {
        return 'media';
      }

      return 'text';
    } else if (
      proto?.documentWithCaptionMessage?.message?.templateMessage
        ?.hydratedTemplate
    ) {
      const keys = Object.keys(
        proto?.documentWithCaptionMessage?.message?.templateMessage
          ?.hydratedTemplate
      );

      const messagePart = [
        'documentMessage',
        'imageMessage',
        'locationMessage',
        'videoMessage',
      ];

      if (messagePart.some((part) => keys.includes(part))) {
        return 'media';
      }

      return 'text';
    }

    if (
      proto?.buttonsMessage?.headerType === 1 ||
      proto?.buttonsMessage?.headerType === 2
    ) {
      return 'text';
    }

    return func(...args);
  });

  wrapModuleFunction(createFanoutMsgStanza, async (func, ...args) => {
    let buttonNode: websocket.WapNode | null = null;
    const proto: any = args[1].id ? args[2] : args[1];
    const interactiveMessage =
      proto?.viewOnceMessage?.message?.interactiveMessage;
    const hasNativeFlow = hasNativeFlowMessage(proto);
    const nativeFlowName = getNativeFlowName(proto);
    const quickReplyNativeFlow = nativeFlowName === 'quick_reply';
    const beforeContent =
      (args[1] as any)?.content ?? (args[2] as any)?.content ?? null;

    if (proto.buttonsMessage) {
      buttonNode = websocket.smax('buttons');
    } else if (proto.listMessage) {
      // The trick to send list message is to force the 'product_list' type in the biz node
      // const listType: number = proto.listMessage.listType || 0;
      const listType = 2;

      const types = ['unknown', 'single_select', 'product_list'];

      buttonNode = websocket.smax('list', {
        v: '2',
        type: types[listType],
      });
    }

    console.log('[native-flow] createFanoutMsgStanza:before', {
      viewOnceInteractiveMessage:
        proto?.viewOnceMessage?.message?.interactiveMessage,
      interactiveMessage: proto?.interactiveMessage,
      nativeFlowName,
      content: beforeContent,
      hasNativeFlow,
      hasButtonsMessage: Boolean(proto?.buttonsMessage),
      bizTree: dumpWapNode(
        (beforeContent as websocket.WapNode[] | null | undefined)?.find(
          (node) => node?.tag === 'biz'
        )
      ),
    });

    console.log('[native-flow] fanout: start');
    console.log('[native-flow] fanout: before original func');
    let node = await func(...args);
    const debugNode = node as any;
    console.log('[native-flow] fanout: after original func', {
      node,
      nodeContent: debugNode?.content,
      stanzaContent: debugNode?.stanza?.content,
    });
    if (interactiveMessage && !quickReplyNativeFlow) {
      console.log('[native-flow] fanout: before encryptAndParserMsgButtons');
      try {
        node = await encryptAndParserMsgButtons(...args, func);
      } catch (error) {
        console.error('[native-flow] encryptAndParserMsgButtons error', error);
        throw error;
      }
      console.log('[native-flow] fanout: after encryptAndParserMsgButtons', {
        node,
        nodeContent: (node as any)?.content,
        stanzaContent: (node as any)?.stanza?.content,
      });
    } else if (quickReplyNativeFlow) {
      console.log(
        '[native-flow] fanout: skipping encryptAndParserMsgButtons for quick_reply native flow'
      );
    }

    const content: websocket.WapNode[] = getStanzaContent(node);
    console.log('[native-flow] fanout: resolved content', {
      contentLength: content?.length,
      tags: Array.isArray(content) ? content.map((c) => c?.tag) : null,
      content,
    });

    let quickReplyFlowNode: websocket.WapNode | null = null;

    if (hasNativeFlow) {
      quickReplyFlowNode = ensureNativeFlowBizNode(
        content as websocket.WapNode[],
        nativeFlowName
      );
    }

    const bizNodeAfter = content.find((c: any) => c.tag === 'biz');
    const interactiveNode = getStanzaContent(bizNodeAfter).find(
      (c: any) => c.tag === 'interactive'
    );
    const nativeFlowLeaf = getStanzaContent(interactiveNode).find(
      (c: any) => c.tag === 'native_flow'
    );

    console.log('[native-flow] fanout: after ensureNativeFlowBizNode', {
      tags: content.map((c) => c?.tag),
      bizAdded: Boolean(bizNodeAfter),
      nativeFlowAdded: Boolean(nativeFlowLeaf),
      bizTree: dumpWapNode(bizNodeAfter as websocket.WapNode),
    });

    if (!buttonNode) {
      if (hasNativeFlow) {
        // Native-flow payloads still need a buttons node in the biz tree so
        // WhatsApp preserves the same stanza shape as Baileys.
        buttonNode = websocket.smax('buttons');
      } else {
        return node;
      }
    }

    if (hasNativeFlow) {
      const nativeFlowChildren = ensureNodeContent(
        quickReplyFlowNode as websocket.WapNode
      );
      const buttonExists = nativeFlowChildren.some(
        (c: any) => c.tag === buttonNode?.tag
      );

      if (!buttonExists) {
        nativeFlowChildren.push(buttonNode);
      }

      return node;
    }

    return node;
  });

  wrapModuleFunction(getABPropConfigValue, (func, ...args) => {
    const [key] = args;
    switch (key) {
      case 'web_unwrap_message_for_stanza_attributes':
        return false;
      /*case 'enable_web_calling':
        return true;*/
    }
    return func(...args);
  });
});
