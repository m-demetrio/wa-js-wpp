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

import { exportModule } from '../exportModule';

/**
 * @whatsapp 13194
 * @whatsapp 9530 >= 2.2210.9
 * @whatsapp 909530 >= 2.2222.8
 */
export declare function isAuthenticated(): boolean;

/**
 * @whatsapp 13194 >= 2.2208.11
 * @whatsapp 9530 >= 2.2210.9
 * @whatsapp 909530 >= 2.2222.8
 */
export declare function isLoggedIn(): boolean;

exportModule(
  exports,
  {
    isAuthenticated: [
      'isAuthenticated',
      'isLoggedIn',
      'Conn.isAuthenticated',
      'Conn.isLoggedIn',
      'Z',
    ],
    isLoggedIn: [
      'isLoggedIn',
      'isAuthenticated',
      'Conn.isLoggedIn',
      'Conn.isAuthenticated',
      'Z',
    ],
  },
  (m) =>
    m.isAuthenticated ||
    m.isLoggedIn ||
    m.Conn?.isAuthenticated ||
    m.Conn?.isLoggedIn ||
    m.default?.isAuthenticated ||
    m.default?.isLoggedIn ||
    m.default?.Conn?.isAuthenticated ||
    m.default?.Conn?.isLoggedIn ||
    (typeof m.Z === 'function' &&
      m.Z?.toString().includes('isRegistered') &&
      m.Z?.toString().includes('getLoginTokens'))
);
