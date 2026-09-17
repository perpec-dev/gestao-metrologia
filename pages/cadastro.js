/* =====================================================================
   CADASTRO — a única porta de entrada do acervo. Quatro abas:
     a) Novo instrumento          (um a um, com ou sem documento de entrada)
     b) Import de instrumentos    (Excel -> prévia -> confirmar)
     c) Famílias                  (nova família + alterar periodicidade)
     d) Import de famílias        (Excel -> prévia -> confirmar)

   A aba "Recebimento" foi absorvida aqui. O que a separava era a
   documentação de entrada (nota fiscal e pedido de compra), que agora é
   um bloco opcional do formulário: preencheu, o instrumento é gravado
   com origem 'recebimento'; deixou em branco, com origem 'avulso'.
   Duas telas quase idênticas viravam dúvida sobre qual usar — e o
   histórico do acervo ficava partido em duas portas.
   ===================================================================== */
import { esc, chave, hojeISO, fmtData, toast, msgErro, lerXLSX, htmlVazio,
         validador, limparErros, baixarBlob } from '../utils.js';
import { badge, badgeCondicao } from '../components/status-badge.js';
import { listarFamilias, listarTodasFases, criarFamilia, alterarPeriodicidade,
         criarInstrumentoCompleto, definirStatusWorkflow, inativarInstrumento,
         tagsLivres, listarTags } from '../supabase.js';
import { htmlFormInstrumento, ligarFormInstrumento,
         coletarFormInstrumento, limparFormInstrumento } from '../components/form-instrumento.js';
import { abrirModal, pedirJustificativa, confirmar } from '../components/modal.js';
import { irPara } from '../router.js';

let familias = [];

/* ------------------------------------------------------------------ */
/* Leitura de planilha: cabeçalhos normalizados (sem acento/caixa)      */
/* ------------------------------------------------------------------ */
async function lerPlanilha(arquivo){
  const XLSX = await lerXLSX();
  const buf  = await arquivo.arrayBuffer();
  const wb   = XLSX.read(buf, { type:'array', cellDates:true });
  const aba  = wb.Sheets[wb.SheetNames[0]];
  const cru  = XLSX.utils.sheet_to_json(aba, { defval:'', raw:false });
  return cru.map(linha => {
    const o = {};
    Object.keys(linha).forEach(k => { o[chave(k).replace(/\s+/g,'_')] = String(linha[k]).trim(); });
    return o;
  });
}

function modeloExcel(nome, cabecalhos, exemplos){
  const linhas = [cabecalhos.join(';'), ...exemplos.map(e => e.join(';'))].join('\r\n');
  baixarBlob(nome + '.csv', new Blob(['﻿' + linhas], { type:'text/csv;charset=utf-8' }));
}

/* ---------------------------------------------------------------------
   Vocabulário aceito na planilha.
   O usuário escreve em português corrente; aqui vira o valor do banco.
   --------------------------------------------------------------------- */
const STATUS_PLANILHA = {
  'calibrado':'calibrado',
  'descalibrado':'descalibrado', 'vencido':'descalibrado', 'nao calibrado':'descalibrado',
  'solicitado':'solicitado', 'calibracao solicitada':'solicitado',
  'em calibracao externa':'em_calibracao_externa', 'em_calibracao_externa':'em_calibracao_externa',
  'calibracao externa':'em_calibracao_externa', 'externa':'em_calibracao_externa',
  'no laboratorio':'em_calibracao_externa'
};
const CONDICAO_PLANILHA = {
  'ativo':'ativo', 'ativa':'ativo', 'em uso':'ativo', 'sim':'ativo',
  'inativo':'inativo', 'inativa':'inativo', 'nao':'inativo',
  'sucateado':'inativo', 'vago':'inativo', 'nao entregue':'inativo', 'danificado':'inativo'
};
/* Quando a coluna "situacao" já traz o motivo, aproveita como motivo_inativo. */
const MOTIVO_DIRETO = {
  'sucateado':'Sucateado', 'vago':'Vago', 'nao entregue':'Não entregue', 'danificado':'Danificado'
};

/* ---------------------------------------------------------------------
   TAG — {P|PR}-{código da família}-{NN}, P- para TMMDE e PR- para
   REFERENCIA. O miolo identifica a família melhor que o nome, que se
   repete: uma "BLOCO PADRÃO" cobre BPD, BPLP, BPM e BPP ao mesmo tempo.
   --------------------------------------------------------------------- */
const RE_TAG = /^(PR?)-([A-Z0-9]{2,10})-(\d{2,})$/;
const TIPO_DO_PREFIXO = { P:'TMMDE', PR:'REFERENCIA' };
const PREFIXO_DO_TIPO = { TMMDE:'P', REFERENCIA:'PR' };

/** Decompõe uma tag, ou devolve null se o texto não for uma tag. */
function lerTag(texto){
  const t = String(texto || '').trim().toUpperCase();
  const m = t.match(RE_TAG);
  return m ? { tag:t, codigo:m[2], numero:parseInt(m[3], 10), tipo:TIPO_DO_PREFIXO[m[1]] } : null;
}

const montarTag = (tipo, codigo, numero) =>
  `${PREFIXO_DO_TIPO[tipo]}-${codigo}-${String(numero).padStart(2, '0')}`;

/* Datas da planilha: AAAA-MM-DD e DD/MM/AAAA. Devolve '' para célula
   vazia e null para texto que não é data — quem chama distingue os dois,
   porque vazio usa o padrão da tela e inválido recusa a linha. */
