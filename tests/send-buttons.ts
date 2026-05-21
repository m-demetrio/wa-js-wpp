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

import { expect, test } from './wpp-test';

const targetChatId = process.env.WPP_TEST_CHAT_ID;

test.skip(
  !targetChatId,
  'Set WPP_TEST_CHAT_ID to run message send integration tests'
);

test.describe('message send integration tests', () => {
  test('sendTextMessage sends quick reply buttons and returns OK', async ({
    loggedPage,
  }) => {
    const result = await loggedPage.evaluate(async (chatId) => {
      const sent = await WPP.chat.sendTextMessage(chatId, 'Escolha uma opcao', {
        waitForAck: true,
        title: 'Teste quick reply',
        footer: 'By ZapOrganic',
        buttons: [
          { id: 'op1', text: 'Opcao 1' },
          { id: 'op2', text: 'Opcao 2' },
        ],
      });

      const sendResult = await sent.sendMsgResult;
      const msg = await WPP.chat.getMessageById(sent.id);

      return {
        id: sent.id,
        ack: sent.ack,
        sendResult,
        message: {
          id: msg.id.toString(),
          body: msg.body,
          ack: msg.ack,
          hydratedButtons: msg.hydratedButtons?.map((button) => ({
            index: button.index ?? null,
            id: button.quickReplyButton?.id ?? null,
            text: button.quickReplyButton?.displayText ?? null,
          })),
        },
      };
    }, targetChatId);

    expect(result.id).toBeTruthy();
    expect(result.ack).toBeGreaterThanOrEqual(1);
    expect(result.sendResult.messageSendResult).toBe('OK');
    expect(result.message.id).toBe(result.id);
    expect(result.message.body).toBe('Escolha uma opcao');
    expect(result.message.hydratedButtons).toHaveLength(2);
    expect(result.message.hydratedButtons?.[0]?.id).toBe('op1');
    expect(result.message.hydratedButtons?.[1]?.text).toBe('Opcao 2');
  });

  test('sendTextMessage sends a single quick reply button', async ({
    loggedPage,
  }) => {
    const result = await loggedPage.evaluate(async (chatId) => {
      const sent = await WPP.chat.sendTextMessage(chatId, 'Teste de um botao', {
        waitForAck: true,
        buttons: [{ id: 'only', text: 'Somente um' }],
      });

      const sendResult = await sent.sendMsgResult;
      const msg = await WPP.chat.getMessageById(sent.id);

      return {
        id: sent.id,
        sendResult,
        hydratedButtons: msg.hydratedButtons?.map((button) => ({
          id: button.quickReplyButton?.id ?? null,
          text: button.quickReplyButton?.displayText ?? null,
        })),
      };
    }, targetChatId);

    expect(result.id).toBeTruthy();
    expect(result.sendResult.messageSendResult).toBe('OK');
    expect(result.hydratedButtons).toHaveLength(1);
    expect(result.hydratedButtons?.[0]?.id).toBe('only');
    expect(result.hydratedButtons?.[0]?.text).toBe('Somente um');
  });

  test('sendTextMessage rejects mixed quick reply and CTA buttons', async ({
    loggedPage,
  }) => {
    const error = await loggedPage
      .evaluate(async (chatId) => {
        await WPP.chat.sendTextMessage(chatId, 'Mensagem invalida', {
          buttons: [
            { id: 'op1', text: 'Opcao 1' },
            { url: 'https://example.com', text: 'Abrir site' },
          ],
        });
      }, targetChatId)
      .catch((err) => err);

    expect(String(error?.message || error)).toContain(
      'not possible to send reply buttons and action buttons together'
    );
  });
});
