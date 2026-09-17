/* =====================================================================
   INVENTÁRIO — o acervo inteiro, ativo e inativo.

   Regra 6: inativar exige motivo e justificativa. As duas coisas vão
   para a trilha de auditoria pelo gatilho do banco — a tela não tem
   como pular essa etapa, porque a coluna condicao_fisica não é
   atualizável pela API (só pela RPC inativar_instrumento).
   ===================================================================== */
import { esc, fmtData, chave, toast, msgErro, debounce, htmlCarregando,
         lembrar, lembrado } from '../utils.js';
import { listarInstrumentos, listarFamilias, inativarInstrumento,
         reativarInstrumento, apagarInstrumentos, cfgLista, MOTIVO_OUTROS,
         ouvir } from '../supabase.js';
import { criarTabela } from '../components/tabela.js';
import { badge, badgeCondicao, classeLinha, legenda,
         bloqueioInativacao } from '../components/status-badge.js';
import { abrirModal } from '../components/modal.js';
import { souAdmin } from '../auth.js';
import { abrirDetalhe } from './calibracao.js';

let desligarRealtime = null;
let tabela = null;
let dados = [];
let selecionados = new Set();
let filtros = { condicao:'ativo', familia:'', tipo:'', texto:'' };

export function destroy(){
  if (desligarRealtime){ desligarRealtime(); desligarRealtime = null; }
  tabela = null; dados = []; selecionados = new Set();
}

