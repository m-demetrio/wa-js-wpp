/*!
 * Copyright 2021 WPPConnect Team
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

import { chat as Chat } from '../';
import {
  resolveCanonicalChatId,
  resolveCanonicalChatIdSync,
  resolveCanonicalWid,
} from '../chat/helpers';
import { WPPError } from '../util';
import { ChatModel, NewsletterStore, Wid } from '../whatsapp';

export class InvalidChat extends WPPError {
  constructor(readonly id: string | { _serialized: string }) {
    super('chat_not_found', `Chat not found for ${id}`);
  }
}

export async function assertFindChat(id: string | Wid): Promise<ChatModel> {
  const canonical = await resolveCanonicalChatId(id);
  const chat = await (Chat as any).find(resolveCanonicalWid(canonical));

  if (!chat) {
    throw new InvalidChat(id);
  }

  return chat;
}

export function assertGetChat(id: string | Wid): ChatModel {
  let chat = null;
  const target = resolveCanonicalWid(resolveCanonicalChatIdSync(id));
  if (target.toString().includes('newsletter')) {
    chat = NewsletterStore.get(target as any);
  } else {
    chat = (Chat as any).get(target);
  }

  if (!chat) {
    throw new InvalidChat(target as any);
  }

  return chat;
}
