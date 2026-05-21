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

import {
  defaultSendMessageOptions,
  RawMessage,
  SendMessageOptions,
  SendMessageReturn,
} from '..';
import { sendRawMessage } from '.';

export interface NativeFlowButtonParams {
  name: string;
  buttonParamsJson: string;
}

export type NativeFlowQuickReplyMessageOptions = SendMessageOptions;

export async function sendNativeFlowMessage(
  chatId: any,
  text: string,
  nativeFlowName: string,
  buttons: NativeFlowButtonParams[],
  options: SendMessageOptions = {}
): Promise<SendMessageReturn> {
  options = {
    ...defaultSendMessageOptions,
    ...options,
  };

  const rawMessage: RawMessage = {
    type: 'interactive',
    caption: text || '',
    nativeFlowName,
    interactiveType: 'native_flow',
    interactivePayload: {
      buttons,
      messageVersion: 1,
    },
    messageSecret: self.crypto.getRandomValues(new Uint8Array(32)),
    isFromTemplate: false,
  } as RawMessage;

  console.log('[native-flow] raw message', {
    nativeFlowName,
    rawMessage,
  });

  const result = await sendRawMessage(chatId, rawMessage, options);
  const sendResult = await result.sendMsgResult;

  console.log('[native-flow] send result', {
    nativeFlowName,
    sendResult,
    ack: result.ack,
  });

  return result;
}

export interface NativeFlowQuickReplyButton {
  id?: string;
  text: string;
}

export async function sendNativeFlowQuickReply(
  chatId: any,
  text: string,
  buttons: NativeFlowQuickReplyButton[],
  options: NativeFlowQuickReplyMessageOptions = {}
): Promise<SendMessageReturn> {
  const nativeFlowButtons = buttons.map((button, index) => ({
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({
      display_text: button.text,
      id: button.id || `${index}`,
    }),
  }));

  return await sendNativeFlowMessage(
    chatId,
    text,
    'quick_reply',
    nativeFlowButtons,
    options
  );
}

export async function sendNativeFlowQuickReplyMessage(
  chatId: any,
  text: string,
  options: NativeFlowQuickReplyMessageOptions & {
    buttons: NativeFlowQuickReplyButton[];
  }
): Promise<SendMessageReturn> {
  return await sendNativeFlowQuickReply(chatId, text, options.buttons, options);
}
