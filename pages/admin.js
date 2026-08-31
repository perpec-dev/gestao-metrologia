/* =====================================================================
   ADMINISTRAÇÃO — só para papel 'admin'.

     Usuários   — papel e acesso de cada pessoa
     Parâmetros — as chaves de config que mudam o comportamento do sistema
     Manutenção — apagar em massa, para corrigir e reimportar
     Auditoria  — a trilha, somente leitura

   A tela some do menu para quem não é admin, mas isso é conforto:
   quem garante é o banco. Toda ação aqui passa por uma RPC que
   verifica sou_admin() de novo.
   ===================================================================== */
import { esc, fmtDT, toast, msgErro, htmlCarregando, htmlVazio, chave, debounce } from '../utils.js';
import { listarUsuarios, definirPapel, definirAtivo, listarAuditoria,
         listarFamilias, listarInstrumentos, carregarConfig, salvarConfig,
         apagarTodosInstrumentos, apagarInstrumentosDaFamilia,
         cfg, configFaltando } from '../supabase.js';
import { souAdmin, meuEmail } from '../auth.js';
import { abrirModal, confirmar } from '../components/modal.js';
import { criarTabela } from '../components/tabela.js';

const PARAMETROS = [
  { chave:'dias_proximo_vencimento', rotulo:'Janela de alerta de vencimento', unidade:'dias', tipo:'number',
    ajuda:'Quantos dias antes do vencimento o instrumento passa a aparecer como "próximo do vencimento" no painel e na lista de calibração.' },
  { chave:'prazo_alerta_emprestimo_casual_dias', rotulo:'Prazo do empréstimo casual', unidade:'dias', tipo:'number',
    ajuda:'Passado esse prazo sem devolução, o empréstimo casual vira lembrete no painel.' },
  { chave:'prazo_alerta_emprestimo_externo_dias', rotulo:'Prazo do empréstimo externo', unidade:'dias', tipo:'number',
    ajuda:'Mesma coisa para instrumento que saiu da empresa. Costuma ser bem menor que o casual.' },
  { chave:'setores', rotulo:'Setores', unidade:'', tipo:'lista',
    ajuda:'Opções do campo "setor" no empréstimo. Separe por vírgula.' },
  { chave:'motivos_inativacao', rotulo:'Motivos de inativação', unidade:'', tipo:'lista',
    ajuda:'Opções oferecidas ao inativar um instrumento no inventário. Separe por vírgula.' }
];

export function destroy(){ tabelaAud = null; }

/* ==================================================================== */
export async function render(container){
  tabelaAud = null;
  if (!souAdmin()){
    container.innerHTML = `<div class="card"><div class="card-body">
      <div class="warn-box e" style="margin:0"><b>Área restrita.</b>
      Esta tela é do administrador da metrologia. Se você precisa de acesso,
      peça a quem já é administrador.</div></div></div>`;
    return;
  }

  container.innerHTML = `
    <div class="subtabs">
      <button class="subtab sel" data-pane="usuarios">Usuários</button>
      <button class="subtab" data-pane="parametros">Parâmetros</button>
      <button class="subtab" data-pane="manutencao">Manutenção</button>
      <button class="subtab" data-pane="auditoria">Auditoria</button>
    </div>
    <section class="pane on" id="pane-usuarios">${htmlCarregando()}</section>
    <section class="pane"    id="pane-parametros"></section>
    <section class="pane"    id="pane-manutencao"></section>
    <section class="pane"    id="pane-auditoria"></section>`;

  container.querySelectorAll('.subtab').forEach(b => b.addEventListener('click', () => {
    container.querySelectorAll('.subtab').forEach(x => x.classList.toggle('sel', x === b));
    container.querySelectorAll('.pane').forEach(p =>
      p.classList.toggle('on', p.id === 'pane-'+b.dataset.pane));
    if (b.dataset.pane === 'auditoria') abaAuditoria(container.querySelector('#pane-auditoria'));
  }));

  await abaUsuarios(container.querySelector('#pane-usuarios'));
  await abaParametros(container.querySelector('#pane-parametros'));
  await abaManutencao(container.querySelector('#pane-manutencao'));
}

