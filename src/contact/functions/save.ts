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

import { assertWid } from '../../assert';
import { WPPError } from '../../util';
import { ContactModel } from '../../whatsapp';
import { saveContactActionV2 } from '../../whatsapp/functions';
import { get } from './get';
import { getPnLidEntry, InvalidWidForGetPnLidEntry } from './getPnLidEntry';

/**
 * Create new or update a contact in the device
 *
 * @example
 * ```javascript
 * await WPP.contact.save('5533999999999@c.us', 'John', {
 *   surname: 'Doe',
 *   syncAddressBook: true,
 * });
 * ```
 *
 * @category Contact
 */

export async function save(
  contactId: string | any,
  firstName: string,
  options?: {
    /** @deprecated Use lastName instead */
    surname?: string;
    /** @deprecated Use syncAddressBook instead, this one with typo was updated */
    syncAdressBook?: boolean;
    lastName?: string;
    syncAddressBook?: boolean;
  }
): Promise<ContactModel | undefined> {
  if (!contactId || !firstName) {
    throw new WPPError(
      'send_the_required_fields',
      'Please, send the contact id like <number@c.us> and the name for your contact'
    );
  }

  if (options?.syncAdressBook !== undefined) {
    console.warn(
      '[WPPConnect Warning] The "syncAdressBook" option is deprecated due to a typo. Please use "syncAddressBook" instead.'
    );
  }

  const wid = assertWid(contactId);

  // BUGFIX (ver BUGFIXES.md "contact.save não sincroniza com o telefone" §2): resolver lid/
  // phoneNumber só pelo cache local (ApiContact.getAlternateUserWid/lidPnCache) falha em silêncio
  // quando o mapeamento ainda não chegou no dispositivo (comum pra contatos @lid recém-vistos).
  // saveContactActionV2 recebe phoneNumber undefined e a ação nativa cai no branch que só salva
  // localmente, sem sincronizar. getPnLidEntry já faz cache-first com fallback de servidor
  // (queryExists) nos dois sentidos — usar ela aqui em vez da resolução síncrona.
  let lid: string | null = null;
  let phoneNumber: string | null = null;
  let isExistingContact = false;

  try {
    const entry = await getPnLidEntry(wid);
    // lid vai serializado (`<digits>@lid`), não só o `.id` (dígitos) — a ação nativa foi testada e
    // confirmada funcionando com a forma serializada; não confirmamos que aceita a forma curta.
    lid = entry.lid?._serialized ?? null;
    phoneNumber = entry.phoneNumber?.id ?? null;
    isExistingContact = entry.contact?.type === 'in';
  } catch (error) {
    if (!(error instanceof InvalidWidForGetPnLidEntry)) {
      throw error;
    }
  }

  const syncToAddressbook =
    options?.syncAddressBook ?? options?.syncAdressBook ?? true;

  const lastName = options?.lastName ?? options?.surname ?? '';

  // BUGFIX (ver BUGFIXES.md "contact.save não sincroniza com o telefone"): a ação nativa
  // `WAWebSaveContactAction.saveContactAction` (WhatsApp Web atual) só aceita um OBJETO — não
  // existe mais suporte a argumentos posicionais. `saveContactActionV2` e o antigo
  // `saveContactAction` resolvem pro MESMO binding nativo (ver whatsapp/functions/
  // saveContactAction.ts), então o branch por versão abaixo estava sempre errado pra quem caía no
  // "legado": a função nativa recebia uma STRING (o 1º argumento posicional) no lugar do objeto,
  // `e.phoneNumber` saía `undefined`, e ela caía no branch `add_username` (sem sincronizar o
  // telefone) — sem lançar erro. Sempre usar a forma objeto elimina esse branch quebrado.
  //
  // BUGFIX #2 (ver BUGFIXES.md, mesma investigação): `isConvertingContactType`/`isExistingContact`
  // NÃO faziam parte do payload nem da interface `SaveContactActionParamsV2` — mas a ação nativa
  // desestrutura `isConvertingContactType` junto com `firstName`/`lastName` logo no topo do corpo
  // da função (capturado via DevTools, ver BUGFIXES.md), sinal de que ela participa da lógica de
  // roteamento antes mesmo do branch phoneNumber/username. Passar sempre explícito
  // (`isConvertingContactType: false`) em vez de deixar `undefined` evita depender de como a nativa
  // trata "campo ausente" nesse ponto.
  await saveContactActionV2({
    phoneNumber,
    prevPhoneNumber: null,
    lid,
    username: undefined,
    firstName,
    lastName,
    syncToAddressbook,
    isExistingContact,
    isConvertingContactType: false,
  });

  return await get(contactId);
}
