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

import { createWid } from '../../util/createWid';
import { functions, ApiContact, WidFactory, Wid, ContactStore } from '../../whatsapp';
import { resolveChatLid } from './resolveChatLid';

export type ChatIdLike = Wid | string | { _serialized?: string } | { id?: any };

const lidToCusCache = new Map<string, Wid | string>();
const classicToLidCache = new Map<string, Wid | string>();

function toIdString(chatId: ChatIdLike): string {
  const candidate = (chatId as any)?._serialized ?? (chatId as any)?.id ?? chatId;
  if (typeof candidate === 'string') {
    return candidate;
  }
  if ((candidate as Wid)?._serialized) {
    return (candidate as Wid)._serialized;
  }
  return String(candidate ?? '');
}

function isMigrated(): boolean {
  try {
    const migrated = functions.isLidMigrated?.();
    if (typeof migrated === 'function') {
      return !!migrated();
    }
    return !!migrated;
  } catch {
    return false;
  }
}

function toWid(id: string): Wid | undefined {
  try {
    return createWid(id) as Wid;
  } catch {
    // ignore
  }

  try {
    if (WidFactory?.isWidlike?.(id)) {
      return WidFactory.createWidFromWidLike(id);
    }
    return WidFactory.createWid(id as any);
  } catch {
    // ignore
  }

  return undefined;
}

async function mapLidToClassic(chatId: string): Promise<Wid | string> {
  if (!chatId.endsWith('@lid')) {
    return chatId;
  }

  const cached = lidToCusCache.get(chatId);
  if (cached) {
    return cached;
  }

  try {
    const user = chatId.split('@')[0];
    const lidWid = toWid(`${user}@lid`) ?? WidFactory.createUserWid?.(user, 'lid');
    const phone = lidWid ? await ApiContact.getPhoneNumber(lidWid as any) : undefined;
    const digits = String(phone ?? '').replace(/\D/g, '');

    if (!digits) {
      return chatId;
    }

    const classicId = `${digits}@c.us`;
    const classicWid = toWid(classicId) ?? classicId;
    lidToCusCache.set(chatId, classicWid);
    return classicWid;
  } catch {
    return chatId;
  }
}

async function mapClassicToLid(chatId: string): Promise<Wid | string> {
  if (!chatId.endsWith('@c.us')) {
    return chatId;
  }

  const cached = classicToLidCache.get(chatId);
  if (cached) {
    return cached;
  }

  try {
    const wid = toWid(chatId);
    if (!wid?.isUser?.()) {
      return chatId;
    }

    const contact = ContactStore.get(wid);
    if (contact?.lid?.isLid?.()) {
      classicToLidCache.set(chatId, contact.lid);
      return contact.lid;
    }

    const lid = await resolveChatLid(wid);
    if (lid?.isLid?.()) {
      classicToLidCache.set(chatId, lid);
      return lid;
    }

    const enforced = functions.getEnforceCurrentLid?.(wid);
    if (enforced?.isLid?.()) {
      classicToLidCache.set(chatId, enforced);
      return enforced;
    }
  } catch {
    // ignore and fall back to original chatId
  }

  return chatId;
}

export async function resolveCanonicalChatId(
  chatId: ChatIdLike,
): Promise<Wid | string | ChatIdLike> {
  const idStr = toIdString(chatId);

  if (isMigrated()) {
    if (idStr.endsWith('@c.us')) {
      return await mapClassicToLid(idStr);
    }

    return chatId;
  }

  // Se já migrado, não converte LID -> clássico aqui (mantém comportamento atual).
  if (!idStr.endsWith('@lid')) {
    return chatId;
  }

  return await mapLidToClassic(idStr);
}

export function resolveCanonicalChatIdSync(
  chatId: ChatIdLike,
): Wid | string | ChatIdLike {
  const idStr = toIdString(chatId);

  if (isMigrated()) {
    if (idStr.endsWith('@c.us')) {
      return classicToLidCache.get(idStr) ?? chatId;
    }

    return chatId;
  }

  if (!idStr.endsWith('@lid')) {
    return chatId;
  }

  return lidToCusCache.get(idStr) ?? chatId;
}