function lerData(texto){
  const t = String(texto || '').trim();
  if (!t) return '';
  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const br  = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  let a, m, d;
  if (iso)     [, a, m, d] = iso;
  else if (br) [, d, m, a] = br;
  else return null;
  // O Date "conserta" 31/02 virando 03/03: se não voltou igual, não era data.
  const dt = new Date(Date.UTC(+a, +m - 1, +d));
  if (dt.getUTCFullYear() !== +a || dt.getUTCMonth() !== +m - 1 || dt.getUTCDate() !== +d)
    return null;
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/* ==================================================================== */
export async function render(container){
  familias = await listarFamilias();

  container.innerHTML = `
    <div class="subtabs">
      <button class="subtab sel" data-pane="avulso">Novo instrumento</button>
      <button class="subtab" data-pane="impInstr">Importar instrumentos</button>
      <button class="subtab" data-pane="familias">Famílias</button>
      <button class="subtab" data-pane="impFam">Importar famílias</button>
    </div>
    <section class="pane on" id="pane-avulso"></section>
    <section class="pane"    id="pane-impInstr"></section>
    <section class="pane"    id="pane-familias"></section>
    <section class="pane"    id="pane-impFam"></section>`;

  container.querySelectorAll('.subtab').forEach(b => b.addEventListener('click', () => {
    container.querySelectorAll('.subtab').forEach(x => x.classList.toggle('sel', x === b));
    container.querySelectorAll('.pane').forEach(p =>
      p.classList.toggle('on', p.id === 'pane-'+b.dataset.pane));
  }));

  await abaAvulso(container.querySelector('#pane-avulso'));
  abaImportInstrumentos(container.querySelector('#pane-impInstr'));
  await abaFamilias(container.querySelector('#pane-familias'));
  abaImportFamilias(container.querySelector('#pane-impFam'));
}

/* ==================================================================== */
/* a) NOVO INSTRUMENTO                                                  */
/* ==================================================================== */
async function abaAvulso(el){
  el.innerHTML = `
    <div class="warn-box i">
      Vale para os dois casos: instrumento <b>comprado agora</b> (preencha o documento
      de entrada) e instrumento que <b>já estava na empresa</b> (deixe o documento em
      branco). A classificação no topo decide o resto do formulário.
    </div>
    <form id="formAvulso" novalidate>
      ${htmlFormInstrumento({ comDocumentos:true, comInspecao:true, comCertificado:true })}
      <div class="act-bar">
        <div style="font-size:12.5px;color:var(--muted);max-width:520px">
          Ao salvar, o sistema oferece os primeiros números livres da família e
          pede a sua confirmação — é a hora de conferir a etiqueta física, porque
          um número livre aqui pode já estar colado num instrumento não cadastrado.
        </div>
        <div class="act-group">
          <button type="button" class="btn btn-outline" id="btLimparAv">Limpar</button>
          <button type="submit" class="btn btn-red btn-xl" id="btSalvarAv" style="width:auto;min-width:260px">
            CADASTRAR INSTRUMENTO</button>
        </div>
      </div>
    </form>
    <div id="ultimosCad"></div>`;

  const form = el.querySelector('#formAvulso');
  await ligarFormInstrumento(form, { comCertificado:true });

  const registrados = [];

  el.querySelector('#btLimparAv').addEventListener('click', () => {
    limparFormInstrumento(form);
    form.querySelector('#fTipo').focus();
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const bt = el.querySelector('#btSalvarAv');
    bt.disabled = true; bt.textContent = 'CONFERINDO A TAG…';
    try {
      const dados = await coletarFormInstrumento(form, {
        comDocumentos:true, comInspecao:true, comCertificado:true,
        // Nada sobe antes de alguém confirmar a tag: o botão só vira
        // "SALVANDO" depois que a confirmação passou.
        antesDeEnviar: async ctx => {
          const tag = await modalConfirmarTag(ctx);
          bt.textContent = 'SALVANDO…';
          return tag;
        }
      });
      if (!dados) return;
      const novo = await criarInstrumentoCompleto(dados.instrumento, dados.inspecao, dados.calibracao);

      registrados.unshift({
        tag: novo.tag, descricao: novo.descricao, id: novo.id,
        referencia: novo.tipo === 'REFERENCIA',
        calibrado: !!dados.calibracao,
        recebimento: novo.origem === 'recebimento'
      });
      pintarUltimos();
      toast('Instrumento cadastrado. Tag ' + novo.tag, 'success');
      limparFormInstrumento(form);
      window.scrollTo({ top:0, behavior:'smooth' });
    } catch (err){ toast(msgErro(err), 'error'); }
    finally { bt.disabled = false; bt.textContent = 'CADASTRAR INSTRUMENTO'; }
  });

  /* Recibo da sessão: quem cadastra dez instrumentos seguidos precisa
     conferir o que já entrou sem sair da tela. */
  function pintarUltimos(){
    const alvo = el.querySelector('#ultimosCad');
    if (!registrados.length){ alvo.innerHTML = ''; return; }
    alvo.innerHTML = `
      <div class="card">
        <div class="card-head"><h2>Cadastrados nesta sessão</h2>
          <span class="right">${registrados.length}</span></div>
        <div class="card-body tight">
          ${registrados.map(r => `
            <div class="rec s-${r.referencia ? 'referencia' : (r.calibrado ? 'calibrado' : 'descalibrado')}">
              <div class="rec-in"><div class="rec-grid">
                <div><div class="k">Tag</div><div class="v" style="font-family:'Courier New',monospace">${esc(r.tag)}</div></div>
                <div><div class="k">Descrição</div><div class="v">${esc(r.descricao)}</div></div>
                <div><div class="k">Entrada</div><div class="v">${r.recebimento ? 'Recebimento (com documento)' : 'Acervo existente'}</div></div>
                <div><div class="k">Situação</div><div class="v">${
                  r.referencia ? 'Referência — sem controle de validade'
                  : r.calibrado ? 'Calibrado' : 'Descalibrado — sem certificado'}</div></div>
                <div style="display:flex;align-items:flex-end">
                  <button class="btn btn-outline btn-sm" data-abrir="${esc(r.id)}">Abrir ficha</button>
                </div>
              </div></div>
            </div>`).join('')}
        </div>
      </div>`;
    alvo.querySelectorAll('[data-abrir]').forEach(b =>
      b.addEventListener('click', () => irPara('calibracao', b.dataset.abrir)));
  }
}

/* --------------------------------------------------------------------
   Confirmação da tag: no clique de salvar, antes de qualquer upload.

   O servidor oferece os primeiros números LIVRES da família, buracos de
   instrumentos sucateados incluídos. Livre no sistema não é livre na
   bancada: o número pode estar colado num instrumento que ninguém
   cadastrou, e só quem abre a gaveta sabe. É essa conferência humana
   que substituiu a regra antiga de nunca reaproveitar número.
   -------------------------------------------------------------------- */
async function modalConfirmarTag({ familia_id, tipo }){
  const livres = await tagsLivres(familia_id, tipo, 5);
  const base = livres[0].replace(/-\d+$/, '');          // P-MCE-01 -> P-MCE

  return new Promise(resolve => {
    abrirModal({
      titulo:'Confirmar a tag do instrumento',
      fecharFora:false,
      corpo: `
        <div class="warn-box w fixa">
          Confira a <b>etiqueta física</b> antes de confirmar. Um número livre aqui
          pode já estar colado num instrumento que ainda não foi cadastrado — o
          sistema não tem como saber.
        </div>
        <div class="field" id="wTagConf">
          <label>Tag deste instrumento<span class="req">*</span></label>
          ${livres.map((t, i) => `
            <div class="field-inline">
              <input type="radio" name="tagConf" id="rTag${i}" value="${esc(t)}" ${i ? '' : 'checked'}>
              <label for="rTag${i}" style="font-family:ui-monospace,Consolas,monospace">${esc(t)}</label>
            </div>`).join('')}
          <div class="field-inline">
            <input type="radio" name="tagConf" id="rTagOutro" value="">
            <label for="rTagOutro">Outro número</label>
          </div>
          <input type="text" id="fTagConf" class="cod" hidden autocomplete="off"
                 placeholder="${esc(base)}-14">
          <div class="hint">Os números que não aparecem na lista já estão em uso no sistema.</div>
          <div class="msg" id="mTagConf"></div>
        </div>`,
      acoes: [
        { rotulo:'Cancelar', classe:'btn-outline', onClick: f => { f(); resolve(null); } },
        { rotulo:'Confirmar tag', classe:'btn-red', onClick: f => {
            const sel = document.querySelector('input[name="tagConf"]:checked');
            let tag = sel ? sel.value : '';

            if (!tag){
              const digitado = document.getElementById('fTagConf').value.trim().toUpperCase();
              // Só o número também serve: prefixo e família já estão decididos.
              tag = /^\d+$/.test(digitado)
                ? `${base}-${digitado.padStart(2, '0')}`
                : digitado;
              if (!lerTag(tag) || !tag.startsWith(base + '-')){
                document.getElementById('wTagConf').classList.add('err');
                document.getElementById('mTagConf').textContent =
                  `Escreva só o número, ou a tag inteira no formato ${base}-NN.`;
                return;
              }
            }
            f(); resolve(tag);
        } }
      ],
      aoAbrir: b => {
        const outro = b.querySelector('#rTagOutro');
        const campo = b.querySelector('#fTagConf');
        b.querySelectorAll('input[name="tagConf"]').forEach(r =>
          r.addEventListener('change', () => {
            campo.hidden = !outro.checked;
            if (outro.checked) campo.focus();
          }));
      }
    });
  });
}

/* ==================================================================== */
/* b) IMPORT DE INSTRUMENTOS EM MASSA                                   */
/* ==================================================================== */
function abaImportInstrumentos(el){
  el.innerHTML = `
    <div class="card">
      <div class="card-head"><span class="step">1</span><h2>Planilha</h2></div>
      <div class="card-body">
        <div class="warn-box i">
          <b>Obrigatórias:</b> <code>codigo</code> e <code>descricao</code>.<br>
          <b>Opcionais:</b> <code>familia</code> (informativo), <code>rastreabilidade</code>
          (obrigatória quando <code>status</code> for <code>solicitado</code>), <code>fabricante</code>,
          <code>resolucao</code>, <code>classificacao</code> (TMMDE ou REFERENCIA — a coluna
          antiga <code>tipo</code> continua valendo), <code>num_serie</code>,
          <code>observacoes</code>, <code>data_entrada</code> (AAAA-MM-DD ou DD/MM/AAAA),
          <code>nota_fiscal</code>, <code>pedido_compra</code>, <code>localizacao</code>,
          <code>standby</code> (sim/não).<br>
          Linha com <code>nota_fiscal</code> ou <code>pedido_compra</code> entra como
          <b>recebimento</b>; sem elas, como acervo já existente.
        </div>
        <div class="warn-box w">
          <b>Coluna <code>codigo</code> — a etiqueta manda.</b> Escreva a <b>tag inteira</b>
          (<code>P-PAQ-06</code>, <code>PR-BPM-03</code>) para o instrumento entrar com a
          etiqueta que ele já tem colada. A família sai do miolo da tag, e o prefixo
          precisa combinar com a classificação: <code>P-</code> para TMMDE,
          <code>PR-</code> para REFERENCIA.<br>
          Escrevendo só o <b>código da família</b> (<code>PAQ</code>), o sistema atribui o
          primeiro número livre — e a prévia mostra qual, antes de você confirmar.
        </div>
        <div class="warn-box i">
          <b>Instrumento de referência.</b> Padrão de aferição não tem exigência de calibração:
          <code>status</code>, <code>data_calibracao</code> e <code>standby</code> são ignorados
          nessas linhas. Use <code>observacoes</code> para rastreabilidade, laboratório,
          certificado e incerteza.
        </div>
        <div class="warn-box w">
          <b>Situação de calibração</b> — coluna <code>status</code>:
          <code>calibrado</code>, <code>descalibrado</code>, <code>solicitado</code> ou
          <code>em calibracao externa</code>. Em branco, entra como <b>descalibrado</b>.<br>
          Para <code>calibrado</code> é obrigatório preencher <code>data_calibracao</code> (AAAA-MM-DD) —
          sem data não existe validade, e o sistema calcula a próxima sozinho pela periodicidade da família.
          O certificado em PDF é anexado depois, na tela de Calibração.<br>
          Para <code>solicitado</code> é obrigatório preencher <code>rastreabilidade</code> — o número
          do pedido, requisição ou ordem de serviço que identifica a solicitação.<br><br>
          <b>Condição física</b> — coluna <code>situacao</code>: <code>ativo</code> ou <code>inativo</code>
          (aceita também <code>sucateado</code>, <code>vago</code>, <code>não entregue</code> e
          <code>danificado</code>, que já viram o motivo). Em branco, entra como <b>ativo</b>.
          Linhas inativas exigem <code>justificativa_inativo</code> com 10+ caracteres e não podem
          vir com a calibração solicitada ou em laboratório — inativar no meio da solicitação a
          abandona sem cancelá-la.
        </div>
        <div class="g3">
          <div class="field" id="wArqInstr">
            <label>Arquivo Excel ou CSV</label>
            <div class="file" id="dArqInstr">
              <input type="file" id="fArqInstr" accept=".xlsx,.xls,.csv">
              <div class="txt">Clique ou arraste a planilha aqui</div>
            </div>
            <div class="msg" id="mArqInstr"></div>
          </div>
          <div class="field">
            <label for="fTipoPadrao">Tipo padrão</label>
            <select id="fTipoPadrao">
              <option value="TMMDE">TMMDE — instrumento de uso</option>
              <option value="REFERENCIA">Referência</option>
            </select>
            <div class="hint">Usado só nas linhas sem a coluna "classificacao" e sem tag —
              quando a tag vem escrita, o prefixo dela decide.</div>
          </div>
          <div class="field">
            <label for="fEntradaPadrao">Data de entrada padrão</label>
            <input type="date" id="fEntradaPadrao" value="${hojeISO()}">
          </div>
        </div>
        <div style="margin-top:12px">
          <button class="btn btn-outline btn-sm" id="btModeloInstr">Baixar modelo de planilha</button>
        </div>
      </div>
    </div>
    <div id="previaInstr"></div>`;

  el.querySelector('#btModeloInstr').addEventListener('click', () =>
    modeloExcel('modelo-instrumentos',
      ['codigo','familia','descricao','fabricante','resolucao','classificacao','num_serie',
       'observacoes','data_entrada','nota_fiscal','pedido_compra','localizacao','standby',
       'status','data_calibracao','rastreabilidade','situacao','justificativa_inativo'],
      [
        // Uma linha por caso, para servir de referência de preenchimento.
        // As duas primeiras trazem a tag da etiqueta; as duas seguintes só o
        // código da família, e recebem o primeiro número livre.
        ['P-PAQ-06','Paquímetro','Paquímetro digital 0-150 mm','Mitutoyo','0,01 mm','TMMDE','12345',
         '','2026-01-15','NF-8891','PC-2026-0142','Armário A2','nao','calibrado','2026-02-10','','ativo',''],
        ['P-MIC-01','Micrômetro','Micrômetro externo 0-25 mm','Starrett','0,001 mm','TMMDE','67890',
         '','03/08/2025','','','Armário A2','nao','descalibrado','','','ativo',''],
        ['TOR','Torquímetro','Torquímetro estalo 20-100 Nm','Tramontina','1 Nm','TMMDE','55512',
         '','2025-11-20','','','Oficina','nao','solicitado','','PC-2026-0311','ativo',''],
        ['REL','Relógio comparador','Relógio comparador 0-10 mm','Mitutoyo','0,01 mm','TMMDE','33210',
         '','2024-05-14','','','','nao','descalibrado','','','nao encontrado',
         'Não localizado no inventário de agosto; segregado da lista mestre'],
        ['PR-BLP-01','Blocos padrão','Jogo de blocos padrão 87 peças','Mitutoyo','','REFERENCIA','99001',
         'Padrão grau 1 · certificado RBC 2026/0431','2026-03-01','','','','nao','','','','ativo','']
      ]));

  const inp = el.querySelector('#fArqInstr');
  inp.addEventListener('change', async () => {
    const arq = inp.files[0];
    const caixa = el.querySelector('#dArqInstr');
    caixa.classList.toggle('ok', !!arq);
    caixa.querySelector('.txt').textContent = arq ? arq.name : 'Clique ou arraste a planilha aqui';
    if (!arq) return;
    try { await previa(el, await lerPlanilha(arq)); }
    catch (e){ toast('Não foi possível ler a planilha: ' + msgErro(e), 'error'); }
  });
}

async function previa(el, linhas){
  const alvo = el.querySelector('#previaInstr');
  const tipoPadrao    = el.querySelector('#fTipoPadrao').value;
  const entradaPadrao = el.querySelector('#fEntradaPadrao').value || hojeISO();

  const porCodigo = new Map(familias.map(f => [chave(f.codigo), f]));
  const porNome   = new Map(familias.map(f => [chave(f.nome), f]));

  const hoje = hojeISO();

  /* Números já gastos por família+classificação, do banco e das linhas
     anteriores da própria planilha. Serve para duas coisas: recusar tag
     repetida e escolher o primeiro livre de quem veio sem tag. */
  const ocupados = new Map();   // 'P-PAQ' -> Set de números
  const gastos = base => {
    if (!ocupados.has(base)) ocupados.set(base, new Set());
    return ocupados.get(base);
  };
  (await listarTags()).forEach(t => {
    const p = lerTag(t);
    if (p) gastos(`${PREFIXO_DO_TIPO[p.tipo]}-${p.codigo}`).add(p.numero);
  });

  const itens = linhas.map((l, i) => {
    const problemas = [];

    /* A coluna `codigo` aceita as duas coisas: a tag inteira da etiqueta
       física (P-PAQ-06) ou só o código da família (PAQ). Com a tag, é o
       miolo dela que identifica a família — o nome da coluna `familia`
       se repete entre famílias diferentes e não serve de chave. */
    const bruto = String(l.codigo || l.familia_codigo || '').trim().toUpperCase();
    const daPlanilha = lerTag(bruto);
    const codigo = daPlanilha ? daPlanilha.codigo : bruto;

    const fam = porCodigo.get(chave(codigo)) || porNome.get(chave(l.familia || ''));

    // "classificacao" é o nome novo da coluna; "tipo" continua valendo
    // para não invalidar as planilhas que a metrologia já montou.
    const tipoBruto = String(l.classificacao || l.tipo || '').toUpperCase();
    const tipoColuna = tipoBruto === 'REFERENCIA' ? 'REFERENCIA'
                     : tipoBruto === 'TMMDE'      ? 'TMMDE' : null;
    // Sem a coluna, o prefixo da tag decide; sem tag, vale o padrão da tela.
    const tipo = tipoColuna || (daPlanilha ? daPlanilha.tipo : tipoPadrao);

    const conflitoPrefixo = !!(daPlanilha && tipoColuna && daPlanilha.tipo !== tipoColuna);
    if (conflitoPrefixo)
      problemas.push(`prefixo da tag ${daPlanilha.tag} não combina com a classificação ${tipoColuna}`);

    if (!fam) problemas.push('família não encontrada');
    if (!String(l.descricao || '').trim()) problemas.push('descrição vazia');

    /* ---- tag ----
       Vinda da planilha, é a etiqueta física e manda. Ausente, o
       instrumento recebe o primeiro número livre — e a prévia mostra
       qual, para a conferência acontecer antes de gravar. */
    let tag = null;
    if (bruto && !daPlanilha && !porCodigo.has(chave(codigo)) && fam)
      problemas.push(`"${bruto}" não é uma tag válida nem um código de família`);

    // Linha com prefixo brigando com a classificação não reserva número:
    // ela não vai ser importada, e reservar deslocaria as outras linhas.
    if (fam && daPlanilha && !conflitoPrefixo){
      const usados = gastos(`${PREFIXO_DO_TIPO[tipo]}-${fam.codigo}`);
      if (daPlanilha.codigo !== fam.codigo)
        problemas.push(`tag ${daPlanilha.tag} não corresponde à família ${fam.codigo}`);
      else if (usados.has(daPlanilha.numero))
        problemas.push(`tag ${daPlanilha.tag} já existe (no sistema ou em outra linha da planilha)`);
      else { tag = daPlanilha.tag; usados.add(daPlanilha.numero); }
    }

    /* ---- datas ---- */
    const dataLida = lerData(l.data_entrada);
    if (dataLida === null) problemas.push('data_entrada não é uma data (use AAAA-MM-DD ou DD/MM/AAAA)');
    const data = dataLida || entradaPadrao;

    /* ---- status de calibração ----
       Padrão de referência não entra nesta conta: ele não vence, então
       status e data de calibração são ignorados em vez de recusados —
       recusar a linha inteira por uma coluna que não se aplica só faria
       a metrologia limpar a planilha à mão. */
    const referencia = tipo === 'REFERENCIA';
    const statusBruto = referencia ? '' : chave(l.status || l.situacao_calibracao || '');
    let status = 'descalibrado';
    if (statusBruto){
      if (STATUS_PLANILHA[statusBruto]) status = STATUS_PLANILHA[statusBruto];
      else problemas.push(`status "${l.status}" não reconhecido`);
    }

    const calLida = referencia ? '' : lerData(l.data_calibracao);
    if (calLida === null) problemas.push('data_calibracao não é uma data (use AAAA-MM-DD ou DD/MM/AAAA)');
    const dataCal = calLida || null;
    if (!referencia && status === 'calibrado' && !dataCal)
      problemas.push('status "calibrado" exige data_calibracao preenchida');
    if (dataCal && dataCal > hoje)
      problemas.push('data_calibracao no futuro');
    if (dataCal && dataCal < data)
      problemas.push('data_calibracao anterior à data de entrada');

    /* Calibração solicitada exige a rastreabilidade do pedido — a mesma
       regra da tela, e a mesma do banco. Recusar aqui é melhor do que
       deixar a linha falhar no meio da importação, com o instrumento já
       criado e o status pela metade. */
    const rastreio = String(l.rastreabilidade || l.pedido_calibracao || l.pedido || '').trim();
    if (status === 'solicitado' && !rastreio)
      problemas.push('status "solicitado" exige a coluna rastreabilidade');

    /* ---- condição física ---- */
    const condBruta = chave(l.situacao || l.condicao_fisica || l.condicao || '');
    let condicao = 'ativo';
    if (condBruta){
      if (CONDICAO_PLANILHA[condBruta]) condicao = CONDICAO_PLANILHA[condBruta];
      else problemas.push(`situação "${l.situacao}" não reconhecida`);
    }
    const justInativo = String(l.justificativa_inativo || l.justificativa || '').trim();
    const motivoInativo = String(l.motivo_inativo || '').trim() || MOTIVO_DIRETO[condBruta] || 'Danificado';

    if (condicao === 'inativo'){
      if (justInativo.length < 10) problemas.push('inativo exige justificativa_inativo com 10+ caracteres');
      // Mesma regra da tela de Inventário: instrumento com calibração em
      // andamento não é inativado — inativar abandona a solicitação no
      // meio, sem cancelá-la.
      if (['solicitado','em_calibracao_externa'].includes(status))
        problemas.push('instrumento inativo não pode entrar com a calibração solicitada ou em laboratório');
    }

    return {
      linha: i + 2, ok: problemas.length === 0, problemas,
      familia: fam, codigo, tipo, referencia, status, condicao, dataCal,
      motivoInativo, justInativo, rastreio, tag, tagSugerida: false,
      dados: fam ? {
        familia_id: fam.id, tipo, tag,
        descricao: String(l.descricao || '').trim(),
        fabricante: l.fabricante || null,
        resolucao: l.resolucao || null,
        num_serie: l.num_serie || null,
        observacoes: l.observacoes || l.observacao || null,
        data_entrada: data,
        nota_fiscal: l.nota_fiscal || null,
        pedido_compra: l.pedido_compra || null,
        localizacao_normal: l.localizacao || l.localizacao_normal || null,
        // Referência não tem relógio de validade para pausar.
        standby: tipo === 'TMMDE' && /^(sim|s|true|1|x)$/i.test(String(l.standby || '')),
        origem: (l.nota_fiscal || l.pedido_compra) ? 'recebimento' : 'avulso'
      } : null
    };
  });

  /* Os números sugeridos são distribuídos só depois da validação: linha
     que vai ser ignorada não pode consumir um número e empurrar as
     outras, senão a coluna Tag da prévia mente sobre o que será criado. */
  itens.forEach(it => {
    if (!it.ok || it.tag || !it.familia) return;
    const usados = gastos(`${PREFIXO_DO_TIPO[it.tipo]}-${it.familia.codigo}`);
    let n = 1;
    while (usados.has(n)) n++;
    usados.add(n);
    it.tag = it.dados.tag = montarTag(it.tipo, it.familia.codigo, n);
    it.tagSugerida = true;
  });

  const validos = itens.filter(i => i.ok);

  alvo.innerHTML = `
    <div class="card">
      <div class="card-head"><span class="step">2</span><h2>Prévia</h2>
        <span class="right">${validos.length} de ${itens.length} prontos</span></div>
      <div class="card-body">
        ${itens.length - validos.length
          ? `<div class="warn-box w fixa">${itens.length - validos.length} linha(s) serão ignoradas.
             Corrija a planilha e importe de novo se elas forem necessárias.</div>` : ''}
        <div class="tbl-wrap"><table class="tbl" style="min-width:1180px">
          <thead><tr><th>Linha</th><th>Tag</th><th>Família</th><th>Tipo</th><th>Descrição</th>
                     <th>Entrada</th><th>Status</th><th>Calibração</th><th>Condição</th>
                     <th>Conferência</th></tr></thead>
          <tbody>${itens.map(i => `
            <tr class="${i.ok ? '' : 'l-descalibrado'}">
              <td class="num">${i.linha}</td>
              <td style="font-family:ui-monospace,Consolas,monospace;white-space:nowrap">
                ${i.tag ? esc(i.tag) : '—'}
                ${i.tag ? `<span class="bdg ${i.tagSugerida ? 'neutro' : 's-calibrado'}"
                   >${i.tagSugerida ? 'sugerida' : 'planilha'}</span>` : ''}
              </td>
              <td>${esc(i.familia ? i.familia.codigo + ' — ' + i.familia.nome : i.codigo || '—')}</td>
              <td>${esc(i.referencia ? 'Referência' : 'TMMDE')}</td>
              <td>${esc(i.dados?.descricao || '—')}</td>
              <td>${esc(i.dados?.data_entrada || '—')}</td>
              <td>${badge(i.referencia ? 'referencia' : i.status)}</td>
              <td>${esc(i.referencia ? 'não se aplica' : (i.dataCal ? fmtData(i.dataCal) : '—'))}</td>
              <td>${badgeCondicao(i.condicao)}</td>
              <td>${i.ok ? '<span class="bdg s-calibrado">Pronto</span>'
                         : '<span class="bdg s-descalibrado">'+esc(i.problemas.join(' · '))+'</span>'}</td>
            </tr>`).join('')}</tbody>
        </table></div>
      </div>
    </div>
    <div class="act-bar">
      <div style="font-size:12.5px;color:var(--muted);max-width:620px">
        As tags marcadas <b>planilha</b> entram exatamente como estão escritas.
        As marcadas <b>sugerida</b> receberam o primeiro número livre da família.
        Confira a coluna Tag agora: depois de importar, mudar a tag exige recadastrar.
      </div>
      <div class="act-group">
        <button class="btn btn-red" id="btImportar" ${validos.length ? '' : 'disabled'}>
          IMPORTAR ${validos.length} INSTRUMENTO(S)</button>
      </div>
    </div>
    <div id="resultadoImport"></div>`;

  const bt = alvo.querySelector('#btImportar');
  if (!bt) return;
  bt.addEventListener('click', async () => {
    if (!await confirmar({
      titulo:'Confirmar importação',
      texto:`Serão cadastrados <b>${validos.length}</b> instrumentos. Esta ação não tem desfazer em lote.`,
      rotuloOk:'Importar'
    })) return;

    bt.disabled = true;
    const res = alvo.querySelector('#resultadoImport');
    const falhas = [];
    let feitos = 0;

    for (const item of validos){
      bt.textContent = `IMPORTANDO ${feitos + 1} de ${validos.length}…`;
      try {
        // 1. O instrumento nasce com a calibração, quando a planilha traz a data.
        //    É o INSERT da calibração que dispara o cálculo da próxima e põe o
        //    status_workflow em 'calibrado' — não adianta gravar o status na mão.
        const calibracao = item.dataCal
          ? { data_calibracao: item.dataCal, standby_apos: item.dados.standby }
          : null;
        const novo = await criarInstrumentoCompleto(item.dados, null, calibracao);

        // 2. Estados declarados pelo usuário (solicitado / em calibração externa).
        //    'descalibrado' já é o padrão; 'calibrado' veio do passo 1.
        if (item.status === 'solicitado' || item.status === 'em_calibracao_externa'){
          await definirStatusWorkflow(novo.id, item.status,
            'Importação em massa de planilha', item.rastreio || null);
        }

        // 3. Condição física, por último: instrumento inativo não deve
        //    atrapalhar os passos anteriores.
        if (item.condicao === 'inativo'){
          await inativarInstrumento(novo.id, item.motivoInativo, item.justInativo);
        }

        feitos++;
      }
      catch (e){ falhas.push({ linha:item.linha, erro:msgErro(e) }); }
    }

    res.innerHTML = `
      <div class="card"><div class="card-body">
        <div class="warn-box ${falhas.length ? 'w' : 'g'}">
          <b>${feitos}</b> instrumento(s) cadastrados com sucesso.
          ${falhas.length ? `<br><b>${falhas.length}</b> falharam:` : ''}
        </div>
        ${falhas.length ? `<ul style="font-size:13px;margin-left:18px">${
          falhas.map(f => `<li>Linha ${f.linha}: ${esc(f.erro)}</li>`).join('')}</ul>` : ''}
        ${feitos ? `
        <!-- 'fixa': é a única pendência que a importação deixa em aberto,
             e ela não aparece em lugar nenhum se não for dita aqui. A
             planilha não carrega imagens; a foto é o que identifica o
             instrumento na conferência do inventário. -->
        <div class="warn-box w fixa" style="margin-top:14px">
          <b>Estes instrumentos entraram sem foto.</b> A planilha não carrega imagens —
          a foto se anexa depois, pela pasta do instrumento, sem recadastrar nada.
          Em <b>Arquivos</b>, o indicador <b>Sem foto</b> lista quem ainda falta.
          <div style="margin-top:10px">
            <button class="btn btn-outline btn-sm" id="btIrArquivos">Ir para Arquivos</button>
          </div>
        </div>` : ''}
      </div></div>`;

    const btArq = res.querySelector('#btIrArquivos');
    if (btArq) btArq.addEventListener('click', () => irPara('arquivos'));

    bt.textContent = 'IMPORTAÇÃO CONCLUÍDA';
    toast(`${feitos} instrumento(s) importados.`, falhas.length ? 'error' : 'success');
    familias = await listarFamilias();
  });
}

/* ==================================================================== */
/* c) FAMÍLIAS                                                          */
/* ==================================================================== */
async function abaFamilias(el){
  const fases = await listarTodasFases();
  const porFamilia = fases.reduce((m,f) => { (m[f.familia_id] ||= []).push(f); return m; }, {});

  el.innerHTML = `
    <div class="card">
      <div class="card-head"><span class="step">1</span><h2>Nova família</h2></div>
      <div class="card-body">
        <div class="g4">
          <div class="field" id="wCodigo">
            <label for="fCodigo">Código<span class="req">*</span></label>
            <input type="text" id="fCodigo" class="cod" maxlength="10" placeholder="PAQ">
            <div class="hint">2 a 10 letras/números maiúsculos. Vira o miolo da tag.</div>
            <div class="msg" id="mCodigo"></div>
          </div>
          <div class="field" id="wNome">
            <label for="fNome">Nome<span class="req">*</span></label>
            <input type="text" id="fNome" placeholder="Paquímetro">
            <div class="msg" id="mNome"></div>
          </div>
          <div class="field" id="wPeriodicidade">
            <label for="fPeriodicidade">Periodicidade (meses)<span class="req">*</span></label>
            <input type="number" id="fPeriodicidade" min="1" max="600" value="12">
            <div class="hint">Intervalo padrão entre calibrações.</div>
            <div class="msg" id="mPeriodicidade"></div>
          </div>
          <div class="field field-inline" style="align-self:end;padding-bottom:8px">
            <input type="checkbox" id="fCustomizada">
            <label for="fCustomizada">Periodicidade customizada por fases</label>
          </div>
        </div>

        <div id="blocoFases" hidden style="margin-top:16px">
          <div class="sec-title">Fases de periodicidade</div>
          <div class="warn-box i">
            A fase vigente é escolhida pela <b>idade</b> do instrumento. Deixe
            <b>vigência</b> em branco na última fase: ela passa a valer indefinidamente.
          </div>
          <div id="listaFases"></div>
          <button type="button" class="btn btn-outline btn-sm" id="btAddFase" style="margin-top:9px">
            + Adicionar fase</button>
        </div>
      </div>
    </div>
    <div class="act-bar">
      <div class="act-group"></div>
      <div class="act-group">
        <button class="btn btn-red" id="btSalvarFam" style="min-width:220px">CRIAR FAMÍLIA</button>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Famílias cadastradas</h2><span class="right">${familias.length}</span></div>
      <div class="card-body">
        ${familias.length ? `
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Código</th><th>Nome</th><th>Periodicidade</th><th>Fases</th><th></th></tr></thead>
          <tbody>${familias.map(f => `
            <tr>
              <td class="mono">${esc(f.codigo)}</td>
              <td>${esc(f.nome)}</td>
              <td>${f.periodicidade_customizada
                    ? '<span class="bdg s-solicitado">Customizada</span>'
                    : esc(f.periodicidade_meses) + ' meses'}</td>
              <td style="font-size:12px;color:var(--muted)">${
                (porFamilia[f.id] || []).map(x =>
                  `${x.intervalo_meses}m até ${x.vigencia_ate_meses ?? '∞'}m`).join(' · ') || '—'}</td>
              <td><button class="btn btn-outline btn-sm" data-editar="${esc(f.id)}">Alterar periodicidade</button></td>
            </tr>`).join('')}</tbody>
        </table></div>` : htmlVazio('Nenhuma família cadastrada ainda.')}
      </div>
    </div>`;

  /* ---- fases da nova família ---- */
  const bloco = el.querySelector('#blocoFases');
  const lista = el.querySelector('#listaFases');
  el.querySelector('#fCustomizada').addEventListener('change', e => {
    bloco.hidden = !e.target.checked;
    if (e.target.checked && !lista.children.length) addFase(lista);
  });
  el.querySelector('#btAddFase').addEventListener('click', () => addFase(lista));

  el.querySelector('#fCodigo').addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'');
  });

  el.querySelector('#btSalvarFam').addEventListener('click', async ev => {
    limparErros(el);
    const val = familiaValida(el);
    if (!val) return;

    const bt = ev.currentTarget;
    bt.disabled = true; bt.textContent = 'SALVANDO…';
    try {
      await criarFamilia(val);
      toast('Família ' + val.codigo + ' criada.', 'success');
      familias = await listarFamilias();
      await abaFamilias(el);
    } catch (e){ toast(msgErro(e), 'error'); }
    finally { bt.disabled = false; bt.textContent = 'CRIAR FAMÍLIA'; }
  });

  el.querySelectorAll('[data-editar]').forEach(b =>
    b.addEventListener('click', () => modalPeriodicidade(b.dataset.editar, porFamilia, el)));
}

