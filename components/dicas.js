/* =====================================================================
   DICAS — o texto que ensina fica guardado atrás de uma lâmpada.

   As tarjas azuis e âmbares explicavam bem a tela na primeira semana e
   atrapalhavam a partir da segunda: quem já sabe a regra passa o dia
   rolando por cima de um parágrafo que não lê mais. Mas apagar o texto
   também não serve — é ele que responde "por que não consigo inativar
   este instrumento?" para quem chega depois.

   A solução é a mesma de sempre: o texto continua ali, fechado, a um
   clique. Na tela fica só a lâmpada — o assunto da dica ("Quando dá para
   inativar") vira o tooltip e o nome acessível do botão, então quem
   passa o mouse ou navega por teclado sabe o que vai abrir, e quem está
   trabalhando não lê parágrafo nenhum.

   COMO FUNCIONA, e por que não foi preciso mexer em 30 telas:
   isto é melhoria progressiva. Um observador de DOM converte qualquer
   `.warn-box.i` e `.warn-box.w` que apareça na tela — em página, em
   modal, em conteúdo repintado pelo Realtime. As telas continuam
   escrevendo o mesmo HTML de antes; nada aqui precisa ser lembrado por
   quem escrever a próxima.

   O QUE NUNCA VIRA LÂMPADA — e a distinção é a única regra fina daqui:

     · `.warn-box.e` e `.warn-box.g` (erro e confirmação). São resposta
       do sistema a uma ação, não material de leitura.
     · qualquer tarja com botão, link ou campo dentro. Esconder um botão
       atrás de um clique a mais é esconder função, não texto.
     · qualquer tarja marcada com a classe `fixa`. É a saída explícita
       para o aviso operacional — "5 empréstimos passaram do prazo" é
       informação do dia, não explicação da tela.
   ===================================================================== */
const SELETOR = '.warn-box.i:not(.fixa), .warn-box.w:not(.fixa)';

const LAMPADA =
  '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2V17h6v-.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2Z"/>';

/* Título da lâmpada: o negrito de abertura, que nestas tarjas já é o
   assunto ("Quando dá para inativar."). Sem negrito, a primeira frase.
   Sem frase, um rótulo genérico — melhor um rótulo do que uma lâmpada
   anônima que obriga a abrir para saber do que se trata. */
function titulo(box){
  /* O negrito só serve de título quando ABRE a tarja — aí ele é mesmo o
     assunto. Negrito no meio da frase é ênfase: em "entrou por
     <b>compra</b>", a lâmpada sairia chamada "compra". */
  const primeiro = [...box.childNodes]
    .find(n => n.nodeType !== 3 || n.textContent.trim());
  const forte = primeiro && /^(B|STRONG)$/.test(primeiro.nodeName) ? primeiro : null;
  let t = (forte ? forte.textContent : '').trim();

  if (!t){
    // Primeira frase. Escrito sem lookbehind de propósito: expressão
    // regular que o navegador não entende não falha na hora do uso, e
    // sim ao carregar o módulo — derrubando a aplicação inteira.
    const texto = box.textContent.replace(/\s+/g, ' ').trim();
    const frase = texto.match(/^[^.!?]+[.!?]?/);
    t = (frase ? frase[0] : texto).trim();
  }
  t = t.replace(/[.:;,\s]+$/, '');
  if (!t) return 'Como funciona esta tela';
  // Folga generosa: isto é tooltip, não rótulo na tela — cabe a frase
  // inteira, e uma frase inteira explica melhor do que duas palavras.
  return t.length > 110 ? t.slice(0, 109).trim() + '…' : t;
}

function converter(box){
  const dica = document.createElement('details');
  dica.className = 'dica ' + (box.classList.contains('w') ? 'd-w' : 'd-i');
  // A margem que a tarja tinha era decisão de quem escreveu a tela;
  // a lâmpada ocupa o mesmo lugar no fluxo.
  if (box.getAttribute('style')) dica.setAttribute('style', box.getAttribute('style'));

  /* Fechada, a dica é só a lâmpada. O assunto não some: vira o nome
     acessível do botão e o tooltip do navegador — quem passa o mouse ou
     navega por teclado sabe o que vai abrir, e quem só está trabalhando
     na tela não lê parágrafo nenhum. */
  const assunto = titulo(box);
  const resumo = document.createElement('summary');
  resumo.title = assunto;
  resumo.setAttribute('aria-label', assunto);
  resumo.innerHTML = `<svg class="lamp" viewBox="0 0 24 24" aria-hidden="true">${LAMPADA}</svg>`;

  const corpo = document.createElement('div');
  corpo.className = 'dica-corpo';
  while (box.firstChild) corpo.appendChild(box.firstChild);

  dica.appendChild(resumo);
  dica.appendChild(corpo);
  box.replaceWith(dica);
}

/** Uma tarja com ação dentro não é texto explicativo: é interface. */
const temAcao = box => !!box.querySelector('button, a, input, select, textarea');

function converterTodas(raiz){
  raiz.querySelectorAll(SELETOR).forEach(box => {
    if (!temAcao(box)) converter(box);
  });
}

/**
 * Liga a conversão para a aplicação inteira. Chamada uma vez, no
 * arranque: o observador cuida de tudo que for pintado depois.
 * @returns {() => void} desliga o observador (não usado hoje; existe
 *   para que ligar isto numa tela isolada seja possível sem vazamento).
 */
export function ligarDicas(raiz = document.body){
  converterTodas(raiz);

  let agendado = false;
  const obs = new MutationObserver(() => {
    // Converter gera mutação, que acordaria o observador de novo. O
    // quadro de animação junta a rajada inteira numa varredura só, e a
    // varredura seguinte não acha mais nada — `details.dica` não casa
    // com o seletor, então o ciclo termina sozinho.
    if (agendado) return;
    agendado = true;
    requestAnimationFrame(() => { agendado = false; converterTodas(raiz); });
  });

  obs.observe(raiz, { childList: true, subtree: true });
  return () => obs.disconnect();
}