export async function render(container){
  filtros = Object.assign(filtros, lembrado('filtros.inventario', {}));
  const familias = await listarFamilias();

  container.innerHTML = `
    ${souAdmin() ? '' : `<div class="warn-box i">
      Inativar e reativar instrumentos é atribuição da metrologia — você pode fazer as duas
      coisas, com motivo e justificativa. <b>Apagar</b> instrumento, esse sim, é só do
      administrador: inativar preserva o histórico, apagar destrói.</div>`}

    <div class="warn-box i">
      <b>Quando dá para inativar.</b> Só instrumento <b>calibrado</b> ou <b>descalibrado</b> que
      <b>não esteja emprestado</b>. Com a calibração solicitada ou em laboratório externo, encerre
      ou cancele a solicitação primeiro — inativar no meio abandona o pedido sem cancelá-lo.
      Padrão de referência também pode ser inativado; nele vale só a regra do empréstimo.
    </div>

    <div class="filtros">
      <div class="field busca">
        <label for="fBusca">Buscar</label>
        <input type="text" id="fBusca" placeholder="Tag, descrição, série…" value="${esc(filtros.texto)}">
      </div>
      <div class="field">
        <label for="fCondicao">Condição física</label>
        <select id="fCondicao">
          <option value="">Todas</option>
          <option value="ativo">Ativos</option>
          <option value="inativo">Inativos</option>
        </select>
      </div>
      <div class="field">
        <label for="fTipo">Classificação</label>
        <select id="fTipo">
          <option value="">Todas</option>
          <option value="TMMDE">TMMDE — instrumento de uso</option>
          <option value="REFERENCIA">Referência — padrão de aferição</option>
        </select>
      </div>
      <div class="field">
        <label for="fFamilia">Família</label>
        <select id="fFamilia"><option value="">Todas</option>
          ${familias.map(f => `<option value="${esc(f.id)}">${esc(f.codigo)} — ${esc(f.nome)}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="align-self:end;padding-bottom:2px">
        <button class="btn btn-outline" id="btAtualizar">Atualizar</button>
      </div>
    </div>

    <div id="resumo" class="kpis"></div>
    <div style="margin-bottom:14px">${legenda()}</div>
    <div id="selBar"></div>
    <div id="listaInv">${htmlCarregando()}</div>`;

  container.querySelector('#fCondicao').value = filtros.condicao || '';
  container.querySelector('#fFamilia').value  = filtros.familia  || '';
  container.querySelector('#fTipo').value     = filtros.tipo     || '';

  const aplicar = () => {
    filtros = {
      texto:    container.querySelector('#fBusca').value,
      condicao: container.querySelector('#fCondicao').value,
      familia:  container.querySelector('#fFamilia').value,
      tipo:     container.querySelector('#fTipo').value
    };
    lembrar('filtros.inventario', filtros);
    if (tabela) tabela.atualizar(filtrar());
    resumo(container);
  };

  container.querySelector('#fBusca').addEventListener('input', debounce(aplicar, 200));
  ['#fCondicao','#fFamilia','#fTipo'].forEach(s => container.querySelector(s).addEventListener('change', aplicar));
  container.querySelector('#btAtualizar').addEventListener('click', () => carregar(container));

  await carregar(container);

  desligarRealtime = ouvir('tela-inventario', ['instrumentos','calibracoes'],
    debounce(() => carregar(container, true), 800));
}

function filtrar(){
  const t = chave(filtros.texto);
  return dados.filter(i => {
    if (filtros.condicao && i.condicao_fisica !== filtros.condicao) return false;
    if (filtros.familia  && i.familia_id !== filtros.familia) return false;
    if (filtros.tipo     && i.tipo !== filtros.tipo) return false;
    if (t && !chave([i.tag, i.descricao, i.num_serie, i.fabricante, i.familia_nome].join(' ')).includes(t))
      return false;
    return true;
  });
}

function resumo(container){
  const el = container.querySelector('#resumo');
  const ativos      = dados.filter(i => i.condicao_fisica === 'ativo').length;
  const inativos    = dados.filter(i => i.condicao_fisica === 'inativo').length;
  const referencias = dados.filter(i => i.tipo === 'REFERENCIA').length;
  const fora        = dados.filter(i => i.emprestado).length;
  el.innerHTML = `
    <button class="kpi c-total"      data-f=""><div class="k">Total no acervo</div><div class="v">${dados.length}</div></button>
    <button class="kpi c-calibrado"  data-f="ativo"><div class="k">Ativos</div><div class="v">${ativos}</div></button>
    <button class="kpi c-standby"    data-f="inativo"><div class="k">Inativos</div><div class="v">${inativos}</div></button>
    <button class="kpi c-referencia" data-t="REFERENCIA"><div class="k">Referências</div><div class="v">${referencias}</div></button>
    <div class="kpi c-solicitado" style="cursor:default"><div class="k">Emprestados agora</div><div class="v">${fora}</div></div>`;
  el.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => {
    container.querySelector('#fCondicao').value = b.dataset.f;
    container.querySelector('#fTipo').value = '';
    container.querySelector('#fCondicao').dispatchEvent(new Event('change'));
  }));
  el.querySelectorAll('[data-t]').forEach(b => b.addEventListener('click', () => {
    container.querySelector('#fTipo').value = b.dataset.t;
    container.querySelector('#fCondicao').value = '';
    container.querySelector('#fTipo').dispatchEvent(new Event('change'));
  }));
}

async function carregar(container, silencioso = false){
  const el = container.querySelector('#listaInv');
  if (!silencioso && !tabela) el.innerHTML = htmlCarregando();
  try { dados = await listarInstrumentos(); }
  catch (e){ el.innerHTML = `<div class="warn-box e">${esc(msgErro(e))}</div>`; return; }

  resumo(container);
  // Uma linha apagada por outro usuário não pode ficar marcada aqui.
  const vivos = new Set(dados.map(d => d.id));
  selecionados = new Set([...selecionados].filter(id => vivos.has(id)));

  const linhas = filtrar();
  if (tabela){ tabela.atualizar(linhas); pintarSelBar(container); return; }

  const colunaSelecao = souAdmin() ? [{
    chave:'sel', rotulo:'', ordenavel:false, classe:'sel', largura:'38px',
    html: l => `<input type="checkbox" data-sel="${esc(l.id)}" aria-label="Selecionar ${esc(l.tag)}"
                       ${selecionados.has(l.id) ? 'checked' : ''}>`
  }] : [];

  tabela = criarTabela(el, {
    linhas,
    vazio: 'Nenhum instrumento com esses filtros.',
    ordem: { chave:'tag', dir:1 },
    idLinha: l => l.id,
    classeLinha: l => classeLinha(l.status_efetivo)
      + (l.condicao_fisica === 'inativo' ? ' inativa' : '')
      + (selecionados.has(l.id) ? ' marcada' : ''),
    colunas: [
      ...colunaSelecao,
      { chave:'tag', rotulo:'Tag', classe:'mono', largura:'110px' },
      { chave:'descricao', rotulo:'Descrição' },
      { chave:'familia_nome', rotulo:'Família', largura:'150px' },
      { chave:'tipo', rotulo:'Classificação', largura:'110px',
        html: l => l.tipo === 'REFERENCIA'
          ? '<span class="bdg s-referencia">Referência</span>'
          : '<span class="bdg neutro">TMMDE</span>' },
      { chave:'condicao_fisica', rotulo:'Condição', largura:'110px',
        // O motivo é o que responde "por que este está inativo?" sem
        // precisar abrir a ficha — a pergunta nº 1 de quem varre a lista.
        html: l => badgeCondicao(l.condicao_fisica) + (l.condicao_fisica === 'inativo' && l.motivo_inativo
          ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">${esc(l.motivo_inativo)}</div>` : '') },
      { chave:'status_efetivo', rotulo:'Situação', largura:'170px',
        html: l => badge(l.status_efetivo) },
      { chave:'data_proxima', rotulo:'Próxima calibração', largura:'130px',
        html: l => esc(fmtData(l.data_proxima)) },
      { chave:'localizacao_atual', rotulo:'Localização', largura:'160px',
        html: l => l.emprestado
          ? `<span title="Com ${esc(l.emprestado_para)}">${esc(l.setor_atual || '—')} ↗</span>`
          : esc(l.localizacao_normal || '—') },
      { chave:'acoes', rotulo:'', ordenavel:false, largura:'210px',
        /* Botão desabilitado com o motivo no title, em vez de botão que
           some: quem procura "Inativar" e não acha conclui que o sistema
           quebrou; quem lê "está emprestado para Fulano" sabe o que
           fazer em seguida. */
        html: l => {
          if (l.condicao_fisica !== 'ativo') return `
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn btn-outline btn-sm" data-ficha="${esc(l.id)}">Ficha</button>
              <button class="btn btn-outline btn-sm" data-reativar="${esc(l.id)}">Reativar</button>
            </div>`;
          const bloqueio = bloqueioInativacao(l);
          return `
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn btn-outline btn-sm" data-ficha="${esc(l.id)}">Ficha</button>
              <button class="btn btn-outline btn-sm" data-inativar="${esc(l.id)}"
                      ${bloqueio ? 'disabled' : ''}
                      title="${esc(bloqueio || 'Inativar este instrumento')}">
                Inativar</button>
            </div>` } }
    ]
  });

  el.addEventListener('click', e => {
    const ficha = e.target.closest('[data-ficha]');
    if (ficha){ abrirDetalhe(ficha.dataset.ficha, null); return; }
    const inat = e.target.closest('[data-inativar]');
    if (inat){ modalInativar(dados.find(d => d.id === inat.dataset.inativar), container); return; }
    const reat = e.target.closest('[data-reativar]');
    if (reat){ modalReativar(dados.find(d => d.id === reat.dataset.reativar), container); }
  });

  el.addEventListener('change', e => {
    const cx = e.target.closest('[data-sel]');
    if (!cx) return;
    if (cx.checked) selecionados.add(cx.dataset.sel);
    else selecionados.delete(cx.dataset.sel);
    cx.closest('tr')?.classList.toggle('marcada', cx.checked);
    pintarSelBar(container);
  });

  pintarSelBar(container);
}

