/* =====================================================================
   EMPRÉSTIMO — saída e devolução de instrumento.

   Regra 4: só sai instrumento calibrado. A tela bloqueia antes do clique
   para não fazer o usuário perder tempo; quem decide de verdade é a RPC
   registrar_movimentacao, no banco.

   Regra 5: posse e externo não salvam sem o termo de responsabilidade.
   ===================================================================== */
import { esc, fmtDT, fmtData, chave, toast, msgErro, debounce, htmlVazio,
         htmlCarregando, validador, limparErros, delegar } from '../utils.js';
import { listarInstrumentos, listarEmprestimosAbertos, registrarMovimentacao,
         registrarDevolucao, enviarArquivo, cfgLista, ouvir, abrirArquivo } from '../supabase.js';
import { CONFIG } from '../config.js';
import { badge, PODE_EMPRESTAR } from '../components/status-badge.js';
import { abrirModal } from '../components/modal.js';

let desligarRealtime = null;
let instrumentos = [];
let escolhido = null;
let raiz = null;

export function destroy(){
  if (desligarRealtime){ desligarRealtime(); desligarRealtime = null; }
  instrumentos = []; escolhido = null; raiz = null;
}

/* ==================================================================== */
export async function render(container, params = []){
  raiz = container;
  const setores = cfgLista('setores');

  container.innerHTML = `
    <div class="subtabs">
      <button class="subtab sel" data-pane="saida">Nova saída</button>
      <button class="subtab" data-pane="abertos">Em aberto</button>
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
    </section>`;

  container.querySelectorAll('.subtab').forEach(b => b.addEventListener('click', () => {
    container.querySelectorAll('.subtab').forEach(x => x.classList.toggle('sel', x === b));
    container.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.id === 'pane-'+b.dataset.pane));
    if (b.dataset.pane === 'abertos') carregarAbertos();
  }));

  instrumentos = await listarInstrumentos();
  ligarAutocomplete(container);
  ligarFormulario(container);
  carregarAbertos();

  desligarRealtime = ouvir('tela-emprestimo', ['instrumentos','movimentacoes'],
    debounce(async () => { instrumentos = await listarInstrumentos(); carregarAbertos(); }, 800));

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

  const fechar = () => { lista.hidden = true; lista.innerHTML = ''; };

  const buscar = debounce(() => {
    const t = chave(inp.value);
    if (t.length < 2){ fechar(); return; }
    const achados = instrumentos
      .filter(i => i.condicao_fisica === 'ativo')
      .filter(i => chave(i.tag + ' ' + i.descricao + ' ' + (i.num_serie||'') + ' ' + i.familia_nome).includes(t))
      .slice(0, 12);

    if (!achados.length){
      lista.innerHTML = `<div class="ac-item" style="cursor:default;color:var(--muted)">Nenhum instrumento encontrado.</div>`;
      lista.hidden = false; return;
    }
    lista.innerHTML = achados.map(i => `
      <div class="ac-item" data-id="${esc(i.id)}">
        <b>${esc(i.tag)}</b> — ${esc(i.descricao)}
        <div><span>${esc(i.familia_nome)}</span> ${badge(i.status_efetivo)}
          ${i.emprestado ? '<span class="bdg s-solicitado">Já emprestado</span>' : ''}</div>
      </div>`).join('');
    lista.hidden = false;
  }, 160);

  inp.addEventListener('input', buscar);
  inp.addEventListener('focus', buscar);
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
    ${i.standby && !i.data_inicio_relogio ? `<div class="warn-box w" style="margin-top:10px">
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
        ? await enviarArquivo(CONFIG.BUCKETS.termos, arq, new Date().getFullYear() + '/' + escolhido.tag)
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
/* ==================================================================== */
async function carregarAbertos(){
  if (!raiz) return;
  const el = raiz.querySelector('#listaAbertos');
  if (!el) return;
  try {
    const lista = await listarEmprestimosAbertos();
    if (!lista.length){ el.innerHTML = htmlVazio('Nenhum instrumento emprestado no momento.'); return; }

    const emAlerta = lista.filter(m => m.em_alerta).length;
    el.innerHTML = `
      ${emAlerta ? `<div class="warn-box w"><b>${emAlerta}</b> empréstimo(s) passaram do prazo de alerta.</div>` : ''}
      ${lista.map(m => `
        <div class="rec ${m.em_alerta ? 's-descalibrado' : 's-solicitado'}">
          <div class="rec-in">
            <div class="rec-grid">
              <div><div class="k">Tag</div><div class="v" style="font-family:'Courier New',monospace">${esc(m.tag)}</div></div>
              <div><div class="k">Instrumento</div><div class="v">${esc(m.descricao)}</div></div>
              <div><div class="k">Tipo</div><div class="v">${esc(m.tipo)}</div></div>
              <div><div class="k">Responsável</div><div class="v">${esc(m.responsavel)}</div></div>
              <div><div class="k">Setor</div><div class="v">${esc(m.setor)}</div></div>
              <div><div class="k">Saída</div><div class="v">${esc(fmtDT(m.data_saida))}</div></div>
              <div><div class="k">Fora há</div><div class="v" style="color:${m.em_alerta ? 'var(--status-descalibrado)' : 'inherit'}">
                ${esc(m.dias_fora)} dia(s)${m.prazo_alerta_dias ? ' · alerta em '+esc(m.prazo_alerta_dias) : ''}</div></div>
              <div><div class="k">Prevista</div><div class="v">${esc(m.data_prevista_retorno ? fmtDT(m.data_prevista_retorno) : '—')}</div></div>
            </div>
            <div class="rec-acts">
              <button class="btn btn-green btn-sm" data-devolver="${esc(m.id)}" data-tag="${esc(m.tag)}">
                Registrar devolução</button>
              ${m.termo_path ? `<button class="btn btn-outline btn-sm" data-termo="${esc(m.termo_path)}">Ver termo</button>` : ''}
            </div>
          </div>
        </div>`).join('')}`;

    el.querySelectorAll('[data-termo]').forEach(b => b.addEventListener('click', async () => {
      try { await abrirArquivo(CONFIG.BUCKETS.termos, b.dataset.termo); }
      catch (e){ toast(msgErro(e), 'error'); }
    }));

    el.querySelectorAll('[data-devolver]').forEach(b => b.addEventListener('click', () =>
      modalDevolucao(b.dataset.devolver, b.dataset.tag)));
  } catch (e){
    el.innerHTML = `<div class="warn-box e">${esc(msgErro(e))}</div>`;
  }
}

function modalDevolucao(movId, tag){
  abrirModal({
    titulo: `Devolução — ${tag}`,
    corpo: `
      <p style="font-size:14px;margin-bottom:12px">Confirme a devolução do instrumento
        <b>${esc(tag)}</b>. A data e a hora do retorno são as de agora.</p>
      <div class="field">
        <label for="fObsDev">Observação da devolução</label>
        <textarea id="fObsDev" placeholder="Estado do instrumento na volta, avarias, etc."></textarea>
      </div>`,
    acoes: [
      { rotulo:'Cancelar', classe:'btn-outline', onClick: f => f() },
      { rotulo:'Confirmar devolução', classe:'btn-green', onClick: async (fechar, bt) => {
          bt.disabled = true; bt.textContent = 'Salvando…';
          try {
            await registrarDevolucao(movId, document.getElementById('fObsDev').value.trim());
            fechar();
            toast(`Devolução de ${tag} registrada.`, 'success');
            instrumentos = await listarInstrumentos();
            carregarAbertos();
          } catch (e){
            toast(msgErro(e), 'error');
            bt.disabled = false; bt.textContent = 'Confirmar devolução';
          }
      } }
    ]
  });
}
