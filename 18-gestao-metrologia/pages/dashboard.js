/* =====================================================================
   PAINEL — a primeira tela do dia.

   Três leituras, nesta ordem: quanto tem e como está (indicadores +
   arco), quando vai vencer (barras por mês), e onde atacar primeiro
   (Pareto por família). Depois, o que exige ação hoje.

   Tudo sai de vw_instrumentos_status e vw_emprestimos_abertos, com
   Realtime nas duas pontas.
   ===================================================================== */
import { esc, fmtData, fmtDT, toast, msgErro, debounce,
         htmlCarregando, htmlVazio, lembrar, p2, animarNumero } from '../utils.js';
import { listarInstrumentos, listarEmprestimosAbertos, ouvir, cfgInt } from '../supabase.js';
import { badge, legenda, textoVencimento, STATUS, ORDEM_GRAFICO } from '../components/status-badge.js';
import { arcoSituacao, barrasVencimento, pareto } from '../components/graficos.js';
import { irPara } from '../router.js';
import { meuNome } from '../auth.js';

let desligarRealtime = null;
let elRaiz = null;

export function destroy(){
  if (desligarRealtime){ desligarRealtime(); desligarRealtime = null; }
  elRaiz = null;
}

export async function render(container){
  elRaiz = container;
  const primeiroNome = (meuNome() || '').trim().split(/\s+/)[0] || '';

  container.innerHTML = `
    <header style="display:flex;align-items:flex-end;justify-content:space-between;
                   flex-wrap:wrap;gap:10px;margin-bottom:1.5rem">
      <div>
        <h1 style="font-size:22px;font-weight:680;letter-spacing:-.025em">
          ${primeiroNome ? 'Bom trabalho, ' + esc(primeiroNome) + '.' : 'Painel da metrologia'}</h1>
        <p style="font-size:13px;color:var(--muted);margin-top:3px" id="resumoLinha"></p>
      </div>
      <div style="font-size:12px;color:var(--muted)" id="atualizadoEm"></div>
    </header>
    <div id="kpis" class="kpis"></div>
    <div id="graficos" class="graficos"></div>
    <div id="conteudo">${htmlCarregando()}</div>`;

  await carregar();

  desligarRealtime = ouvir('tela-dashboard', ['instrumentos','calibracoes','movimentacoes'],
    debounce(() => carregar(true), 900));
}

