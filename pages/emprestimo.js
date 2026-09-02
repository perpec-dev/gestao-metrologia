/* =====================================================================
   EMPRÉSTIMO — saída e devolução de instrumento.

   Regra 4: só sai instrumento calibrado. A tela bloqueia antes do clique
   para não fazer o usuário perder tempo; quem decide de verdade é a RPC
   registrar_movimentacao, no banco.

   Regra 5: posse e externo não salvam sem o termo de responsabilidade.
   ===================================================================== */
import { esc, fmtDT, fmtData, hojeISO, p2, slug, chave, toast, msgErro, debounce,
         htmlVazio, htmlCarregando, validador, limparErros, delegar,
         lerXLSX, lerPDFMake, baixarBlob, lembrar, lembrado } from '../utils.js';
import { listarInstrumentos, listarEmprestimosAbertos, registrarMovimentacao,
         registrarDevolucao, listarHistoricoEmprestimos, enviarArquivo,
         listarEmailsSetor, cfgLista, ouvir, abrirArquivo,
         pastaDoInstrumento } from '../supabase.js';
import { CONFIG } from '../config.js';
import { badge, PODE_EMPRESTAR } from '../components/status-badge.js';
import { abrirModal } from '../components/modal.js';
import { criarTabela } from '../components/tabela.js';
import { meuNome } from '../auth.js';

let desligarRealtime = null;
let instrumentos = [];
let escolhido = null;
let raiz = null;

/* Histórico: resultado da última consulta e o recorte que a gerou.
   O recorte é congelado no momento de consultar, não lido do formulário
   na hora de exportar — entre uma coisa e outra o usuário pode ter mexido
   nos filtros sem clicar em Consultar. */
/* E-mail do responsável por setor, cadastrado na Administração.
   Carregado uma vez por visita: é lista curta e quase estática. */
let emailsSetor = new Map();

/* Em aberto: a lista veio do servidor uma vez, e trocar a visualização
   entre casual, posse e externo é recorte em memória. */
let abertos = [];
let filtroTipo = '';          // '' = todos

let historico = [];
let histConsultado = false;   // consulta vazia também conta: não repetir
let tabelaHist = null;
let descHist = { titulo:'Histórico de empréstimos', linha:'' };

export function destroy(){
  if (desligarRealtime){ desligarRealtime(); desligarRealtime = null; }
  instrumentos = []; escolhido = null; raiz = null;
  emailsSetor = new Map();
  abertos = [];
  historico = []; histConsultado = false; tabelaHist = null;
}

