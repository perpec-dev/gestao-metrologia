/* =====================================================================
   ETIQUETAS — escolher os instrumentos, conferir a prévia, imprimir.

   O conteúdo de cada etiqueta sai da mesma view que a ficha mostra
   (vw_instrumentos_status), então a etiqueta nunca diz uma data que a
   ficha não diga. As regras, a distribuição nas folhas e o desenho estão
   em components/etiquetas.js; esta tela só cuida da seleção.

   Instrumento sem calibração válida aparece na lista, desabilitado e com
   o motivo: a pergunta "por que o P-MAN-30 não sai?" precisa de resposta
   na própria tela.

   #/etiquetas/<id> já abre com aquele instrumento marcado — é o botão
   "Etiqueta" da ficha.
   ===================================================================== */
import { esc, chave, debounce, delegar, lembrar, lembrado, hojeISO,
         htmlCarregando, htmlVazio, toast, msgErro } from '../utils.js';
import { listarInstrumentos, listarFamilias } from '../supabase.js';
import { criarTabela } from '../components/tabela.js';
import { badge } from '../components/status-badge.js';
import { conteudoEtiqueta, motivoSemEtiqueta, resumoEtiqueta, distribuir,
         htmlFolhas, imprimirEtiquetas, cssEtiquetas, FOLHA } from '../components/etiquetas.js';

const PADRAO = { texto:'', tipo:'', familia:'', desde:'', mostrar:'aptos' };

let dados = [];
let tabela = null;
let selecao = new Set();
let filtros = { ...PADRAO };
let ajuste = { x:0, y:0 };

export function destroy(){ dados = []; tabela = null; selecao = new Set(); }

