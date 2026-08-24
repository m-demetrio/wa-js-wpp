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

import { getMyUserWid } from '../conn/functions/getMyUserWid';
import { WPPError } from '../util';
import { ContactStore } from '../whatsapp';

export class NotIsBusinessError extends WPPError {
  constructor() {
    super('is_not_business', `This account is not a business version`);
  }
}

export function assertIsBusiness(): void {
  // Conn.isSMB deixou de existir no WhatsApp Web (>= 2.3000.104x): o Conn real so
  // expoe smbTos, que e o aceite de termos do SMB e nao o tipo da conta. O sinal
  // confiavel e o isBusiness do proprio contato logado, populado pelo servidor.
  const me = getMyUserWid();
  const isBusiness = me ? ContactStore.get(me)?.isBusiness : undefined;

  if (!isBusiness) {
    throw new NotIsBusinessError();
  }
}