/* ==================================================================== */
export async function render(container, params = []){
  raiz = container;
  const setores = cfgLista('setores');
  filtroTipo = lembrado('filtros.emprestimoAberto', '') || '';

  container.innerHTML = `
    <div class="subtabs">
      <button class="subtab sel" data-pane="saida">Nova saída</button>
      <button class="subtab" data-pane="abertos">Em aberto</button>
      <button class="subtab" data-pane="historico">Histórico</button>
    </div>

    <section class="pane on" id="pane-saida">
      <div class="card">
        <div class="card-head"><span class="step">1</span><h2>Instrumento</h2></div>
        <div class="card-body">
          <div class="field ac" id="wInstrumento" style="max-width:560px">
            <label for="fInstrumento">Buscar por tag ou descrição<span class="req">*</span></label>
            <input type="text" id="fInstrumento" placeholder="Digite P-PAQ-01, paquímetro…" autocomplete="off">
            <div class="ac-lista" id="acLista" hidden></div>
            <div class="msg" id="mInstrumento"></div>
          </div>
          <div id="fichaInstrumento" style="margin-top:14px"></div>
        </div>
      </div>

      <div class="card" id="cardDados" hidden>
        <div class="card-head"><span class="step">2</span><h2>Responsabilidade</h2></div>
        <div class="card-body">
          <div class="g3">
            <div class="field" id="wTipoEmp">
              <label for="fTipoEmp">Tipo de empréstimo<span class="req">*</span></label>
              <select id="fTipoEmp">
                <option value="casual">Casual — uso pontual, devolve no mesmo dia</option>
                <option value="posse">Posse — fica com o responsável</option>
                <option value="externo">Externo — sai da empresa</option>
              </select>
              <div class="hint" id="dicaTipo"></div>
              <div class="msg" id="mTipoEmp"></div>
            </div>
            <div class="field" id="wEntregue">
              <label for="fEntregue">Entregue por<span class="req">*</span></label>
              <input type="text" id="fEntregue" placeholder="Quem da Metrologia entregou">
              <div class="msg" id="mEntregue"></div>
            </div>
            <div class="field" id="wResponsavel">
              <label for="fResponsavel">Responsável pelo instrumento<span class="req">*</span></label>
              <input type="text" id="fResponsavel" placeholder="Quem está levando">
              <div class="msg" id="mResponsavel"></div>
            </div>
            <div class="field" id="wSetor">
              <label for="fSetor">Setor<span class="req">*</span></label>
              <select id="fSetor"><option value="">Selecione…</option>
                ${setores.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select>
              <div class="msg" id="mSetor"></div>
            </div>
            <div class="field" id="wPrevisto">
              <label for="fPrevisto">Devolução prevista</label>
              <input type="datetime-local" id="fPrevisto">
              <div class="hint">Opcional, mas ajuda a cobrar a devolução.</div>
            </div>
            <div class="field" id="wTermo">
              <label>Termo de responsabilidade<span class="req" id="reqTermo" hidden>*</span></label>
              <div class="file"><input type="file" id="fTermo" accept="application/pdf,image/*">
                <div class="txt">Clique ou arraste o termo assinado</div></div>
              <div class="hint" id="dicaTermo">Obrigatório para posse e externo.</div>
              <div class="msg" id="mTermo"></div>
            </div>
          </div>

          <details style="margin-top:14px">
            <summary style="cursor:pointer;font-size:13px;font-weight:700;color:var(--muted)">
              Texto do termo de responsabilidade</summary>
            <p style="font-size:13.5px;line-height:1.6;font-style:italic;color:var(--muted);margin-top:8px">
              ${esc(CONFIG.TERMO)}</p>
          </details>
        </div>
      </div>

      <div class="act-bar" id="barraSalvar" hidden>
        <div id="avisoTrava" style="font-size:13px;font-weight:700"></div>
        <div class="act-group">
          <button class="btn btn-red btn-xl" id="btSaida" style="width:auto;min-width:280px" disabled>
            REGISTRAR SAÍDA</button>
        </div>
      </div>
    </section>

    <section class="pane" id="pane-abertos">
      <div id="listaAbertos">${htmlCarregando()}</div>
    </section>

    <section class="pane" id="pane-historico">
      <div class="card">
        <div class="card-head"><h2>Filtros do histórico</h2></div>
        <div class="card-body">
          <div class="g4">
            <div class="field">
              <label for="hDe">Saída — de</label>
              <input type="date" id="hDe">
            </div>
            <div class="field">
              <label for="hAte">Saída — até</label>
              <input type="date" id="hAte">
            </div>
            <div class="field">
              <label for="hSituacao">Situação</label>
              <select id="hSituacao">
                <option value="">Todos os registros</option>
                <option value="devolvido">Devolvidos</option>
                <option value="aberto">Ainda em aberto</option>
                <option value="atraso">Fora do prazo previsto</option>
              </select>
            </div>
            <div class="field">
              <label for="hTipo">Tipo</label>
              <select id="hTipo">
                <option value="">Todos</option>
                <option value="casual">Casual</option>
                <option value="posse">Posse</option>
                <option value="externo">Externo</option>
              </select>
            </div>
          </div>
          <div class="field" style="margin-top:14px;max-width:460px">
            <label for="hBusca">Buscar</label>
            <input type="text" id="hBusca" placeholder="Tag, instrumento, responsável ou setor">
            <div class="hint">Filtra o resultado já consultado, sem ir ao servidor.</div>
          </div>
          <div style="margin-top:14px;display:flex;gap:9px;flex-wrap:wrap">
            <button class="btn btn-outline btn-sm" data-hat="30">Últimos 30 dias</button>
            <button class="btn btn-outline btn-sm" data-hat="ano">Este ano</button>
            <button class="btn btn-outline btn-sm" data-hat="limpar">Todo o período</button>
          </div>
        </div>
      </div>

      <div class="act-bar">
        <div id="hResumo" style="font-size:13px;color:var(--muted)">Nenhuma consulta feita ainda.</div>
        <div class="act-group">
          <button class="btn btn-outline" id="btHExcel" disabled>Exportar para Excel</button>
          <button class="btn btn-outline" id="btHPDF" disabled>Exportar para PDF</button>
          <button class="btn btn-red" id="btHGerar" style="min-width:180px">CONSULTAR</button>
        </div>
      </div>

      <div id="hLista">${htmlVazio('Escolha o período e clique em "Consultar".')}</div>
    </section>`;

  container.querySelectorAll('.subtab').forEach(b => b.addEventListener('click', () => {
    container.querySelectorAll('.subtab').forEach(x => x.classList.toggle('sel', x === b));
    container.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.id === 'pane-'+b.dataset.pane));
    if (b.dataset.pane === 'abertos') carregarAbertos();
    // O histórico só vai ao servidor quando alguém pede: é a consulta
    // mais pesada da tela e ninguém abre a aba sem querer olhar.
    if (b.dataset.pane === 'historico' && !histConsultado) consultarHistorico();
  }));

  instrumentos = await listarInstrumentos();

  // Sem e-mail cadastrado a tela continua funcionando: só o botão de
  // notificar fica desabilitado, explicando por quê.
  try { emailsSetor = new Map((await listarEmailsSetor()).map(e => [e.setor, e])); }
  catch (e){ console.warn('[metrologia] e-mails por setor:', e); }

  ligarAutocomplete(container);
  ligarFormulario(container);
  ligarHistorico(container);
  carregarAbertos();

  desligarRealtime = ouvir('tela-emprestimo', ['instrumentos','movimentacoes'],
    debounce(async () => {
      instrumentos = await listarInstrumentos();
      carregarAbertos();
      if (histConsultado) consultarHistorico();
    }, 800));

  if (params[0]){
    const i = instrumentos.find(x => x.id === params[0]);
    if (i) selecionar(i, container);
  }
}

/* ==================================================================== */
/* Autocomplete                                                         */
/* ==================================================================== */
function ligarAutocomplete(container){
  const inp   = container.querySelector('#fInstrumento');
  const lista = container.querySelector('#acLista');
  const cartao = inp.closest('.card');

  // Enquanto a lista está aberta, o cartão precisa ficar acima dos
  // cartões seguintes — senão eles pintam por cima dos resultados.
  const abrir  = () => { lista.hidden = false; cartao?.classList.add('ac-aberto'); };
  const fechar = () => { lista.hidden = true; lista.innerHTML = ''; cartao?.classList.remove('ac-aberto'); };

  const buscar = debounce(() => {
    const t = chave(inp.value);
    if (t.length < 2){ fechar(); return; }
    const achados = instrumentos
      .filter(i => i.condicao_fisica === 'ativo')
      .filter(i => chave(i.tag + ' ' + i.descricao + ' ' + (i.num_serie||'') + ' ' + i.familia_nome).includes(t))
      .slice(0, 30);

    if (!achados.length){
      lista.innerHTML = `<div class="ac-item" style="cursor:default;color:var(--muted)">Nenhum instrumento encontrado.</div>`;
      abrir(); return;
    }
    lista.innerHTML = achados.map(i => `
      <div class="ac-item" data-id="${esc(i.id)}">
        <b>${esc(i.tag)}</b> — ${esc(i.descricao)}
        <div><span>${esc(i.familia_nome)}</span> ${badge(i.status_efetivo)}
          ${i.emprestado ? '<span class="bdg s-solicitado">Já emprestado</span>' : ''}</div>
      </div>`).join('');
    abrir();
  }, 160);

  inp.addEventListener('input', buscar);
  inp.addEventListener('focus', buscar);
  inp.addEventListener('keydown', e => { if (e.key === 'Escape') fechar(); });
  document.addEventListener('click', e => { if (!e.target.closest('#wInstrumento')) fechar(); });

  delegar(lista, 'click', '.ac-item[data-id]', (e, el) => {
    const i = instrumentos.find(x => x.id === el.dataset.id);
    if (i){ selecionar(i, container); fechar(); }
  });
}