function addFase(lista, dados = {}){
  const i = lista.children.length + 1;
  const div = document.createElement('div');
  div.className = 'g4';
  div.style.cssText = 'align-items:end;margin-bottom:10px;padding:10px;background:var(--surface2);border-radius:8px';
  div.innerHTML = `
    <div class="field"><label>Ordem</label>
      <input type="number" class="fOrdem" value="${dados.ordem ?? i}" min="1" readonly></div>
    <div class="field"><label>Intervalo (meses)</label>
      <input type="number" class="fIntervalo" value="${dados.intervalo_meses ?? 12}" min="1" max="600"></div>
    <div class="field"><label>Vigência até (meses de idade)</label>
      <input type="number" class="fVigencia" value="${dados.vigencia_ate_meses ?? ''}" min="1" placeholder="em branco = última fase"></div>
    <div class="field"><label>Âncora da idade</label>
      <select class="fAncora">
        <option value="entrada" ${dados.ancora !== 'primeira_calibracao' ? 'selected' : ''}>Data de entrada</option>
        <option value="primeira_calibracao" ${dados.ancora === 'primeira_calibracao' ? 'selected' : ''}>Primeira calibração</option>
      </select>
      <button type="button" class="link-btn" style="margin-top:4px;text-align:left" data-remover>Remover fase</button>
    </div>`;
  div.querySelector('[data-remover]').addEventListener('click', () => {
    div.remove();
    Array.from(lista.children).forEach((c,k) => c.querySelector('.fOrdem').value = k+1);
  });
  lista.appendChild(div);
}