/* ==================================================================== */
/* USUÁRIOS                                                             */
/* ==================================================================== */
async function abaUsuarios(el){
  let usuarios;
  try { usuarios = await listarUsuarios(); }
  catch (e){ el.innerHTML = `<div class="warn-box e">${esc(msgErro(e))}</div>`; return; }

  const admins = usuarios.filter(u => u.papel === 'admin' && u.ativo).length;

  el.innerHTML = `
    <div class="warn-box i">
      <b>Como entra gente nova.</b> O Supabase é quem cria a credencial; esta tela define o que a
      pessoa pode fazer.<br>
      1. No painel do Supabase: <b>Authentication → Users → Add user</b>, com <b>Auto Confirm</b> ligado.<br>
      2. O perfil aparece aqui sozinho, como <b>metrologista ativo</b>.<br>
      3. Ajuste o papel abaixo, se for o caso.
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Quem tem acesso</h2>
        <span class="right">${usuarios.length} · ${admins} administrador(es)</span>
      </div>
      <div class="card-body">
        <div class="tbl-wrap"><table class="tbl" style="min-width:760px">
          <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Acesso</th><th></th></tr></thead>
          <tbody>${usuarios.map(u => `
            <tr class="${u.ativo ? '' : 'inativa'}">
              <td>${esc(u.nome || '—')}${u.email === meuEmail() ? ' <span class="tag">você</span>' : ''}</td>
              <td class="mono" style="font-size:12px">${esc(u.email)}</td>
              <td>
                <select data-papel="${esc(u.id)}" style="font-size:13px;padding:5px 8px;
                        border:1px solid var(--border2);border-radius:var(--r-sm);font-family:inherit">
                  <option value="metrologista" ${u.papel === 'metrologista' ? 'selected' : ''}>Metrologista</option>
                  <option value="admin" ${u.papel === 'admin' ? 'selected' : ''}>Administrador</option>
                </select>
              </td>
              <td>${u.ativo ? '<span class="bdg s-ativo">Ativo</span>'
                            : '<span class="bdg s-inativo">Bloqueado</span>'}</td>
              <td>
                <button class="btn btn-sm ${u.ativo ? 'btn-perigo' : 'btn-outline'}"
                        data-ativo="${esc(u.id)}" data-valor="${u.ativo ? 'false' : 'true'}"
                        data-nome="${esc(u.nome || u.email)}">
                  ${u.ativo ? 'Bloquear acesso' : 'Liberar acesso'}</button>
              </td>
            </tr>`).join('')}</tbody>
        </table></div>

        <div class="sec-title">O que cada papel pode</div>
        <div class="tbl-wrap"><table class="tbl" style="min-width:520px">
          <thead><tr><th>Ação</th><th>Metrologista</th><th>Administrador</th></tr></thead>
          <tbody>
            ${[['Consultar tudo', 1, 1],
               ['Receber, cadastrar e importar', 1, 1],
               ['Registrar calibração', 1, 1],
               ['Emprestar e registrar devolução', 1, 1],
               ['Alterar periodicidade (com justificativa)', 1, 1],
               ['Inativar / reativar instrumento', 0, 1],
               ['Apagar instrumentos', 0, 1],
               ['Alterar parâmetros do sistema', 0, 1],
               ['Gerenciar papéis e acessos', 0, 1]
              ].map(([a,m,ad]) => `
              <tr><td>${esc(a)}</td>
                  <td>${m ? '<span class="bdg s-ativo">sim</span>' : '<span class="bdg s-inativo">não</span>'}</td>
                  <td><span class="bdg s-ativo">sim</span></td></tr>`).join('')}
          </tbody>
        </table></div>
      </div>
    </div>`;

  el.querySelectorAll('[data-papel]').forEach(sel => {
    const original = sel.value;
    sel.addEventListener('change', async () => {
      const novo = sel.value;
      const ok = await confirmar({
        titulo:'Alterar papel',
        texto: novo === 'admin'
          ? 'Administrador pode inativar e <b>apagar</b> instrumentos, mexer nos parâmetros e gerenciar acessos. Confirma?'
          : 'A pessoa perde o acesso de administrador e passa a atuar como metrologista. Confirma?',
        rotuloOk:'Alterar papel'
      });
      if (!ok){ sel.value = original; return; }
      try {
        await definirPapel(sel.dataset.papel, novo);
        toast('Papel atualizado e registrado na auditoria.', 'success');
        await abaUsuarios(el);
      } catch (e){ sel.value = original; toast(msgErro(e), 'error'); }
    });
  });

  el.querySelectorAll('[data-ativo]').forEach(b => b.addEventListener('click', async () => {
    const liberar = b.dataset.valor === 'true';
    const ok = await confirmar({
      titulo: liberar ? 'Liberar acesso' : 'Bloquear acesso',
      texto: liberar
        ? `<b>${esc(b.dataset.nome)}</b> volta a poder entrar no sistema.`
        : `<b>${esc(b.dataset.nome)}</b> deixa de entrar no sistema. O histórico do que essa pessoa
           fez continua intacto — bloquear não apaga nada.`,
      rotuloOk: liberar ? 'Liberar' : 'Bloquear',
      classeOk: liberar ? 'btn-green' : 'btn-red'
    });
    if (!ok) return;
    try {
      await definirAtivo(b.dataset.ativo, liberar);
      toast(liberar ? 'Acesso liberado.' : 'Acesso bloqueado.', 'success');
      await abaUsuarios(el);
    } catch (e){ toast(msgErro(e), 'error'); }
  }));
}

