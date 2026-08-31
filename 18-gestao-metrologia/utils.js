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

export function uid(){
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random()*16|0, v = c === 'x' ? r : ((r & 0x3) | 0x8);
    return v.toString(16);
  });
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
