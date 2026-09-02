/* =====================================================================
   Roteador de hash. Troca de tela sem recarregar a página.

   Cada página é um módulo ES que exporta:
     render(container, params)   — obrigatório
     destroy()                   — opcional (desligar Realtime, timers)
   ===================================================================== */
import { htmlCarregando, esc, toast, msgErro } from './utils.js';

export const TELAS = [
  { id:'dashboard',   rotulo:'Painel',      arquivo:'./pages/dashboard.js',
    icone:'<path d="M3 12h7V3H3v9Zm0 9h7v-6H3v6Zm11 0h7v-9h-7v9Zm0-18v6h7V3h-7Z"/>' },
  /* Recebimento foi absorvido por Cadastro: o que separava as duas telas
     era a documentação de entrada, hoje um bloco opcional do formulário. */
  { id:'cadastro',    rotulo:'Cadastro',    arquivo:'./pages/cadastro.js',
    icone:'<path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/>' },
  { id:'calibracao',  rotulo:'Calibração',  arquivo:'./pages/calibracao.js',
    icone:'<path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2"/>' },
  /* Padrões de aferição em tela própria: eles não vencem, não são
     cobrados e não entram na fila de trabalho da calibração. */
  { id:'referencia',  rotulo:'Referência',  arquivo:'./pages/referencia.js',
    icone:'<path d="M12 3v18M4.5 7.5h15M6 7.5 3 15a3.5 3.5 0 0 0 6 0L6 7.5ZM18 7.5 15 15a3.5 3.5 0 0 0 6 0l-3-7.5Z"/>' },
  { id:'emprestimo',  rotulo:'Empréstimo',  arquivo:'./pages/emprestimo.js',
    icone:'<path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7M2 7h20v5H2zM12 7v14M12 7S9 3 6.5 3a2.5 2.5 0 0 0 0 5M12 7s3-4 5.5-4a2.5 2.5 0 0 1 0 5"/>' },
  { id:'inventario',  rotulo:'Inventário',  arquivo:'./pages/inventario.js',
    icone:'<path d="M9 3h6l1 4H8l1-4ZM4 7h16v14H4zM9 12h6"/>' },
  { id:'arquivos',    rotulo:'Arquivos',    arquivo:'./pages/arquivos.js',
    icone:'<path d="M4 20V6a2 2 0 0 1 2-2h3.5l2 3H18a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/>' },
  { id:'relatorios',  rotulo:'Relatórios',  arquivo:'./pages/relatorios.js',
    icone:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6M8 13h8M8 17h5"/>' },
  { id:'admin',       rotulo:'Administração', arquivo:'./pages/admin.js', soAdmin:true,
    icone:'<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>' }
];

const PADRAO = 'dashboard';
let atual = null;          // { id, modulo }
let container = null;
let aoTrocar = null;
let ehAdmin = false;

/** Telas que este usuário pode abrir. A tela de Administração é a única
    restrita — e a restrição de verdade está no banco, não aqui. */
export const telasVisiveis = () => TELAS.filter(t => !t.soAdmin || ehAdmin);

/* Telas que mudaram de lugar. Um favorito antigo do navegador não pode
   cair no painel sem explicação: ele vai para onde a função foi parar. */
const REDIRECIONAR = { recebimento: 'cadastro' };

/** #/calibracao/uuid-do-instrumento -> { id:'calibracao', params:['uuid…'] } */
function lerHash(){
  const bruto = (location.hash || '').replace(/^#\/?/, '');
  const partes = bruto.split('/').filter(Boolean);
  const id = REDIRECIONAR[partes[0]] || partes[0] || PADRAO;
  const existe = telasVisiveis().some(t => t.id === id);
  return { id: existe ? id : PADRAO, params: partes.slice(1) };
}

export function irPara(id, ...params){
  const novo = '#/' + [id, ...params].join('/');
  if (location.hash === novo) navegar();     // mesma rota: força recarregar
  else location.hash = novo;
}

export function rotaAtual(){ return lerHash(); }

async function navegar(){
  const { id, params } = lerHash();

  if (atual && atual.modulo && typeof atual.modulo.destroy === 'function'){
    try { atual.modulo.destroy(); } catch(e){ console.warn('destroy()', e); }
  }

  container.innerHTML = htmlCarregando();
  marcarNav(id);
  if (aoTrocar) aoTrocar(id);

  const tela = TELAS.find(t => t.id === id);
  try {
    const modulo = await import(tela.arquivo);
    atual = { id, modulo };
    // A rota pode ter mudado enquanto o módulo carregava.
    if (lerHash().id !== id) return;
    await modulo.render(container, params);
  } catch (e){
    console.error(e);
    atual = null;
    container.innerHTML =
      `<div class="card"><div class="card-body">
         <div class="warn-box e"><b>Não foi possível abrir a tela "${esc(tela.rotulo)}".</b><br>${esc(msgErro(e))}</div>
         <button class="btn btn-outline" onclick="location.reload()">Recarregar</button>
       </div></div>`;
    toast(msgErro(e), 'error');
  }
}

function marcarNav(id){
  document.querySelectorAll('.tabs .tab').forEach(a => {
    a.classList.toggle('sel', a.dataset.tela === id);
  });
}

export function montarNav(elNav, admin = false){
  ehAdmin = !!admin;
  elNav.innerHTML = telasVisiveis().map(t => `
    <a class="tab" href="#/${t.id}" data-tela="${t.id}">
      <svg viewBox="0 0 24 24">${t.icone}</svg>${esc(t.rotulo)}
      <span class="n" data-contador="${t.id}" hidden></span>
    </a>`).join('');
}

/** Contador colorido na aba (ex.: descalibrados em Calibração). */
export function contadorNav(telaId, valor, classe = ''){
  const el = document.querySelector(`[data-contador="${telaId}"]`);
  if (!el) return;
  if (!valor){ el.hidden = true; return; }
  el.hidden = false;
  el.textContent = valor;
  el.className = 'n ' + (classe || '');
}

export function iniciarRouter(elContainer, callbackTroca){
  container = elContainer;
  aoTrocar  = callbackTroca;
  if (!location.hash) location.replace('#/'+PADRAO);
  window.addEventListener('hashchange', navegar);
  navegar();
}