/* ==================================================================== */
function selecionar(i, container){
  escolhido = i;
  container.querySelector('#fInstrumento').value = i.tag + ' — ' + i.descricao;

  const liberado = PODE_EMPRESTAR.includes(i.status_efetivo) && !i.emprestado && i.condicao_fisica === 'ativo';

  container.querySelector('#fichaInstrumento').innerHTML = `
    <div class="rec s-${esc(i.status_efetivo)}">
      <div class="rec-in">
        <div class="rec-grid">
          <div><div class="k">Tag</div><div class="v" style="font-family:'Courier New',monospace">${esc(i.tag)}</div></div>
          <div><div class="k">Descrição</div><div class="v">${esc(i.descricao)}</div></div>
          <div><div class="k">Família</div><div class="v">${esc(i.familia_nome)}</div></div>
          <div><div class="k">Situação</div><div class="v">${badge(i.status_efetivo)}</div></div>
          <div><div class="k">Última calibração</div><div class="v">${esc(fmtData(i.ultima_calibracao))}</div></div>
          <div><div class="k">Próxima</div><div class="v">${esc(fmtData(i.data_proxima))}</div></div>
        </div>
      </div>
    </div>
    ${liberado ? '' : `<div class="warn-box e" style="margin-top:10px">${motivoBloqueio(i)}</div>`}
    ${i.standby && !i.data_inicio_relogio ? `<div class="warn-box w fixa" style="margin-top:10px">
      Este instrumento está em <b>standby</b>. Ao registrar esta saída, o relógio de validade
      começa a contar e a próxima data de calibração passa a ser calculada a partir de hoje.</div>` : ''}`;

  container.querySelector('#cardDados').hidden  = !liberado;
  container.querySelector('#barraSalvar').hidden = false;
  container.querySelector('#btSaida').disabled   = !liberado;
  container.querySelector('#avisoTrava').innerHTML = liberado
    ? '<span style="color:var(--status-calibrado)">Instrumento liberado para saída.</span>'
    : '<span style="color:var(--status-descalibrado)">Saída bloqueada.</span>';

  atualizarExigenciaTermo(container);
}

function motivoBloqueio(i){
  if (i.condicao_fisica === 'inativo')
    return `<b>Instrumento inativo.</b> Reative no Inventário antes de emprestar.`;
  if (i.emprestado)
    return `<b>Já está emprestado</b> para ${esc(i.emprestado_para)} (${esc(i.setor_atual)}), desde ${esc(fmtDT(i.emprestado_em))}. Registre a devolução na aba <b>Em aberto</b>.`;
  return `<b>Só instrumento calibrado pode sair.</b> A situação atual é
          "${esc(i.status_efetivo)}". Registre a calibração na tela <b>Calibração</b> antes de emprestar.`;
}

/* ==================================================================== */
function atualizarExigenciaTermo(container){
  const tipo = container.querySelector('#fTipoEmp').value;
  const exige = tipo === 'posse' || tipo === 'externo';
  container.querySelector('#reqTermo').hidden = !exige;
  container.querySelector('#dicaTermo').innerHTML = exige
    ? '<b>Obrigatório</b> para este tipo. Anexe o termo assinado (PDF ou foto).'
    : 'Não exigido no empréstimo casual.';
  container.querySelector('#dicaTipo').textContent = {
    casual:  'Uso pontual. Vira lembrete no painel se não voltar no prazo configurado.',
    posse:   'O instrumento fica com o responsável por tempo indeterminado.',
    externo: 'O instrumento sai da empresa. Aparece no painel enquanto não voltar.'
  }[tipo];
}

function ligarFormulario(container){
  container.querySelector('#fTipoEmp').addEventListener('change', () => atualizarExigenciaTermo(container));
  atualizarExigenciaTermo(container);

  const inpTermo = container.querySelector('#fTermo');
  inpTermo.addEventListener('change', () => {
    const caixa = inpTermo.closest('.file'), a = inpTermo.files[0];
    caixa.classList.toggle('ok', !!a);
    caixa.querySelector('.txt').textContent = a ? a.name : 'Clique ou arraste o termo assinado';
  });

  container.querySelector('#btSaida').addEventListener('click', async ev => {
    if (!escolhido) return;
    limparErros(container);

    const v = id => container.querySelector('#f'+id).value.trim();
    const tipo = v('TipoEmp');
    const val = validador();
    val.exigir('Entregue',    v('Entregue'),    'Informe quem entregou o instrumento.');
    val.exigir('Responsavel', v('Responsavel'), 'Informe quem está levando o instrumento.');
    val.exigir('Setor',       v('Setor'),       'Escolha o setor.');
    if ((tipo === 'posse' || tipo === 'externo') && !inpTermo.files[0])
      val.falha('Termo', 'Anexe o termo de responsabilidade assinado.');
    if (!val.encerrar()) return;

    const bt = ev.currentTarget;
    bt.disabled = true; bt.textContent = 'REGISTRANDO…';
    try {
      const arq = inpTermo.files[0];
      const termo_path = arq
        ? await enviarArquivo(CONFIG.BUCKETS.termos, arq, pastaDoInstrumento(escolhido.tag))
        : null;

      await registrarMovimentacao(escolhido.id, {
        tipo, entregue_por: v('Entregue'), responsavel: v('Responsavel'), setor: v('Setor'),
        termo_path,
        data_prevista_retorno: container.querySelector('#fPrevisto').value
          ? new Date(container.querySelector('#fPrevisto').value).toISOString() : null
      });

      toast(`Saída de ${escolhido.tag} registrada.`, 'success');
      instrumentos = await listarInstrumentos();
      limparSaida(container);
      carregarAbertos();
    } catch (e){
      toast(msgErro(e), 'error');
    } finally {
      bt.disabled = false; bt.textContent = 'REGISTRAR SAÍDA';
    }
  });
}

