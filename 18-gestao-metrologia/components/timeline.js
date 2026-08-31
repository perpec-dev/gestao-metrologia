/* =====================================================================
   Linha do tempo de um instrumento.

   Lê vw_timeline, que já junta entrada, inspeções, calibrações,
   movimentações, documentos e a trilha de auditoria numa lista só.
   ===================================================================== */
import { esc, fmtDT, htmlVazio, delegar, toast, msgErro } from '../utils.js';
import { listarTimeline, abrirArquivo } from '../supabase.js';

const ROTULO_ARQUIVO = {
  fotos:'Ver foto', certificados:'Ver certificado', termos:'Ver termo', laudos:'Ver laudo'
};

export function htmlTimeline(eventos){
  if (!eventos.length) return htmlVazio('Nenhum evento registrado.');
  return `<div class="tl">` + eventos.map(ev => `
    <div class="tl-item t-${esc(ev.tipo)}">
      <div class="tl-quando">${esc(fmtDT(ev.quando))}</div>
      <div class="tl-titulo">${esc(ev.titulo)}</div>
      ${ev.detalhe ? `<div class="tl-detalhe">${esc(ev.detalhe)}</div>` : ''}
      ${ev.arquivo_path ? `<div style="margin-top:5px"><button class="btn btn-outline btn-sm"
           data-arquivo="${esc(ev.arquivo_path)}" data-bucket="${esc(ev.arquivo_bucket)}">
           ${esc(ROTULO_ARQUIVO[ev.arquivo_bucket] || 'Abrir arquivo')}</button></div>` : ''}
      ${ev.autor ? `<div class="tl-autor">${esc(ev.autor)}</div>` : ''}
    </div>`).join('') + `</div>`;
}

/** Liga os botões "ver arquivo" — links do Storage são assinados na hora. */
export function ligarArquivos(raiz){
  delegar(raiz, 'click', '[data-arquivo]', async (e, b) => {
    b.disabled = true;
    try { await abrirArquivo(b.dataset.bucket, b.dataset.arquivo); }
    catch (err){ toast(msgErro(err), 'error'); }
    finally { b.disabled = false; }
  });
}

/** Carrega e desenha dentro de um elemento já existente. */
export async function montarTimeline(el, instrumentoId){
  el.innerHTML = '<div class="carregando"><div class="spin"></div>Montando histórico…</div>';
  try {
    const eventos = await listarTimeline(instrumentoId);
    el.innerHTML = htmlTimeline(eventos);
    ligarArquivos(el);
  } catch (e){
    el.innerHTML = `<div class="warn-box e">${esc(msgErro(e))}</div>`;
  }
}
