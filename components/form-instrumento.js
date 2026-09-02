/* =====================================================================
   Formulário de instrumento — usado pela aba Cadastro.

   Uma tela só para as duas entradas que antes eram duas abas: o
   instrumento que chega comprado (com nota fiscal) e o que já estava na
   empresa. O que separava "Recebimento" de "Cadastro avulso" era a
   documentação de entrada — agora ela é um bloco opcional aqui dentro,
   e a `origem` é deduzida: preencheu nota fiscal ou pedido de compra,
   é recebimento; não preencheu, é avulso.

   A CLASSIFICAÇÃO decide o resto do formulário:
     TMMDE      — instrumento de uso. Tudo aparece: resolução,
                  localização, standby, inspeção visual e certificado.
     REFERÊNCIA — padrão de aferição. Cadastro enxuto: tag (que é a
                  rastreabilidade), descrição, fabricante, número de
                  série, data de cadastro, foto e observações. Sem
                  exigência de calibração, então sem certificado, sem
                  inspeção de entrada e sem relógio de validade.

   Obrigatórios nas duas classificações: descrição, fabricante, data e
   FOTO. A foto vive no cartão de identificação, e não no de inspeção,
   porque ela responde "é este mesmo o instrumento?" — pergunta que a
   conferência de inventário faz sobre qualquer item do acervo.

   A tag é gerada pelo servidor (RPC gerar_tag) assim que família e
   classificação estão escolhidas, e regerada no momento de salvar —
   entre a prévia e o clique, o outro usuário pode ter cadastrado um
   instrumento igual.
   ===================================================================== */
import { esc, hojeISO, validador, limparErros, toast, msgErro } from '../utils.js';
import { proximaTag, enviarArquivo, listarFamilias, pastaDoInstrumento } from '../supabase.js';
import { CONFIG } from '../config.js';

const campo = (id, rotulo, { tipo='text', req=false, dica='', extra='', classe='' } = {}) => `
  <div class="field ${classe}" id="w${id}">
    <label for="f${id}">${esc(rotulo)}${req ? '<span class="req">*</span>' : ''}</label>
    <input type="${tipo}" id="f${id}" ${extra}>
    ${dica ? `<div class="hint" id="d${id}">${esc(dica)}</div>` : ''}
    <div class="msg" id="m${id}"></div>
  </div>`;

const arquivo = (id, rotulo, aceita, dica, { req=false, classe='' } = {}) => `
  <div class="field ${classe}" id="w${id}">
    <label>${esc(rotulo)}${req ? '<span class="req">*</span>' : ''}</label>
    <div class="file" id="d${id}">
      <input type="file" id="f${id}" accept="${aceita}">
      <div class="txt">Clique ou arraste o arquivo aqui</div>
    </div>
    ${dica ? `<div class="hint">${esc(dica)}</div>` : ''}
    <div class="msg" id="m${id}"></div>
  </div>`;

/* Campos que só fazem sentido para instrumento sob controle de
   calibração. Some da tela quando a classificação é Referência. */
const SO_TMMDE = ['wResolucao','wLocalizacao','wStandby'];
const CARDS_TMMDE = ['cardDocs','cardInspecao','cardCert'];