function lerFases(lista){
  return Array.from(lista.children).map((c,i) => ({
    ordem: i + 1,
    intervalo_meses: parseInt(c.querySelector('.fIntervalo').value, 10),
    vigencia_ate_meses: c.querySelector('.fVigencia').value
      ? parseInt(c.querySelector('.fVigencia').value, 10) : null,
    ancora: c.querySelector('.fAncora').value
  }));
}

function familiaValida(el){
  const val = validarFamilia(el);
  return val.encerrar() ? val.dados : null;
}

function validarFamilia(el){
  const v = id => el.querySelector('#f'+id).value.trim();
  const val = validador();
  const codigo = v('Codigo').toUpperCase();
  const nome   = v('Nome');
  const per    = parseInt(v('Periodicidade'), 10);
  const custom = el.querySelector('#fCustomizada').checked;
  const fases  = custom ? lerFases(el.querySelector('#listaFases')) : [];

  if (!/^[A-Z0-9]{2,10}$/.test(codigo)) val.falha('Codigo','Use 2 a 10 letras ou números.');
  if (familias.some(f => f.codigo === codigo)) val.falha('Codigo','Já existe uma família com este código.');
  if (nome.length < 2) val.falha('Nome','Escreva o nome da família.');
  if (!(per >= 1 && per <= 600)) val.falha('Periodicidade','Informe um número de 1 a 600.');
  if (custom && !fases.length) val.falha('Periodicidade','Adicione pelo menos uma fase, ou desmarque "customizada".');
  if (custom && fases.some(f => !(f.intervalo_meses >= 1)))
    val.falha('Periodicidade','Toda fase precisa de um intervalo em meses.');

  val.dados = { codigo, nome, periodicidade_meses: per, periodicidade_customizada: custom, fases };
  return val;
}

