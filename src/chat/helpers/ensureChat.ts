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

import { assertFindChat, assertGetChat, InvalidChat } from '../../assert';
import type { ChatModel, Wid } from '../../whatsapp';
import { ContactStore, WidFactory } from '../../whatsapp';
import { createWid } from '../../util/createWid';
import { resolveChatLid } from './resolveChatLid';

export interface EnsureChatOptions {
  /**
   * When true, the chat will always be created, mimicking the behaviour of
   * `createChat`. Otherwise the existing chat is fetched and only falls back
   * to creation when necessary.
   */
  createChat?: boolean;
  /**
   * When enabled (default), the helper resolves the LID associated with the
   * chat to keep storage writes consistent with WhatsApp Web expectations.
   */
  ensureLid?: boolean;
}

/**
 * Centralised helper used by sending functions to retrieve chats safely.
 *
 * The implementation avoids duplicated logic spread across the different
 * message helpers and guarantees that any chat returned is compatible with
 * the patched storage layer, minimising the chance of race conditions or
 * missing LID errors when messaging new contacts.
 */
type WidLike =
  | string
  | Wid
  | ChatModel
  | { id?: Wid | string }
  | { _serialized: string };

function coerceWid(input: WidLike): Wid {
  const candidate =
    (input as ChatModel)?.id ||
    (input as any)?.id ||
    (input as any)?._serialized ||
    input;

  const created = createWid(candidate as any);
  if (created) {
    return created;
  }

  try {
    return WidFactory.createWid(candidate as any);
  } catch {
    throw new InvalidChat(candidate as any);
  }
}

export async function ensureChat(
  chatId: WidLike,
  options: EnsureChatOptions = {}
): Promise<ChatModel> {
  const { createChat = false, ensureLid = true } = options;

  const wid = coerceWid(chatId);
  const contact = ContactStore.get(wid);

  const tryGetChat = (id: Wid) => {
    try {
      return assertGetChat(id);
    } catch (error) {
      if (!(error instanceof InvalidChat)) {
        throw error;
      }

      return undefined;
    }
  };

  const tryResolveLid = async () => {
    if (!ensureLid || !wid.isUser?.()) {
      return undefined;
    }

    if (contact?.lid?.isLid?.()) {
      return contact.lid;
    }

    return await resolveChatLid(wid);
  };

  const lid = await tryResolveLid();
  const candidateIds = Array.from(
    new Set(
      [lid, wid].filter((id) => id) as Wid[]
    )
  );

  let chat: ChatModel | undefined;
  let lastInvalid: InvalidChat | undefined;

  for (const id of candidateIds) {
    const existing = tryGetChat(id);
    if (existing) {
      chat = existing;
      break;
    }
  }

  if (!chat) {
    for (const id of candidateIds) {
      try {
        chat = await assertFindChat(id);
        break;
      } catch (error) {
        if (error instanceof InvalidChat) {
          lastInvalid = error;
          continue;
        }

        throw error;
      }
    }
  }

  if (!chat) {
    throw lastInvalid ?? new InvalidChat(wid);
  }

  if (ensureLid && chat?.id?.isUser?.()) {
    const resolved = contact?.lid?.isLid?.() ? contact.lid : await resolveChatLid(chat.id);

    if (resolved && contact && !contact.lid) {
      contact.lid = resolved;
    }
  }

  return chat;
}

/**
 * Synchronous helper used by APIs that must remain sync while still tolerating
 * contacts whose active chat entry is stored under a LID instead of the
 * provided user wid.
 */
export function ensureChatSync(chatId: WidLike): ChatModel {
  const wid = coerceWid(chatId);

  try {
    return assertGetChat(wid);
  } catch (error) {
    if (!(error instanceof InvalidChat)) {
      throw error;
    }

    const contact = ContactStore.get(wid);
    const lid = contact?.lid;

    if (lid?.isLid?.()) {
      return assertGetChat(lid);
    }

    throw error;
  }
}
