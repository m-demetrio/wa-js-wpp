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

import { generateOrderUniqueId } from '../../util';
import { RawMessage } from '..';

export interface NativeFlowButtonOption {
  id?: string;
  text: string;
}

export interface InteractiveMessageEnvelopeOptions {
  caption: string;
  footer?: string;
  title?: string;
  nativeFlowName?: string;
  interactiveType?: string;
  interactivePayload?: Record<string, any>;
  includeType?: boolean;
  messageSecret?: boolean;
}

export function createInteractiveMessageEnvelope(
  options: InteractiveMessageEnvelopeOptions
): Partial<RawMessage> {
  const message: Partial<RawMessage> = {
    caption: options.caption,
  };

  if (options.includeType !== false) {
    message.type = 'interactive';
  }

  if (typeof options.title !== 'undefined') {
    message.title = options.title;
  }

  if (typeof options.footer !== 'undefined') {
    message.footer = options.footer;
  }

  if (typeof options.nativeFlowName !== 'undefined') {
    message.nativeFlowName = options.nativeFlowName;
  }

  if (typeof options.interactiveType !== 'undefined') {
    message.interactiveType = options.interactiveType;
  }

  if (typeof options.interactivePayload !== 'undefined') {
    message.interactivePayload = options.interactivePayload;
  }

  if (options.messageSecret !== false) {
    message.messageSecret = self.crypto.getRandomValues(new Uint8Array(32));
  }

  return message;
}

export function createQuickReplyNativeFlowButtons(
  buttons: NativeFlowButtonOption[]
): Array<{ name: string; buttonParamsJson: string }> {
  return buttons.map((button, index) => ({
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({
      display_text: button.text,
      id: button.id || `${index}`,
    }),
  }));
}

export function createQuickReplyInteractiveMessage(options: {
  title?: string;
  body: string;
  footer?: string;
  buttons: Array<{ name: string; buttonParamsJson: string }>;
}) {
  return {
    header: {
      title: options.title || ' ',
      hasMediaAttachment: false,
    },
    body: {
      text: options.body || ' ',
    },
    footer: {
      text: options.footer || ' ',
    },
    nativeFlowMessage: {
      messageVersion: 1,
      buttons: options.buttons,
    },
  };
}

export interface PixKeyMessageParams {
  keyType: 'CNPJ' | 'CPF' | 'PHONE' | 'EMAIL' | 'EVP';
  name: string;
  key: string;
  instructions?: string;
}

export function createPixPaymentInfoPayload(params: PixKeyMessageParams) {
  return {
    order: {
      items: [
        {
          name: '',
          retailer_id: `custom-item-${generateOrderUniqueId()}`,
          amount: {
            offset: 1,
            value: 0,
          },
          quantity: 0,
        },
      ],
      order_type: 'ORDER_WITHOUT_AMOUNT',
      status: 'payment_requested',
      subtotal: {
        value: 0,
        offset: 1,
      },
    },
    total_amount: {
      value: 0,
      offset: 1,
    },
    reference_id: generateOrderUniqueId(),
    payment_settings: [
      {
        type: 'pix_static_code',
        pix_static_code: {
          key_type: params.keyType,
          merchant_name: params.name,
          key: params.key,
        },
      },
      {
        type: 'cards',
        cards: {
          enabled: false,
        },
      },
    ],
    external_payment_configurations: [
      {
        payment_instruction: params.instructions || '',
        type: 'payment_instruction',
      },
    ],
    additional_note: '',
    currency: 'BRL',
    type: 'physical-goods',
  };
}
