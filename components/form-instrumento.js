/* =====================================================================
   Formulário de instrumento, compartilhado por Recebimento e por
   Cadastro > Instrumento avulso.

   A diferença entre os dois é só quais blocos aparecem:
     comNotaFiscal  — nota fiscal e pedido de compra (recebimento)
     comInspecao    — inspeção visual (recebimento)
     comCertificado — certificado inicial de calibração

   A tag é gerada pelo servidor (RPC gerar_tag) assim que família e tipo
   estão escolhidos, e regerada no momento de salvar — entre a prévia e
   o clique, o outro usuário pode ter cadastrado um instrumento igual.
   ===================================================================== */
import { esc, hojeISO, validador, limparErros, toast, msgErro } from '../utils.js';
import { proximaTag, enviarArquivo, listarFamilias } from '../supabase.js';
import { CONFIG } from '../config.js';

const campo = (id, rotulo, { tipo='text', req=false, dica='', extra='', classe='' } = {}) => `
  <div class="field ${classe}" id="w${id}">
    <label for="f${id}">${esc(rotulo)}${req ? '<span class="req">*</span>' : ''}</label>
    <input type="${tipo}" id="f${id}" ${extra}>
    ${dica ? `<div class="hint">${esc(dica)}</div>` : ''}
    <div class="msg" id="m${id}"></div>
  </div>`;

const arquivo = (id, rotulo, aceita, dica) => `
  <div class="field" id="w${id}">
    <label>${esc(rotulo)}</label>
    <div class="file" id="d${id}">
      <input type="file" id="f${id}" accept="${aceita}">
      <div class="txt">Clique ou arraste o arquivo aqui</div>
    </div>
    ${dica ? `<div class="hint">${esc(dica)}</div>` : ''}
    <div class="msg" id="m${id}"></div>
  </div>`;

export function htmlFormInstrumento({ comNotaFiscal = false, comInspecao = false, comCertificado = false } = {}){
  let passo = 0;
  const cabeca = titulo => `<div class="card-head"><span class="step">${++passo}</span><h2>${esc(titulo)}</h2></div>`;

  return `
  ${comNotaFiscal ? `
  <div class="card">
    ${cabeca('Documento de entrada')}
    <div class="card-body"><div class="g3">
      ${campo('NotaFiscal','Nota fiscal',{ req:true, dica:'Número da NF que acompanhou o instrumento.' })}
      ${campo('PedidoCompra','Pedido de compra',{ req:true })}
      ${campo('DataEntrada','Data de entrada',{ tipo:'date', req:true })}
    </div></div>
  </div>` : ''}

  <div class="card">
    ${cabeca('Identificação do instrumento')}
    <div class="card-body">
      <div class="g3">
        <div class="field" id="wFamilia">
          <label for="fFamilia">Família<span class="req">*</span></label>
          <select id="fFamilia"><option value="">Selecione…</option></select>
          <div class="hint" id="dicaFamilia">Define a periodicidade de calibração e o miolo da tag.</div>
          <div class="msg" id="mFamilia"></div>
        </div>
        <div class="field" id="wTipo">
          <label for="fTipo">Tipo<span class="req">*</span></label>
          <select id="fTipo">
            <option value="TMMDE">TMMDE — instrumento de uso</option>
            <option value="REFERENCIA">Referência — padrão de aferição</option>
          </select>
          <div class="hint">TMMDE gera tag <b>P-</b>; Referência gera <b>PR-</b>.</div>
          <div class="msg" id="mTipo"></div>
        </div>
        <div class="field" id="wTag">
          <label for="fTag">Tag</label>
          <input type="text" id="fTag" class="cod" readonly placeholder="—">
          <div class="hint">Gerada automaticamente. Confirmada no momento de salvar.</div>
        </div>
      </div>

      <div class="g2" style="margin-top:14px">
        ${campo('Descricao','Descrição',{ req:true, dica:'Ex.: Paquímetro digital 0–150 mm', classe:'full' })}
        ${campo('Fabricante','Fabricante')}
        ${campo('Resolucao','Resolução / faixa',{ dica:'Ex.: 0,01 mm · 0–25 mm' })}
        ${campo('NumSerie','Número de série')}
        ${campo('Localizacao','Localização normal',{ dica:'Onde o instrumento fica guardado.' })}
        ${comNotaFiscal ? '' : campo('DataEntrada','Data de entrada',{ tipo:'date', req:true })}
        <div class="field field-inline full" id="wStandby" style="margin-top:4px">
          <input type="checkbox" id="fStandby">
          <label for="fStandby">Standby — instrumento guardado sem uso.
            <span style="font-weight:400;color:var(--muted)">A validade da calibração só começa a contar na primeira saída.</span></label>
        </div>
      </div>
    </div>
  </div>

  ${comInspecao ? `
  <div class="card">
    ${cabeca('Inspeção visual')}
    <div class="card-body">
      <div class="g2">
        ${arquivo('Foto','Foto do instrumento','image/*','JPG ou PNG, até '+CONFIG.MAX_MB_FOTO+' MB.')}
        ${campo('Laudo','Laudo da inspeção',{ dica:'Ex.: Recebido íntegro, sem avarias aparentes.' })}
        <div class="field full" id="wComentario">
          <label for="fComentario">Comentário</label>
          <textarea id="fComentario" placeholder="Observações do recebimento."></textarea>
          <div class="msg" id="mComentario"></div>
        </div>
      </div>
    </div>
  </div>` : ''}

  ${comCertificado ? `
  <div class="card">
    ${cabeca('Certificado de calibração (opcional)')}
    <div class="card-body">
      <div class="warn-box i">Sem certificado, o instrumento nasce <b>descalibrado</b> e não pode ser emprestado.</div>
      <div class="g2">
        ${arquivo('Certificado','Certificado em PDF','application/pdf','PDF de até '+CONFIG.MAX_MB_PDF+' MB.')}
        <div id="blocoDataCal" hidden>
          ${campo('DataCalibracao','Data da calibração',{ tipo:'date', req:true,
            dica:'A próxima data é calculada pelo sistema conforme a família.' })}
        </div>
        ${campo('Pedidos','Pedidos associados',{ classe:'full' })}
      </div>
    </div>
  </div>` : ''}`;
}

