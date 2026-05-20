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

import { Wid, WidFactory } from '../whatsapp';

function widToString(value: unknown): string | undefined {
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

function parseSerializedWid(
  id: string
): { user: string; server: string } | undefined {
  const atIndex = id.lastIndexOf('@');

  if (atIndex <= 0) return undefined;

  const user = id.slice(0, atIndex);
  const server = id.slice(atIndex + 1);

  if (!user || !server) return undefined;

  return { user, server };
}

function tryCall<T>(callback: () => T): T | undefined {
  try {
    return callback();
  } catch {
    return undefined;
  }
}

function getWidFactory() {
  return WidFactory as Partial<{
    createUserWidOrThrow: (user: string, server?: string) => Wid;
    createUserWid: (user: string, server?: string) => Wid;
    createWid: (wid: string) => Wid;
  }>;
}

function createUserWidCompat(user: string, server?: string): Wid | undefined {
  const factory = getWidFactory();

  if (!factory) return undefined;

  const createUserWidOrThrow = factory.createUserWidOrThrow;
  if (typeof createUserWidOrThrow === 'function') {
    const wid = tryCall(() => createUserWidOrThrow(user, server));
    if (wid) return wid;
  }

  const createUserWid = factory.createUserWid;
  if (typeof createUserWid === 'function') {
    const wid = tryCall(() => createUserWid(user, server));
    if (wid) return wid;
  }

  const createWid = factory.createWid;
  if (typeof createWid === 'function') {
    const serialized = server ? `${user}@${server}` : user;
    const wid = tryCall(() => createWid(serialized));
    if (wid) return wid;
  }

  return undefined;
}

function createWidFromSerialized(id: string): Wid | undefined {
  if (!id) {
    return undefined;
  }

  const normalized = id.trim();
  if (!normalized) {
    return undefined;
  }

  const parsed = parseSerializedWid(normalized);

  if (parsed?.server === 'lid') {
    return createUserWidCompat(parsed.user, 'lid');
  }

  if (parsed?.server === 'c.us') {
    return createUserWidCompat(parsed.user, 'c.us');
  }

  if (parsed?.server === 'g.us') {
    return createUserWidCompat(parsed.user, 'g.us');
  }

  if (parsed?.server === 'broadcast') {
    return createUserWidCompat(parsed.user, 'broadcast');
  }

  const serialized = (() => {
    if (/^\d+$/.test(normalized)) {
      return `${normalized}@c.us`;
    }

    if (/^\d+-\d+$/.test(normalized)) {
      return `${normalized}@g.us`;
    }

    if (/status$/.test(normalized)) {
      return normalized.includes('@') ? normalized : `${normalized}@broadcast`;
    }

    return normalized;
  })();

  const factoryWid = tryCall(() => {
    const createWid = WidFactory.createWid;
    return typeof createWid === 'function' ? createWid(serialized) : undefined;
  });
  if (factoryWid) {
    return factoryWid;
  }

  return new Wid(serialized, { intentionallyUsePrivateConstructor: true });
}

export function createWid(
  id: string | { _serialized?: unknown; toString?: unknown }
): Wid | undefined {
  if (!id) {
    return;
  }

  const serialized = widToString(id);
  if (!serialized) {
    return undefined;
  }

  return createWidFromSerialized(serialized);
}
