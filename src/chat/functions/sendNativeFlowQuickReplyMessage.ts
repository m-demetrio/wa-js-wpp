/*!
 * Copyright 2026 WPPConnect Team
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
import {
  defaultSendMessageOptions,
  RawMessage,
  SendMessageOptions,
  SendMessageReturn,
} from '..';
import { sendRawMessage } from '.';
import {
  createInteractiveMessageEnvelope,
  createQuickReplyInteractiveMessage,
  createQuickReplyNativeFlowButtons,
} from './interactiveMessage';

export interface NativeFlowQuickReplyButton {
  id?: string;
  text: string;
}

export interface NativeFlowQuickReplyMessageOptions extends SendMessageOptions {
  buttons: NativeFlowQuickReplyButton[];
  title?: string;
  footer?: string;
}

/**
 * Native-flow quick reply sender.
 *
 * This builds the interactive message shape expected by the button pipeline.
 */
export async function sendNativeFlowQuickReplyMessage(
  chatId: any,
  content: string,
  options: NativeFlowQuickReplyMessageOptions
): Promise<SendMessageReturn> {
  if (!chatId || typeof content !== 'string') {
    throw new WPPError(
      'parameter_not_fount',
      'Please, send the chatId and message content'
    );
  }

  options = {
    ...defaultSendMessageOptions,
    ...options,
  };

  if (!Array.isArray(options.buttons) || options.buttons.length === 0) {
    throw new WPPError(
      'buttons_must_between_1_and_3_options',
      'Buttons options must have between 1 and 3 options'
    );
  }

  if (options.buttons.length > 3) {
    throw new WPPError(
      'buttons_must_between_1_and_3_options',
      'Buttons options must have between 1 and 3 options'
    );
  }

  const nativeFlowButtons = createQuickReplyNativeFlowButtons(
    options.buttons.map((button, index) => {
      if (!button?.text) {
        throw new WPPError(
          'invalid_button_text',
          `Button text is required for button index ${index}`
        );
      }

      return {
        id: button.id || `${index}`,
        text: button.text,
      };
    })
  );

  const message = createInteractiveMessageEnvelope({
    caption: content,
    footer: options.footer,
    title: options.title,
    includeType: true,
  }) as RawMessage;

  message.interactiveMessage = createQuickReplyInteractiveMessage({
    title: options.title,
    body: content,
    footer: options.footer,
    buttons: nativeFlowButtons,
  });

  return await sendRawMessage(chatId, message, options);
}