function limparSaida(container){
  escolhido = null;
  container.querySelector('#fInstrumento').value = '';
  container.querySelector('#fichaInstrumento').innerHTML = '';
  container.querySelector('#cardDados').hidden = true;
  container.querySelector('#barraSalvar').hidden = true;
  ['Entregue','Responsavel','Previsto'].forEach(id => container.querySelector('#f'+id).value = '');
  container.querySelector('#fSetor').value = '';
  const inpTermo = container.querySelector('#fTermo');
  inpTermo.value = '';
  inpTermo.closest('.file').classList.remove('ok');
  inpTermo.closest('.file').querySelector('.txt').textContent = 'Clique ou arraste o termo assinado';
  limparErros(container);
}

/* ==================================================================== */
/* EM ABERTO                                                            */
/*                                                                      */
/* Os três tipos de empréstimo são três assuntos diferentes: o casual   */
/* volta no mesmo dia, a posse fica com o responsável por tempo         */
/* indeterminado e o externo saiu da empresa. Quem vai cobrar devolução */
/* olha um de cada vez — daí o seletor de visualização, com a contagem  */
/* de cada tipo à vista mesmo quando não é o tipo escolhido.            */
/* ==================================================================== */
async function carregarAbertos(){
  if (!raiz) return;
  const el = raiz.querySelector('#listaAbertos');
  if (!el) return;
  try {
    abertos = await listarEmprestimosAbertos();
    pintarAbertos();
  } catch (e){
    el.innerHTML = `<div class="warn-box e">${esc(msgErro(e))}</div>`;
  }
}

function pintarAbertos(){
  if (!raiz) return;
  const el = raiz.querySelector('#listaAbertos');
  if (!el) return;

  if (!abertos.length){
    el.innerHTML = htmlVazio('Nenhum instrumento emprestado no momento.');
    return;
  }

  const conta = t => t ? abertos.filter(m => m.tipo === t).length : abertos.length;
  const seletor = `
    <div class="subtabs subtabs-filtro" id="tiposAberto">
      ${[['','Todos'], ['casual','Casual'], ['posse','Posse'], ['externo','Externo']]
        .map(([t, rot]) => `
          <button class="subtab ${filtroTipo === t ? 'sel' : ''}" data-tipo="${t}"
                  ${!conta(t) && t ? 'disabled' : ''}>
            ${esc(rot)} <span class="n">${conta(t)}</span></button>`).join('')}
    </div>`;

  const lista = filtroTipo ? abertos.filter(m => m.tipo === filtroTipo) : abertos;

  if (!lista.length){
    el.innerHTML = seletor +
      htmlVazio(`Nenhum empréstimo do tipo "${TIPO_ROTULO[filtroTipo] || filtroTipo}" em aberto.`);
    ligarSeletorTipo(el);
    return;
  }

  // O aviso de atraso acompanha o recorte na tela: cobrar "todos os
  // setores" mostrando só uma parte da lista seria cobrar às escuras.
  const atrasados = lista.filter(m => m.em_alerta);
  const emAlerta = atrasados.length;

  el.innerHTML = seletor + `
      ${emAlerta ? `<div class="warn-box w fixa">
        <b>${emAlerta}</b> empréstimo(s) passaram do prazo de alerta.
        <div style="margin-top:9px">
          <button class="btn btn-outline btn-sm" id="btNotificarTodos">
            Notificar os setores responsáveis</button>
        </div></div>` : ''}
      ${lista.map(m => `
        <div class="rec ${m.em_alerta ? 's-descalibrado' : 's-solicitado'}">
          <div class="rec-in">
            <div class="rec-grid">
              <div><div class="k">Tag</div><div class="v" style="font-family:'Courier New',monospace">${esc(m.tag)}</div></div>
              <div><div class="k">Instrumento</div><div class="v">${esc(m.descricao)}</div></div>
              <div><div class="k">Tipo</div><div class="v">${esc(TIPO_ROTULO[m.tipo] || m.tipo)}</div></div>
              <div><div class="k">Responsável</div><div class="v">${esc(m.responsavel)}</div></div>
              <div><div class="k">Setor</div><div class="v">${esc(m.setor)}</div></div>
              <div><div class="k">Entregue por</div><div class="v">${esc(m.entregue_por || '—')}</div></div>
              <div><div class="k">Saída</div><div class="v">${esc(fmtDT(m.data_saida))}</div></div>
              <div><div class="k">Fora há</div><div class="v" style="color:${m.em_alerta ? 'var(--status-descalibrado)' : 'inherit'}">
                ${esc(m.dias_fora)} dia(s)${m.prazo_alerta_dias ? ' · alerta em '+esc(m.prazo_alerta_dias) : ''}</div></div>
              <div><div class="k">Prevista</div><div class="v">${esc(m.data_prevista_retorno ? fmtDT(m.data_prevista_retorno) : '—')}</div></div>
            </div>
            <div class="rec-acts">
              <button class="btn btn-green btn-sm" data-devolver="${esc(m.id)}" data-tag="${esc(m.tag)}">
                Registrar devolução</button>
              ${m.termo_path ? `<button class="btn btn-outline btn-sm" data-termo="${esc(m.termo_path)}">Ver termo</button>` : ''}
              <button class="btn btn-outline btn-sm" data-notificar="${esc(m.id)}"
                      ${emailsSetor.has(m.setor) ? '' : 'disabled'}
                      title="${emailsSetor.has(m.setor)
                        ? 'Abre o e-mail já preenchido para ' + esc(emailsSetor.get(m.setor).email)
                        : 'Sem e-mail cadastrado para o setor ' + esc(m.setor) + '. Cadastre em Administração › E-mails por setor.'}">
                ✉ Notificar responsável</button>
            </div>
          </div>
        </div>`).join('')}`;

  el.querySelectorAll('[data-termo]').forEach(b => b.addEventListener('click', async () => {
    try { await abrirArquivo(CONFIG.BUCKETS.termos, b.dataset.termo); }
    catch (e){ toast(msgErro(e), 'error'); }
  }));

  el.querySelectorAll('[data-devolver]').forEach(b => b.addEventListener('click', () =>
    modalDevolucao(b.dataset.devolver, b.dataset.tag)));

  el.querySelectorAll('[data-notificar]').forEach(b => b.addEventListener('click', () => {
    const m = lista.find(x => x.id === b.dataset.notificar);
    if (m) abrirEmail([m]);
  }));

  const btTodos = el.querySelector('#btNotificarTodos');
  if (btTodos) btTodos.addEventListener('click', () => modalNotificarTodos(atrasados));

  ligarSeletorTipo(el);
}

