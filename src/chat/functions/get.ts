/*!
 * Copyright 2023 WPPConnect Team
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

import { assertWid } from '../../assert';
import type { ChatModel, Wid } from '../../whatsapp';
import { ChatStore, NewsletterStore } from '../../whatsapp';
import { findChatByContactPhone, getWidCandidates } from '../helpers';

/**
 * Find a chat by id
 *
 * @category Chat
 */
export function get(chatId: string | Wid): ChatModel | undefined {
  const wid = assertWid(chatId);
  if (wid.server === 'newsletter') {
    return NewsletterStore.get(wid);
  }

  const directChat = ChatStore.get(wid);
  if (directChat) {
    return directChat;
  }

  for (const candidate of getWidCandidates(wid)) {
    if (candidate.equals(wid)) {
      continue;
    }

    const chat = ChatStore.get(candidate);
    if (chat) {
      return chat;
    }
  }

  const chatByPhone = findChatByContactPhone(wid);
  if (chatByPhone) {
    return chatByPhone;
  }

  return undefined;
}