/* ==================================================================== */
/* PARÂMETROS                                                           */
/* ==================================================================== */
async function abaParametros(el){
  try { await carregarConfig(true); } catch(e){ /* segue com os padrões */ }
  const faltando = configFaltando();

  el.innerHTML = `
    ${faltando.length ? `<div class="warn-box e">
      <b>Faltam ${faltando.length} configuração(ões) no banco:</b>
      <code>${faltando.map(esc).join('</code>, <code>')}</code>.<br>
      A tela está usando os valores padrão para não travar as listas suspensas, mas eles
      <b>não estão salvos</b>. Clique em <b>Salvar</b> em cada campo abaixo para gravá-los —
      ou rode <code>sql/04_seed.sql</code> no SQL Editor.
    </div>` : ''}
    <div class="warn-box i">
      Estes valores mudam o comportamento do sistema para todo mundo, na hora.
      Cada um diz embaixo o que acontece se o número mudar.
    </div>
    <div class="card">
      <div class="card-head"><h2>Parâmetros do sistema</h2></div>
      <div class="card-body">
        ${PARAMETROS.map(p => `
          <div class="field" style="margin-bottom:20px" id="w${esc(p.chave)}">
            <label for="f${esc(p.chave)}">${esc(p.rotulo)}${p.unidade ? ' (' + esc(p.unidade) + ')' : ''}</label>
            <div style="display:flex;gap:8px;align-items:flex-start">
              <input type="${p.tipo === 'number' ? 'number' : 'text'}" id="f${esc(p.chave)}"
                     value="${esc(cfg(p.chave))}" ${p.tipo === 'number' ? 'min="1" max="3650"' : ''}
                     style="${p.tipo === 'number' ? 'max-width:160px' : ''}">
              <button class="btn btn-outline" data-salvar="${esc(p.chave)}">Salvar</button>
            </div>
            <div class="hint">${esc(p.ajuda)}</div>
            <div class="msg" id="m${esc(p.chave)}"></div>
          </div>`).join('')}
      </div>
    </div>`;

  el.querySelectorAll('[data-salvar]').forEach(b => b.addEventListener('click', async () => {
    const k = b.dataset.salvar;
    const p = PARAMETROS.find(x => x.chave === k);
    const valor = el.querySelector('#f'+k).value.trim();

    if (p.tipo === 'number' && !(parseInt(valor,10) >= 1)){
      toast('Informe um número inteiro maior que zero.', 'error'); return;
    }
    if (p.tipo === 'lista' && !valor){
      toast('A lista não pode ficar vazia.', 'error'); return;
    }

    b.disabled = true; b.textContent = 'Salvando…';
    try {
      await salvarConfig(k, valor);
      toast('Parâmetro atualizado.', 'success');
      await abaParametros(el);      // some o aviso de chave faltando
    } catch (e){
      toast(msgErro(e), 'error');
      b.disabled = false; b.textContent = 'Salvar';
    }
  }));
}