/* Alteração de periodicidade — auditada, justificativa obrigatória. */
function modalPeriodicidade(familiaId, porFamilia, elPai){
  const fam = familias.find(f => f.id === familiaId);
  abrirModal({
    titulo: `Periodicidade — ${fam.codigo} · ${fam.nome}`,
    largo: true,
    corpo: `
      <div class="warn-box w">
        Toda alteração de periodicidade é gravada na trilha de auditoria com o seu e-mail,
        a data e a justificativa. A mudança vale para as <b>próximas</b> calibrações;
        as datas já calculadas não mudam sozinhas.
      </div>
      <div class="g2">
        <div class="field" id="wPer">
          <label for="fPer">Periodicidade padrão (meses)</label>
          <input type="number" id="fPer" min="1" max="600" value="${esc(fam.periodicidade_meses)}">
          <div class="msg" id="mPer"></div>
        </div>
        <div class="field field-inline" style="align-self:end;padding-bottom:10px">
          <input type="checkbox" id="fCustom" ${fam.periodicidade_customizada ? 'checked' : ''}>
          <label for="fCustom">Customizada por fases</label>
        </div>
      </div>
      <div id="blocoFasesEdit" ${fam.periodicidade_customizada ? '' : 'hidden'}>
        <div class="sec-title">Fases</div>
        <div id="listaFasesEdit"></div>
        <button type="button" class="btn btn-outline btn-sm" id="btAddFaseEdit">+ Adicionar fase</button>
      </div>`,
    acoes: [
      { rotulo:'Cancelar', classe:'btn-outline', onClick: f => f() },
      { rotulo:'Salvar alteração', classe:'btn-red', onClick: async (fechar, bt) => {
          const per    = parseInt(document.getElementById('fPer').value, 10);
          const custom = document.getElementById('fCustom').checked;
          const fases  = custom ? lerFases(document.getElementById('listaFasesEdit')) : [];
          if (!(per >= 1 && per <= 600)){ toast('Periodicidade inválida.','error'); return; }
          if (custom && !fases.length){ toast('Adicione ao menos uma fase.','error'); return; }

          fechar();
          const just = await pedirJustificativa({
            titulo:'Justificativa da alteração de periodicidade',
            texto:`Família <b>${esc(fam.codigo)} — ${esc(fam.nome)}</b>.`,
            rotuloOk:'Gravar alteração'
          });
          if (!just) return;

          try {
            await alterarPeriodicidade({
              familia_id: familiaId, periodicidade_meses: per,
              customizada: custom, fases, justificativa: just
            });
            toast('Periodicidade alterada e registrada na auditoria.','success');
            familias = await listarFamilias();
            await abaFamilias(elPai);
          } catch (e){ toast(msgErro(e),'error'); }
      } }
    ],
    aoAbrir: body => {
      const lista = body.querySelector('#listaFasesEdit');
      (porFamilia[familiaId] || []).forEach(f => addFase(lista, f));
      if (!lista.children.length) addFase(lista);
      body.querySelector('#fCustom').addEventListener('change', e =>
        body.querySelector('#blocoFasesEdit').hidden = !e.target.checked);
      body.querySelector('#btAddFaseEdit').addEventListener('click', () => addFase(lista));
    }
  });
}

