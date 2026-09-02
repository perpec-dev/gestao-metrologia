/* =====================================================================
   ARQUIVOS — uma pasta por equipamento.

   O acervo sempre teve arquivos; o que faltava era um lugar onde eles
   fossem ARQUIVOS, e não eventos. Certificado, laudo, foto e termo
   moravam cada um numa coluna de uma tabela diferente, visíveis só
   dentro da linha do tempo do instrumento — ótimo para contar a
   história, péssimo para responder "cadê o certificado do P-PAQ-03".

   Aqui cada instrumento é uma pasta, com subpastas por tipo de
   documento. É o mesmo desenho que o Storage passou a ter: os arquivos
   agora sobem para <bucket>/<tag>/<data>-<nome>, então a pasta existe
   dos dois lados — nesta tela e no painel do Supabase.

   Leitura pura: nada aqui apaga nem move arquivo.
   ===================================================================== */
import { esc, chave, toast, msgErro, debounce, htmlCarregando, htmlVazio,
         lembrar, lembrado } from '../utils.js';
import { listarArquivos, listarInstrumentos, ouvir } from '../supabase.js';
import { htmlArquivos, resumoArquivos } from '../components/arquivos.js';
import { ligarArquivos } from '../components/timeline.js';
import { irPara } from '../router.js';

let desligarRealtime = null;
let pastas = [];          // [{ id, tag, descricao, familia_nome, inativo, arquivos:[] }]
let filtros = { texto:'', tipo:'', vazias:false };

export function destroy(){
  if (desligarRealtime){ desligarRealtime(); desligarRealtime = null; }
  pastas = [];
}

/* ==================================================================== */
export async function render(container){
  filtros = Object.assign(filtros, lembrado('filtros.arquivos', {}));

  container.innerHTML = `
    <div class="filtros">
      <div class="field busca">
        <label for="fBusca">Buscar</label>
        <input type="text" id="fBusca" placeholder="Tag, instrumento ou nome do arquivo…"
               value="${esc(filtros.texto)}">
      </div>
      <div class="field">
        <label for="fTipo">Tipo de documento</label>
        <select id="fTipo">
          <option value="">Todos</option>
          <option value="Certificado">Certificados</option>
          <option value="Laudo">Laudos</option>
          <option value="Foto">Fotos</option>
          <option value="Termo">Termos de responsabilidade</option>
        </select>
      </div>
      <div class="field field-inline" style="align-self:end;padding-bottom:9px">
        <input type="checkbox" id="fVazias" ${filtros.vazias ? 'checked' : ''}>
        <label for="fVazias" title="Instrumentos que ainda não têm nenhum documento anexado">
          Mostrar pastas vazias</label>
      </div>
      <div class="field" style="align-self:end;padding-bottom:2px">
        <button class="btn btn-outline" id="btAtualizar">Atualizar</button>
      </div>
    </div>

    <div id="resumoArq" class="kpis"></div>
    <div id="listaArq">${htmlCarregando()}</div>`;

  container.querySelector('#fTipo').value = filtros.tipo || '';

  const aplicar = () => {
    filtros = {
      texto:  container.querySelector('#fBusca').value,
      tipo:   container.querySelector('#fTipo').value,
      vazias: container.querySelector('#fVazias').checked
    };
    lembrar('filtros.arquivos', filtros);
    pintar(container);
  };

  container.querySelector('#fBusca').addEventListener('input', debounce(aplicar, 200));
  ['#fTipo','#fVazias'].forEach(s =>
    container.querySelector(s).addEventListener('change', aplicar));
  container.querySelector('#btAtualizar').addEventListener('click', () => carregar(container));

  await carregar(container);

  desligarRealtime = ouvir('tela-arquivos', ['calibracoes','movimentacoes','instrumentos'],
    debounce(() => carregar(container, true), 900));
}

/* ==================================================================== */
async function carregar(container, silencioso = false){
  const el = container.querySelector('#listaArq');
  if (!el) return;
  if (!silencioso && !pastas.length) el.innerHTML = htmlCarregando();

  let arquivos, instrumentos;
  try {
    [arquivos, instrumentos] = await Promise.all([listarArquivos(), listarInstrumentos()]);
  } catch (e){
    el.innerHTML = `<div class="warn-box e">${esc(msgErro(e))}</div>`;
    if (!silencioso) toast(msgErro(e), 'error');
    return;
  }

  // A pasta existe mesmo vazia: instrumento sem nenhum documento é
  // exatamente o que a metrologia precisa enxergar antes da auditoria.
  const porInstrumento = new Map();
  arquivos.forEach(a => {
    if (!porInstrumento.has(a.instrumento_id)) porInstrumento.set(a.instrumento_id, []);
    porInstrumento.get(a.instrumento_id).push(a);
  });

  pastas = instrumentos.map(i => ({
    id: i.id, tag: i.tag, descricao: i.descricao,
    familia_nome: i.familia_nome,
    referencia: i.tipo === 'REFERENCIA',
    inativo: i.condicao_fisica === 'inativo',
    arquivos: porInstrumento.get(i.id) || []
  }));

  pintar(container);
}

