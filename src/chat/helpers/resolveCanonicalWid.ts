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
import type { ChatModel, Wid } from '../../whatsapp';
import { ContactStore, functions, WidFactory } from '../../whatsapp';

export type WidLike =
  | string
  | Wid
  | ChatModel
  | { id?: Wid | string }
  | { _serialized?: string };

function toWid(id: WidLike): Wid | undefined {
  const candidate =
    (id as ChatModel)?.id ?? (id as any)?.id ?? (id as any)?._serialized ?? id;

  try {
    const created = createWid(candidate as any);
    if (created) {
      return created;
    }
  } catch {
    // ignore
  }

  try {
    if (WidFactory?.isWidlike?.(candidate)) {
      return WidFactory.createWidFromWidLike(candidate as any);
    }
    if (WidFactory?.createWid) {
      return WidFactory.createWid(candidate as any);
    }
  } catch {
    // ignore
  }

  return undefined;
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

function readMsgLid(msg?: any): Wid | undefined {
  const lidCandidate =
    msg?.senderLid ||
    msg?.lid ||
    msg?.peerRecipientLid ||
    msg?.recipientLid ||
    msg?.futureproofParams?.info?.senderLid ||
    msg?.futureproofParams?.info?.recipientLid;

  if (!lidCandidate) {
    return undefined;
  }

  return toWid(lidCandidate);
}

function resolveCandidates(wid: Wid, msg?: any): Wid[] {
  const candidates: Wid[] = [];
  const contact = ContactStore.get(wid);

  const push = (value?: Wid | string) => {
    const parsed = value ? toWid(value as any) : undefined;
    if (
      parsed &&
      !candidates.some((c) => c._serialized === parsed._serialized)
    ) {
      candidates.push(parsed);
    }
  };

  push(contact?.lid);
  push(readMsgLid(msg));

  try {
    push(functions.getCurrentLid?.(wid));
  } catch {
    // ignore
  }

  try {
    push(functions.getEnforceCurrentLid?.(wid));
  } catch {
    // ignore
  }

  push(contact?.id);
  push(wid);

  return candidates;
}

/**
 * Resolve a canonical Wid for migrated sessions, preferring LID identifiers when
 * available while remaining fail-safe for non-migrated accounts.
 */
export function resolveCanonicalWid(chatId: WidLike, msg?: any): Wid | string {
  const wid =
    toWid(chatId) || createWid(String((chatId as any)?._serialized || chatId));

  if (!wid) {
    return (chatId as any) ?? '';
  }

  if (!wid.isUser?.()) {
    return wid;
  }

  if (wid.isLid?.()) {
    return wid;
  }

  if (!isMigrated()) {
    return wid;
  }

  const candidates = resolveCandidates(wid, msg);
  const preferred = candidates.find((id) => id.isLid?.());

  if (preferred?.isLid?.()) {
    const contact = ContactStore.get(wid) || ContactStore.get(preferred);
    if (contact && !contact.lid) {
      contact.lid = preferred;
    }
    return preferred;
  }

  return wid;
}
