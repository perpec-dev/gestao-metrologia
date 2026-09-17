/* =====================================================================
   Utilitários gerais. Sem dependência de Supabase — só browser.
   ===================================================================== */
import { CONFIG } from './config.js';

/* ---- Texto ---------------------------------------------------------
   XSS: tudo que vem do usuário passa por aqui antes de virar innerHTML. */
export function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* Comparação tolerante a acento, caixa e espaço.
   ̀-ͯ é a faixa dos acentos separados pelo normalize('NFD').
   Escrita em escape de propósito: caractere combinante literal no
   arquivo quebra dependendo do editor que salvar depois.            */
const ACENTOS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');

export function chave(s){
  return String(s || '').normalize('NFD').replace(ACENTOS,'')
    .toLowerCase().replace(/\s+/g,' ').trim();
}

/* ---- Nome de pessoa -------------------------------------------------
   O perfil nasce do e-mail: joao@perpec.com.br vira "joao". Escrever
   "Olá, joao" na primeira tela do dia é o sistema chamando a pessoa pelo
   login, não pelo nome dela.

   Duas coisas acontecem aqui, e só a primeira é infalível:

     1. CAIXA — "joao amaral" vira "João Amaral", com as partículas em
        minúscula ("Costa e Silva", "Souza dos Santos") e os compostos de
        hífen e apóstrofo respeitados ("Ana-Clara", "D'Ávila").

     2. ACENTO — não existe como deduzir acento de um texto sem acento:
        "sergio" tanto pode ser Sérgio quanto Sergio. O que dá para fazer
        é uma lista dos primeiros nomes e sobrenomes mais comuns,
        aplicada SOMENTE quando a palavra chega sem nenhum acento. Nome
        fora da lista sai como veio, com a caixa corrigida — nunca com um
        acento inventado.

   O conserto definitivo de qualquer nome é escrevê-lo em
   Administração › Usuários, e é para isso que aquele campo existe.
   Acrescente aqui o que a sua equipe usar: a chave é o nome em minúscula
   e sem acento, o valor é como ele deve aparecer.
   --------------------------------------------------------------------- */
const PARTICULAS = new Set(['de','da','do','das','dos','e','di','du','del','della','van','von','y','la']);

const ACENTOS_NOMES = {
  joao:'João', jose:'José', antonio:'Antônio', sergio:'Sérgio', tercio:'Tércio',
  marcio:'Márcio', mario:'Mário', fabio:'Fábio', flavio:'Flávio', otavio:'Otávio',
  luis:'Luís', andre:'André', cesar:'César', cassio:'Cássio', tulio:'Túlio',
  julio:'Júlio', romulo:'Rômulo', vinicius:'Vinícius', lucio:'Lúcio', helio:'Hélio',
  elio:'Élio', ricardo:'Ricardo', jonatas:'Jônatas', matheus:'Matheus',
  sebastiao:'Sebastião', estevao:'Estêvão', cristovao:'Cristóvão', damiao:'Damião',
  adao:'Adão', fabiola:'Fabíola', junior:'Júnior', natalia:'Natália',
  patricia:'Patrícia', monica:'Mônica', veronica:'Verônica', angelica:'Angélica',
  jessica:'Jéssica', leticia:'Letícia', tania:'Tânia', sonia:'Sônia', gloria:'Glória',
  cintia:'Cíntia', lucia:'Lúcia', marcia:'Márcia', barbara:'Bárbara', heloisa:'Heloísa',
  luisa:'Luísa', tais:'Taís', thais:'Thaís', silvia:'Sílvia', cassia:'Cássia',
  virginia:'Virgínia', valeria:'Valéria', rosangela:'Rosângela', angela:'Ângela',
  otavia:'Otávia', iara:'Iara', vitoria:'Vitória', debora:'Débora', livia:'Lívia',
  alicia:'Alícia', ana:'Ana', maria:'Maria',
  // Sobrenomes
  araujo:'Araújo', goncalves:'Gonçalves', conceicao:'Conceição', assuncao:'Assunção',
  brandao:'Brandão', simoes:'Simões', nobrega:'Nóbrega', inacio:'Inácio',
  fatima:'Fátima', gouveia:'Gouveia', queiros:'Queirós', macedo:'Macedo',
  camara:'Câmara', couto:'Couto', vasconcelos:'Vasconcelos', paiva:'Paiva'
};

/** true quando a palavra já traz acento ou cedilha — aí a lista não mexe. */
const temAcento = p => Array.prototype.some.call(p, c => c.charCodeAt(0) > 127);