/* ==================================================================== */
export async function render(container, params = []){
  // Vindo da ficha, os filtros guardados podiam esconder justamente o
  // instrumento que se quer imprimir.
  filtros = params[0] ? { ...PADRAO } : Object.assign({ ...PADRAO }, lembrado('filtros.etiquetas', {}));
  ajuste  = Object.assign({ x:0, y:0 }, lembrado('etiquetas.ajuste', {}));
  selecao = new Set(params[0] ? [params[0]] : []);
  garantirCss();

  container.innerHTML = `
    <div class="warn-box i">
      <b>Como imprimir.</b> Na janela de impressão, escolha a impressora de etiquetas com o papel
      <b>${String(FOLHA.largura).replace('.', ',')} × ${String(FOLHA.altura).replace('.', ',')} mm</b>,
      margens <b>Nenhuma</b> e escala <b>100%</b>. Se a impressão sair deslocada, corrija em
      <b>Ajuste fino</b> — o valor fica guardado neste computador.<br>
      A etiqueta só sai para instrumento com calibração válida: TMMDE em standby sai só com a
      tag e o quadrado cheio; o que já saiu do standby leva a data de saída como calibração.
    </div>

    <div class="card">
      <div class="card-head"><span class="step">1</span><h2>Instrumentos</h2>
        <span class="right" id="contSel"></span></div>
      <div class="card-body">
        <div class="filtros">
          <div class="field busca">
            <label for="fBusca">Buscar</label>
            <input type="text" id="fBusca" placeholder="Tag, descrição, série…" value="${esc(filtros.texto)}">
          </div>
          <div class="field">
            <label for="fTipo">Classificação</label>
            <select id="fTipo">
              <option value="">Todas</option>
              <option value="TMMDE">TMMDE</option>
              <option value="REFERENCIA">Referência</option>
            </select>
          </div>
          <div class="field">
            <label for="fFamilia">Família</label>
            <select id="fFamilia"><option value="">Todas</option></select>
          </div>
          <div class="field">
            <label for="fDesde">Calibração a partir de</label>
            <input type="date" id="fDesde" value="${esc(filtros.desde)}">
          </div>
          <div class="field">
            <label for="fMostrar">Mostrar</label>
            <select id="fMostrar">
              <option value="aptos">Só os que podem receber etiqueta</option>
              <option value="todos">Todos, com o motivo de quem não pode</option>
            </select>
          </div>
        </div>
        <div style="display:flex;gap:9px;flex-wrap:wrap;margin-bottom:12px">
          <button class="btn btn-outline btn-sm" id="btTodos">Marcar os listados</button>
          <button class="btn btn-outline btn-sm" id="btLimpar">Limpar seleção</button>
        </div>
        <div id="listaEtq">${htmlCarregando()}</div>
      </div>
    </div>

    <div class="act-bar">
      <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">
        <div class="field" style="width:120px">
          <label for="fAjX">Ajuste fino → (mm)</label>
          <input type="number" id="fAjX" step="0.5" min="-10" max="10" value="${esc(ajuste.x)}">
        </div>
        <div class="field" style="width:120px">
          <label for="fAjY">Ajuste fino ↓ (mm)</label>
          <input type="number" id="fAjY" step="0.5" min="-10" max="10" value="${esc(ajuste.y)}">
        </div>
      </div>
      <div class="act-group">
        <button class="btn btn-red" id="btImprimir" style="min-width:220px" disabled>IMPRIMIR ETIQUETAS</button>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><span class="step">2</span><h2>Prévia</h2>
        <span class="right" id="contFolhas"></span></div>
      <div class="card-body">
        <p style="font-size:12.5px;color:var(--muted);margin:0 0 12px">
          Tracejado: margens da folha. Hachurado: área que não pode ser impressa.
          Nada disso sai no papel.</p>
        <div id="previaEtq"></div>
      </div>
    </div>`;

  const familias = await listarFamilias();
  const selFam = container.querySelector('#fFamilia');
  selFam.innerHTML = '<option value="">Todas</option>' +
    familias.map(f => `<option value="${esc(f.id)}">${esc(f.codigo)} — ${esc(f.nome)}</option>`).join('');
  selFam.value = filtros.familia;
  container.querySelector('#fTipo').value = filtros.tipo;
  container.querySelector('#fMostrar').value = filtros.mostrar;

  const aplicar = () => {
    filtros = {
      texto:   container.querySelector('#fBusca').value,
      tipo:    container.querySelector('#fTipo').value,
      familia: container.querySelector('#fFamilia').value,
      desde:   container.querySelector('#fDesde').value,
      mostrar: container.querySelector('#fMostrar').value
    };
    lembrar('filtros.etiquetas', filtros);
    if (tabela) tabela.atualizar(filtrar());
  };
  container.querySelector('#fBusca').addEventListener('input', debounce(aplicar, 200));
  ['#fTipo','#fFamilia','#fDesde','#fMostrar'].forEach(s =>
    container.querySelector(s).addEventListener('change', aplicar));

  const lerAjuste = () => {
    const n = id => { const v = Number(container.querySelector(id).value); return isFinite(v) ? v : 0; };
    ajuste = { x: n('#fAjX'), y: n('#fAjY') };
    lembrar('etiquetas.ajuste', ajuste);
    previa(container);
  };
  ['#fAjX','#fAjY'].forEach(s => container.querySelector(s).addEventListener('change', lerAjuste));

  container.querySelector('#btTodos').addEventListener('click', () => {
    filtrar().forEach(l => { if (!l._motivo) selecao.add(l.id); });
    mudouSelecao(container);
  });
  container.querySelector('#btLimpar').addEventListener('click', () => {
    selecao.clear();
    mudouSelecao(container);
  });

  // No elemento da lista, e não no container: o container é de todas as
  // telas, e o Inventário também usa data-sel — o ouvinte sobreviveria à
  // troca de tela e dispararia lá.
  delegar(container.querySelector('#listaEtq'), 'change', 'input[data-sel]', (e, inp) => {
    if (inp.checked) selecao.add(inp.dataset.sel); else selecao.delete(inp.dataset.sel);
    mudouSelecao(container);
  });

  container.querySelector('#btImprimir').addEventListener('click', () => imprimir(container));

  try {
    await carregar();
  } catch (e){
    container.querySelector('#listaEtq').innerHTML = htmlVazio('Não foi possível carregar os instrumentos.');
    toast(msgErro(e), 'error');
    return;
  }

  // O instrumento pedido pela ficha pode não poder receber etiqueta:
  // dizer por quê, em vez de abrir a tela com a seleção vazia em silêncio.
  if (params[0]){
    const pedido = dados.find(l => l.id === params[0]);
    if (pedido && pedido._motivo){
      selecao.delete(pedido.id);
      toast(`${pedido.tag} não pode receber etiqueta: ${pedido._motivo.toLowerCase()}.`, 'error');
    }
  }

  tabela = criarTabela(container.querySelector('#listaEtq'), {
    colunas: [
      { chave:'_sel', rotulo:'', ordenavel:false, classe:'sel',
        html: l => l._motivo ? '' :
          `<input type="checkbox" data-sel="${esc(l.id)}" ${selecao.has(l.id) ? 'checked' : ''}
                  aria-label="Selecionar ${esc(l.tag)}">` },
      { chave:'tag', rotulo:'Tag', classe:'mono', largura:'120px' },
      { chave:'descricao', rotulo:'Descrição' },
      { chave:'tipo', rotulo:'Classificação', largura:'120px',
        valor: l => l.tipo === 'REFERENCIA' ? 'Referência' : 'TMMDE' },
      { chave:'status_efetivo', rotulo:'Situação', largura:'170px', html: l => badge(l.status_efetivo) },
      { chave:'_resumo', rotulo:'Etiqueta', largura:'260px',
        valor: l => l._motivo || l._resumo,
        html: l => l._motivo
          ? `<span style="color:var(--red);font-weight:650">${esc(l._motivo)}</span>`
          : esc(l._resumo) }
    ],
    linhas: filtrar(),
    idLinha: l => l.id,
    classeLinha: l => selecao.has(l.id) ? 'marcada' : (l._motivo ? 'inativa' : ''),
    aoClicar: l => {
      if (l._motivo) return;
      if (selecao.has(l.id)) selecao.delete(l.id); else selecao.add(l.id);
      mudouSelecao(container);
    },
    vazio: 'Nenhum instrumento com esses filtros.'
  });

  mudouSelecao(container);
}

