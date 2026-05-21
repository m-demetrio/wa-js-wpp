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
import { TemplateButtonCollection, TemplateButtonModel } from '../../whatsapp';
import { wrapModuleFunction } from '../../whatsapp/exportModule';
import {
  createMsgProtobuf,
  typeAttributeFromProtobuf,
} from '../../whatsapp/functions';
import { RawMessage } from '..';
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
  buttons?: Array<MessageButtonsTypes>;
  title?: string;
  footer?: string;
}

function getInteractiveMessage(proto: any) {
  return (
    proto?.viewOnceMessage?.message?.interactiveMessage ||
    proto?.interactiveMessage
  );
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

  const nativeFlowButtons: Array<{ name: string; buttonParamsJson: string }> =
    isQuickReplyOnly
      ? (options.buttons as Array<{ id?: string; text: string }>).map(
          (button, index) => ({
            name: 'quick_reply',
            buttonParamsJson: JSON.stringify({
              display_text: button.text,
              id: (button as any).id || `${index}`,
            }),
          })
        )
      : (options.buttons as Array<MessageButtonsTypes>)
          .map((button) => {
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
            if ('phoneNumber' in button) {
              return {
                name: 'cta_call',
                buttonParamsJson: JSON.stringify({
                  display_text: button.text,
                  phone_number: button.phoneNumber,
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
            return null;
          })
          .filter(
            (b): b is { name: string; buttonParamsJson: string } => b !== null
          );

  const primaryNativeFlowName =
    nativeFlowButtons.length > 0 ? nativeFlowButtons[0].name : 'quick_reply';

  Object.assign(
    message,
    createInteractiveMessageEnvelope({
      caption: message.body || message.caption || ' ',
      footer: options.footer,
      title: options.title,
      nativeFlowName: primaryNativeFlowName,
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

  message.isFromTemplate = true;
  message.buttons = new TemplateButtonCollection();
  message.hydratedButtons = options.buttons.map((button, index) => {
    if ('phoneNumber' in button) {
      return {
        index,
        callButton: {
          displayText: button.text,
          phoneNumber: button.phoneNumber,
        },
      };
    }
    if ('url' in button) {
      return {
        index,
        urlButton: {
          displayText: button.text,
          url: button.url,
        },
      };
    }
    if ('code' in button) {
      return {
        index,
        urlButton: {
          displayText: button.text,
          url: `https://www.whatsapp.com/otp/code/?otp_type=COPY_CODE&code=otp${button.code}`,
        },
      };
    }

    return {
      index,
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
    const r = func(...args);
    const interactiveMessage = getInteractiveMessage(message);

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
});
