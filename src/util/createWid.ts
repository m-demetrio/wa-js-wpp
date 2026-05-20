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

import { Wid } from '../whatsapp';

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

function createWidFromSerialized(id: string): Wid | undefined {
  if (!id) {
    return undefined;
  }

  const normalized = id.trim();
  if (!normalized) {
    return undefined;
  }

  const serialized = (() => {
    if (/^\d+$/.test(normalized)) {
      return `${normalized}@c.us`;
    }

    if (/^\d+-\d+$/.test(normalized)) {
      return `${normalized}@g.us`;
    }

    if (/@\w*lid\b/.test(normalized)) {
      return normalized;
    }

    if (/status$/.test(normalized)) {
      return normalized.includes('@') ? normalized : `${normalized}@broadcast`;
    }

    return normalized;
  })();

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
