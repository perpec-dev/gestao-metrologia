/* =====================================================================
   REFERÊNCIA — os padrões de aferição.

   Tela irmã da de Calibração, e separada dela de propósito. O padrão de
   referência não tem validade a vencer, não entra na fila de trabalho e
   não é cobrado: misturá-lo com os TMMDE fazia a lista de calibração
   contar itens que nunca vão vencer, e a conta do painel nunca fechar.

   O que interessa aqui é outra pergunta — não "quando vence", mas
   "quais padrões eu tenho e onde eles estão". Daí as colunas: tag (que
   é a rastreabilidade do padrão), família e localização, com o setor de
   quem está com ele quando está emprestado.

   Inativação existe também para referência (padrão danificado, vago,
   sucateado), e o filtro de condição decide se os inativos aparecem,
   se aparecem sozinhos ou se somem.
   ===================================================================== */
import { esc, fmtData, msgErro, debounce, chave,
         lembrar, lembrado, htmlCarregando } from '../utils.js';
import { listarInstrumentos, listarFamilias, ouvir } from '../supabase.js';
import { criarTabela } from '../components/tabela.js';
import { badgeCondicao } from '../components/status-badge.js';
import { fecharModal } from '../components/modal.js';
import { abrirDetalhe } from './calibracao.js';
import { irPara } from '../router.js';

let desligarRealtime = null;
let tabela = null;
let dados = [];
let filtros = { familia:'', texto:'', condicao:'ativo' };

export function destroy(){
  if (desligarRealtime){ desligarRealtime(); desligarRealtime = null; }
  fecharModal();
  tabela = null; dados = [];
}

/* ==================================================================== */
export async function render(container, params = []){
  filtros = Object.assign(filtros, lembrado('filtros.referencia', {}));

  container.innerHTML = `
    <div class="warn-box i">
      <b>Padrões de aferição.</b> Instrumento de referência não tem exigência de calibração
      periódica neste controle: ele não vence, não fica descalibrado e não entra na fila de
      trabalho da metrologia. O que se controla aqui é <b>quais padrões existem e onde estão</b>.
      A rastreabilidade de cada um fica na tag e nas observações da ficha.
    </div>

    <div class="filtros">
      <div class="field busca">
        <label for="fBusca">Buscar</label>
        <input type="text" id="fBusca" placeholder="Tag, descrição, série, fabricante…"
               value="${esc(filtros.texto)}">
      </div>
      <div class="field">
        <label for="fFamilia">Família</label>
        <select id="fFamilia"><option value="">Todas</option></select>
      </div>
      <div class="field">
        <label for="fCondicao">Inativos</label>
        <select id="fCondicao">
          <option value="ativo">Ocultar — só os ativos</option>
          <option value="">Incluir — ativos e inativos</option>
          <option value="inativo">Apenas os inativos</option>
        </select>
      </div>
      <div class="field" style="align-self:end;padding-bottom:2px">
        <button class="btn btn-outline" id="btAtualizar">Atualizar</button>
      </div>
    </div>

    <div id="resumoRef" class="kpis"></div>
    <div id="listaRef">${htmlCarregando()}</div>`;

  const familias = await listarFamilias();
  const selFam = container.querySelector('#fFamilia');
  selFam.innerHTML = '<option value="">Todas</option>' +
    familias.map(f => `<option value="${esc(f.id)}">${esc(f.codigo)} — ${esc(f.nome)}</option>`).join('');
  selFam.value = filtros.familia || '';
  container.querySelector('#fCondicao').value = filtros.condicao ?? 'ativo';

  const aplicar = () => {
    filtros = {
      texto:    container.querySelector('#fBusca').value,
      familia:  container.querySelector('#fFamilia').value,
      condicao: container.querySelector('#fCondicao').value
    };
    lembrar('filtros.referencia', filtros);
    if (tabela) tabela.atualizar(filtrar());
    resumo(container);
  };

  container.querySelector('#fBusca').addEventListener('input', debounce(aplicar, 200));
  ['#fFamilia','#fCondicao'].forEach(s =>
    container.querySelector(s).addEventListener('change', aplicar));
  container.querySelector('#btAtualizar').addEventListener('click', () => carregar(container));

  await carregar(container);

  desligarRealtime = ouvir('tela-referencia', ['instrumentos','movimentacoes'],
    debounce(() => carregar(container, true), 800));

  if (params[0]) abrirDetalhe(params[0], null);
}

