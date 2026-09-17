/* =====================================================================
   PAINEL — a primeira tela do dia.

   Três leituras, nesta ordem: quanto tem e como está (indicadores +
   arco), quando vai vencer (barras por mês), e onde atacar primeiro
   (Pareto por família). Depois, o que exige ação hoje.

   Tudo sai de vw_instrumentos_status e vw_emprestimos_abertos, com
   Realtime nas duas pontas.
   ===================================================================== */
import { esc, fmtData, fmtDT, toast, msgErro, debounce, htmlCarregando, htmlVazio,
         lembrar, lembrado, p2, animarNumero, primeiroNome } from '../utils.js';
import { listarInstrumentos, listarEmprestimosAbertos, ouvir,
         limiteAlertaVencimento, cfgBool } from '../supabase.js';
import { badge, legenda, textoVencimento, STATUS,
         ORDEM_GRAFICO, ORDEM_STATUS_TMMDE } from '../components/status-badge.js';
import { arcoSituacao, barrasVencimento, pareto } from '../components/graficos.js';
import { irPara } from '../router.js';
import { meuNome } from '../auth.js';

let desligarRealtime = null;
let elRaiz = null;

/* Os gráficos são desenhados em escala 1:1 sobre a largura medida da
   carta (ver moldura() em components/graficos.js), então mudar o tamanho
   da janela exige redesenhá-los. Guardar o último recorte evita ir ao
   servidor de novo só porque alguém arrastou a borda da janela. */
let ultimoRecorte = null;
let aoRedimensionar = null;

export function destroy(){
  if (desligarRealtime){ desligarRealtime(); desligarRealtime = null; }
  if (aoRedimensionar){ window.removeEventListener('resize', aoRedimensionar); aoRedimensionar = null; }
  ultimoRecorte = null;
  elRaiz = null;
}

