/*!
 * Copyright 2025 WPPConnect Team
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

import { ChatModel, ChatStore, Wid } from '../../whatsapp';
import { findOrCreateLatestChat } from '../../whatsapp/functions';
import { ensureChat } from './ensureChat';
import { resolveChatLid } from './resolveChatLid';

function isMissingLidError(error: unknown): boolean {
  return error instanceof Error && /No LID for user/i.test(error.message);
}

/**
 * Resolve a chat using the native latest-chat flow when possible.
 *
 * WhatsApp's `findOrCreateLatestChat` can throw for PN-only users when the
 * account has not been migrated to LID yet. In that case we fall back to the
 * local `ensureChat(..., { createChat: true })` path, which now creates the
 * chat directly when the native lookup cannot complete.
 */
export async function findOrCreateLatestChatSafe(wid: Wid): Promise<ChatModel> {
  const lookupWid = wid.isUser?.() ? ((await resolveChatLid(wid)) ?? wid) : wid;

  const existing = ChatStore.get(lookupWid);
  if (existing) {
    return existing;
  }

  try {
    const result = await findOrCreateLatestChat(lookupWid, 'newChatFlow');
    const chat = result?.chat?.id ? ChatStore.get(result.chat.id) : null;

    if (chat) {
      return chat;
    }
  } catch (error) {
    if (!isMissingLidError(error)) {
      // Fall back to the local creation path when the native flow fails for
      // reasons other than a missing LID.
    }
  }

  return await ensureChat(lookupWid, {
    createChat: true,
    ensureLid: true,
  });
}