/* ==================================================================== */
/* d) IMPORT DE FAMÍLIAS                                                */
/* ==================================================================== */
function abaImportFamilias(el){
  el.innerHTML = `
    <div class="card">
      <div class="card-head"><span class="step">1</span><h2>Planilha de famílias</h2></div>
      <div class="card-body">
        <div class="warn-box i">
          Colunas esperadas: <b>codigo</b>, <b>familia</b> (nome), <b>periodicidade</b> (meses),
          <b>periodicidade_personalizada</b> (sim/não).<br>
          Famílias marcadas como personalizadas entram sem fases: configure as fases
          depois, na aba <b>Famílias</b>.
        </div>
        <div class="field" id="wArqFam" style="max-width:460px">
          <label>Arquivo Excel ou CSV</label>
          <div class="file" id="dArqFam">
            <input type="file" id="fArqFam" accept=".xlsx,.xls,.csv">
            <div class="txt">Clique ou arraste a planilha aqui</div>
          </div>
        </div>
        <div style="margin-top:12px">
          <button class="btn btn-outline btn-sm" id="btModeloFam">Baixar modelo de planilha</button>
        </div>
      </div>
    </div>
    <div id="previaFam"></div>`;

  el.querySelector('#btModeloFam').addEventListener('click', () =>
    modeloExcel('modelo-familias',
      ['codigo','familia','periodicidade','periodicidade_personalizada'],
      [['PAQ','Paquímetro','12','nao'],
       ['BLP','Blocos padrão','36','sim']]));

  const inp = el.querySelector('#fArqFam');
  inp.addEventListener('change', async () => {
    const arq = inp.files[0];
    const caixa = el.querySelector('#dArqFam');
    caixa.classList.toggle('ok', !!arq);
    caixa.querySelector('.txt').textContent = arq ? arq.name : 'Clique ou arraste a planilha aqui';
    if (!arq) return;

    try {
      const linhas = await lerPlanilha(arq);
      const existentes = new Set(familias.map(f => chave(f.codigo)));

      const itens = linhas.map((l,i) => {
        const codigo = String(l.codigo || '').toUpperCase().replace(/[^A-Z0-9]/g,'');
        const nome   = String(l.familia || l.nome || '').trim();
        const per    = parseInt(l.periodicidade || l.periodicidade_meses || '', 10);
        const custom = /^(sim|s|true|1|x)$/i.test(String(l.periodicidade_personalizada || l.periodicidade_customizada || ''));
        const problemas = [];
        if (!/^[A-Z0-9]{2,10}$/.test(codigo)) problemas.push('código inválido');
        else if (existentes.has(chave(codigo))) problemas.push('código já existe');
        if (nome.length < 2) problemas.push('nome vazio');
        if (!(per >= 1 && per <= 600)) problemas.push('periodicidade inválida');
        return { linha:i+2, ok:!problemas.length, problemas,
                 dados:{ codigo, nome, periodicidade_meses:per, periodicidade_customizada:custom, fases:[] } };
      });

      const validos = itens.filter(i => i.ok);
      const alvo = el.querySelector('#previaFam');
      alvo.innerHTML = `
        <div class="card">
          <div class="card-head"><span class="step">2</span><h2>Prévia</h2>
            <span class="right">${validos.length} de ${itens.length} prontas</span></div>
          <div class="card-body">
            <div class="tbl-wrap"><table class="tbl">
              <thead><tr><th>Linha</th><th>Código</th><th>Nome</th><th>Periodicidade</th>
                         <th>Customizada</th><th>Situação</th></tr></thead>
              <tbody>${itens.map(i => `
                <tr class="${i.ok ? '' : 'l-descalibrado'}">
                  <td class="num">${i.linha}</td>
                  <td class="mono">${esc(i.dados.codigo || '—')}</td>
                  <td>${esc(i.dados.nome || '—')}</td>
                  <td class="num">${esc(isNaN(i.dados.periodicidade_meses) ? '—' : i.dados.periodicidade_meses)}</td>
                  <td>${i.dados.periodicidade_customizada ? 'Sim' : 'Não'}</td>
                  <td>${i.ok ? '<span class="bdg s-calibrado">Pronta</span>'
                             : '<span class="bdg s-descalibrado">'+esc(i.problemas.join(', '))+'</span>'}</td>
                </tr>`).join('')}</tbody>
            </table></div>
          </div>
        </div>
        <div class="act-bar"><div class="act-group"></div><div class="act-group">
          <button class="btn btn-red" id="btImpFam" ${validos.length ? '' : 'disabled'}>
            IMPORTAR ${validos.length} FAMÍLIA(S)</button>
        </div></div>
        <div id="resFam"></div>`;

      const bt = alvo.querySelector('#btImpFam');
      bt.addEventListener('click', async () => {
        bt.disabled = true;
        const falhas = []; let feitos = 0;
        for (const it of validos){
          bt.textContent = `IMPORTANDO ${feitos+1} de ${validos.length}…`;
          try { await criarFamilia(it.dados); feitos++; }
          catch (e){ falhas.push({ linha:it.linha, erro:msgErro(e) }); }
        }
        familias = await listarFamilias();
        alvo.querySelector('#resFam').innerHTML = `
          <div class="card"><div class="card-body">
            <div class="warn-box ${falhas.length ? 'w' : 'g'}"><b>${feitos}</b> família(s) criadas.
            ${falhas.length ? `<br><b>${falhas.length}</b> falharam.` : ''}</div>
            ${falhas.length ? `<ul style="font-size:13px;margin-left:18px">${
              falhas.map(f => `<li>Linha ${f.linha}: ${esc(f.erro)}</li>`).join('')}</ul>` : ''}
          </div></div>`;
        bt.textContent = 'IMPORTAÇÃO CONCLUÍDA';
        toast(`${feitos} família(s) importadas.`, falhas.length ? 'error' : 'success');
      });
    } catch (e){ toast('Não foi possível ler a planilha: ' + msgErro(e), 'error'); }
  });
}