/* ==================================================================== */
/* MANUTENÇÃO — apagar em massa                                         */
/* ==================================================================== */
async function abaManutencao(el){
  const [familias, instrumentos] = await Promise.all([listarFamilias(), listarInstrumentos()]);
  const porFamilia = familias.map(f => ({
    ...f, qtd: instrumentos.filter(i => i.familia_id === f.id).length
  })).filter(f => f.qtd > 0);

  el.innerHTML = `
    <div class="warn-box w">
      <b>O que "apagar" significa aqui.</b> Some o instrumento e, por cascata, todas as
      calibrações, inspeções, movimentações e documentos dele. <b>Não</b> some a trilha de
      auditoria — ela é somente-inclusão, e o próprio apagamento entra nela.
      Famílias, parâmetros e usuários ficam de pé.<br><br>
      Os <b>arquivos no Storage</b> (certificados, termos, laudos, fotos) não são removidos
      junto. Se você vai reimportar, isso não atrapalha; se quiser faxina completa,
      a consulta que lista os órfãos está em <code>sql/05_admin.sql</code>, item 4.7.
    </div>

    <div class="card">
      <div class="card-head"><h2>Apagar por família</h2>
        <span class="right">${instrumentos.length} instrumento(s) no acervo</span></div>
      <div class="card-body">
        <p style="font-size:13px;color:var(--text2);margin-bottom:14px">
          Use quando a planilha de uma família saiu errada e o resto do acervo está correto.
        </p>
        ${porFamilia.length ? `
        <div class="g3" style="align-items:end">
          <div class="field">
            <label for="fFamApagar">Família</label>
            <select id="fFamApagar">
              <option value="">Selecione…</option>
              ${porFamilia.map(f => `<option value="${esc(f.id)}">
                ${esc(f.codigo)} — ${esc(f.nome)} (${f.qtd})</option>`).join('')}
            </select>
          </div>
          <div><button class="btn btn-perigo" id="btApagarFam" disabled>Apagar os instrumentos desta família</button></div>
        </div>` : htmlVazio('Nenhum instrumento cadastrado.')}
      </div>
    </div>

    <div class="card" style="border-color:#E9C4BE">
      <div class="card-head" style="border-bottom-color:#F3DCD8">
        <h2 style="color:var(--status-descalibrado)">Limpar todo o acervo</h2></div>
      <div class="card-body">
        <p style="font-size:13px;color:var(--text2);margin-bottom:16px">
          Apaga <b>todos</b> os ${instrumentos.length} instrumentos, para você reimportar a planilha
          corrigida do zero. Famílias, parâmetros e usuários permanecem — a importação volta a
          funcionar imediatamente. Não tem desfazer.
        </p>
        <div class="g2">
          <div class="field" id="wConfirmar">
            <label for="fConfirmar">Digite <b>APAGAR TUDO</b> para liberar o botão</label>
            <input type="text" id="fConfirmar" class="cod" placeholder="APAGAR TUDO" autocomplete="off">
            <div class="msg" id="mConfirmar"></div>
          </div>
          <div class="field" id="wJustTudo">
            <label for="fJustTudo">Justificativa</label>
            <input type="text" id="fJustTudo" placeholder="Ex.: carga inicial incorreta, reimportando planilha revisada">
            <div class="hint">Mínimo de 10 caracteres. Vai para a auditoria.</div>
            <div class="msg" id="mJustTudo"></div>
          </div>
        </div>
        <div style="margin-top:16px">
          <button class="btn btn-red" id="btApagarTudo" disabled>APAGAR OS ${instrumentos.length} INSTRUMENTOS</button>
        </div>
      </div>
    </div>`;

  /* ---- por família ---- */
  const selFam = el.querySelector('#fFamApagar');
  const btFam  = el.querySelector('#btApagarFam');
  if (selFam){
    selFam.addEventListener('change', () => btFam.disabled = !selFam.value);
    btFam.addEventListener('click', async () => {
      const f = porFamilia.find(x => x.id === selFam.value);
      if (!f) return;
      const just = await pedirTexto({
        titulo:`Apagar ${f.qtd} instrumento(s) da família ${f.codigo}`,
        aviso:`Vão junto todas as calibrações, movimentações, inspeções e documentos desses
               instrumentos. A família <b>${esc(f.nome)}</b> continua cadastrada.`,
        rotulo:'Justificativa'
      });
      if (!just) return;
      try {
        const n = await apagarInstrumentosDaFamilia(f.id, just);
        toast(`${n} instrumento(s) apagados.`, 'success');
        await abaManutencao(el);
      } catch (e){ toast(msgErro(e), 'error'); }
    });
  }

  /* ---- tudo ---- */
  const fConf = el.querySelector('#fConfirmar');
  const fJust = el.querySelector('#fJustTudo');
  const btTudo = el.querySelector('#btApagarTudo');
  const revalidar = () => {
    btTudo.disabled = !(fConf.value.trim() === 'APAGAR TUDO' && fJust.value.trim().length >= 10);
  };
  fConf.addEventListener('input', revalidar);
  fJust.addEventListener('input', revalidar);

  btTudo.addEventListener('click', async () => {
    const ok = await confirmar({
      titulo:'Última confirmação',
      texto:`Você vai apagar <b>${instrumentos.length}</b> instrumentos e todo o histórico deles.
             Isso não tem desfazer. A trilha de auditoria registra a operação.`,
      rotuloOk:'Apagar tudo'
    });
    if (!ok) return;
    btTudo.disabled = true; btTudo.textContent = 'APAGANDO…';
    try {
      const n = await apagarTodosInstrumentos(fConf.value.trim(), fJust.value.trim());
      toast(`${n} instrumento(s) apagados. Pode reimportar.`, 'success');
      await abaManutencao(el);
    } catch (e){
      toast(msgErro(e), 'error');
      btTudo.disabled = false; btTudo.textContent = 'APAGAR OS INSTRUMENTOS';
    }
  });
}

