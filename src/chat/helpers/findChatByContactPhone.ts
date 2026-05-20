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

import { ChatStore, Wid } from '../../whatsapp';
import type { ChatModel } from '../../whatsapp/models';

interface ContactLike {
  phoneNumber?: unknown;
  __x_phoneNumber?: unknown;
  id?: unknown;
  lid?: unknown;
}

interface ChatWithContact extends ChatModel {
  contact?: ContactLike;
  __x_contact?: ContactLike;
}

function normalizeWidString(value: unknown): string | undefined {
  const raw = widToString(value);
  const normalized = raw?.trim();
  return normalized ? normalized : undefined;
}

/**
 * Convert a Wid-like value to its serialized representation when available.
 */
export function widToString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    return undefined;
  }

  const serialized = (value as { _serialized?: unknown })._serialized;
  if (typeof serialized === 'string' && serialized) {
    return serialized;
  }

  const toString = (value as { toString?: unknown }).toString;
  if (typeof toString === 'function') {
    const result = toString.call(value);
    if (typeof result === 'string' && result && result !== '[object Object]') {
      return result;
    }
  }

  return undefined;
}

function getContactPhoneCandidates(chat: ChatModel): unknown[] {
  const withContact = chat as ChatWithContact;
  const contact = withContact.contact ?? withContact.__x_contact;

  return [
    contact?.phoneNumber,
    contact?.__x_phoneNumber,
    contact?.id,
    contact?.lid,
    withContact.__x_contact?.__x_phoneNumber,
  ];
}

/**
 * Find a loaded chat by matching the contact phone fields against the input
 * Wid. This stays fully synchronous and only inspects in-memory chat data.
 */
export function findChatByContactPhone(wid: Wid): ChatModel | undefined {
  const target = normalizeWidString(wid);
  if (!target) {
    return undefined;
  }

  for (const chat of ChatStore.getModelsArray()) {
    for (const candidate of getContactPhoneCandidates(chat)) {
      if (normalizeWidString(candidate) === target) {
        return chat;
      }
    }
  }

  return undefined;
}
