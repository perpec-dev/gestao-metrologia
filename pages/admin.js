/* =====================================================================
   ADMINISTRAÇÃO — só para papel 'admin'.

     Usuários   — papel e acesso de cada pessoa
     Parâmetros — as chaves de config que mudam o comportamento do sistema
     E-mails    — para onde a Metrologia escreve ao cobrar devolução
     Manutenção — apagar em massa, para corrigir e reimportar
     Auditoria  — a trilha, somente leitura

   A tela some do menu para quem não é admin, mas isso é conforto:
   quem garante é o banco. Toda ação aqui passa por uma RPC que
   verifica sou_admin() de novo.
   ===================================================================== */
import { esc, fmtDT, toast, msgErro, htmlCarregando, htmlVazio, chave, debounce,
         nomeProprio } from '../utils.js';
import { listarUsuarios, definirPapel, definirAtivo, definirNomeUsuario, listarAuditoria,
         listarFamilias, listarInstrumentos, carregarConfig, salvarConfig,
         apagarTodosInstrumentos, apagarInstrumentosDaFamilia,
         listarEmailsSetor, salvarEmailSetor, removerEmailSetor,
         cfg, cfgLista, configFaltando } from '../supabase.js';
import { souAdmin, meuEmail } from '../auth.js';
import { abrirModal, confirmar } from '../components/modal.js';
import { criarTabela } from '../components/tabela.js';