export async function render(container){
  elRaiz = container;
  // meuNome() já devolve o nome normalizado — "joao" vira "João" lá, e
  // não aqui, para que cabeçalho, PDF e e-mail escrevam o mesmo nome.
  const nome = primeiroNome(meuNome());

  container.innerHTML = `
    <header style="display:flex;align-items:flex-end;justify-content:space-between;
                   flex-wrap:wrap;gap:10px;margin-bottom:1.5rem">
      <div>
        <h1 style="font-size:22px;font-weight:680;letter-spacing:-.025em">
          ${nome ? 'Olá, ' + esc(nome) + '. Tudo sob controle?' : 'Tudo sob controle?'}</h1>
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

  // Redesenha só os gráficos, com os dados que já estão na mão.
  aoRedimensionar = debounce(() => { if (ultimoRecorte) graficos(ultimoRecorte); }, 200);
  window.addEventListener('resize', aoRedimensionar);
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

  /* Três recortes do acervo, e cada gráfico usa o seu:

       ativos      — tudo que está em uso, referência incluída. É a base
                     do anel de situação: padrão de aferição é
                     instrumento ativo, e deixá-lo fora fazia o total do
                     anel não bater com o acervo.
       sobControle — os TMMDE, únicos que vencem. É a base da carga por
                     mês e do Pareto: referência nunca entra numa fila
                     de calibração.
       inativos    — fora de uso, com motivo registrado. Base do quarto
                     gráfico, e o único recorte que olha o acervo
                     inteiro como denominador. */
  const ativos      = instrumentos.filter(i => i.condicao_fisica === 'ativo');
  const inativos    = instrumentos.filter(i => i.condicao_fisica === 'inativo');
  const referencias = ativos.filter(i => i.tipo === 'REFERENCIA');
  const sobControle = ativos.filter(i => i.tipo !== 'REFERENCIA');
  const por = s => sobControle.filter(i => i.status_efetivo === s);

  const descalibrados = por('descalibrado');
  const proximos      = por('proximo_vencimento')
                          .sort((a,b) => (a.dias_para_vencer ?? 0) - (b.dias_para_vencer ?? 0));
  const calibrados    = por('calibrado');
  const standby       = por('standby_pausado');
  const solicitados   = por('solicitado');
  const externas      = por('em_calibracao_externa');

  /* Até quando vai o alerta. Por padrão, o último dia do MÊS QUE VEM —
     a metrologia fecha o mês, e a pergunta de segunda-feira é "o que
     preciso resolver até fechar o mês que vem?", não "o que vence em 15
     dias". Quem decide a cor de cada instrumento continua sendo o banco
     (public.limite_alerta_vencimento); aqui a data serve só de rótulo. */
  const limite = limiteAlertaVencimento();
  // O rótulo acompanha o parâmetro: desligado o alerta mensal, "fim do
  // próximo mês" viraria mentira em cima de uma data correta.
  const alerta = `até ${fmtData(limite)}` +
    (cfgBool('alerta_vencimento_proximo_mes', true) ? ' — fim do próximo mês' : '');

  indicadores({ ativos, sobControle, referencias, inativos, descalibrados, proximos,
                calibrados, standby, solicitados, externas, emprestimos, alerta,
                acervo: instrumentos.length });

  ultimoRecorte = { ativos, sobControle, referencias, inativos, acervo: instrumentos.length,
                    descalibrados, proximos, calibrados, standby, solicitados, externas };
  graficos(ultimoRecorte);
  listas({ alvo, descalibrados, proximos, emprestimos, alerta });

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
  /* O indicador conta TUDO que está fora da sala de metrologia — é um
     fato sobre o acervo. Quem lista só os casuais é a carta lá embaixo,
     e é por isso que a linha de baixo mostra a divisão: sem ela, o "3"
     aqui e os "2" da lista pareceriam um erro. */
  const foraAlerta = d.emprestimos.filter(m => m.em_alerta).length;
  const casuais    = d.emprestimos.filter(m => m.tipo === 'casual').length;
  const outros     = d.emprestimos.length - casuais;
  const detalheEmp = [
    foraAlerta ? foraAlerta + ' fora do prazo' : null,
    casuais + ' casual(is)',
    outros ? outros + ' em posse/externo' : null
  ].filter(Boolean).join(' · ') || 'nenhum instrumento fora';

  const pctAcervo = d.acervo ? Math.round(d.inativos.length / d.acervo * 100) : 0;

  el.innerHTML = `
    <button class="kpi c-total" data-ir="">
      <div class="k">Acervo ativo</div><div class="v">${d.ativos.length}</div>
      <div class="d">${d.sobControle.length} sob controle · ${d.referencias.length} referência(s)
        · ${d.inativos.length} inativo(s) fora da conta</div></button>
    <button class="kpi c-descalibrado" data-ir="descalibrado">
      <div class="k">Descalibrados</div><div class="v">${d.descalibrados.length}</div>
      <div class="d">não podem ser emprestados</div></button>
    <button class="kpi c-proximo" data-ir="proximo_vencimento">
      <div class="k">Vencendo</div><div class="v">${d.proximos.length}</div>
      <div class="d">${esc(d.alerta)}</div></button>
    <button class="kpi c-externa" data-ir="em_calibracao_externa">
      <div class="k">Processo de calibração</div><div class="v">${d.externas.length + d.solicitados.length}</div>
      <div class="d">${d.solicitados.length} solicitada(s), ${d.externas.length} enviada(s)</div></button>
    <div class="kpi c-solicitado estatico">
      <div class="k">Emprestados</div><div class="v">${d.emprestimos.length}</div>
      <div class="d">${esc(detalheEmp)}</div></div>
    <!-- Denominador é o acervo INTEIRO, não o ativo: "14% está fora de
         uso" só quer dizer alguma coisa se os inativos estiverem dentro
         da conta. Estático como Emprestados — é um fato do acervo, não
         uma fila de trabalho que se clica para atacar. -->
    <div class="kpi c-inativo estatico">
      <div class="k">Inativos</div>
      <div class="v"><span data-num>${pctAcervo}</span>%</div>
      <div class="d">${d.inativos.length} de ${d.acervo} do acervo fora de uso</div></div>`;

  /* Contagem crescente: o número chama atenção para si sem piscar nada.
     Onde existe [data-num], é ele que anima — o '%' fica de fora, senão
     animarNumero leria "14%" como NaN e zeraria o indicador. */
  el.querySelectorAll('.kpi .v').forEach(v => {
    const alvo = v.querySelector('[data-num]') || v;
    animarNumero(alvo, alvo.textContent);
  });

  el.querySelectorAll('[data-ir]').forEach(b => b.addEventListener('click', () => {
    lembrar('filtros.calibracao', { status:b.dataset.ir, familia:'', texto:'', incluirInativos:false });
    irPara('calibracao');
  }));
}

/* ==================================================================== */
function graficos(d){
  const el = elRaiz.querySelector('#graficos');
  /* Três gráficos, na ordem em que a pergunta aparece: o que eu tenho
     (composição), quando vence (agenda), onde atacar (concentração).

     Eram quatro. O quarto contava quantos instrumentos estavam inativos
     e por qual motivo — mas o motivo virou um dado que a importação não
     preenche mais, e uma barra sozinha num cartão inteiro é desenho sem
     informação. O número que importava (quanto do acervo está fora de
     uso) subiu para a faixa de indicadores, que é o lugar de um valor
     que se lê sem interpretar. */
  el.innerHTML = `<div id="gArco"></div><div id="gMeses"></div>
                  <div id="gPareto" class="larga"></div>`;

  /* --- 1. Arco de situação -------------------------------------------
     'standby_pausado' entra somado a 'calibrado': é exatamente isso que
     ele é — instrumento válido com o relógio parado. Como cinza de croma
     0,02 ele reprova no piso do validador e viraria uma mancha morta no
     anel; como rótulo, na tabela e na lista, ele continua existindo.

     'referencia' é gomo próprio: padrão de aferição é instrumento ativo
     do acervo, e não uma situação de calibração. Sem ele, o número do
     centro do anel (acervo ativo) não fechava com a soma dos gomos. */
  const contagem = {
    descalibrado:          d.descalibrados.length,
    em_calibracao_externa: d.externas.length,
    proximo_vencimento:    d.proximos.length,
    solicitado:            d.solicitados.length,
    calibrado:             d.calibrados.length + d.standby.length,
    referencia:            d.referencias.length
  };
  arcoSituacao(el.querySelector('#gArco'), {
    total: d.ativos.length,
    rotuloCentro: 'instrumentos ativos',
    segmentos: ORDEM_GRAFICO.map(s => ({
      chave: s,
      rotulo: s === 'calibrado' && d.standby.length
        ? `Calibrado (${d.standby.length} em standby)`
        : s === 'referencia'
          ? 'Referência (sem validade a vencer)'
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
  // Só quem tem validade a vencer entra na carga: referência não tem
  // data_proxima, e contá-la no denominador diluiria o percentual.
  d.sobControle.forEach(i => {
    if (!i.data_proxima) return;
    const [a, m] = i.data_proxima.split('-').map(Number);
    const alvo = meses.find(x => x.ano === a && x.mes === m - 1);
    if (alvo) alvo.valor++;
  });
  barrasVencimento(el.querySelector('#gMeses'), { meses, totalAtivos: d.sobControle.length });

  /* --- 3. Pareto por família ----------------------------------------- */
  const pendentes = [...d.descalibrados, ...d.proximos];
  const mapa = new Map();
  pendentes.forEach(i => {
    const k = i.familia_id;
    if (!mapa.has(k)) mapa.set(k, { rotulo: i.familia_nome, sigla: i.familia_codigo, valor: 0 });
    mapa.get(k).valor++;
  });
  pareto(el.querySelector('#gPareto'), {
    familias: [...mapa.values()], totalAtivos: d.sobControle.length });
}

/* ==================================================================== */
/* ---------------------------------------------------------------------
   Cartão de lista que abre e fecha.

   Com centenas de instrumentos, essas duas listas empurravam os
   gráficos e os empréstimos para fora da tela. Fechadas por padrão, o
   cabeçalho já entrega o número — que é a informação de fato — e a
   lista completa fica a um clique. <details> nativo: teclado e leitor
   de tela funcionam sem nenhum JS.
   --------------------------------------------------------------------- */
function cardLista({ id, icone, titulo, resumo, itens }){
  const aberto = lembrado('painel.aberto.' + id, false);
  return `
    <details class="card" data-colapsavel="${esc(id)}" ${aberto ? 'open' : ''}>
      <summary class="card-head">
        <svg viewBox="0 0 24 24">${icone}</svg>
        <h2>${esc(titulo)}</h2>
        <span class="right">${itens.length}${resumo ? ' · ' + esc(resumo) : ''}</span>
        <span class="chevron" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></span>
      </summary>
      <div class="card-body tight">${listaInstrumentos(itens)}</div>
    </details>`;
}

function listas({ alvo, descalibrados, proximos, emprestimos, alerta }){
  /* Só empréstimo CASUAL entra na lista do painel. Casual é o que devia
     ter voltado no mesmo dia — é dele que se cobra devolução. Posse e
     externo são de prazo indeterminado por definição: listá-los aqui
     todo dia é encher a primeira tela com o que ninguém vai fazer nada
     a respeito. Eles continuam inteiros na tela de Empréstimo, e o
     indicador lá em cima segue contando o acervo que está fora. */
  const casuais = emprestimos.filter(m => m.tipo === 'casual');
  const outros  = emprestimos.filter(m => m.tipo !== 'casual');
  const alertas = casuais.filter(m => m.em_alerta);

  const maisUrgente = proximos.length ? proximos[0].dias_para_vencer : null;

  alvo.innerHTML = `
    <div style="margin-bottom:16px">${legenda(ORDEM_STATUS_TMMDE)}</div>

    ${descalibrados.length
      ? cardLista({
          id:'descalibrados',
          icone:'<path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
          titulo:'Descalibrados — ação imediata',
          itens: descalibrados
        })
      : `<div class="card"><div class="card-body">
           <div class="warn-box g" style="margin:0">Nenhum instrumento descalibrado. O acervo está em dia.</div>
         </div></div>`}

    ${proximos.length
      ? cardLista({
          id:'proximos',
          icone:'<path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2"/>',
          titulo:`Vencem ${alerta}`,
          resumo: maisUrgente != null
            ? (maisUrgente <= 0 ? 'o primeiro vence hoje' : `o primeiro em ${maisUrgente} d`)
            : '',
          itens: proximos
        })
      : ''}

    <div class="card">
      <div class="card-head">
        <svg viewBox="0 0 24 24"><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7M2 7h20v5H2zM12 7v14"/></svg>
        <h2>Empréstimos casuais em aberto</h2>
        <span class="right">${casuais.length}${alertas.length ? ' · ' + alertas.length + ' em alerta' : ''}</span>
      </div>
      <div class="card-body tight">
        ${casuais.length ? `
          <!-- 'fixa': isto é o número do dia, não explicação de tela.
               Aviso operacional não se guarda atrás de um clique. -->
          ${alertas.length ? `<div class="warn-box w fixa">
            <b>${alertas.length}</b> empréstimo(s) passaram do prazo. Cobre a devolução.</div>` : ''}
          ${casuais.map(m => `
            <div class="rec ${m.em_alerta ? 's-descalibrado' : 's-solicitado'}">
              <div class="rec-in"><div class="rec-grid">
                <div><div class="k">Tag</div><div class="v mono">${esc(m.tag)}</div></div>
                <div><div class="k">Instrumento</div><div class="v">${esc(m.descricao)}</div></div>
                <div><div class="k">Com</div><div class="v">${esc(m.responsavel)} · ${esc(m.setor)}</div></div>
                <div><div class="k">Saída</div><div class="v">${esc(fmtDT(m.data_saida))}</div></div>
                <div><div class="k">Fora há</div><div class="v" style="color:${
                  m.em_alerta ? 'var(--status-descalibrado)' : 'inherit'}">${esc(m.dias_fora)} dia(s)</div></div>
              </div></div>
            </div>`).join('')}
        ` : htmlVazio('Nenhum empréstimo casual em aberto.')}
        ${outros.length ? `<p style="font-size:12px;color:var(--muted);margin-top:12px;line-height:1.5">
          ${outros.length} empréstimo(s) em <b>posse</b> ou <b>externo</b> não entram nesta lista:
          eles são de prazo indeterminado por definição. Estão na tela de Empréstimo.</p>` : ''}
        <div style="margin-top:12px"><button class="btn btn-outline btn-sm" id="btIrEmp">
          Abrir tela de empréstimo</button></div>
      </div>
    </div>`;

  const btEmp = alvo.querySelector('#btIrEmp');
  if (btEmp) btEmp.addEventListener('click', () => irPara('emprestimo'));

  alvo.querySelectorAll('[data-instr]').forEach(b =>
    b.addEventListener('click', () => irPara('calibracao', b.dataset.instr)));

  // O Realtime repinta esta área sozinho. Sem guardar o estado, a lista
  // que o usuário acabou de abrir fecharia na cara dele.
  alvo.querySelectorAll('[data-colapsavel]').forEach(d =>
    d.addEventListener('toggle', () => lembrar('painel.aberto.' + d.dataset.colapsavel, d.open)));
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