/* ==================================================================== */
/* SELEÇÃO EM MASSA — só administrador                                  */
/* ==================================================================== */
function pintarSelBar(container){
  const bar = container.querySelector('#selBar');
  if (!bar) return;

  if (!souAdmin() || !selecionados.size){ bar.innerHTML = ''; return; }

  const visiveis = filtrar();
  const todosMarcados = visiveis.length && visiveis.every(l => selecionados.has(l.id));

  bar.innerHTML = `
    <div class="sel-bar">
      <span>${selecionados.size} instrumento(s) selecionado(s)</span>
      <button class="btn btn-outline btn-sm" id="btTodos">
        ${todosMarcados ? 'Desmarcar' : 'Marcar'} os ${visiveis.length} filtrados</button>
      <span class="sep"></span>
      <button class="btn btn-outline btn-sm" id="btLimparSel">Limpar seleção</button>
      <button class="btn btn-red btn-sm" id="btApagarSel">Apagar selecionados</button>
    </div>`;

  bar.querySelector('#btTodos').addEventListener('click', () => {
    if (todosMarcados) visiveis.forEach(l => selecionados.delete(l.id));
    else visiveis.forEach(l => selecionados.add(l.id));
    tabela.repintar();
    pintarSelBar(container);
  });

  bar.querySelector('#btLimparSel').addEventListener('click', () => {
    selecionados.clear();
    tabela.repintar();
    pintarSelBar(container);
  });

  bar.querySelector('#btApagarSel').addEventListener('click', () => modalApagar(container));
}

