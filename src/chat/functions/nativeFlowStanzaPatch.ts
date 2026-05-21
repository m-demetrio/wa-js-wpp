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

import * as webpack from '../../webpack';
import { websocket } from '../../whatsapp';
import { wrapModuleFunction } from '../../whatsapp/exportModule';
import { createFanoutMsgStanza } from '../../whatsapp/functions';

function getInteractiveMessage(proto: any) {
  return (
    proto?.viewOnceMessage?.message?.interactiveMessage ||
    proto?.interactiveMessage
  );
}

function getNativeFlowMessage(proto: any) {
  return getInteractiveMessage(proto)?.nativeFlowMessage;
}

function getMessageFromArgs(args: any[]) {
  const firstArg = args[0];

  return firstArg?.data || firstArg;
}

function getProtoFromArgs(args: any[]) {
  if (args[0]?.data) {
    return args[1];
  }

  return args[2];
}

function getChatWid(message: any, stanza?: websocket.WapNode) {
  return (
    message?.id?.remote ||
    message?.to ||
    message?.from ||
    stanza?.attrs?.to ||
    stanza?.attrs?.from
  );
}

function hasNativeFlow(proto: any, message: any) {
  const nativeFlowMessage = getNativeFlowMessage(proto);

  return Boolean(
    nativeFlowMessage ||
    message?.nativeFlowName ||
    (message?.interactiveType === 'native_flow' &&
      message?.interactivePayload?.buttons?.length)
  );
}

function getNativeFlowNameFromButtons(buttons: any[]) {
  const names = buttons
    .map((button) => button?.name)
    .filter((name): name is string => typeof name === 'string' && !!name);

  if (names.length === 0) {
    return undefined;
  }

  return names.every((name) => name === names[0]) ? names[0] : 'mixed';
}

function getNativeFlowName(proto: any, message: any) {
  const nativeFlowMessage = getNativeFlowMessage(proto);

  return (
    nativeFlowMessage?.nativeFlowName ||
    message?.nativeFlowName ||
    getNativeFlowNameFromButtons(nativeFlowMessage?.buttons || []) ||
    getNativeFlowNameFromButtons(message?.interactivePayload?.buttons || []) ||
    'quick_reply'
  );
}

function isPrivateChat(message: any, stanza?: websocket.WapNode) {
  const wid = getChatWid(message, stanza);

  if (!wid) {
    return false;
  }

  if (typeof wid.isUser === 'function') {
    return wid.isUser();
  }

  if (typeof wid === 'string') {
    return /@(c\.us|lid|bot|hosted|hosted\.lid)$/.test(wid);
  }

  return false;
}

function getContentTags(stanza: websocket.WapNode) {
  return Array.isArray(stanza.content)
    ? stanza.content.map((node: websocket.WapNode) => node?.tag)
    : [];
}

function hasNativeFlowBizNode(stanza: websocket.WapNode) {
  if (!Array.isArray(stanza.content)) {
    return false;
  }

  return stanza.content.some((node: websocket.WapNode) => {
    const interactiveNode = Array.isArray(node?.content)
      ? node.content.find(
          (child: websocket.WapNode) => child?.tag === 'interactive'
        )
      : undefined;

    return (
      node?.tag === 'biz' && interactiveNode?.attrs?.type === 'native_flow'
    );
  });
}

function hasBotNode(stanza: websocket.WapNode) {
  if (!Array.isArray(stanza.content)) {
    return false;
  }

  return stanza.content.some((node: websocket.WapNode) => node?.tag === 'bot');
}

function createNativeFlowBizNode(nativeFlowName: string): websocket.WapNode {
  return {
    tag: 'biz',
    attrs: {},
    content: [
      {
        tag: 'interactive',
        attrs: {
          type: 'native_flow',
          v: '1',
        },
        content: [
          {
            tag: 'native_flow',
            attrs: {
              name: nativeFlowName,
            },
            content: undefined,
          },
        ],
      },
    ],
  } as unknown as websocket.WapNode;
}

function createBotNode(): websocket.WapNode {
  return {
    tag: 'bot',
    attrs: {
      biz_bot: '1',
    },
    content: undefined,
  } as unknown as websocket.WapNode;
}

webpack.onFullReady(() => {
  wrapModuleFunction(createFanoutMsgStanza, async (func, ...args) => {
    const message = getMessageFromArgs(args);
    const proto = getProtoFromArgs(args);
    const isNativeFlow = hasNativeFlow(proto, message);
    const nativeFlowName = isNativeFlow
      ? getNativeFlowName(proto, message)
      : undefined;

    const result = await func(...args);

    if (!isNativeFlow || !nativeFlowName) {
      return result;
    }

    const stanza = (result as any)?.stanza || result;
    const tagsBefore = getContentTags(stanza);
    const bizTree = createNativeFlowBizNode(nativeFlowName);
    const privateChat = isPrivateChat(message, stanza);
    let botNodeAdded = false;

    if (Array.isArray(stanza?.content) && !hasNativeFlowBizNode(stanza)) {
      stanza.content.push(bizTree);
    }

    if (privateChat && Array.isArray(stanza?.content) && !hasBotNode(stanza)) {
      stanza.content.push(createBotNode());
      botNodeAdded = true;
    }

    console.log('[native-flow] createFanoutMsgStanza patch', {
      nativeFlowName,
      isPrivateChat: privateChat,
      tagsBefore,
      tagsAfter: getContentTags(stanza),
      bizTree,
      botNodeAdded,
    });

    return result;
  });
});