const PARAMETROS = [
  { chave:'alerta_vencimento_proximo_mes', rotulo:'Alertar até o fim do próximo mês', unidade:'', tipo:'simnao',
    ajuda:'Com "sim", entra como "próximo do vencimento" tudo que vence até o último dia do MÊS QUE VEM — ' +
          'o horizonte do controle mensal. Vale para o painel, a lista de calibração, o contador da aba e ' +
          'os relatórios, todos ao mesmo tempo. Com "não", volta a valer a janela em dias abaixo.' },
  { chave:'dias_proximo_vencimento', rotulo:'Janela de alerta de vencimento', unidade:'dias', tipo:'number',
    ajuda:'Quantos dias antes do vencimento o instrumento passa a aparecer como "próximo do vencimento". ' +
          'Só é usado quando o alerta até o fim do próximo mês está desligado.' },
  { chave:'prazo_alerta_emprestimo_casual_dias', rotulo:'Prazo do empréstimo casual', unidade:'dias', tipo:'number',
    ajuda:'Passado esse prazo sem devolução, o empréstimo casual vira lembrete no painel.' },
  { chave:'prazo_alerta_emprestimo_externo_dias', rotulo:'Prazo do empréstimo externo', unidade:'dias', tipo:'number',
    ajuda:'Mesma coisa para instrumento que saiu da empresa. Costuma ser bem menor que o casual.' },
  { chave:'setores', rotulo:'Setores', unidade:'', tipo:'lista',
    ajuda:'Opções do campo "setor" no empréstimo. Separe por vírgula.' },
  { chave:'motivos_inativacao', rotulo:'Motivos de inativação', unidade:'', tipo:'lista',
    ajuda:'Opções oferecidas ao inativar um instrumento no inventário. Separe por vírgula. ' +
          '"Outros" tem tratamento especial: escolhê-lo obriga a descrever a segregação do instrumento.' },
  { chave:'vencimento_fim_do_mes', rotulo:'Vencimento no último dia do mês', unidade:'', tipo:'simnao',
    ajuda:'Com "sim", a validade da calibração vai até o fim do mês de vencimento: ' +
          'calibrado em 20/08/2025 com periodicidade de 12 meses vence em 31/08/2026, e não em 20/08/2026. ' +
          'É o que casa com o controle mensal da metrologia. Vale para as PRÓXIMAS calibrações registradas; ' +
          'as datas já calculadas não mudam sozinhas.' }
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
      <button class="subtab" data-pane="emails">E-mails por setor</button>
      <button class="subtab" data-pane="manutencao">Manutenção</button>
      <button class="subtab" data-pane="auditoria">Auditoria</button>
    </div>
    <section class="pane on" id="pane-usuarios">${htmlCarregando()}</section>
    <section class="pane"    id="pane-parametros"></section>
    <section class="pane"    id="pane-emails"></section>
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
  await abaEmails(container.querySelector('#pane-emails'));
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
      2. O perfil aparece aqui sozinho, como <b>metrologista ativo</b>, com o nome tirado do e-mail.<br>
      3. Corrija o <b>nome</b> e ajuste o papel abaixo.
    </div>

    <div class="warn-box w">
      <b>O nome escrito aqui é o nome que a pessoa vê.</b> Ele aparece na saudação do painel, no
      cabeçalho, na assinatura do e-mail de cobrança e no "emitido por" dos relatórios em PDF.
      Como o perfil nasce do e-mail, ele começa como <code>joao</code> — o sistema arruma a caixa
      e os acentos que consegue reconhecer, mas <b>acento não se deduz</b>: "sergio" tanto pode ser
      Sérgio quanto Sergio. Escreva o nome completo, com acento, e acabou a adivinhação.
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Quem tem acesso</h2>
        <span class="right">${usuarios.length} · ${admins} administrador(es)</span>
      </div>
      <div class="card-body">
        <div class="tbl-wrap"><table class="tbl" style="min-width:820px">
          <thead><tr><th style="width:230px">Nome</th><th>E-mail</th><th>Papel</th>
                     <th>Acesso</th><th></th></tr></thead>
          <tbody>${usuarios.map(u => `
            <tr class="${u.ativo ? '' : 'inativa'}">
              <td>
                <input type="text" data-nome="${esc(u.id)}" value="${esc(u.nome || '')}"
                       placeholder="Nome completo, com acento"
                       style="width:100%;font-size:13px;padding:6px 9px;border:1px solid var(--border2);
                              border-radius:var(--r-sm);font-family:inherit">
                ${u.email === meuEmail() ? '<div style="margin-top:3px"><span class="tag">você</span></div>' : ''}
              </td>
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
               ['Notificar setor sobre devolução em atraso', 1, 1],
               ['Alterar periodicidade (com justificativa)', 1, 1],
               ['Inativar / reativar instrumento (com justificativa)', 1, 1],
               ['Apagar instrumentos', 0, 1],
               ['Alterar parâmetros do sistema', 0, 1],
               ['Cadastrar e-mails por setor', 0, 1],
               ['Gerenciar papéis e acessos', 0, 1]
              ].map(([a,m,ad]) => `
              <tr><td>${esc(a)}</td>
                  <td>${m ? '<span class="bdg s-ativo">sim</span>' : '<span class="bdg s-inativo">não</span>'}</td>
                  <td><span class="bdg s-ativo">sim</span></td></tr>`).join('')}
          </tbody>
        </table></div>
      </div>
    </div>`;

  /* O nome salva ao sair do campo (ou no Enter), sem botão próprio: é um
     campo só, e um botão "Salvar" por linha encheria a tabela de ações
     que quase nunca são usadas. A caixa e os acentos conhecidos são
     normalizados na hora de gravar — quem escreveu "joao amaral" recebe
     "João Amaral" de volta e vê o que ficou guardado. */
  el.querySelectorAll('[data-nome]').forEach(inp => {
    const original = inp.value;
    const salvar = async () => {
      const novo = nomeProprio(inp.value);
      if (novo === original){ inp.value = original; return; }
      if (novo.length < 3){
        toast('Escreva o nome completo (mínimo de 3 caracteres).', 'error');
        inp.value = original; return;
      }
      inp.disabled = true;
      try {
        await definirNomeUsuario(inp.dataset.nome, novo);
        toast(`Nome atualizado para ${novo}.`, 'success');
        await abaUsuarios(el);
      } catch (e){
        toast(msgErro(e), 'error');
        inp.value = original; inp.disabled = false;
      }
    };
    inp.addEventListener('change', salvar);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  });

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
              ${p.tipo === 'simnao' ? `
                <select id="f${esc(p.chave)}" style="max-width:160px">
                  <option value="sim" ${/^(sim|s|true|1)$/i.test(cfg(p.chave)) ? 'selected' : ''}>Sim</option>
                  <option value="nao" ${/^(sim|s|true|1)$/i.test(cfg(p.chave)) ? '' : 'selected'}>Não</option>
                </select>` : `
                <input type="${p.tipo === 'number' ? 'number' : 'text'}" id="f${esc(p.chave)}"
                       value="${esc(cfg(p.chave))}" ${p.tipo === 'number' ? 'min="1" max="3650"' : ''}
                       style="${p.tipo === 'number' ? 'max-width:160px' : ''}">`}
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
/* E-MAILS POR SETOR                                                    */
/*                                                                      */
/* Quando um empréstimo passa do prazo, quem cobra a devolução não é o  */
/* sistema: é o responsável pelo setor. Esta lista é para onde a        */
/* Metrologia escreve. Os setores vêm do próprio parâmetro "Setores" —  */
/* duas listas para manter viram, com o tempo, duas listas diferentes.  */
/* ==================================================================== */
async function abaEmails(el){
  el.innerHTML = htmlCarregando();

  let cadastrados;
  try { cadastrados = await listarEmailsSetor(); }
  catch (e){ el.innerHTML = `<div class="warn-box e">${esc(msgErro(e))}</div>`; return; }

  const porSetor = new Map(cadastrados.map(c => [c.setor, c]));
  const setores  = cfgLista('setores');
  // Setor que saiu do parâmetro mas ainda tem e-mail cadastrado continua
  // aparecendo: sumir com ele sem avisar deixaria um registro invisível.
  const orfaos   = cadastrados.filter(c => !setores.includes(c.setor)).map(c => c.setor);
  const linhas   = [...setores, ...orfaos];
  const semEmail = setores.filter(s => !porSetor.has(s)).length;

  el.innerHTML = `
    <div class="warn-box i">
      Usado na aba <b>Empréstimo › Em aberto</b>: o botão <b>Notificar responsável</b> abre
      um e-mail já preenchido para o setor que está com o instrumento. Metrologista também
      pode notificar; cadastrar e alterar é do administrador.
    </div>
    ${semEmail ? `<div class="warn-box w fixa">
      <b>${semEmail}</b> setor(es) ainda sem e-mail. Para eles o botão de notificar
      fica desabilitado e a cobrança volta a ser feita no braço.</div>` : ''}

    <div class="card">
      <div class="card-head"><h2>Responsável por setor</h2>
        <span class="right">${cadastrados.length} de ${setores.length} cadastrado(s)</span></div>
      <div class="card-body">
        ${linhas.length ? `
        <div class="tbl-wrap"><table class="tbl" style="min-width:780px">
          <thead><tr><th style="width:170px">Setor</th><th style="width:200px">Responsável</th>
                     <th>E-mail</th><th style="width:180px"></th></tr></thead>
          <tbody>${linhas.map(setor => {
            const c = porSetor.get(setor) || {};
            const orfao = !setores.includes(setor);
            return `
            <tr data-setor="${esc(setor)}">
              <td><b>${esc(setor)}</b>${orfao
                ? '<div style="font-size:11px;color:var(--muted)">fora da lista de setores</div>' : ''}</td>
              <td><input type="text" class="fResp" value="${esc(c.responsavel || '')}"
                         placeholder="Nome de quem responde"
                         style="width:100%;font-size:13px;padding:6px 9px;border:1px solid var(--border2);
                                border-radius:var(--r-sm);font-family:inherit"></td>
              <td><input type="email" class="fMail" value="${esc(c.email || '')}"
                         placeholder="setor@perpec.com.br"
                         style="width:100%;font-size:13px;padding:6px 9px;border:1px solid var(--border2);
                                border-radius:var(--r-sm);font-family:inherit"></td>
              <td>
                <div style="display:flex;gap:6px">
                  <button class="btn btn-outline btn-sm" data-salvar-mail>Salvar</button>
                  ${c.email ? '<button class="btn btn-outline btn-sm" data-remover-mail>Remover</button>' : ''}
                </div>
                ${c.atualizado_em ? `<div style="font-size:10.5px;color:var(--muted);margin-top:4px">
                  ${esc(fmtDT(c.atualizado_em))}</div>` : ''}
              </td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>` : htmlVazio('Nenhum setor configurado. Cadastre a lista em Parâmetros › Setores.')}
      </div>
    </div>`;

  el.querySelectorAll('[data-salvar-mail]').forEach(b => b.addEventListener('click', async () => {
    const tr    = b.closest('tr');
    const setor = tr.dataset.setor;
    const email = tr.querySelector('.fMail').value.trim();
    const resp  = tr.querySelector('.fResp').value.trim();

    // Validação de e-mail também no banco (check constraint). Aqui é só
    // para não gastar uma ida ao servidor com um erro óbvio.
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){
      toast('Informe um e-mail válido para ' + setor + '.', 'error');
      tr.querySelector('.fMail').focus();
      return;
    }

    b.disabled = true; b.textContent = 'Salvando…';
    try {
      await salvarEmailSetor(setor, email, resp);
      toast('E-mail de ' + setor + ' atualizado.', 'success');
      await abaEmails(el);
    } catch (e){
      toast(msgErro(e), 'error');
      b.disabled = false; b.textContent = 'Salvar';
    }
  }));

  el.querySelectorAll('[data-remover-mail]').forEach(b => b.addEventListener('click', async () => {
    const setor = b.closest('tr').dataset.setor;
    if (!await confirmar({
      titulo:'Remover e-mail',
      texto:`O setor <b>${esc(setor)}</b> deixa de receber a notificação de devolução em atraso.`,
      rotuloOk:'Remover'
    })) return;
    try {
      await removerEmailSetor(setor);
      toast('E-mail removido.', 'success');
      await abaEmails(el);
    } catch (e){ toast(msgErro(e), 'error'); }
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
    <!-- 'fixa': aviso que precede ação destrutiva fica aberto. Guardar
         atrás de um clique o texto que explica o estrago é convidar o
         usuário a não lê-lo. -->
    <div class="warn-box w fixa">
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