/** Troca a visualização sem ir ao servidor: os dados já estão na mão. */
function ligarSeletorTipo(el){
  el.querySelectorAll('[data-tipo]').forEach(b => b.addEventListener('click', () => {
    filtroTipo = b.dataset.tipo;
    lembrar('filtros.emprestimoAberto', filtroTipo);
    pintarAbertos();
  }));
}

/* ==================================================================== */
/* COBRANÇA DE DEVOLUÇÃO POR E-MAIL                                     */
/*                                                                      */
/* O e-mail sai do cliente de e-mail da própria pessoa, com o texto     */
/* pronto: a mensagem chega assinada por quem cobra e a resposta volta  */
/* para ela, não para uma caixa de sistema que ninguém lê. O que o      */
/* sistema faz é o trabalho chato — juntar destinatário, tags, datas e  */
/* prazos sem ninguém precisar copiar da tela.                          */
/* ==================================================================== */

/* O TEXTO do e-mail mora em CONFIG.EMAIL_COBRANCA (config.js), com os
   marcadores documentados. Aqui fica só a montagem: escolher singular ou
   plural, preencher os marcadores e juntar os pedaços. Quem quiser mudar
   a redação não precisa abrir este arquivo. */

/** Troca {marcadores} pelo valor. Marcador sem valor vira string vazia —
    e a linha que ficar só com espaço em branco é descartada depois. */
function preencher(modelo, valores){
  return String(modelo || '').replace(/\{(\w+)\}/g,
    (_, k) => (valores[k] == null ? '' : String(valores[k])));
}

/** Uma entrada da lista, por instrumento. Linha cujo dado opcional não
    existe (prazo, devolução prevista) some inteira. */
function linhaEmail(m){
  const texto = preencher(CONFIG.EMAIL_COBRANCA.ITEM, {
    tag: m.tag,
    descricao: m.descricao,
    responsavel_item: m.responsavel,
    saida: fmtDT(m.data_saida),
    dias: m.dias_fora,
    prazo: m.prazo_alerta_dias ? ` (prazo: ${m.prazo_alerta_dias} dias)` : '',
    prevista: m.data_prevista_retorno ? fmtDT(m.data_prevista_retorno) : ''
  });
  // Sem devolução prevista, a linha "Devolução prevista:" fica pendurada
  // sem valor. Uma linha que terminou em ':' perdeu o dado dela.
  return texto.split('\n').filter(l => l.trim() && !/[:·]\s*$/.test(l.trim())).join('\n');
}

function montarEmail(setor, itens){
  const T       = CONFIG.EMAIL_COBRANCA;
  const contato = emailsSetor.get(setor);
  const plural  = itens.length > 1;

  const valores = {
    responsavel: contato?.responsavel || '',
    setor,
    qtd: itens.length,
    tags: itens.map(m => m.tag).join(', '),
    assinatura: meuNome() || 'Metrologia',
    empresa: CONFIG.EMPRESA,
    documento: CONFIG.APP_REF
  };

  const assunto = preencher(plural ? T.ASSUNTO_N : T.ASSUNTO_1, valores);

  const corpo = [
    preencher(contato?.responsavel ? T.SAUDACAO : T.SAUDACAO_SEM, valores),
    '',
    preencher(plural ? T.ABERTURA_N : T.ABERTURA_1, valores),
    '',
    itens.map(linhaEmail).join('\n\n'),
    '',
    preencher(T.FECHAMENTO, valores),
    '',
    preencher(T.ASSINATURA, valores)
  ].join('\n');

  return { para: contato?.email || '', assunto, corpo };
}