/* ==================================================================== */
function filtrar(){
  const t = chave(filtros.texto);
  return dados.filter(i => {
    if (filtros.condicao && i.condicao_fisica !== filtros.condicao) return false;
    if (filtros.familia && i.familia_id !== filtros.familia) return false;
    if (t){
      const alvo = chave([i.tag, i.descricao, i.num_serie, i.fabricante,
                          i.familia_nome, i.localizacao_atual, i.observacoes].join(' '));
      if (!alvo.includes(t)) return false;
    }
    return true;
  });
}

async function carregar(container, silencioso = false){
  const el = container.querySelector('#listaRef');
  if (!el) return;
  if (!silencioso && !tabela) el.innerHTML = htmlCarregando();

  try {
    dados = (await listarInstrumentos()).filter(i => i.tipo === 'REFERENCIA');
  } catch (e){
    el.innerHTML = `<div class="warn-box e">${esc(msgErro(e))}</div>`;
    return;
  }

  resumo(container);

  const linhas = filtrar();
  if (tabela){ tabela.atualizar(linhas); return; }

  tabela = criarTabela(el, {
    linhas,
    vazio: 'Nenhum padrão de referência com esses filtros.',
    ordem: { chave:'tag', dir:1 },
    idLinha: l => l.id,
    classeLinha: l => 'l-referencia' + (l.condicao_fisica === 'inativo' ? ' inativa' : ''),
    /* container null de propósito: a ficha é a mesma da tela de
       Calibração, e as ações dela que releem a lista são as de
       calibração — que não existem para referência. O Realtime desta
       tela já cuida de manter a lista em dia. */
    aoClicar: l => abrirDetalhe(l.id, null),
    colunas: [
      { chave:'tag', rotulo:'Tag', classe:'mono', largura:'120px' },
      { chave:'descricao', rotulo:'Descrição' },
      { chave:'familia_nome', rotulo:'Família', largura:'180px' },
      /* Localização é a coluna que responde à pergunta do dia: o padrão
         está na sala da metrologia ou saiu com alguém? Emprestado, mostra
         o setor e com quem — a mesma leitura da tela de calibração. */
      { chave:'localizacao_atual', rotulo:'Localização', largura:'200px',
        html: l => l.emprestado
          ? `<span title="Com ${esc(l.emprestado_para)}">${esc(l.setor_atual || '—')} ↗</span>
             <div style="font-size:11px;color:var(--muted)">${esc(l.emprestado_para)}</div>`
          : esc(l.localizacao_normal || '—') },
      { chave:'condicao_fisica', rotulo:'Condição', largura:'130px',
        html: l => badgeCondicao(l.condicao_fisica) +
          (l.condicao_fisica === 'inativo' && l.motivo_inativo
            ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">${esc(l.motivo_inativo)}</div>`
            : '') },
      { chave:'data_entrada', rotulo:'Cadastro', largura:'110px',
        html: l => esc(fmtData(l.data_entrada)) }
    ]
  });
}

/* ==================================================================== */
function resumo(container){
  const el = container.querySelector('#resumoRef');
  if (!el) return;
  const ativos      = dados.filter(i => i.condicao_fisica === 'ativo').length;
  const inativos    = dados.filter(i => i.condicao_fisica === 'inativo').length;
  const emprestados = dados.filter(i => i.emprestado && i.condicao_fisica === 'ativo').length;

  el.innerHTML = `
    <button class="kpi c-referencia" data-c="">
      <div class="k">Padrões cadastrados</div><div class="v">${dados.length}</div>
      <div class="d">ativos e inativos</div></button>
    <button class="kpi c-calibrado" data-c="ativo">
      <div class="k">Ativos</div><div class="v">${ativos}</div>
      <div class="d">disponíveis para aferição</div></button>
    <button class="kpi c-standby" data-c="inativo">
      <div class="k">Inativos</div><div class="v">${inativos}</div>
      <div class="d">fora de uso, com motivo registrado</div></button>
    <button class="kpi c-solicitado" id="kpiEmpRef">
      <div class="k">Emprestados agora</div><div class="v">${emprestados}</div>
      <div class="d">fora da sala de metrologia</div></button>`;

  el.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => {
    const sel = container.querySelector('#fCondicao');
    sel.value = b.dataset.c;
    sel.dispatchEvent(new Event('change'));
  }));

  const btEmp = el.querySelector('#kpiEmpRef');
  if (btEmp) btEmp.addEventListener('click', () => irPara('emprestimo'));
}