/* ------------------------------------------------------------------ */
export async function ligarFormInstrumento(raiz, { comCertificado = false } = {}){
  const g = id => raiz.querySelector('#f'+id);

  const familias = await listarFamilias();
  const sel = g('Familia');
  sel.innerHTML = '<option value="">Selecione…</option>' + familias.map(f =>
    `<option value="${esc(f.id)}" data-p="${f.periodicidade_meses}" data-c="${f.periodicidade_customizada}">
       ${esc(f.codigo)} — ${esc(f.nome)}</option>`).join('');

  if (g('DataEntrada')) g('DataEntrada').value = hojeISO();

  async function preverTag(){
    const fam = sel.value, tipo = g('Tipo').value;
    const elTag = g('Tag');
    if (!fam || !tipo){ elTag.value = ''; return; }
    elTag.value = '…';
    try { elTag.value = await proximaTag(fam, tipo); }
    catch (e){ elTag.value = ''; toast(msgErro(e), 'error'); }
  }

  function mostrarPeriodicidade(){
    const o = sel.selectedOptions[0];
    const dica = raiz.querySelector('#dicaFamilia');
    if (!o || !o.value){ dica.textContent = 'Define a periodicidade de calibração e o miolo da tag.'; return; }
    dica.innerHTML = o.dataset.c === 'true'
      ? 'Periodicidade <b>customizada por fases</b> — a próxima data varia com a idade do instrumento.'
      : `Calibração a cada <b>${esc(o.dataset.p)}</b> meses.`;
  }

  sel.addEventListener('change', () => { mostrarPeriodicidade(); preverTag(); });
  g('Tipo').addEventListener('change', preverTag);

  // Nome do arquivo aparece na caixa; sem isso ninguém sabe se anexou.
  raiz.querySelectorAll('.file input[type=file]').forEach(inp => {
    inp.addEventListener('change', () => {
      const caixa = inp.closest('.file');
      const a = inp.files[0];
      caixa.classList.toggle('ok', !!a);
      caixa.querySelector('.txt').textContent = a ? a.name : 'Clique ou arraste o arquivo aqui';
      if (comCertificado && inp.id === 'fCertificado'){
        const bloco = raiz.querySelector('#blocoDataCal');
        bloco.hidden = !a;
        if (a && !g('DataCalibracao').value) g('DataCalibracao').value = hojeISO();
      }
    });
  });

  return { familias, preverTag };
}