/* ==================================================================== */
async function carregar(silencioso = false){
  if (!elRaiz) return;
  const alvo = elRaiz.querySelector('#conteudo');
  if (!alvo) return;

  let instrumentos, emprestimos;
  try {
    [instrumentos, emprestimos] = await Promise.all([
      listarInstrumentos(), listarEmprestimosAbertos()
    ]);
  } catch (e){
    alvo.innerHTML = `<div class="warn-box e">${esc(msgErro(e))}</div>`;
    if (!silencioso) toast(msgErro(e), 'error');
    return;
  }

  const ativos = instrumentos.filter(i => i.condicao_fisica === 'ativo');
  const por = s => ativos.filter(i => i.status_efetivo === s);

  const descalibrados = por('descalibrado');
  const proximos      = por('proximo_vencimento')
                          .sort((a,b) => (a.dias_para_vencer ?? 0) - (b.dias_para_vencer ?? 0));
  const calibrados    = por('calibrado');
  const standby       = por('standby_pausado');
  const solicitados   = por('solicitado');
  const externas      = por('em_calibracao_externa');
  const janela        = cfgInt('dias_proximo_vencimento', 15);

  indicadores({ ativos, instrumentos, descalibrados, proximos, calibrados, standby,
                solicitados, externas, emprestimos, janela });
  graficos({ ativos, descalibrados, proximos, calibrados, standby, solicitados, externas });
  listas({ alvo, descalibrados, proximos, emprestimos, janela });

  const d = new Date();
  elRaiz.querySelector('#atualizadoEm').textContent =
    `Atualizado às ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  elRaiz.querySelector('#resumoLinha').textContent = descalibrados.length
    ? `${descalibrados.length} instrumento(s) fora de conformidade agora.`
    : `Acervo em dia: nenhum instrumento descalibrado.`;
}

/* ==================================================================== */
function indicadores(d){
  const el = elRaiz.querySelector('#kpis');
  const foraAlerta = d.emprestimos.filter(m => m.em_alerta).length;

  el.innerHTML = `
    <button class="kpi c-total" data-ir="">
      <div class="k">Acervo ativo</div><div class="v">${d.ativos.length}</div>
      <div class="d">${d.instrumentos.length - d.ativos.length} inativo(s) fora da conta</div></button>
    <button class="kpi c-descalibrado" data-ir="descalibrado">
      <div class="k">Descalibrados</div><div class="v">${d.descalibrados.length}</div>
      <div class="d">não podem ser emprestados</div></button>
    <button class="kpi c-proximo" data-ir="proximo_vencimento">
      <div class="k">Vencendo</div><div class="v">${d.proximos.length}</div>
      <div class="d">nos próximos ${d.janela} dias</div></button>
    <button class="kpi c-externa" data-ir="em_calibracao_externa">
      <div class="k">Em laboratório</div><div class="v">${d.externas.length + d.solicitados.length}</div>
      <div class="d">${d.solicitados.length} solicitada(s), ${d.externas.length} enviada(s)</div></button>
    <div class="kpi c-solicitado estatico">
      <div class="k">Emprestados</div><div class="v">${d.emprestimos.length}</div>
      <div class="d">${foraAlerta ? foraAlerta + ' fora do prazo' : 'todos dentro do prazo'}</div></div>`;

  // Contagem crescente: o número chama atenção para si sem piscar nada.
  el.querySelectorAll('.kpi .v').forEach(v => animarNumero(v, v.textContent));

  el.querySelectorAll('[data-ir]').forEach(b => b.addEventListener('click', () => {
    lembrar('filtros.calibracao', { status:b.dataset.ir, familia:'', texto:'', incluirInativos:false });
    irPara('calibracao');
  }));
}

/* ==================================================================== */
function graficos(d){
  const el = elRaiz.querySelector('#graficos');
  el.innerHTML = `<div id="gArco"></div><div id="gMeses"></div><div id="gPareto"></div>`;

  /* --- 1. Arco de situação -------------------------------------------
     'standby_pausado' entra somado a 'calibrado': é exatamente isso que
     ele é — instrumento válido com o relógio parado. Como cinza de croma
     0,02 ele reprova no piso do validador e viraria uma mancha morta no
     anel; como rótulo, na tabela e na lista, ele continua existindo. */
  const contagem = {
    descalibrado:          d.descalibrados.length,
    em_calibracao_externa: d.externas.length,
    proximo_vencimento:    d.proximos.length,
    solicitado:            d.solicitados.length,
    calibrado:             d.calibrados.length + d.standby.length
  };
  arcoSituacao(el.querySelector('#gArco'), {
    total: d.ativos.length,
    rotuloCentro: 'instrumentos ativos',
    segmentos: ORDEM_GRAFICO.map(s => ({
      chave: s,
      rotulo: s === 'calibrado' && d.standby.length
        ? `Calibrado (${d.standby.length} em standby)`
        : STATUS[s].rotulo,
      cor: STATUS[s].cor,
      valor: contagem[s]
    }))
  });

  /* --- 2. Carga por mês ---------------------------------------------- */
  const hoje = new Date();
  const MES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  const MES_LONGO = ['janeiro','fevereiro','março','abril','maio','junho',
                     'julho','agosto','setembro','outubro','novembro','dezembro'];
  const meses = Array.from({ length: 6 }, (_, k) => {
    const m = new Date(hoje.getFullYear(), hoje.getMonth() + k, 1);
    return { ano:m.getFullYear(), mes:m.getMonth(),
             rotulo: MES[m.getMonth()] + (m.getMonth() === 0 || k === 0 ? '/' + String(m.getFullYear()).slice(2) : ''),
             rotuloLongo: MES_LONGO[m.getMonth()] + ' de ' + m.getFullYear(),
             valor: 0 };
  });
  d.ativos.forEach(i => {
    if (!i.data_proxima) return;
    const [a, m] = i.data_proxima.split('-').map(Number);
    const alvo = meses.find(x => x.ano === a && x.mes === m - 1);
    if (alvo) alvo.valor++;
  });
  barrasVencimento(el.querySelector('#gMeses'), { meses });

  /* --- 3. Pareto por família ----------------------------------------- */
  const pendentes = [...d.descalibrados, ...d.proximos];
  const mapa = new Map();
  pendentes.forEach(i => {
    const k = i.familia_id;
    if (!mapa.has(k)) mapa.set(k, { rotulo: i.familia_nome, sigla: i.familia_codigo, valor: 0 });
    mapa.get(k).valor++;
  });
  pareto(el.querySelector('#gPareto'), { familias: [...mapa.values()] });
}

/* ==================================================================== */
function listas({ alvo, descalibrados, proximos, emprestimos, janela }){
  const alertas  = emprestimos.filter(m => m.em_alerta);
  const externos = emprestimos.filter(m => m.tipo === 'externo');

  alvo.innerHTML = `
    <div style="margin-bottom:16px">${legenda()}</div>

    ${descalibrados.length ? `
    <div class="card">
      <div class="card-head">
        <svg viewBox="0 0 24 24"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>
        <h2>Descalibrados — ação imediata</h2><span class="right">${descalibrados.length}</span>
      </div>
      <div class="card-body tight">${listaInstrumentos(descalibrados)}</div>
    </div>` : `
    <div class="card"><div class="card-body">
      <div class="warn-box g" style="margin:0">Nenhum instrumento descalibrado. O acervo está em dia.</div>
    </div></div>`}

    ${proximos.length ? `
    <div class="card">
      <div class="card-head">
        <svg viewBox="0 0 24 24"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2"/></svg>
        <h2>Vencem nos próximos ${janela} dias</h2><span class="right">${proximos.length}</span>
      </div>
      <div class="card-body tight">${listaInstrumentos(proximos)}</div>
    </div>` : ''}

    <div class="card">
      <div class="card-head">
        <svg viewBox="0 0 24 24"><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7M2 7h20v5H2zM12 7v14"/></svg>
        <h2>Empréstimos em aberto</h2>
        <span class="right">${emprestimos.length}${alertas.length ? ' · ' + alertas.length + ' em alerta' : ''}</span>
      </div>
      <div class="card-body tight">
        ${emprestimos.length ? `
          ${alertas.length ? `<div class="warn-box w">
            <b>${alertas.length}</b> empréstimo(s) passaram do prazo. Cobre a devolução.</div>` : ''}
          ${externos.length ? `<div class="warn-box i">
            <b>${externos.length}</b> instrumento(s) estão fora da empresa (empréstimo externo).</div>` : ''}
          ${emprestimos.map(m => `
            <div class="rec ${m.em_alerta ? 's-descalibrado' : 's-solicitado'}">
              <div class="rec-in"><div class="rec-grid">
                <div><div class="k">Tag</div><div class="v mono">${esc(m.tag)}</div></div>
                <div><div class="k">Instrumento</div><div class="v">${esc(m.descricao)}</div></div>
                <div><div class="k">Tipo</div><div class="v">${esc(m.tipo)}</div></div>
                <div><div class="k">Com</div><div class="v">${esc(m.responsavel)} · ${esc(m.setor)}</div></div>
                <div><div class="k">Saída</div><div class="v">${esc(fmtDT(m.data_saida))}</div></div>
                <div><div class="k">Fora há</div><div class="v" style="color:${
                  m.em_alerta ? 'var(--status-descalibrado)' : 'inherit'}">${esc(m.dias_fora)} dia(s)</div></div>
              </div></div>
            </div>`).join('')}
          <div style="margin-top:12px"><button class="btn btn-outline btn-sm" id="btIrEmp">
            Abrir tela de empréstimo</button></div>
        ` : htmlVazio('Nenhum instrumento emprestado no momento.')}
      </div>
    </div>`;

  const btEmp = alvo.querySelector('#btIrEmp');
  if (btEmp) btEmp.addEventListener('click', () => irPara('emprestimo'));

  alvo.querySelectorAll('[data-instr]').forEach(b =>
    b.addEventListener('click', () => irPara('calibracao', b.dataset.instr)));
}

function listaInstrumentos(lista){
  return lista.map(i => `
    <div class="rec s-${esc(i.status_efetivo)}" data-instr="${esc(i.id)}">
      <div class="rec-in"><div class="rec-grid">
        <div><div class="k">Tag</div><div class="v mono">${esc(i.tag)}</div></div>
        <div><div class="k">Descrição</div><div class="v">${esc(i.descricao)}</div></div>
        <div><div class="k">Família</div><div class="v">${esc(i.familia_nome)}</div></div>
        <div><div class="k">Situação</div><div class="v">${badge(i.status_efetivo)}</div></div>
        <div><div class="k">Próxima calibração</div><div class="v">${esc(fmtData(i.data_proxima))} · ${esc(textoVencimento(i))}</div></div>
        <div><div class="k">Localização</div><div class="v">${esc(i.localizacao_atual || '—')}</div></div>
      </div></div>
    </div>`).join('');
}