export function htmlFormInstrumento({ comDocumentos = true, comInspecao = true, comCertificado = true } = {}){
  /* Numeração inicial já no HTML: ligarFormInstrumento é assíncrona
     (busca as famílias), e um círculo vazio no topo do cartão enquanto
     a lista carrega parece cartão quebrado. numerarPassos() corrige
     depois, quando a classificação esconde algum cartão. */
  let passo = 0;
  const n = () => ++passo;

  return `
  <div class="card" data-passo id="cardIdent">
    <div class="card-head"><span class="step">${n()}</span><h2>Identificação do instrumento</h2></div>
    <div class="card-body">
      <div class="g3">
        <div class="field" id="wTipo">
          <label for="fTipo">Classificação do instrumento<span class="req">*</span></label>
          <select id="fTipo">
            <option value="TMMDE">TMMDE — instrumento de uso</option>
            <option value="REFERENCIA">Referência — padrão de aferição</option>
          </select>
          <div class="hint" id="dicaTipo">Sob controle de calibração: vence, é cobrado e não sai sem estar em dia.</div>
          <div class="msg" id="mTipo"></div>
        </div>
        <div class="field" id="wFamilia">
          <label for="fFamilia">Família<span class="req">*</span></label>
          <select id="fFamilia"><option value="">Selecione…</option></select>
          <div class="hint" id="dicaFamilia">Define a periodicidade de calibração e o miolo da tag.</div>
          <div class="msg" id="mFamilia"></div>
        </div>
        <div class="field" id="wTag">
          <label for="fTag">Tag</label>
          <input type="text" id="fTag" class="cod" readonly placeholder="—">
          <div class="hint" id="dicaTag">Gerada automaticamente. Confirmada no momento de salvar.</div>
        </div>
      </div>

      <div class="g2" style="margin-top:14px">
        ${campo('Descricao','Descrição',{ req:true, dica:'Ex.: Paquímetro digital 0–150 mm', classe:'full' })}
        ${campo('Fabricante','Fabricante',{ req:true, dica:'Quem fabricou. Entra no certificado e na conferência do inventário.' })}
        ${campo('NumSerie','Número de série')}
        ${campo('Resolucao','Resolução / faixa',{ dica:'Ex.: 0,01 mm · 0–25 mm' })}
        ${campo('Localizacao','Localização normal',{ dica:'Onde o instrumento fica guardado.' })}
        ${campo('DataEntrada','Data de entrada',{ tipo:'date', req:true })}
        <!-- A foto é do CADASTRO, não da inspeção: ela identifica o
             instrumento na conferência do inventário e vale para
             referência também, que não passa por inspeção de entrada. -->
        ${arquivo('Foto','Foto do instrumento','image/*',
          'JPG ou PNG, até '+CONFIG.MAX_MB_FOTO+' MB. É por ela que se reconhece o instrumento na conferência.',
          { req:true })}
        <div class="field field-inline full" id="wStandby" style="margin-top:4px">
          <input type="checkbox" id="fStandby">
          <label for="fStandby">Standby — instrumento guardado sem uso.
            <span style="font-weight:400;color:var(--muted)">A validade da calibração só começa a contar na primeira saída.</span></label>
        </div>
        <div class="field full" id="wObservacoes">
          <label for="fObservacoes">Observações complementares</label>
          <textarea id="fObservacoes" placeholder="O que mais precisa ficar registrado sobre este instrumento."></textarea>
          <div class="msg" id="mObservacoes"></div>
        </div>
      </div>
    </div>
  </div>

  ${comDocumentos ? `
  <div class="card" data-passo id="cardDocs">
    <div class="card-head"><span class="step">${n()}</span><h2>Documento de entrada</h2>
      <span class="right">opcional</span></div>
    <div class="card-body">
      <div class="warn-box i">
        Preencha quando o instrumento entrou por <b>compra</b>. Em branco, ele é
        cadastrado como acervo que já estava na empresa.
      </div>
      <div class="g2">
        ${campo('NotaFiscal','Nota fiscal',{ dica:'Número da NF que acompanhou o instrumento.' })}
        ${campo('PedidoCompra','Pedido de compra')}
      </div>
    </div>
  </div>` : ''}

  ${comInspecao ? `
  <div class="card" data-passo id="cardInspecao">
    <div class="card-head"><span class="step">${n()}</span><h2>Inspeção visual</h2>
      <span class="right">opcional</span></div>
    <div class="card-body">
      <!-- Um campo só. "Laudo" e "Comentário" pediam a mesma coisa com
           dois nomes, e o resultado prático era metade preenchida num,
           metade no outro — histórico partido em dois campos. -->
      <div class="field full" id="wLaudo">
        <label for="fLaudo">Laudo da inspeção</label>
        <textarea id="fLaudo" placeholder="Estado em que o instrumento foi recebido: integridade, avarias, acessórios que vieram junto, restrições de uso."></textarea>
        <div class="hint">Opcional. Vai para a linha do tempo do instrumento.</div>
        <div class="msg" id="mLaudo"></div>
      </div>
    </div>
  </div>` : ''}

  ${comCertificado ? `
  <div class="card" data-passo id="cardCert">
    <div class="card-head"><span class="step">${n()}</span><h2>Certificado de calibração</h2>
      <span class="right">opcional</span></div>
    <div class="card-body">
      <div class="warn-box i">Sem certificado, o instrumento nasce <b>descalibrado</b> e não pode ser emprestado.</div>
      <div class="g2">
        ${arquivo('Certificado','Certificado em PDF','application/pdf','PDF de até '+CONFIG.MAX_MB_PDF+' MB.')}
        <div id="blocoDataCal" hidden>
          ${campo('DataCalibracao','Data da calibração',{ tipo:'date', req:true,
            dica:'A próxima data é calculada pelo sistema conforme a família.' })}
        </div>
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
    if (!dica) return;
    if (g('Tipo').value === 'REFERENCIA'){
      dica.textContent = 'Aqui a família só define o miolo da tag: o padrão de referência não tem periodicidade.';
      return;
    }
    if (!o || !o.value){ dica.textContent = 'Define a periodicidade de calibração e o miolo da tag.'; return; }
    dica.innerHTML = o.dataset.c === 'true'
      ? 'Periodicidade <b>customizada por fases</b> — a próxima data varia com a idade do instrumento.'
      : `Calibração a cada <b>${esc(o.dataset.p)}</b> meses.`;
  }

  /* ---------------------------------------------------------------
     A classificação reconfigura o formulário inteiro. Esconder é
     melhor que desabilitar: campo cinza que não pode ser preenchido
     ainda ocupa a atenção de quem lê a tela pela primeira vez.
     --------------------------------------------------------------- */
  function aplicarClassificacao(){
    const referencia = g('Tipo').value === 'REFERENCIA';

    SO_TMMDE.forEach(id => {
      const el = raiz.querySelector('#'+id);
      if (el) el.hidden = referencia;
    });
    CARDS_TMMDE.forEach(id => {
      const el = raiz.querySelector('#'+id);
      if (el) el.hidden = referencia;
    });

    // Campo escondido não pode continuar carregando valor: ele seria
    // gravado sem ninguém ver.
    if (referencia){
      if (g('Resolucao'))   g('Resolucao').value = '';
      if (g('Localizacao')) g('Localizacao').value = '';
      if (g('Standby'))     g('Standby').checked = false;
    }

    const rotuloData = raiz.querySelector('label[for="fDataEntrada"]');
    if (rotuloData) rotuloData.innerHTML =
      (referencia ? 'Data de cadastro' : 'Data de entrada') + '<span class="req">*</span>';

    const dicaTipo = raiz.querySelector('#dicaTipo');
    if (dicaTipo) dicaTipo.innerHTML = referencia
      ? 'Padrão de aferição: <b>sem exigência de calibração</b>. A tag é a rastreabilidade do padrão.'
      : 'Sob controle de calibração: vence, é cobrado e não sai sem estar em dia.';

    const dicaTag = raiz.querySelector('#dicaTag');
    if (dicaTag) dicaTag.textContent = referencia
      ? 'Rastreabilidade do padrão. Gerada com o prefixo PR-, confirmada ao salvar.'
      : 'Gerada automaticamente. Confirmada no momento de salvar.';

    const obs = raiz.querySelector('#fObservacoes');
    if (obs) obs.placeholder = referencia
      ? 'Rastreabilidade, laboratório, certificado, incerteza, classe de exatidão — o que a metrologia precisar registrar.'
      : 'O que mais precisa ficar registrado sobre este instrumento.';

    numerarPassos(raiz);
    mostrarPeriodicidade();
  }

  sel.addEventListener('change', () => { mostrarPeriodicidade(); preverTag(); });
  g('Tipo').addEventListener('change', () => { aplicarClassificacao(); preverTag(); });

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

  aplicarClassificacao();

  return { familias, preverTag, aplicarClassificacao };
}

