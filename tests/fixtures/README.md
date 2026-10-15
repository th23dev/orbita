# Áudio de referência

`voice-reference.wav` contém fala sintetizada localmente com a voz Microsoft Maria Desktop (System.Speech), criada para estes testes. Não contém gravação de usuários.

Texto: “Estamos testando a qualidade da voz durante uma chamada. O som do ventilador deve diminuir enquanto as palavras continuam claras. Agora podemos conversar com menos ruído no fundo.”

`voice-loopback.ts` mistura a fala com ruído determinístico e mede o áudio decodificado em uma conexão WebRTC local, usando o controlador de microfone e a faixa LiveKit de produção. Substitui apenas captura e sinalização. Os controles nativos de captura não atuam nesse sinal gerado.

`neural-quality.ts` compara magnitudes espectrais da referência limpa com o sinal ruidoso e o sinal tratado, compensando atraso e ganho. Mede somente janelas com fala, para que um gate que silencie pausas não passe no teste. Não é uma pontuação perceptiva como PESQ, nem garante o mesmo resultado em qualquer ambiente.
