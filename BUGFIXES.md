# Registro de correções recentes

## Contexto geral

As correções abaixo estabilizam envios para contatos novos ou migrados para LID e evitam falhas de autenticação ou de módulos internos quando o bundle do WhatsApp Web muda. Elas contemplam envios de texto, arquivos, PTT/áudio, PTV/vídeo curto e operações de etiquetas.

## Principais ajustes aplicados

- **Normalização de IDs de chat**: qualquer identificador numérico ou sufixado (`@c.us`, `@g.us`, `@lid`) é convertido para um `Wid` antes de buscar ou criar o chat. Isso previne erros como `Invalid wid` e evita criar chats duplicados para o mesmo contato.
- **Resolução de LID antes de escrever no armazenamento**: sempre que um chat for de usuário, o LID é resolvido ou reaproveitado do contato para manter o registro consistente com a base do WhatsApp Web, eliminando "Chat not found" ao enviar mensagens ou aplicar etiquetas.
- **Fallback seguro para criação de chat**: operações que exigem chat (envio de mídia, arquivar, fixar, marcar lido/gravando, etiquetas) passam pelo helper centralizado `ensureChat`, garantindo que um chat existente seja reutilizado e que só seja criado um novo quando realmente necessário.
- **Compatibilidade com PTT e PTV**: o fluxo de resolução de chat foi unificado para que áudios PTT e vídeos PTV usem o mesmo caminho seguro de resolução de LID, evitando falhas específicas dessas mídias.
- **Abertura e encaminhamento resilientes**: funções de interface (abrir chat no WhatsApp Web, posicionar em uma mensagem, começar do primeiro não lido e encaminhar mensagens) agora também usam o helper, aceitando números puros ou WIDs clássicos sem gerar duplicidade ou `Invalid wid`.
- **Recuperação de módulos internos**: as heurísticas para localizar módulos como autenticação, rede e stream foram ampliadas para lidar com exportações `default` ou nomes alternativos quando o bundle é atualizado.

## Boas práticas de uso

- Ao enviar para um número puro, o helper adiciona automaticamente o sufixo correto, então chamadas como `sendTextMessage('5511999999999', 'Olá')` funcionarão sem lançar exceção.
- Para novos contatos, continue usando `sendFileMessage`/`sendTextMessage`; o helper garantirá que o chat e o LID existam antes do envio, sem necessidade de chamadas extras de criação de chat.

## Notas de otimização

- A resolução de LID agora é reutilizada dentro do mesmo fluxo de envio, reduzindo chamadas redundantes à API interna e deixando o helper mais leve sem alterar o comportamento.
- Caso precise de bundles menores, considere ativar divisão de código (`import()` dinâmico) em projetos que consumam esta lib; os _warnings_ de tamanho do webpack são apenas informativos e não impedem o build.
