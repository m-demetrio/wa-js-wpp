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

import Debug from 'debug';

import { createWid } from '../../util/createWid';
import { ApiContact, USyncQuery, USyncUser, Wid } from '../../whatsapp';
import * as DBCreateLidPnMappings from '../../whatsapp/misc/DBCreateLidPnMappings';

export interface QueryExistsResult {
  wid: Wid;
  biz: boolean;
  bizInfo?: {
    verifiedName?: {
      isApi: boolean;
      level: string;
      name: string;
      privacyMode: any;
      serial: string;
    };
  };
  disappearingMode?: {
    duration: number;
    settingTimestamp: number;
  };
  status?: string;
  lid?: Wid;
}

const cache = new Map<string, QueryExistsResult | null>();
const debug = Debug('WA-JS:contact:queryExists');
const SUCCESS_CACHE_TTL = 5 * 60 * 1000;
const FAILURE_CACHE_TTL = 15 * 1000;

function scheduleCacheInvalidation(cacheKey: string, ttl: number): void {
  const timeout = setTimeout(() => {
    cache.delete(cacheKey);
  }, ttl);

  if (typeof (timeout as any).unref === 'function') {
    (timeout as any).unref();
  }
}

function normalizeWid(contactId: string | Wid): Wid | null {
  const normalized = createWid(contactId);
  if (normalized) {
    return normalized;
  }

  if (typeof contactId === 'string' && contactId.startsWith('+')) {
    const fallback = createWid(contactId.slice(1));
    if (fallback) {
      return fallback;
    }
  }

  debug('Invalid WID passed to queryExists', {
    contactId,
  });
  return null;
}

function normalizePhoneForUser(wid: Wid): string | null {
  const phone = wid.user?.trim();
  if (!phone) {
    return null;
  }

  return phone.startsWith('+') ? phone : `+${phone}`;
}

function normalizeResponseWid(value: unknown): Wid | null {
  if (value == null) {
    return null;
  }

  const wid = createWid(value as string | { _serialized: string });
  if (wid) {
    return wid;
  }

  if (typeof value === 'string') {
    return createWid(value.startsWith('+') ? value.slice(1) : value) || null;
  }

  return null;
}

async function createMappingSafely(lid: Wid, pn: Wid): Promise<void> {
  try {
    await DBCreateLidPnMappings.createLidPnMappings({
      mappings: [{ lid, pn }],
      flushImmediately: true,
      learningSource: 'usync',
    });
  } catch (error) {
    debug('Failed to create PN<->LID mapping in queryExists', {
      lid: lid.toString(),
      pn: pn.toString(),
      error,
    });
  }
}

/**
 * Check if the number exists and what is correct ID
 *
 * This help to identify numbers with nine digit in Brazil
 *
 * @example
 * ```javascript
 * const result = await WPP.contact.queryExists('[number]@c.us');
 * console.log(result.wid); // Correct ID
 * ```
 *
 * @category Contact
 */
export async function queryExists(
  contactId: string | Wid
): Promise<QueryExistsResult | null> {
  const wid = normalizeWid(contactId);
  if (!wid) {
    return null;
  }

  const cacheKey = wid.toString();
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey) ?? null;
  }

  try {
    const syncUser = new USyncUser();
    const syncQuery = new USyncQuery();

    if (wid.isLid()) {
      syncUser.withLid(wid);
    } else if (wid.isUser()) {
      syncQuery.withContactProtocol();

      const phone = normalizePhoneForUser(wid);
      if (phone) {
        syncUser.withPhone(phone);
      } else {
        syncUser.withId(wid);
      }

      const currentLid = ApiContact.getCurrentLid(wid);
      if (currentLid) {
        syncUser.withLid(currentLid);
      }
    } else {
      syncUser.withId(wid);
    }

    syncQuery
      .withUser(syncUser)
      .withBusinessProtocol()
      .withDisappearingModeProtocol()
      .withStatusProtocol()
      .withLidProtocol();

    let response: unknown;
    try {
      response = await syncQuery.execute();
    } catch (error) {
      debug('syncQuery.execute failed in queryExists', {
        wid: cacheKey,
        error,
      });
      cache.set(cacheKey, null);
      scheduleCacheInvalidation(cacheKey, FAILURE_CACHE_TTL);
      return null;
    }

    const payload = response as
      | {
          error?: {
            all?: unknown;
            contact?: unknown;
          };
          list?: unknown;
        }
      | null
      | undefined;

    if (payload?.error?.all || payload?.error?.contact) {
      cache.set(cacheKey, null);
      scheduleCacheInvalidation(cacheKey, FAILURE_CACHE_TTL);
      return null;
    }

    if (!Array.isArray(payload?.list)) {
      debug('Unexpected queryExists response structure', {
        wid: cacheKey,
      });
      cache.set(cacheKey, null);
      scheduleCacheInvalidation(cacheKey, FAILURE_CACHE_TTL);
      return null;
    }

    const entry = payload.list[0] as
      | {
          id?: unknown;
          business?: QueryExistsResult['bizInfo'];
          disappearing_mode?: {
            duration?: number;
            t?: number;
          };
          status?: unknown;
          lid?: unknown;
          contact?: {
            type?: string;
          };
        }
      | undefined;

    if (!entry || entry.contact?.type === 'out') {
      cache.set(cacheKey, null);
      scheduleCacheInvalidation(cacheKey, FAILURE_CACHE_TTL);
      return null;
    }

    const resultWid = normalizeResponseWid(entry.id);
    if (!resultWid) {
      debug('Unexpected queryExists id field', {
        wid: cacheKey,
        id: entry.id,
      });
      cache.set(cacheKey, null);
      scheduleCacheInvalidation(cacheKey, FAILURE_CACHE_TTL);
      return null;
    }

    const lid = normalizeResponseWid(entry.lid);
    const result: QueryExistsResult = {
      wid: resultWid,
      biz: typeof entry.business !== 'undefined',
      bizInfo: entry.business,
      disappearingMode:
        typeof entry.disappearing_mode !== 'undefined'
          ? {
              duration: entry.disappearing_mode?.duration ?? 0,
              settingTimestamp: entry.disappearing_mode?.t ?? 0,
            }
          : undefined,
      status: typeof entry.status === 'string' ? entry.status : undefined,
      lid: lid ?? undefined,
    };

    cache.set(cacheKey, result);
    scheduleCacheInvalidation(cacheKey, SUCCESS_CACHE_TTL);

    if (result.lid && wid.isUser() && !wid.isLid()) {
      void createMappingSafely(result.lid, result.wid);
    }

    return result;
  } catch (error) {
    debug('queryExists failed', {
      wid: cacheKey,
      error,
    });
    cache.set(cacheKey, null);
    scheduleCacheInvalidation(cacheKey, FAILURE_CACHE_TTL);
    return null;
  }
}