/** Abre o cliente de e-mail com tudo preenchido. */
function abrirEmail(itens){
  const setor = itens[0].setor;
  if (!emailsSetor.has(setor)){
    toast(`Sem e-mail cadastrado para o setor ${setor}. Peça ao administrador para cadastrar em Administração › E-mails por setor.`, 'error');
    return;
  }
  const { para, assunto, corpo } = montarEmail(setor, itens);
  // encodeURIComponent, e não encodeURI: o corpo tem quebras de linha,
  // acento e "&" — encodeURI deixaria o "&" partir a URL ao meio.
  window.location.href = `mailto:${encodeURIComponent(para)}` +
    `?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
  toast(`E-mail para ${setor} montado no seu cliente de e-mail.`, 'success');
}

/** Um e-mail por setor: cobrar cinco instrumentos em cinco mensagens
    separadas é o jeito mais rápido de ninguém responder nenhuma. */
function modalNotificarTodos(atrasados){
  const porSetor = new Map();
  atrasados.forEach(m => {
    if (!porSetor.has(m.setor)) porSetor.set(m.setor, []);
    porSetor.get(m.setor).push(m);
  });

  const grupos = [...porSetor.entries()].sort((a,b) => b[1].length - a[1].length);
  const semEmail = grupos.filter(([setor]) => !emailsSetor.has(setor));

  abrirModal({
    titulo: 'Notificar setores responsáveis',
    largo: true,
    corpo: `
      <div class="warn-box i">
        Um e-mail por setor, com todos os instrumentos atrasados daquele setor.
        Cada botão abre a mensagem pronta no seu cliente de e-mail — você confere
        e envia.
      </div>
      ${semEmail.length ? `<div class="warn-box w fixa">
        <b>${semEmail.length}</b> setor(es) sem e-mail cadastrado:
        ${semEmail.map(([s]) => esc(s)).join(', ')}.
        Cadastre em <b>Administração › E-mails por setor</b>.</div>` : ''}

      ${grupos.map(([setor, itens]) => {
        const contato = emailsSetor.get(setor);
        return `
        <div class="rec ${contato ? 's-solicitado' : 's-descalibrado'}" style="margin-bottom:10px">
          <div class="rec-in">
            <div class="rec-grid">
              <div><div class="k">Setor</div><div class="v">${esc(setor)}</div></div>
              <div><div class="k">Instrumentos</div><div class="v">${itens.length}</div></div>
              <div><div class="k">Destinatário</div><div class="v">${
                contato ? esc(contato.email) : '<span style="color:var(--status-descalibrado)">não cadastrado</span>'}</div></div>
              <div><div class="k">Responsável</div><div class="v">${esc(contato?.responsavel || '—')}</div></div>
            </div>
            <div style="margin-top:10px;font-size:12.5px;color:var(--muted);line-height:1.6">
              ${itens.map(m => `${esc(m.tag)} · ${esc(m.responsavel)} · ${esc(m.dias_fora)} d`).join('<br>')}
            </div>
            <div class="rec-acts">
              <button class="btn btn-outline btn-sm" data-setor="${esc(setor)}"
                      ${contato ? '' : 'disabled'}>✉ Abrir e-mail para ${esc(setor)}</button>
            </div>
          </div>
        </div>`;
      }).join('')}`,
    acoes: [{ rotulo:'Fechar', classe:'btn-outline', onClick: f => f() }],
    aoAbrir: body => {
      body.querySelectorAll('[data-setor]').forEach(b => b.addEventListener('click', () =>
        abrirEmail(porSetor.get(b.dataset.setor))));
    }
  });
}

/* ==================================================================== */
function modalDevolucao(movId, tag){
  abrirModal({
    titulo: `Devolução — ${tag}`,
    corpo: `
      <p style="font-size:14px;margin-bottom:12px">Confirme a devolução do instrumento
        <b>${esc(tag)}</b>. A data e a hora do retorno são as de agora.</p>
      <div class="field" id="wRecebido">
        <label for="fRecebido">Recebido por<span class="req">*</span></label>
        <input type="text" id="fRecebido" placeholder="Quem da Metrologia está recebendo">
        <div class="hint">Fecha o par da entrega: fica no histórico e no PDF.</div>
        <div class="msg" id="mRecebido"></div>
      </div>
      <div class="field">
        <label for="fObsDev">Observação da devolução</label>
        <textarea id="fObsDev" placeholder="Estado do instrumento na volta, avarias, etc."></textarea>
      </div>`,
    acoes: [
      { rotulo:'Cancelar', classe:'btn-outline', onClick: f => f() },
      { rotulo:'Confirmar devolução', classe:'btn-green', onClick: async (fechar, bt) => {
          const recebido = document.getElementById('fRecebido').value.trim();
          const val = validador();
          val.exigir('Recebido', recebido, 'Informe quem está recebendo o instrumento.');
          if (!val.encerrar()) return;

          bt.disabled = true; bt.textContent = 'Salvando…';
          try {
            await registrarDevolucao(movId, document.getElementById('fObsDev').value.trim(), recebido);
            fechar();
            toast(`Devolução de ${tag} registrada.`, 'success');
            instrumentos = await listarInstrumentos();
            carregarAbertos();
            if (historico.length) consultarHistorico();
          } catch (e){
            toast(msgErro(e), 'error');
            bt.disabled = false; bt.textContent = 'Confirmar devolução';
          }
      } }
    ]
  });
}

/* ==================================================================== */
/* HISTÓRICO — entrega e devolução, com exportação                      */
/*                                                                      */
/* Nada é apagado quando o instrumento volta: a devolução preenche a    */
/* mesma linha da saída. O histórico é, portanto, a própria tabela de   */
/* movimentações — aqui só damos filtro, leitura e papel timbrado.      */
/* ==================================================================== */
function ligarHistorico(container){
  container.querySelector('#btHGerar').addEventListener('click', () => consultarHistorico());
  container.querySelector('#btHExcel').addEventListener('click', () => exportarHistExcel(container));
  container.querySelector('#btHPDF').addEventListener('click',   () => exportarHistPDF(container));

  container.querySelector('#hBusca').addEventListener('input',
    debounce(() => pintarHistorico(), 200));

  container.querySelectorAll('[data-hat]').forEach(b => b.addEventListener('click', () => {
    const de = container.querySelector('#hDe'), ate = container.querySelector('#hAte');
    const hoje = new Date();
    const iso = d => d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());

    if (b.dataset.hat === '30'){
      de.value = iso(new Date(hoje.getTime() - 30*86400000));
      ate.value = '';
    } else if (b.dataset.hat === 'ano'){
      de.value = hoje.getFullYear()+'-01-01';
      ate.value = '';
    } else {
      de.value = ''; ate.value = '';
    }
    consultarHistorico();
  }));

  // Um listener só, no container: a tabela se repinta a cada ordenação.
  delegar(container.querySelector('#hLista'), 'click', '[data-termo]', async (e, b) => {
    try { await abrirArquivo(CONFIG.BUCKETS.termos, b.dataset.termo); }
    catch (err){ toast(msgErro(err), 'error'); }
  });
}

const TIPO_ROTULO = { casual:'Casual', posse:'Posse', externo:'Externo' };

/** Descrição legível do recorte — vai para a tela, o PDF e o nome do arquivo. */
function descreverHistorico(f){
  const partes = [];
  if (f.de && f.ate)  partes.push(`Saídas de ${fmtData(f.de)} a ${fmtData(f.ate)}`);
  else if (f.de)      partes.push(`Saídas a partir de ${fmtData(f.de)}`);
  else if (f.ate)     partes.push(`Saídas até ${fmtData(f.ate)}`);
  else                partes.push('Todo o período');

  partes.push('Situação: ' + ({
    devolvido:'devolvidos', aberto:'ainda em aberto', atraso:'fora do prazo previsto'
  }[f.situacao] || 'todas'));

  if (f.tipo) partes.push('Tipo: ' + (TIPO_ROTULO[f.tipo] || f.tipo));
  if (f.busca) partes.push(`Busca: "${f.busca}"`);

  let titulo = 'Histórico de empréstimos';
  if (f.situacao === 'aberto')    titulo = 'Empréstimos em aberto';
  if (f.situacao === 'devolvido') titulo = 'Empréstimos devolvidos';
  if (f.situacao === 'atraso')    titulo = 'Empréstimos fora do prazo';
  if (f.tipo) titulo += ' · ' + (TIPO_ROTULO[f.tipo] || f.tipo);

  return { titulo, linha: partes.join('  ·  ') };
}

function filtrosHistorico(){
  const v = id => raiz.querySelector('#'+id).value || '';
  return { de:v('hDe'), ate:v('hAte'), situacao:v('hSituacao'),
           tipo:v('hTipo'), busca:v('hBusca').trim() };
}

async function consultarHistorico(){
  if (!raiz) return;
  const alvo = raiz.querySelector('#hLista');
  if (!alvo) return;

  const f = filtrosHistorico();
  alvo.innerHTML = htmlCarregando('Consultando o histórico…');
  tabelaHist = null;

  try {
    // 'atraso' não é filtro de banco: a view calcula fora_do_prazo, então
    // trazemos tudo do período e recortamos aqui.
    historico = await listarHistoricoEmprestimos({
      de: f.de || null, ate: f.ate || null, tipo: f.tipo || null,
      situacao: f.situacao === 'atraso' ? '' : f.situacao
    });
  } catch (e){
    historico = [];
    alvo.innerHTML = `<div class="warn-box e">${esc(msgErro(e))}</div>`;
    return;
  }
  histConsultado = true;
  descHist = descreverHistorico(f);
  pintarHistorico();
}

/** Aplica os filtros que moram no cliente e repinta tabela e resumo. */
function pintarHistorico(){
  if (!raiz || !histConsultado) return;
  const alvo = raiz.querySelector('#hLista');
  if (!alvo) return;

  const f = filtrosHistorico();
  let linhas = historico;
  if (f.situacao === 'atraso') linhas = linhas.filter(m => m.fora_do_prazo);
  if (f.busca){
    const t = chave(f.busca);
    linhas = linhas.filter(m => chave(
      [m.tag, m.descricao, m.responsavel, m.setor, m.entregue_por, m.recebido_por]
        .filter(Boolean).join(' ')).includes(t));
  }
  descHist = descreverHistorico(f);

  const devolvidos = linhas.filter(m => !m.em_aberto);
  const media = devolvidos.length
    ? Math.round(devolvidos.reduce((s,m) => s + (m.dias_fora||0), 0) / devolvidos.length)
    : null;

  raiz.querySelector('#hResumo').innerHTML = `
    <b style="color:var(--text)">${esc(descHist.titulo)}</b><br>
    <span style="font-size:12px">${esc(descHist.linha)}</span><br>
    <span style="font-size:12px">${linhas.length} registro(s) ·
      ${devolvidos.length} devolvido(s) ·
      ${linhas.length - devolvidos.length} em aberto ·
      ${linhas.filter(m => m.fora_do_prazo).length} fora do prazo${
      media != null ? ' · média de '+media+' dia(s) fora' : ''}</span>`;

  raiz.querySelector('#btHExcel').disabled = !linhas.length;
  raiz.querySelector('#btHPDF').disabled   = !linhas.length;

  tabelaHist = criarTabela(alvo, {
    linhas,
    ordem: { chave:'data_saida', dir:-1 },
    vazio: 'Nenhum empréstimo atende a esses filtros.',
    classeLinha: m => m.fora_do_prazo ? 'l-descalibrado' : (m.em_aberto ? 'l-solicitado' : ''),
    colunas: [
      { chave:'tag', rotulo:'Tag', classe:'mono', largura:'110px' },
      { chave:'descricao', rotulo:'Instrumento' },
      { chave:'tipo', rotulo:'Tipo', largura:'90px',
        html: m => esc(TIPO_ROTULO[m.tipo] || m.tipo) },
      { chave:'responsavel', rotulo:'Responsável', largura:'150px' },
      { chave:'setor', rotulo:'Setor', largura:'120px' },
      { chave:'entregue_por', rotulo:'Entregue por', largura:'140px' },
      { chave:'data_saida', rotulo:'Saída', largura:'140px',
        html: m => esc(fmtDT(m.data_saida)) },
      { chave:'data_prevista_retorno', rotulo:'Prevista', largura:'140px',
        html: m => esc(m.data_prevista_retorno ? fmtDT(m.data_prevista_retorno) : '—') },
      { chave:'data_retorno', rotulo:'Devolução', largura:'140px',
        html: m => esc(m.data_retorno ? fmtDT(m.data_retorno) : '—') },
      { chave:'recebido_por', rotulo:'Recebido por', largura:'140px',
        html: m => esc(m.recebido_por || '—') },
      { chave:'dias_fora', rotulo:'Dias', classe:'num', largura:'80px' },
      { chave:'em_aberto', rotulo:'Situação', largura:'150px',
        valor: m => m.fora_do_prazo ? 0 : (m.em_aberto ? 1 : 2),
        html: m => situacaoHist(m) },
      { chave:'termo_path', rotulo:'Termo', largura:'92px', ordenavel:false,
        html: m => m.termo_path
          ? `<button class="btn btn-outline btn-sm" data-termo="${esc(m.termo_path)}">Ver</button>`
          : '—' }
    ]
  });
}

function situacaoHist(m){
  if (m.fora_do_prazo && m.em_aberto) return '<span class="bdg s-descalibrado">Atrasado</span>';
  if (m.fora_do_prazo)                return '<span class="bdg s-descalibrado">Devolvido com atraso</span>';
  if (m.em_aberto)                    return '<span class="bdg s-solicitado">Em aberto</span>';
  return '<span class="bdg s-calibrado">Devolvido</span>';
}

/* ---- Linhas planas: mesma base para Excel e PDF --------------------- */
const CAB_HIST = ['Tag','Instrumento','Nº de série','Família','Tipo','Responsável','Setor',
                  'Entregue por','Saída','Devolução prevista','Devolução','Recebido por',
                  'Dias fora','Situação','Observação da devolução','Registrado por'];

function linhasHistPlanas(){
  const base = tabelaHist ? tabelaHist.linhas : historico;
  const situacaoTexto = m =>
    m.em_aberto ? (m.fora_do_prazo ? 'Atrasado' : 'Em aberto')
                : (m.fora_do_prazo ? 'Devolvido com atraso' : 'Devolvido');
  return base.map(m => [
    m.tag, m.descricao, m.num_serie || '—', m.familia_nome,
    TIPO_ROTULO[m.tipo] || m.tipo, m.responsavel, m.setor,
    m.entregue_por,
    fmtDT(m.data_saida),
    m.data_prevista_retorno ? fmtDT(m.data_prevista_retorno) : '—',
    m.data_retorno ? fmtDT(m.data_retorno) : '—',
    m.recebido_por || '—',
    m.dias_fora,
    situacaoTexto(m),
    m.obs_devolucao || '—',
    m.criado_por_email || '—'
  ]);
}

function nomeArquivoHist(ext){
  const d = new Date();
  return `Emprestimos-${slug(descHist.titulo)}-${d.getFullYear()}${p2(d.getMonth()+1)}${p2(d.getDate())}.${ext}`;
}

async function exportarHistExcel(container){
  const bt = container.querySelector('#btHExcel');
  bt.disabled = true; bt.textContent = 'Gerando…';
  try {
    const XLSX = await lerXLSX();
    const aba = XLSX.utils.aoa_to_sheet([CAB_HIST, ...linhasHistPlanas()]);
    aba['!cols'] = CAB_HIST.map((c,i) => ({ wch: i === 1 ? 42 : Math.max(12, c.length + 3) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, aba, 'Empréstimos');
    const buf = XLSX.write(wb, { bookType:'xlsx', type:'array' });
    baixarBlob(nomeArquivoHist('xlsx'),
      new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    toast('Planilha gerada.', 'success');
  } catch (e){ toast('Falha ao gerar a planilha: ' + msgErro(e), 'error'); }
  finally { bt.disabled = false; bt.textContent = 'Exportar para Excel'; }
}

async function exportarHistPDF(container){
  const bt = container.querySelector('#btHPDF');
  bt.disabled = true; bt.textContent = 'Gerando…';
  try {
    const pdfMake = await lerPDFMake();
    const linhas = linhasHistPlanas();
    const emitido = new Date();

    // Colunas enxutas: paisagem A4 ainda tem largura finita.
    // Tag, Instrumento, Tipo, Responsável, Setor, Entregue, Saída, Devolução, Recebido, Dias, Situação
    const cols = [0,1,4,5,6,7,8,10,11,12,13];
    const cab  = cols.map(i => CAB_HIST[i]);
    const corpo = linhas.map(l => cols.map(i => String(l[i] ?? '—')));

    const doc = {
      pageSize: 'A4',
      pageOrientation: 'landscape',
      pageMargins: [28, 92, 28, 40],

      header: () => ({
        margin: [28, 16, 28, 0],
        columns: [
          window.LOGO_B64
            ? { image: window.LOGO_B64, width: 104, margin:[0,2,0,0] }
            : { text: CONFIG.EMPRESA, bold:true, fontSize:12 },
          { stack: [
              { text:'CONTROLE DE EMPRÉSTIMO DE INSTRUMENTOS', bold:true, fontSize:11.5, alignment:'right' },
              { text: descHist.titulo, bold:true, fontSize:9, color:'#C0392B',
                alignment:'right', margin:[0,2,0,0] },
              { text: descHist.linha, fontSize:7, color:'#87827D',
                alignment:'right', margin:[0,2,0,0] },
              { text:`${linhas.length} registro(s)  ·  emitido em ${fmtData(hojeISO())} às ${p2(emitido.getHours())}:${p2(emitido.getMinutes())} por ${meuNome()}`,
                fontSize:7, color:'#87827D', alignment:'right', margin:[0,1,0,0] }
            ] }
        ]
      }),

      footer: (pagina, total) => ({
        margin: [28, 8, 28, 0],
        columns: [
          { text:`${CONFIG.EMPRESA}  •  ${CONFIG.APP_REF}`, fontSize:6.5, italics:true, color:'#AAA5A0' },
          { text:`Página ${pagina} de ${total}`, fontSize:6.5, color:'#AAA5A0', alignment:'right' }
        ]
      }),

      content: [
        { canvas:[{ type:'line', x1:0, y1:0, x2:786, y2:0, lineWidth:0.8, lineColor:'#C0392B' }], margin:[0,0,0,10] },
        {
          table: {
            headerRows: 1,
            widths: ['auto','*','auto','auto','auto','auto','auto','auto','auto','auto','auto'],
            body: [
              cab.map(t => ({ text:t, bold:true, fontSize:7.5, color:'#F0E6E4', fillColor:'#1A1210' })),
              ...corpo.map(l => l.map(c => ({ text:c, fontSize:7.5 })))
            ]
          },
          layout: {
            hLineWidth: i => i <= 1 ? 0.8 : 0.3,
            vLineWidth: () => 0,
            hLineColor: i => i <= 1 ? '#1A1210' : '#E0DBD5',
            paddingTop: () => 3.5, paddingBottom: () => 3.5,
            fillColor: i => i > 0 && i % 2 === 0 ? '#F8F7F5' : null
          }
        }
      ],
      defaultStyle: { font:'Roboto' }
    };

    pdfMake.createPdf(doc).download(nomeArquivoHist('pdf'));
    toast('PDF gerado.', 'success');
  } catch (e){
    console.error(e);
    toast('Falha ao gerar o PDF: ' + msgErro(e), 'error');
  } finally { bt.disabled = false; bt.textContent = 'Exportar para PDF'; }
}
