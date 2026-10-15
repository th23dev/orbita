# Voz e áudio

Abra os menus de microfone e fone ao lado do perfil, ou **Configurações → Voz e áudio**. Na sala há também o botão **Voz e áudio**. As preferências ficam neste navegador e são aplicadas durante a chamada.

- Entrada: dispositivo, volume de 0 a 200% e teste com medidor do sinal tratado. **Ouvir minha voz** ativa a reprodução local; use fones. Fechar o painel ou parar o teste libera a captura. Trocar a entrada encerra o teste para que você o reinicie no novo dispositivo.
- Saída: dispositivo e volume de 0 a 100% das faixas recebidas na chamada, incluindo compartilhamento e soundboard remoto. O volume individual de cada participante continua sendo respeitado.
- **Foco na voz**: redução de ruído equilibrada, cancelamento de eco e ganho automático do navegador.
- **Estúdio**: desliga filtros de voz, redução de ruído, eco e ganho automático; mantém o volume de entrada escolhido.
- **Personalizado**: supressão equilibrada, intensa ou desligada; sensibilidade automática ou limiar manual; controles de eco e ganho automático.

O teste é local e não grava nem envia áudio. O microfone da chamada é capturado e tratado separadamente; testar não altera o estado de mudo da chamada.

## Processamento

O `VoiceMicrophone` configura uma faixa LiveKit antes de publicá-la. O `VoiceProcessor` usa o AudioContext fornecido pelo SDK e produz uma faixa mono para o envio:

1. Captura com os controles de eco, ganho e supressão nativos escolhidos.
2. Filtro passa-altas de 75 Hz (equilibrada) ou 100 Hz (intensa).
3. Expansor suave em AudioWorklet: estima o nível baixo de ruído, atenua pausas, abre em aproximadamente 3 ms e mantém a abertura por 200 ms, com fechamento gradual. O limiar manual substitui a estimativa quando selecionado.
4. Compressor suave para conter picos, seguido do volume de entrada.

O modo desligado usa um caminho direto, preservando o volume. Mudanças usam transições suaves. O processamento atua somente no microfone local, sem filtrar soundboard ou compartilhamento de tela. Todos os participantes que usam este cliente podem tratar o próprio envio.

Não é uma implementação do Krisp nem um classificador de voz por IA: a supressão durante a fala depende do navegador, e o expansor reduz ruído nas pausas. Ruídos fortes sobrepostos à fala podem continuar audíveis; vozes muito baixas podem ser atenuadas no modo intenso. A qualidade perceptiva precisa ser conferida com microfones e ambientes reais.

## Compatibilidade e recuperação

Use HTTPS ou localhost. A seleção de saída depende de `HTMLMediaElement.setSinkId`, das permissões e dos dispositivos expostos pelo navegador. Quando indisponível, o seletor é desabilitado e o painel orienta a usar a saída do sistema. **Permitir acesso e atualizar dispositivos** solicita a permissão para revelar nomes, liberando a captura logo depois.

Se o AudioWorklet falhar, um caminho direto mantém o áudio e o volume; o processamento nativo disponível continua funcionando. O painel informa o tratamento básico. A saída padrão é usada quando a seleção falha. Durante a chamada, desconectar um dispositivo restaura a seleção padrão e mostra um aviso. Trocas e ajustes não devem desmutar o microfone. Reconexões recriam a faixa com as preferências atuais.

## Validação

`npm test` verifica redução de sinais fracos, preservação de sinais de voz sintéticos e finais de palavras, bypass, limiar manual, persistência validada, publicação após processamento, captura tardia cancelada, falha de publicação e troca de dispositivo sem desmutar.

`npm run test:e2e -- tests/audio.spec.ts tests/community.spec.ts` verifica o worklet real no Chromium, volume zero, bypass, reinicialização, fallback de download, liberação de recursos e os controles em desktop e viewport móvel. São testes com sinais sintetizados; não substituem uma chamada entre dispositivos físicos e avaliação por escuta.

Referências: [processadores de áudio LiveKit](https://github.com/livekit/track-processors-js/blob/main/processor-docs/audio-processors.md), [captura LiveKit](https://docs.livekit.io/reference/client-sdk-js/interfaces/AudioCaptureOptions.html), [seleção de saída](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/setSinkId).