const capitalizar = p => p ? p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1) : p;

export function nomeProprio(nome){
  const bruto = String(nome || '').trim().replace(/\s+/g, ' ');
  if (!bruto) return '';

  const partes = bruto.split(' ');
  return partes.map((p, i) => {
    const min = p.toLocaleLowerCase('pt-BR');
    // Partícula nunca é a primeira palavra: "Da Silva" começa nome, "da"
    // no meio é ligação.
    if (i > 0 && PARTICULAS.has(min)) return min;
    if (!temAcento(p) && ACENTOS_NOMES[min]) return ACENTOS_NOMES[min];
    // Compostos: os dois lados do hífen e do apóstrofo são nomes.
    return min.split(/([-'’])/)
              .map(t => /^[-'’]$/.test(t) ? t : capitalizar(t))
              .join('');
  }).join(' ');
}

/** Só o primeiro nome, já normalizado — para saudação e assinatura. */
export const primeiroNome = nome => nomeProprio(nome).split(' ')[0] || '';

export function uid(){
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random()*16|0, v = c === 'x' ? r : ((r & 0x3) | 0x8);
    return v.toString(16);
  });
}

/** Texto legível -> pedaço de nome de arquivo, preservando a caixa. */
export function slug(texto, max = 48){
  return String(texto || '').normalize('NFD').replace(ACENTOS,'')
    .replace(/[^A-Za-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0, max);
}

/* Nome de arquivo seguro para o Storage (sem acento, espaço ou barra). */
export function nomeSeguro(nome){
  const limpo = String(nome || 'arquivo').normalize('NFD')
    .replace(ACENTOS,'').replace(/[^A-Za-z0-9._-]/g,'-').replace(/-+/g,'-');
  return limpo.slice(-80);
}

/* ---- Datas ---------------------------------------------------------- */
export const p2 = n => String(n).padStart(2,'0');

export function hojeISO(){
  const d = new Date();
  return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());
}

/** '2026-03-04' -> '04/03/2026'. Trata a data pura como local, sem fuso. */
export function fmtData(v){
  if (!v) return '—';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[3]+'/'+m[2]+'/'+m[1];
  const d = new Date(v);
  return isNaN(d) ? '—' : p2(d.getDate())+'/'+p2(d.getMonth()+1)+'/'+d.getFullYear();
}

export function fmtDT(v){
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return '—';
  return p2(d.getDate())+'/'+p2(d.getMonth()+1)+'/'+d.getFullYear()+' '+p2(d.getHours())+':'+p2(d.getMinutes());
}

export function fromInputDT(v){ if(!v) return null; const d=new Date(v); return isNaN(d)?null:d.toISOString(); }

export function diasDesde(v){
  if (!v) return null;
  return Math.floor((Date.now() - new Date(v).getTime()) / 86400000);
}

/* ---- DOM ------------------------------------------------------------ */
export const $  = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

/** Delegação: um listener no container serve para linhas que ainda nem existem. */
export function delegar(raiz, evento, seletor, fn){
  raiz.addEventListener(evento, e => {
    const alvo = e.target.closest(seletor);
    if (alvo && raiz.contains(alvo)) fn(e, alvo);
  });
}

export function debounce(fn, ms = 220){
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const htmlCarregando = (txt = 'Carregando…') =>
  `<div class="carregando"><div class="spin"></div>${esc(txt)}</div>`;

export const htmlVazio = txt => `<div class="empty-state">${esc(txt)}</div>`;

/* ---- Erros de formulário -------------------------------------------
   Prefixos de id: f = campo, w = wrapper, m = mensagem.               */
export function marcarErro(campo, msg){
  const w = document.getElementById('w'+campo);
  if (!w) return;
  w.classList.toggle('err', !!msg);
  const m = document.getElementById('m'+campo);
  if (m) m.textContent = msg || '';
}

export function limparErros(raiz = document){
  $$('.field.err', raiz).forEach(w => { w.classList.remove('err'); const m = w.querySelector('.msg'); if (m) m.textContent=''; });
}

/** Coletor de falhas: marca todos, foca o primeiro, um toast só. */
export function validador(){
  let erro = false, foco = null;
  return {
    falha(campo, msg){ marcarErro(campo, msg); erro = true; foco = foco || campo; },
    exigir(campo, valor, msg){ if (!String(valor||'').trim()) this.falha(campo, msg); },
    get temErro(){ return erro; },
    encerrar(msg = 'Faltou preencher. Veja os campos em vermelho.'){
      if (!erro) return true;
      const el = document.querySelector('#w'+foco+' input, #w'+foco+' select, #w'+foco+' textarea');
      if (el){ el.focus(); el.scrollIntoView({ block:'center', behavior:'smooth' }); }
      toast(msg, 'error');
      return false;
    }
  };
}

/* ---- Movimento -------------------------------------------------------
   Animação é acabamento, não informação: quem pediu menos movimento no
   sistema operacional recebe o valor final direto, sem transição.      */
export const prefereMenosMovimento = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Contagem crescente até o valor. Devolve o próprio elemento. */
export function animarNumero(el, valor, ms = 620){
  if (!el) return el;
  const alvo = Number(valor) || 0;
  if (prefereMenosMovimento() || alvo === 0){ el.textContent = alvo; return el; }

  const inicio = performance.now();
  const suave = t => 1 - Math.pow(1 - t, 3);      // desacelera no fim
  (function passo(agora){
    const t = Math.min(1, (agora - inicio) / ms);
    el.textContent = Math.round(alvo * suave(t));
    if (t < 1) requestAnimationFrame(passo);
    else el.textContent = alvo;
  })(inicio);
  return el;
}

/* ---- Toast ---------------------------------------------------------- */
export function toast(msg, tipo = ''){
  let el = document.getElementById('toast');
  if (!el){
    el = document.createElement('div');
    el.id = 'toast'; el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'toast' + (tipo ? ' '+tipo : '');
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), tipo === 'error' ? 6500 : 4000);
}

/* ---- Preferências locais (só conveniência) --------------------------- */
export function lembrar(chaveLocal, valor){
  try { localStorage.setItem(CONFIG.DB_KEY+'.'+chaveLocal, JSON.stringify(valor)); } catch(e){}
}
export function lembrado(chaveLocal, padrao = null){
  try { const v = localStorage.getItem(CONFIG.DB_KEY+'.'+chaveLocal); return v ? JSON.parse(v) : padrao; }
  catch(e){ return padrao; }
}
export function esquecerTudo(){
  try {
    Object.keys(localStorage).filter(k => k.startsWith(CONFIG.DB_KEY))
      .forEach(k => localStorage.removeItem(k));
  } catch(e){}
}

/* ---- Carregamento sob demanda de bibliotecas ------------------------- */
const _scripts = new Map();
export function carregarScript(url){
  if (_scripts.has(url)) return _scripts.get(url);
  const p = new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = url; s.async = true;
    s.onload = () => ok();
    s.onerror = () => falha(new Error('Não foi possível carregar '+url));
    document.head.appendChild(s);
  });
  _scripts.set(url, p);
  return p;
}

let _xlsx = null;
export async function lerXLSX(){
  if (!_xlsx) _xlsx = await import(/* @vite-ignore */ CONFIG.CDN_XLSX);
  return _xlsx;
}

export async function lerPDFMake(){
  if (window.pdfMake && window.pdfMake.vfs) return window.pdfMake;
  await carregarScript(CONFIG.CDN_PDFMAKE);
  await carregarScript(CONFIG.CDN_PDFFONTS);
  if (window.pdfMake && !window.pdfMake.vfs && window.pdfFonts){
    window.pdfMake.vfs = (window.pdfFonts.pdfMake || window.pdfFonts).vfs;
  }
  return window.pdfMake;
}

/* ---- Download ------------------------------------------------------- */
export function baixarBlob(nome, blob){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---- Ordenação genérica de tabela ------------------------------------ */
export function comparar(a, b){
  if (a == null && b == null) return 0;
  if (a == null) return 1;      // vazio sempre no fim
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'pt-BR', { numeric:true, sensitivity:'base' });
}

/* ---- Mensagem de erro legível --------------------------------------- */
export function msgErro(e){
  if (!e) return 'Erro desconhecido.';
  const m = e.message || e.error_description || String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(m))
    return 'Sem conexão com o servidor. Verifique a rede e tente de novo.';
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/Email not confirmed/i.test(m))       return 'E-mail ainda não confirmado no painel do Supabase.';
  if (/duplicate key.*instrumentos_tag_key/i.test(m))
    return 'Já existe um instrumento com essa tag. Recarregue a tela e tente novamente.';
  if (/duplicate key.*familias_codigo_key/i.test(m))
    return 'Já existe uma família com esse código.';
  if (/violates row-level security/i.test(m))
    return 'Seu usuário não tem permissão para esta operação.';
  if (/permission denied/i.test(m))
    return 'Operação bloqueada pelo banco: seu papel não permite alterar este campo diretamente.';
  return m.replace(/^.*?ERROR:\s*/,'');
}