/* ==================================================================== */
async function carregar(){
  const hoje = hojeISO();
  dados = (await listarInstrumentos()).map(l => {
    const motivo = motivoSemEtiqueta(l, hoje);
    const c = motivo ? null : conteudoEtiqueta(l);
    return { ...l, _motivo: motivo, _conteudo: c, _resumo: c ? resumoEtiqueta(c) : '' };
  });
  // Quem perdeu a validade desde que foi marcado sai da seleção.
  [...selecao].forEach(id => {
    const l = dados.find(x => x.id === id);
    if (!l || l._motivo) selecao.delete(id);
  });
}

function filtrar(){
  const t = chave(filtros.texto);
  return dados.filter(l => {
    if (filtros.mostrar === 'aptos' && l._motivo) return false;
    if (filtros.tipo && l.tipo !== filtros.tipo) return false;
    if (filtros.familia && l.familia_id !== filtros.familia) return false;
    // "Calibração" é a data que vai NA ETIQUETA: para quem saiu do
    // standby, a data de saída. Referência e standby não têm data e não
    // passam neste filtro.
    if (filtros.desde && !(l._conteudo?.calibracao && l._conteudo.calibracao >= filtros.desde)) return false;
    if (t && !chave([l.tag, l.descricao, l.num_serie, l.fabricante].join(' ')).includes(t)) return false;
    return true;
  });
}

const selecionados = () => dados
  .filter(l => selecao.has(l.id) && !l._motivo)
  .sort((a, b) => a.tag.localeCompare(b.tag, 'pt-BR', { numeric:true }));

function mudouSelecao(container){
  if (tabela) tabela.repintar();
  const n = selecionados().length;
  container.querySelector('#contSel').textContent =
    n ? `${n} selecionado${n > 1 ? 's' : ''}` : 'Nenhum selecionado';
  container.querySelector('#btImprimir').disabled = !n;
  previa(container);
}

function folhasDaSelecao(){
  return distribuir(selecionados().map(l => l._conteudo));
}

function previa(container){
  const alvo = container.querySelector('#previaEtq');
  const cont = container.querySelector('#contFolhas');
  let folhas;
  try { folhas = folhasDaSelecao(); }
  catch (e){ alvo.innerHTML = htmlVazio(msgErro(e)); cont.textContent = ''; return; }

  if (!folhas.length){
    alvo.innerHTML = htmlVazio('Marque os instrumentos na lista para ver as etiquetas.');
    cont.textContent = '';
    return;
  }
  const n = folhas.reduce((s, f) => s + f.length, 0);
  cont.textContent = `${n} etiqueta${n > 1 ? 's' : ''} · ${folhas.length} folha${folhas.length > 1 ? 's' : ''}`;
  alvo.innerHTML = `<div class="etq-previa">${htmlFolhas(folhas, { guias:true, ajuste })}</div>`;
}

async function imprimir(container){
  const bt = container.querySelector('#btImprimir');
  bt.disabled = true; bt.textContent = 'Preparando…';
  try {
    // Relê antes de imprimir: entre marcar e imprimir alguém pode ter
    // registrado calibração ou marcado um instrumento como descalibrado,
    // e a etiqueta tem de dizer o que o banco diz AGORA.
    const antes = selecionados().length;
    await carregar();
    if (tabela) tabela.atualizar(filtrar());
    mudouSelecao(container);
    const depois = selecionados().length;
    if (depois < antes){
      toast(`${antes - depois} instrumento(s) deixaram de ter calibração válida e saíram da seleção. Confira a prévia.`, 'error');
      return;
    }
    if (!depois) return;
    await imprimirEtiquetas(folhasDaSelecao(), ajuste);
  } catch (e){
    toast(msgErro(e), 'error');
  } finally {
    bt.textContent = 'IMPRIMIR ETIQUETAS';
    bt.disabled = !selecionados().length;
  }
}

/* As regras de desenho das etiquetas são as mesmas da impressão; só a
   moldura da prévia (zoom e sombra da folha) é da tela. */
function garantirCss(){
  if (document.getElementById('etqCss')) return;
  const st = document.createElement('style');
  st.id = 'etqCss';
  st.textContent = cssEtiquetas() + `
    .etq-previa{display:flex;flex-wrap:wrap;gap:18px;overflow-x:auto;padding:4px}
    .etq-previa .etq-folha{zoom:2;box-shadow:0 0 0 .25mm #CFC8BF, 0 1mm 3mm rgba(21,16,16,.10);flex:0 0 auto}`;
  document.head.appendChild(st);
}