/* ------------------------------------------------------------------
   Coleta, valida e sobe os arquivos. Devolve os três blocos prontos
   para criar_instrumento_completo, ou null se a validação falhou.
   ------------------------------------------------------------------ */
export async function coletarFormInstrumento(raiz, opcoes = {}){
  const { comNotaFiscal = false, comInspecao = false, comCertificado = false, origem = 'avulso' } = opcoes;
  const g  = id => raiz.querySelector('#f'+id);
  const v  = id => (g(id) ? g(id).value.trim() : '');
  const arq = id => { const i = g(id); return i && i.files[0] ? i.files[0] : null; };

  limparErros(raiz);
  const val = validador();

  if (comNotaFiscal){
    val.exigir('NotaFiscal',   v('NotaFiscal'),   'Informe o número da nota fiscal.');
    val.exigir('PedidoCompra', v('PedidoCompra'), 'Informe o pedido de compra.');
  }
  val.exigir('Familia',     v('Familia'),     'Escolha a família do instrumento.');
  val.exigir('Tipo',        v('Tipo'),        'Escolha o tipo.');
  val.exigir('Descricao',   v('Descricao'),   'Descreva o instrumento.');
  val.exigir('DataEntrada', v('DataEntrada'), 'Informe a data de entrada.');

  if (v('DataEntrada') && v('DataEntrada') > hojeISO())
    val.falha('DataEntrada','A data de entrada não pode estar no futuro.');

  const cert = comCertificado ? arq('Certificado') : null;
  if (cert && !v('DataCalibracao'))
    val.falha('DataCalibracao','Informe a data da calibração do certificado anexado.');
  if (v('DataCalibracao') && v('DataCalibracao') > hojeISO())
    val.falha('DataCalibracao','A data da calibração não pode estar no futuro.');

  if (!val.encerrar()) return null;

  // Uploads só depois da validação: nada de arquivo órfão no Storage.
  const pasta = new Date().getFullYear() + '/' + (v('Familia').slice(0,8) || 'geral');
  let fotoPath = null, certPath = null;

  if (comInspecao && arq('Foto'))
    fotoPath = await enviarArquivo(CONFIG.BUCKETS.fotos, arq('Foto'), pasta);
  if (cert)
    certPath = await enviarArquivo(CONFIG.BUCKETS.certificados, cert, pasta);

  const instrumento = {
    familia_id:         v('Familia'),
    tipo:               v('Tipo'),
    descricao:          v('Descricao'),
    fabricante:         v('Fabricante'),
    resolucao:          v('Resolucao'),
    num_serie:          v('NumSerie'),
    nota_fiscal:        comNotaFiscal ? v('NotaFiscal')   : null,
    pedido_compra:      comNotaFiscal ? v('PedidoCompra') : null,
    data_entrada:       v('DataEntrada'),
    standby:            !!(g('Standby') && g('Standby').checked),
    localizacao_normal: v('Localizacao'),
    origem
  };

  const inspecao = (comInspecao && (fotoPath || v('Laudo') || v('Comentario')))
    ? { foto_path: fotoPath, laudo: v('Laudo'), comentario: v('Comentario') }
    : null;

  const calibracao = (comCertificado && v('DataCalibracao'))
    ? { data_calibracao: v('DataCalibracao'), certificado_path: certPath,
        pedidos_associados: v('Pedidos'), standby_apos: instrumento.standby }
    : null;

  return { instrumento, inspecao, calibracao };
}

/** Limpa o formulário para o próximo lançamento, mantendo a data. */
export function limparFormInstrumento(raiz){
  raiz.querySelectorAll('input, textarea, select').forEach(i => {
    if (i.type === 'checkbox') i.checked = false;
    else if (i.type === 'file') i.value = '';
    else if (i.id !== 'fDataEntrada') i.value = i.tagName === 'SELECT' ? (i.id === 'fTipo' ? 'TMMDE' : '') : '';
  });
  raiz.querySelectorAll('.file').forEach(c => {
    c.classList.remove('ok');
    c.querySelector('.txt').textContent = 'Clique ou arraste o arquivo aqui';
  });
  const bloco = raiz.querySelector('#blocoDataCal');
  if (bloco) bloco.hidden = true;
  limparErros(raiz);
}