/* ==================================================================== */
function filtrar(){
  const t = chave(filtros.texto);
  return pastas
    .map(p => {
      // O filtro de tipo recorta o CONTEÚDO da pasta, não só a lista de
      // pastas: pedir "certificados" e receber a pasta inteira aberta,
      // com termos e fotos no meio, não é filtrar.
      const arquivos = filtros.tipo
        ? p.arquivos.filter(a => a.tipo === filtros.tipo)
        : p.arquivos;
      return { ...p, arquivos };
    })
    .filter(p => {
      // Pasta sem arquivo só aparece quando alguém pede — é o recorte de
      // "o que ainda falta documentar", não o padrão de navegação.
      if (!filtros.vazias && !p.arquivos.length) return false;
      if (!t) return true;
      const alvo = chave([p.tag, p.descricao, p.familia_nome,
                          ...p.arquivos.map(a => a.nome + ' ' + a.arquivo_path)].join(' '));
      return alvo.includes(t);
    });
}

function pintar(container){
  const el = container.querySelector('#listaArq');
  const lista = filtrar();

  resumo(container, lista);

  if (!lista.length){
    el.innerHTML = htmlVazio(filtros.texto || filtros.tipo
      ? 'Nenhuma pasta com esses filtros.'
      : 'Nenhum arquivo anexado ainda. Certificados, laudos, fotos e termos aparecem aqui automaticamente.');
    return;
  }

  const aberta = lembrado('arquivos.aberta', null);

  el.innerHTML = lista.map(p => `
    <details class="card pasta" data-pasta="${esc(p.id)}" ${p.id === aberta ? 'open' : ''}>
      <summary class="card-head">
        <svg viewBox="0 0 24 24"><path d="M4 4h6l2 3h8v13H4z"/></svg>
        <h2><span class="mono">${esc(p.tag)}</span> — ${esc(p.descricao)}</h2>
        <span class="right">${p.arquivos.length
          ? esc(resumoArquivos(p.arquivos))
          : '<span style="color:var(--muted)">pasta vazia</span>'}</span>
        <span class="chevron" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></span>
      </summary>
      <div class="card-body tight">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;font-size:12px;color:var(--muted)">
          <span>${esc(p.familia_nome)}</span>
          ${p.referencia ? '<span class="bdg s-referencia">Referência</span>' : ''}
          ${p.inativo ? '<span class="bdg s-inativo">Inativo</span>' : ''}
          <span style="flex:1"></span>
          <button class="btn btn-outline btn-sm" data-ficha="${esc(p.id)}">Abrir ficha</button>
        </div>
        ${htmlArquivos(p.arquivos,
          'Nenhum documento anexado a este instrumento ainda.')}
      </div>
    </details>`).join('');

  ligarArquivos(el);

  el.querySelectorAll('[data-ficha]').forEach(b => b.addEventListener('click', e => {
    e.preventDefault();
    const p = pastas.find(x => x.id === b.dataset.ficha);
    irPara(p && p.referencia ? 'referencia' : 'calibracao', b.dataset.ficha);
  }));

  // Uma pasta aberta continua aberta depois do Realtime repintar a tela.
  el.querySelectorAll('[data-pasta]').forEach(d => d.addEventListener('toggle', () =>
    lembrar('arquivos.aberta', d.open ? d.dataset.pasta : null)));
}

function resumo(container, lista){
  const el = container.querySelector('#resumoArq');
  if (!el) return;
  const total    = pastas.reduce((s,p) => s + p.arquivos.length, 0);
  const comPasta = pastas.filter(p => p.arquivos.length).length;
  const semNada  = pastas.filter(p => !p.arquivos.length).length;

  el.innerHTML = `
    <div class="kpi c-total estatico">
      <div class="k">Arquivos no acervo</div><div class="v">${total}</div>
      <div class="d">certificados, laudos, fotos e termos</div></div>
    <div class="kpi c-calibrado estatico">
      <div class="k">Instrumentos com pasta</div><div class="v">${comPasta}</div>
      <div class="d">de ${pastas.length} no acervo</div></div>
    <button class="kpi c-descalibrado" id="kpiVazias">
      <div class="k">Pastas vazias</div><div class="v">${semNada}</div>
      <div class="d">sem nenhum documento anexado</div></button>
    <div class="kpi c-solicitado estatico">
      <div class="k">Mostrando</div><div class="v">${lista.length}</div>
      <div class="d">pasta(s) com os filtros atuais</div></div>`;

  const bt = el.querySelector('#kpiVazias');
  if (bt) bt.addEventListener('click', () => {
    const cx = container.querySelector('#fVazias');
    cx.checked = true;
    container.querySelector('#fTipo').value = '';
    container.querySelector('#fBusca').value = '';
    cx.dispatchEvent(new Event('change'));
  });
}
