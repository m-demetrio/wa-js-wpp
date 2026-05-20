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

import type { Wid } from '../../whatsapp';
import { ContactStore } from '../../whatsapp';

function pushUnique(candidates: Wid[], candidate: Wid | undefined) {
  if (!candidate) {
    return;
  }

  const serialized = candidate.toString();
  if (candidates.some((entry) => entry.toString() === serialized)) {
    return;
  }

  candidates.push(candidate);
}

/**
 * Build local Wid candidates that may point to the same chat/contact record.
 *
 * The helper never hits the network and only inspects the in-memory contact
 * cache, which makes it safe to use from synchronous call sites.
 */
export function getWidCandidates(wid: Wid): Wid[] {
  const candidates: Wid[] = [];

  pushUnique(candidates, wid);

  const directContact = ContactStore.get(wid);
  pushUnique(
    candidates,
    directContact?.lid?.isLid?.() ? directContact.lid : undefined
  );
  pushUnique(candidates, directContact?.id);

  for (const contact of ContactStore.getModelsArray()) {
    if (contact.id?.equals?.(wid)) {
      pushUnique(candidates, contact.id);
      pushUnique(candidates, contact.lid?.isLid?.() ? contact.lid : undefined);
      continue;
    }

    if (contact.lid?.equals?.(wid)) {
      pushUnique(candidates, contact.lid);
      pushUnique(candidates, contact.id);
    }
  }

  return candidates;
}