/** Modal simples de texto obrigatório (justificativa de apagamento). */
function pedirTexto({ titulo, aviso, rotulo, minimo = 10 }){
  return new Promise(resolve => {
    abrirModal({
      titulo, fecharFora:false,
      corpo: `
        ${aviso ? `<div class="warn-box e">${aviso}</div>` : ''}
        <div class="field" id="wTxt">
          <label for="fTxt">${esc(rotulo)}<span class="req">*</span></label>
          <textarea id="fTxt" placeholder="Explique o motivo. Este texto vai para a auditoria."></textarea>
          <div class="hint">Mínimo de ${minimo} caracteres.</div>
          <div class="msg" id="mTxt"></div>
        </div>`,
      acoes: [
        { rotulo:'Cancelar', classe:'btn-outline', onClick: f => { f(); resolve(null); } },
        { rotulo:'Apagar', classe:'btn-red', onClick: f => {
            const v = document.getElementById('fTxt').value.trim();
            if (v.length < minimo){
              document.getElementById('wTxt').classList.add('err');
              document.getElementById('mTxt').textContent = `Escreva pelo menos ${minimo} caracteres.`;
              return;
            }
            f(); resolve(v);
        } }
      ],
      aoAbrir: b => b.querySelector('#fTxt').focus()
    });
  });
}

/* ==================================================================== */
/* AUDITORIA                                                            */
/* ==================================================================== */
let tabelaAud = null;

async function abaAuditoria(el){
  if (tabelaAud) return;      // já montada nesta visita
  el.innerHTML = htmlCarregando();

  let linhas;
  try { linhas = await listarAuditoria({ limite: 500 }); }
  catch (e){ el.innerHTML = `<div class="warn-box e">${esc(msgErro(e))}</div>`; return; }

  el.innerHTML = `
    <div class="warn-box i">
      Somente leitura, e é assim no banco: a tabela não tem permissão de UPDATE nem DELETE,
      e dois gatilhos recusam as duas operações. Nem pelo painel do Supabase dá para editar
      uma linha daqui sem desligar o gatilho de propósito.
    </div>
    <div class="filtros">
      <div class="field busca">
        <label for="fBuscaAud">Buscar</label>
        <input type="text" id="fBuscaAud" placeholder="Campo, valor, justificativa, e-mail…">
      </div>
      <div class="field">
        <label for="fEntidade">Entidade</label>
        <select id="fEntidade">
          <option value="">Todas</option>
          <option value="instrumentos">Instrumentos</option>
          <option value="familias">Famílias</option>
          <option value="periodicidade_fases">Fases de periodicidade</option>
          <option value="profiles">Usuários</option>
        </select>
      </div>
    </div>
    <div id="tabAud"></div>`;

  const filtrar = () => {
    const t = chave(el.querySelector('#fBuscaAud').value);
    const ent = el.querySelector('#fEntidade').value;
    return linhas.filter(l => {
      if (ent && l.entidade !== ent) return false;
      if (!t) return true;
      return chave([l.campo, l.valor_antigo, l.valor_novo, l.justificativa, l.usuario_email]
        .join(' ')).includes(t);
    });
  };

  tabelaAud = criarTabela(el.querySelector('#tabAud'), {
    linhas: filtrar(),
    vazio: 'Nenhum registro na trilha com esses filtros.',
    ordem: { chave:'criado_em', dir:-1 },
    colunas: [
      { chave:'criado_em', rotulo:'Quando', largura:'140px', html: l => esc(fmtDT(l.criado_em)) },
      { chave:'entidade', rotulo:'Entidade', largura:'130px' },
      { chave:'campo', rotulo:'Campo', largura:'150px' },
      { chave:'valor_antigo', rotulo:'De', html: l => esc(l.valor_antigo ?? '—') },
      { chave:'valor_novo', rotulo:'Para', html: l => esc(l.valor_novo ?? '—') },
      { chave:'justificativa', rotulo:'Justificativa', html: l => esc(l.justificativa ?? '—') },
      { chave:'usuario_email', rotulo:'Quem', largura:'190px',
        html: l => `<span style="font-size:12px">${esc(l.usuario_email ?? '—')}</span>` }
    ]
  });

  const aplicar = () => tabelaAud.atualizar(filtrar());
  el.querySelector('#fBuscaAud').addEventListener('input', debounce(aplicar, 200));
  el.querySelector('#fEntidade').addEventListener('change', aplicar);
}