function modalApagar(container){
  const ids = [...selecionados];
  const itens = dados.filter(d => ids.includes(d.id));
  const comHistorico = itens.filter(i => i.ultima_calibracao || i.emprestado).length;

  abrirModal({
    titulo: `Apagar ${ids.length} instrumento(s)`,
    fecharFora: false,
    corpo: `
      <div class="warn-box e">
        <b>Some o instrumento e todo o histórico dele</b> — calibrações, inspeções,
        movimentações e documentos. Não tem desfazer.
        ${comHistorico ? `<br><br><b>${comHistorico}</b> dos selecionados já têm calibração
          registrada ou estão emprestados.` : ''}
        <br><br>A trilha de auditoria <b>não</b> some: ela registra este apagamento com o
        seu e-mail, a data e a justificativa abaixo.
      </div>

      <div style="max-height:180px;overflow:auto;border:1px solid var(--border);
                  border-radius:var(--r);padding:10px 12px;margin-bottom:16px;
                  font-size:12.5px;line-height:1.7">
        ${itens.map(i => `<div><span class="mono">${esc(i.tag)}</span> — ${esc(i.descricao)}</div>`).join('')}
      </div>

      <div class="field" id="wJustDel">
        <label for="fJustDel">Justificativa<span class="req">*</span></label>
        <textarea id="fJustDel" placeholder="Ex.: carga de teste, reimportando a planilha corrigida."></textarea>
        <div class="hint">Mínimo de 10 caracteres.</div>
        <div class="msg" id="mJustDel"></div>
      </div>`,
    acoes: [
      { rotulo:'Cancelar', classe:'btn-outline', onClick: f => f() },
      { rotulo:`Apagar ${ids.length}`, classe:'btn-red', onClick: async (fechar, bt) => {
          const just = document.getElementById('fJustDel').value.trim();
          if (just.length < 10){
            document.getElementById('wJustDel').classList.add('err');
            document.getElementById('mJustDel').textContent = 'Escreva pelo menos 10 caracteres.';
            return;
          }
          bt.disabled = true; bt.textContent = 'Apagando…';
          try {
            const n = await apagarInstrumentos(ids, just);
            selecionados.clear();
            fechar();
            toast(`${n} instrumento(s) apagados.`, 'success');
            carregar(container, true);
          } catch (e){
            toast(msgErro(e), 'error');
            bt.disabled = false; bt.textContent = `Apagar ${ids.length}`;
          }
      } }
    ],
    aoAbrir: b => b.querySelector('#fJustDel').focus()
  });
}

