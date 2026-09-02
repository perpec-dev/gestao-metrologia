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
         criarInstrumentoCompleto, definirStatusWorkflow, inativarInstrumento } from '../supabase.js';
import { souAdmin } from '../auth.js';
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
          A tag definitiva é confirmada pelo servidor no momento de salvar.
          Se outro usuário cadastrar um instrumento da mesma família antes de você,
          a sua tag avança sozinha — sem duplicar.
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
    bt.disabled = true; bt.textContent = 'SALVANDO…';
    try {
      const dados = await coletarFormInstrumento(form, {
        comDocumentos:true, comInspecao:true, comCertificado:true
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

/* ==================================================================== */
/* b) IMPORT DE INSTRUMENTOS EM MASSA                                   */
/* ==================================================================== */
function abaImportInstrumentos(el){
  el.innerHTML = `
    <div class="card">
      <div class="card-head"><span class="step">1</span><h2>Planilha</h2></div>
      <div class="card-body">
        <div class="warn-box i">
          <b>Obrigatórias:</b> <code>codigo</code> (código da família, ex. PAQ) e <code>descricao</code>.<br>
          <b>Opcionais:</b> <code>familia</code> (informativo), <code>fabricante</code>,
          <code>resolucao</code>, <code>classificacao</code> (TMMDE ou REFERENCIA — a coluna
          antiga <code>tipo</code> continua valendo), <code>num_serie</code>,
          <code>observacoes</code>, <code>data_entrada</code> (AAAA-MM-DD),
          <code>nota_fiscal</code>, <code>pedido_compra</code>, <code>localizacao</code>,
          <code>standby</code> (sim/não).<br>
          Linha com <code>nota_fiscal</code> ou <code>pedido_compra</code> entra como
          <b>recebimento</b>; sem elas, como acervo já existente.
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
          O certificado em PDF é anexado depois, na tela de Calibração.<br><br>
          <b>Condição física</b> — coluna <code>situacao</code>: <code>ativo</code> ou <code>inativo</code>
          (aceita também <code>sucateado</code>, <code>vago</code>, <code>não entregue</code> e
          <code>danificado</code>, que já viram o motivo). Em branco, entra como <b>ativo</b>.
          Linhas inativas exigem <code>justificativa_inativo</code> e ${souAdmin()
            ? 'só você, como administrador, pode importá-las.'
            : '<b>papel de administrador</b> — no seu perfil elas serão recusadas na prévia.'}
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
            <div class="hint">Usado nas linhas sem a coluna "tipo".</div>
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
       'status','data_calibracao','situacao','justificativa_inativo'],
      [
        // Uma linha por caso, para servir de referência de preenchimento.
        ['PAQ','Paquímetro','Paquímetro digital 0-150 mm','Mitutoyo','0,01 mm','TMMDE','12345',
         '','2026-01-15','NF-8891','PC-2026-0142','Armário A2','nao','calibrado','2026-02-10','ativo',''],
        ['MIC','Micrômetro','Micrômetro externo 0-25 mm','Starrett','0,001 mm','TMMDE','67890',
         '','2025-08-03','','','Armário A2','nao','descalibrado','','ativo',''],
        ['TOR','Torquímetro','Torquímetro estalo 20-100 Nm','Tramontina','1 Nm','TMMDE','55512',
         '','2025-11-20','','','Oficina','nao','em calibracao externa','','ativo',''],
        ['REL','Relógio comparador','Relógio comparador 0-10 mm','Mitutoyo','0,01 mm','TMMDE','33210',
         '','2024-05-14','','','','nao','descalibrado','','nao encontrado',
         'Não localizado no inventário de agosto; segregado da lista mestre'],
        ['BLP','Blocos padrão','Jogo de blocos padrão 87 peças','Mitutoyo','','REFERENCIA','99001',
         'Padrão grau 1 · certificado RBC 2026/0431','2026-03-01','','','','nao','','','ativo','']
      ]));

  const inp = el.querySelector('#fArqInstr');
  inp.addEventListener('change', async () => {
    const arq = inp.files[0];
    const caixa = el.querySelector('#dArqInstr');
    caixa.classList.toggle('ok', !!arq);
    caixa.querySelector('.txt').textContent = arq ? arq.name : 'Clique ou arraste a planilha aqui';
    if (!arq) return;
    try { previa(el, await lerPlanilha(arq)); }
    catch (e){ toast('Não foi possível ler a planilha: ' + msgErro(e), 'error'); }
  });
}

function previa(el, linhas){
  const alvo = el.querySelector('#previaInstr');
  const tipoPadrao    = el.querySelector('#fTipoPadrao').value;
  const entradaPadrao = el.querySelector('#fEntradaPadrao').value || hojeISO();

  const porCodigo = new Map(familias.map(f => [chave(f.codigo), f]));
  const porNome   = new Map(familias.map(f => [chave(f.nome), f]));

  const hoje = hojeISO();
  const admin = souAdmin();

  const itens = linhas.map((l, i) => {
    const codigo = l.codigo || l.familia_codigo || '';
    const fam = porCodigo.get(chave(codigo)) || porNome.get(chave(l.familia || ''));
    // "classificacao" é o nome novo da coluna; "tipo" continua valendo
    // para não invalidar as planilhas que a metrologia já montou.
    const tipoBruto = String(l.classificacao || l.tipo || '').toUpperCase();
    const tipo = tipoBruto === 'REFERENCIA' ? 'REFERENCIA'
               : tipoBruto === 'TMMDE'      ? 'TMMDE' : tipoPadrao;
    const problemas = [];

    if (!fam) problemas.push('família não encontrada');
    if (!String(l.descricao || '').trim()) problemas.push('descrição vazia');

    const data = /^\d{4}-\d{2}-\d{2}$/.test(l.data_entrada || '') ? l.data_entrada : entradaPadrao;

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

    const dataCal = !referencia && /^\d{4}-\d{2}-\d{2}$/.test(l.data_calibracao || '')
      ? l.data_calibracao : null;
    if (!referencia && status === 'calibrado' && !dataCal)
      problemas.push('status "calibrado" exige data_calibracao no formato AAAA-MM-DD');
    if (dataCal && dataCal > hoje)
      problemas.push('data_calibracao no futuro');
    if (dataCal && dataCal < data)
      problemas.push('data_calibracao anterior à data de entrada');

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
      if (!admin) problemas.push('só administrador importa instrumento inativo');
      else if (justInativo.length < 10) problemas.push('inativo exige justificativa_inativo com 10+ caracteres');
    }

    return {
      linha: i + 2, ok: problemas.length === 0, problemas,
      familia: fam, codigo, tipo, referencia, status, condicao, dataCal,
      motivoInativo, justInativo,
      dados: fam ? {
        familia_id: fam.id, tipo,
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

  const validos = itens.filter(i => i.ok);

  alvo.innerHTML = `
    <div class="card">
      <div class="card-head"><span class="step">2</span><h2>Prévia</h2>
        <span class="right">${validos.length} de ${itens.length} prontos</span></div>
      <div class="card-body">
        ${itens.length - validos.length
          ? `<div class="warn-box w">${itens.length - validos.length} linha(s) serão ignoradas.
             Corrija a planilha e importe de novo se elas forem necessárias.</div>` : ''}
        <div class="tbl-wrap"><table class="tbl" style="min-width:1040px">
          <thead><tr><th>Linha</th><th>Família</th><th>Tipo</th><th>Descrição</th>
                     <th>Entrada</th><th>Status</th><th>Calibração</th><th>Condição</th>
                     <th>Conferência</th></tr></thead>
          <tbody>${itens.map(i => `
            <tr class="${i.ok ? '' : 'l-descalibrado'}">
              <td class="num">${i.linha}</td>
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
      <div style="font-size:12.5px;color:var(--muted)">As tags são geradas pelo servidor, em sequência, uma por linha.</div>
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
          await definirStatusWorkflow(novo.id, item.status, 'Importação em massa de planilha');
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
      </div></div>`;
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