/* Os passos são numerados aqui, e não no HTML: com a classificação
   Referência três cartões somem, e "1, 4" no lugar de "1, 2" faz o
   usuário procurar o que ficou faltando. */
function numerarPassos(raiz){
  let n = 0;
  raiz.querySelectorAll('[data-passo]').forEach(card => {
    if (card.hidden) return;
    const passo = card.querySelector('.step');
    if (passo) passo.textContent = ++n;
  });
}

/* ------------------------------------------------------------------
   Coleta, valida e sobe os arquivos. Devolve os três blocos prontos
   para criar_instrumento_completo, ou null se a validação falhou.
   ------------------------------------------------------------------ */
export async function coletarFormInstrumento(raiz, opcoes = {}){
  const { comDocumentos = true, comInspecao = true, comCertificado = true } = opcoes;
  const g  = id => raiz.querySelector('#f'+id);
  const v  = id => (g(id) ? g(id).value.trim() : '');
  const arq = id => { const i = g(id); return i && i.files[0] ? i.files[0] : null; };

  limparErros(raiz);
  const val = validador();

  const referencia = v('Tipo') === 'REFERENCIA';
  // Referência não tem documento de entrada, inspeção nem certificado:
  // os cartões estão escondidos, e o que está escondido não é coletado.
  // A FOTO não está nessa lista: ela é do cadastro, não da inspeção, e
  // vale para as duas classificações.
  const usaDocs  = comDocumentos  && !referencia;
  const usaInsp  = comInspecao    && !referencia;
  const usaCert  = comCertificado && !referencia;

  val.exigir('Familia',     v('Familia'),     'Escolha a família do instrumento.');
  val.exigir('Tipo',        v('Tipo'),        'Escolha a classificação.');
  val.exigir('Descricao',   v('Descricao'),   'Descreva o instrumento.');
  val.exigir('Fabricante',  v('Fabricante'),  'Informe o fabricante do instrumento.');
  val.exigir('DataEntrada', v('DataEntrada'),
    referencia ? 'Informe a data de cadastro.' : 'Informe a data de entrada.');

  if (!arq('Foto'))
    val.falha('Foto','Anexe a foto do instrumento.');

  if (v('DataEntrada') && v('DataEntrada') > hojeISO())
    val.falha('DataEntrada','A data não pode estar no futuro.');

  const cert = usaCert ? arq('Certificado') : null;
  if (cert && !v('DataCalibracao'))
    val.falha('DataCalibracao','Informe a data da calibração do certificado anexado.');
  if (usaCert && v('DataCalibracao') && v('DataCalibracao') > hojeISO())
    val.falha('DataCalibracao','A data da calibração não pode estar no futuro.');
  if (usaCert && v('DataCalibracao') && v('DataEntrada') && v('DataCalibracao') < v('DataEntrada'))
    val.falha('DataCalibracao','A calibração não pode ser anterior à entrada do instrumento.');

  if (!val.encerrar()) return null;

  /* Uploads só depois da validação: nada de arquivo órfão no Storage.

     A pasta é a TAG — uma pasta por equipamento, igual no Storage e na
     tela Arquivos. A tag definitiva só nasce no INSERT, então aqui vai a
     prévia, relida agora para ser a mais recente possível. Se outro
     usuário cadastrar um instrumento da mesma família neste intervalo de
     milissegundos, o arquivo cai na pasta vizinha — o caminho gravado no
     banco continua correto, e a tela continua abrindo o arquivo certo. */
  let pasta = 'sem-tag';
  try { pasta = pastaDoInstrumento(await proximaTag(v('Familia'), v('Tipo'))); }
  catch (e){ /* prévia indisponível: o arquivo ainda sobe, em 'sem-tag' */ }

  let fotoPath = null, certPath = null;

  if (arq('Foto'))
    fotoPath = await enviarArquivo(CONFIG.BUCKETS.fotos, arq('Foto'), pasta);
  if (cert)
    certPath = await enviarArquivo(CONFIG.BUCKETS.certificados, cert, pasta);

  const notaFiscal   = usaDocs ? v('NotaFiscal')   : '';
  const pedidoCompra = usaDocs ? v('PedidoCompra') : '';

  const instrumento = {
    familia_id:         v('Familia'),
    tipo:               v('Tipo'),
    descricao:          v('Descricao'),
    fabricante:         v('Fabricante'),
    resolucao:          referencia ? '' : v('Resolucao'),
    num_serie:          v('NumSerie'),
    observacoes:        v('Observacoes'),
    nota_fiscal:        notaFiscal   || null,
    pedido_compra:      pedidoCompra || null,
    data_entrada:       v('DataEntrada'),
    standby:            !referencia && !!(g('Standby') && g('Standby').checked),
    localizacao_normal: referencia ? '' : v('Localizacao'),
    // A origem deixou de ser a aba em que o usuário estava e passou a ser
    // o que ele preencheu: com documento de compra é recebimento.
    origem:             (notaFiscal || pedidoCompra) ? 'recebimento' : 'avulso'
  };

  // A foto sozinha já vale um registro de inspeção: é ela que guarda o
  // estado do instrumento no dia em que ele entrou.
  const laudo = usaInsp ? v('Laudo') : '';
  const inspecao = (fotoPath || laudo)
    ? { foto_path: fotoPath, laudo, comentario: '' }
    : null;

  const calibracao = (usaCert && v('DataCalibracao'))
    ? { data_calibracao: v('DataCalibracao'), certificado_path: certPath,
        standby_apos: instrumento.standby }
    : null;

  return { instrumento, inspecao, calibracao };
}

/** Limpa o formulário para o próximo lançamento, mantendo a data. */
export function limparFormInstrumento(raiz){
  raiz.querySelectorAll('input, textarea, select').forEach(i => {
    if (i.type === 'checkbox') i.checked = false;
    else if (i.type === 'file') i.value = '';
    else if (i.id !== 'fDataEntrada' && i.id !== 'fTipo')
      i.value = i.tagName === 'SELECT' ? '' : '';
  });
  raiz.querySelectorAll('.file').forEach(c => {
    c.classList.remove('ok');
    c.querySelector('.txt').textContent = 'Clique ou arraste o arquivo aqui';
  });
  const bloco = raiz.querySelector('#blocoDataCal');
  if (bloco) bloco.hidden = true;
  limparErros(raiz);
}