/* ==================================================================== */
function modalInativar(inst, container){
  if (!inst) return;

  // A tabela já desabilita o botão, mas a lista pode estar defasada por
  // alguns segundos: entre pintar a linha e clicar nela, outro usuário
  // pode ter emprestado o instrumento ou solicitado a calibração.
  const bloqueio = bloqueioInativacao(inst);
  if (bloqueio){
    toast(`${inst.tag} não pode ser inativado. ${bloqueio}`, 'error');
    return;
  }

  const motivos = cfgLista('motivos_inativacao');

  abrirModal({
    titulo: `Inativar — ${inst.tag}`,
    fecharFora: false,
    corpo: `
      <div class="warn-box w">
        A inativação é registrada na trilha de auditoria com o seu e-mail, a data,
        o motivo e a justificativa. Instrumento inativo não pode ser emprestado
        nem entra no fluxo de calibração até ser reativado.
      </div>
      <div class="kv" style="margin-bottom:16px">
        <div><div class="k">Instrumento</div><div class="v">${esc(inst.descricao)}</div></div>
        <div><div class="k">Família</div><div class="v">${esc(inst.familia_nome)}</div></div>
        <div><div class="k">Classificação</div><div class="v">${inst.tipo === 'REFERENCIA'
              ? 'Referência — padrão de aferição' : 'TMMDE — instrumento de uso'}</div></div>
        <div><div class="k">Situação atual</div><div class="v">${badge(inst.status_efetivo)}</div></div>
      </div>
      <div class="field" id="wMotivo">
        <label for="fMotivo">Motivo<span class="req">*</span></label>
        <select id="fMotivo"><option value="">Selecione…</option>
          ${motivos.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}</select>
        <div class="msg" id="mMotivo"></div>
      </div>

      <!-- "Outros" não pode virar um buraco na lista mestre: quem escolhe
           precisa dizer para onde o instrumento foi. -->
      <div class="field" id="wSegregacao" style="margin-top:12px" hidden>
        <label for="fSegregacao">Descrição da segregação<span class="req">*</span></label>
        <input type="text" id="fSegregacao" placeholder="Ex.: enviado ao fabricante; guardado na caixa vermelha da sala de metrologia">
        <div class="hint">Onde o instrumento foi parar e como está identificado. Entra na justificativa.</div>
        <div class="msg" id="mSegregacao"></div>
      </div>

      <div class="field" id="wJustInat" style="margin-top:12px">
        <label for="fJustInat">Justificativa<span class="req">*</span></label>
        <textarea id="fJustInat" placeholder="Descreva o que aconteceu com o instrumento."></textarea>
        <div class="hint">Mínimo de 10 caracteres.</div>
        <div class="msg" id="mJustInat"></div>
      </div>`,
    acoes: [
      { rotulo:'Cancelar', classe:'btn-outline', onClick: f => f() },
      { rotulo:'Inativar instrumento', classe:'btn-red', onClick: async (fechar, bt) => {
          const motivo = document.getElementById('fMotivo').value;
          const just   = document.getElementById('fJustInat').value.trim();
          const segreg = document.getElementById('fSegregacao').value.trim();
          const exigeSegregacao = motivo === MOTIVO_OUTROS;
          let erro = false;
          if (!motivo){ document.getElementById('wMotivo').classList.add('err');
                        document.getElementById('mMotivo').textContent = 'Escolha o motivo.'; erro = true; }
          if (exigeSegregacao && segreg.length < 5){
                        document.getElementById('wSegregacao').classList.add('err');
                        document.getElementById('mSegregacao').textContent =
                          'Descreva a segregação do instrumento.'; erro = true; }
          if (just.length < 10){ document.getElementById('wJustInat').classList.add('err');
                        document.getElementById('mJustInat').textContent = 'Escreva pelo menos 10 caracteres.'; erro = true; }
          if (erro){ toast('Confira os campos em vermelho.','error'); return; }

          // A segregação entra na própria justificativa: é ela que vai
          // para a trilha de auditoria e para o relatório de inativos.
          const justificativa = exigeSegregacao
            ? `Segregação: ${segreg} · ${just}`
            : just;

          bt.disabled = true; bt.textContent = 'Inativando…';
          try {
            await inativarInstrumento(inst.id, motivo, justificativa);
            fechar();
            toast(`${inst.tag} inativado e registrado na auditoria.`, 'success');
            carregar(container, true);
          } catch (e){
            toast(msgErro(e), 'error');
            bt.disabled = false; bt.textContent = 'Inativar instrumento';
          }
      } }
    ],
    aoAbrir: body => {
      const sel = body.querySelector('#fMotivo');
      const wSeg = body.querySelector('#wSegregacao');
      sel.addEventListener('change', () => {
        wSeg.hidden = sel.value !== MOTIVO_OUTROS;
        if (!wSeg.hidden) body.querySelector('#fSegregacao').focus();
      });
      sel.focus();
    }
  });
}

function modalReativar(inst, container){
  if (!inst) return;
  abrirModal({
    titulo: `Reativar — ${inst.tag}`,
    corpo: `
      <!-- 'fixa': aqui não é dica, é o dado do instrumento. -->
      <div class="warn-box i fixa">
        Motivo atual da inativação: <b>${esc(inst.motivo_inativo || '—')}</b><br>
        ${esc(inst.justificativa_inativo || '')}
      </div>
      <div class="field" id="wJustReat">
        <label for="fJustReat">Justificativa da reativação<span class="req">*</span></label>
        <textarea id="fJustReat" placeholder="Ex.: instrumento reparado e recalibrado."></textarea>
        <div class="msg" id="mJustReat"></div>
      </div>`,
    acoes: [
      { rotulo:'Cancelar', classe:'btn-outline', onClick: f => f() },
      { rotulo:'Reativar', classe:'btn-green', onClick: async (fechar, bt) => {
          const just = document.getElementById('fJustReat').value.trim();
          if (just.length < 10){
            document.getElementById('wJustReat').classList.add('err');
            document.getElementById('mJustReat').textContent = 'Escreva pelo menos 10 caracteres.';
            return;
          }
          bt.disabled = true; bt.textContent = 'Reativando…';
          try {
            await reativarInstrumento(inst.id, just);
            fechar();
            toast(`${inst.tag} reativado.`, 'success');
            carregar(container, true);
          } catch (e){
            toast(msgErro(e), 'error');
            bt.disabled = false; bt.textContent = 'Reativar';
          }
      } }
    ]
  });
}
