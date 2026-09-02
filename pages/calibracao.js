/* =====================================================================
   CALIBRAÇÃO — a fila de trabalho da metrologia.

   Esta tela é dos instrumentos TMMDE, e só deles: são os que têm
   validade a vencer, certificado a anexar e cobrança a fazer. Padrão de
   REFERÊNCIA tem tela própria (pages/referencia.js) — misturar os dois
   fazia a fila de trabalho contar itens que nunca vão vencer.

   A situação NUNCA vem de um campo gravado: vem de vw_instrumentos_status.
   O Realtime só dispara uma releitura — não tenta remendar a linha na tela.
   ===================================================================== */
import { esc, fmtData, hojeISO, toast, msgErro, debounce, chave,
         lembrar, lembrado, htmlCarregando } from '../utils.js';
import { listarInstrumentos, buscarInstrumento, listarFamilias, registrarCalibracao,
         definirStatusWorkflow, enviarArquivo, ouvir, abrirArquivo,
         pastaDoInstrumento } from '../supabase.js';
import { CONFIG } from '../config.js';
import { criarTabela } from '../components/tabela.js';
import { badge, classeLinha, legenda, rotulo, textoVencimento,
         ORDEM_STATUS_TMMDE, STATUS } from '../components/status-badge.js';
import { abrirModal, fecharModal, confirmar } from '../components/modal.js';
import { montarTimeline } from '../components/timeline.js';
import { montarArquivosInstrumento } from '../components/arquivos.js';
import { irPara } from '../router.js';

let desligarRealtime = null;
let tabela = null;
let dados = [];
let familias = [];
let filtros = { status:'', familia:'', texto:'', incluirInativos:false };

export function destroy(){
  if (desligarRealtime){ desligarRealtime(); desligarRealtime = null; }
  fecharModal();
  tabela = null; dados = [];
}

/* ==================================================================== */
export async function render(container, params = []){
  filtros = Object.assign(filtros, lembrado('filtros.calibracao', {}));

  container.innerHTML = `
    <div class="filtros">
      <div class="field busca">
        <label for="fBusca">Buscar</label>
        <input type="text" id="fBusca" placeholder="Tag, descrição, série, fabricante…" value="${esc(filtros.texto)}">
      </div>
      <div class="field">
        <label for="fStatus">Situação</label>
        <select id="fStatus"><option value="">Todas</option>
          ${ORDEM_STATUS_TMMDE.map(s => `<option value="${s}">${esc(STATUS[s].rotulo)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="fFamilia">Família</label>
        <select id="fFamilia"><option value="">Todas</option></select>
      </div>
      <div class="field field-inline" style="align-self:end;padding-bottom:9px">
        <input type="checkbox" id="fInativos" ${filtros.incluirInativos ? 'checked' : ''}>
        <label for="fInativos">Mostrar inativos</label>
      </div>
      <div class="field" style="align-self:end;padding-bottom:2px">
        <button class="btn btn-outline" id="btAtualizar">Atualizar</button>
      </div>
    </div>

    <div style="margin-bottom:12px">${legenda(ORDEM_STATUS_TMMDE)}</div>
    <div id="listaCal">${htmlCarregando()}</div>`;

  familias = await listarFamilias();
  const selFam = container.querySelector('#fFamilia');
  selFam.innerHTML = '<option value="">Todas</option>' +
    familias.map(f => `<option value="${esc(f.id)}">${esc(f.codigo)} — ${esc(f.nome)}</option>`).join('');
  selFam.value = filtros.familia || '';
  container.querySelector('#fStatus').value = filtros.status || '';

  const aplicar = () => {
    filtros = {
      texto: container.querySelector('#fBusca').value,
      status: container.querySelector('#fStatus').value,
      familia: container.querySelector('#fFamilia').value,
      incluirInativos: container.querySelector('#fInativos').checked
    };
    lembrar('filtros.calibracao', filtros);
    if (tabela) tabela.atualizar(filtrar());
  };

  container.querySelector('#fBusca').addEventListener('input', debounce(aplicar, 200));
  ['#fStatus','#fFamilia','#fInativos'].forEach(s =>
    container.querySelector(s).addEventListener('change', aplicar));
  container.querySelector('#btAtualizar').addEventListener('click', () => carregar(container));

  await carregar(container);

  // Realtime: uma releitura debounced serve para os dois usuários.
  const recarregar = debounce(async () => {
    const antes = new Map(dados.map(d => [d.id, d.status_efetivo]));
    await carregar(container, true);
    const mudou = dados.filter(d => antes.has(d.id) && antes.get(d.id) !== d.status_efetivo);
    if (mudou.length){
      toast(mudou.length === 1
        ? `${mudou[0].tag} mudou para "${STATUS[mudou[0].status_efetivo]?.rotulo || mudou[0].status_efetivo}".`
        : `${mudou.length} instrumentos mudaram de situação.`);
      mudou.forEach(m => {
        const tr = container.querySelector(`tr[data-id="${m.id}"]`);
        if (tr) tr.classList.add('mudou');
      });
    }
  }, 700);
  desligarRealtime = ouvir('tela-calibracao', ['instrumentos','calibracoes'], recarregar);

  if (params[0]) abrirDetalhe(params[0], container);
}

/* ==================================================================== */
function filtrar(){
  const t = chave(filtros.texto);
  return dados.filter(i => {
    // Padrão de referência não tem validade a vencer: ele não é filtrado
    // aqui, é de outra tela. Sem checkbox para trazê-lo de volta — a
    // separação é a regra, não uma preferência de visualização.
    if (i.tipo === 'REFERENCIA') return false;
    if (!filtros.incluirInativos && i.condicao_fisica === 'inativo') return false;
    if (filtros.status  && i.status_efetivo !== filtros.status) return false;
    if (filtros.familia && i.familia_id !== filtros.familia) return false;
    if (t){
      const alvo = chave([i.tag, i.descricao, i.num_serie, i.fabricante,
                          i.familia_nome, i.localizacao_atual].join(' '));
      if (!alvo.includes(t)) return false;
    }
    return true;
  });
}

async function carregar(container, silencioso = false){
  const el = container.querySelector('#listaCal');
  if (!silencioso && !tabela) el.innerHTML = htmlCarregando();
  try {
    dados = await listarInstrumentos();
  } catch (e){
    el.innerHTML = `<div class="warn-box e">${esc(msgErro(e))}</div>`;
    return;
  }

  const linhas = filtrar();
  if (tabela){ tabela.atualizar(linhas); return; }

  tabela = criarTabela(el, {
    linhas,
    vazio: 'Nenhum instrumento com esses filtros.',
    ordem: { chave:'dias_para_vencer', dir:1 },
    idLinha: l => l.id,
    classeLinha: l => classeLinha(l.status_efetivo) + (l.condicao_fisica === 'inativo' ? ' inativa' : ''),
    aoClicar: l => abrirDetalhe(l.id, container),
    colunas: [
      { chave:'tag', rotulo:'Tag', classe:'mono', largura:'110px' },
      { chave:'descricao', rotulo:'Descrição' },
      { chave:'familia_nome', rotulo:'Família', largura:'150px' },
      { chave:'status_efetivo', rotulo:'Situação', largura:'170px',
        html: l => badge(l.status_efetivo) },
      { chave:'ultima_calibracao', rotulo:'Última calibração', largura:'130px',
        html: l => esc(fmtData(l.ultima_calibracao)) },
      { chave:'data_proxima', rotulo:'Próxima', largura:'120px',
        html: l => esc(fmtData(l.data_proxima)) },
      { chave:'dias_para_vencer', rotulo:'Vence', classe:'num', largura:'110px',
        valor: l => l.dias_para_vencer,
        html: l => `<span style="color:${l.dias_para_vencer != null && l.dias_para_vencer < 0
                      ? 'var(--status-descalibrado)' : 'inherit'}">${esc(textoVencimento(l))}</span>` },
      { chave:'localizacao_atual', rotulo:'Localização', largura:'150px',
        html: l => l.emprestado
          ? `<span title="Emprestado para ${esc(l.emprestado_para)}">${esc(l.setor_atual || '—')} ↗</span>`
          : esc(l.localizacao_normal || '—') }
    ]
  });
}

/* ==================================================================== */
/* PAINEL DE DETALHE                                                    */
/* ==================================================================== */
export async function abrirDetalhe(id, container){
  let i;
  try { i = await buscarInstrumento(id); }
  catch (e){ toast(msgErro(e), 'error'); return; }

  /* Duas condições tiram o instrumento do fluxo de calibração, por
     motivos diferentes:
       · inativo — pode estar não encontrado, em manutenção ou na sucata.
         Solicitar calibração dele não quer dizer nada.
       · referência — padrão de aferição não tem validade a vencer.
     Em ambos os casos os botões somem em vez de ficarem cinzas: botão
     desabilitado ainda convida ao clique e ainda ocupa a leitura. */
  const inativo    = i.condicao_fisica === 'inativo';
  const referencia = i.tipo === 'REFERENCIA';

  abrirModal({
    titulo: `${i.tag} · ${i.descricao}`,
    largo: true,
    corpo: `
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
        ${badge(i.status_efetivo)}
        ${i.condicao_fisica === 'inativo' ? '<span class="bdg s-inativo">Inativo</span>' : ''}
        ${i.emprestado ? `<span class="bdg s-solicitado">Emprestado — ${esc(i.emprestado_para)}</span>` : ''}
        ${i.standby ? `<span class="bdg s-standby_pausado">Standby${i.data_inicio_relogio ? ' (relógio ligado)' : ' (relógio parado)'}</span>` : ''}
      </div>

      ${inativo
        ? `<div class="warn-box e"><b>Instrumento inativo.</b> ${esc(i.motivo_inativo || '')} — ${esc(i.justificativa_inativo || '')}</div>` : ''}
      ${referencia
        ? `<div class="warn-box i"><b>Padrão de aferição.</b> Instrumento de referência não tem
             exigência de calibração periódica neste controle: ele não vence e não entra na fila
             de trabalho da metrologia.</div>` : ''}
      ${i.standby && !i.data_inicio_relogio
        ? `<div class="warn-box i fixa">Relógio de validade <b>parado</b>: a contagem começa na primeira saída deste instrumento.</div>` : ''}

      <div class="sec-title">Ficha</div>
      <div class="kv">
        <div><div class="k">Classificação</div><div class="v">${referencia
              ? 'Referência — padrão de aferição' : 'TMMDE — instrumento de uso'}</div></div>
        <div><div class="k">Família</div><div class="v">${esc(i.familia_codigo)} — ${esc(i.familia_nome)}</div></div>
        <div><div class="k">Fabricante</div><div class="v">${esc(i.fabricante || '—')}</div></div>
        <div><div class="k">Número de série</div><div class="v">${esc(i.num_serie || '—')}</div></div>
        <div><div class="k">${referencia ? 'Cadastro' : 'Entrada'}</div><div class="v">${esc(fmtData(i.data_entrada))}</div></div>
        ${referencia ? '' : `
        <div><div class="k">Resolução / faixa</div><div class="v">${esc(i.resolucao || '—')}</div></div>
        <div><div class="k">Periodicidade</div><div class="v">${i.periodicidade_customizada
              ? 'Customizada por fases' : esc(i.periodicidade_meses) + ' meses'}</div></div>
        <div><div class="k">Localização normal</div><div class="v">${esc(i.localizacao_normal || '—')}</div></div>
        <div><div class="k">Última calibração</div><div class="v">${esc(fmtData(i.ultima_calibracao))}</div></div>
        <div><div class="k">Próxima calibração</div><div class="v">${esc(fmtData(i.data_proxima))} · ${esc(textoVencimento(i))}</div></div>`}
        <div><div class="k">Nota fiscal</div><div class="v">${esc(i.nota_fiscal || '—')}</div></div>
        <div><div class="k">Pedido de compra</div><div class="v">${esc(i.pedido_compra || '—')}</div></div>
        ${i.pedido_calibracao ? `<div><div class="k">Rastreabilidade da solicitação</div>
          <div class="v">${esc(i.pedido_calibracao)}</div></div>` : ''}
      </div>

      ${i.observacoes ? `<div class="sec-title">Observações</div>
        <p style="font-size:13.5px;line-height:1.6;color:var(--text2);white-space:pre-wrap">${esc(i.observacoes)}</p>` : ''}

      ${i.certificado_path ? `<div style="margin-top:12px">
        <button class="btn btn-outline btn-sm" id="btCert">Abrir último certificado</button></div>` : ''}

      <div class="sec-title">Situação de trabalho</div>
      ${inativo ? `
        <!-- 'fixa': é a resposta para "cadê os botões?". Fechada, a
             pergunta ficaria sem resposta visível. -->
        <div class="warn-box w fixa" style="margin-bottom:0">
          Instrumento inativo não participa do fluxo de calibração — ele pode estar
          não encontrado, em manutenção ou segregado. Para voltar a solicitar, enviar
          ou calibrar, <b>reative-o no Inventário</b> primeiro.
        </div>`
      : referencia ? `
        <div class="act-group">
          <button class="btn btn-outline" id="btEmprestar">Registrar empréstimo</button>
        </div>
        <p style="font-size:12.5px;color:var(--muted);margin-top:8px">
          As ações de calibração não se aplicam a padrão de referência.</p>`
      : `
      <div class="act-group">
        <button class="btn btn-green" id="btCalibrar">Tornar calibrado</button>
        <button class="btn btn-outline" data-status="solicitado">Solicitar calibração</button>
        <button class="btn btn-outline" data-status="em_calibracao_externa">Enviar para calibração externa</button>
        <button class="btn btn-outline" data-status="descalibrado">Marcar como descalibrado</button>
        ${i.status_efetivo === 'calibrado' || i.status_efetivo === 'standby_pausado'
          ? `<button class="btn btn-outline" id="btEmprestar">Registrar empréstimo</button>` : ''}
      </div>`}

      <div class="sec-title">Arquivos do instrumento</div>
      <div id="arqDetalhe"></div>

      <div class="sec-title">Histórico completo</div>
      <div id="tlDetalhe"></div>`,
    acoes: [{ rotulo:'Fechar', classe:'btn-outline', onClick: f => f() }],
    aoAbrir: (body) => {
      montarArquivosInstrumento(body.querySelector('#arqDetalhe'), i.id);
      montarTimeline(body.querySelector('#tlDetalhe'), i.id);

      const btCert = body.querySelector('#btCert');
      if (btCert) btCert.addEventListener('click', async () => {
        try { await abrirArquivo(CONFIG.BUCKETS.certificados, i.certificado_path); }
        catch (e){ toast(msgErro(e), 'error'); }
      });

      const btEmp = body.querySelector('#btEmprestar');
      if (btEmp) btEmp.addEventListener('click', () => { fecharModal(); irPara('emprestimo', i.id); });

      const btCal = body.querySelector('#btCalibrar');
      if (btCal) btCal.addEventListener('click', () => formTornarCalibrado(i, container));

      body.querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', async () => {
        const novo = b.dataset.status;

        // Solicitar calibração é o momento em que o pedido de compra do
        // serviço nasce — e por isso é aqui que ele é perguntado, não no
        // fim, quando o serviço já acabou e ninguém lembra o número.
        if (novo === 'solicitado'){ formSolicitarCalibracao(i, container); return; }

        // Nome local, e não a função rotulo() importada: aqui o texto é
        // do ato ("Enviar para calibração externa"), não do status.
        const rotuloNovo = { em_calibracao_externa:'Em calibração externa',
                             descalibrado:'Descalibrado' }[novo];
        if (!await confirmar({
          titulo:'Alterar situação',
          texto:`Marcar <b>${esc(i.tag)}</b> como <b>${esc(rotuloNovo)}</b>?` +
                (novo === 'descalibrado' && i.pedido_calibracao
                  ? `<br><br>O pedido <b>${esc(i.pedido_calibracao)}</b>, associado na solicitação,
                     será desvinculado — voltar para descalibrado cancela a solicitação.` : ''),
          rotuloOk:'Alterar'
        })) return;
        try {
          await definirStatusWorkflow(i.id, novo);
          toast('Situação atualizada.', 'success');
          fecharModal();
          if (container) carregar(container, true);
        } catch (e){ toast(msgErro(e), 'error'); }
      }));
    }
  });
}

/* ==================================================================== */
/* SOLICITAR CALIBRAÇÃO                                                 */
/*                                                                      */
/* Aqui nasce a RASTREABILIDADE DA SOLICITAÇÃO: o número que liga este  */
/* instrumento ao pedido do serviço — pedido de compra, requisição,     */
/* ordem de serviço, o que a empresa usar. Antes ela era pedida no fim, */
/* ao tornar calibrado: naquele momento o serviço já acabou, o número   */
/* está num e-mail de duas semanas atrás e o campo passa em branco.     */
/* Perguntada na solicitação, é a informação que a pessoa acabou de     */
/* usar — e viaja guardada no instrumento até o certificado voltar.     */
/* Por isso é obrigatória, aqui e no banco.                             */
/* ==================================================================== */
function formSolicitarCalibracao(i, container){
  abrirModal({
    titulo: `Solicitar calibração — ${i.tag}`,
    fecharFora: false,
    corpo: `
      <p style="font-size:14px;line-height:1.55;margin-bottom:14px">
        <b>${esc(i.tag)}</b> — ${esc(i.descricao)}<br>
        <span style="color:var(--muted);font-size:13px">
          Passa de <b>${esc(rotulo(i.status_efetivo))}</b> para <b>Calibração solicitada</b>.</span>
      </p>
      <div class="field" id="wPedidoSol">
        <label for="fPedidoSol">Rastreabilidade de solicitação<span class="req">*</span></label>
        <input type="text" id="fPedidoSol" placeholder="Ex.: PC-2026-0142, RQ-118, OS 4471"
               value="${esc(i.pedido_calibracao || '')}">
        <div class="hint">
          O número que identifica esta solicitação de calibração — pedido de compra,
          requisição ou ordem de serviço. Fica vinculado ao instrumento durante toda a
          solicitação e é gravado no registro da calibração quando o certificado voltar.
        </div>
        <div class="msg" id="mPedidoSol"></div>
      </div>
      <div class="field" style="margin-top:12px">
        <label for="fObsSol">Observação da solicitação</label>
        <input type="text" id="fObsSol" placeholder="Laboratório escolhido, prazo combinado…">
        <div class="hint">Opcional. Vai para a trilha de auditoria junto com a mudança.</div>
      </div>`,
    acoes: [
      { rotulo:'Cancelar', classe:'btn-outline', onClick: f => f() },
      { rotulo:'Registrar solicitação', classe:'btn-red', onClick: async (fechar, bt) => {
          const pedido = document.getElementById('fPedidoSol').value.trim();
          const obs    = document.getElementById('fObsSol').value.trim();

          if (!pedido){
            document.getElementById('wPedidoSol').classList.add('err');
            document.getElementById('mPedidoSol').textContent =
              'Informe a rastreabilidade da solicitação.';
            document.getElementById('fPedidoSol').focus();
            return;
          }

          bt.disabled = true; bt.textContent = 'Salvando…';
          try {
            await definirStatusWorkflow(i.id, 'solicitado',
              obs || 'Calibração solicitada — rastreabilidade ' + pedido, pedido);
            fechar();
            toast(`Calibração de ${i.tag} solicitada · ${pedido}.`, 'success');
            if (container) carregar(container, true);
          } catch (e){
            toast(msgErro(e), 'error');
            bt.disabled = false; bt.textContent = 'Registrar solicitação';
          }
      } }
    ],
    aoAbrir: body => body.querySelector('#fPedidoSol').focus()
  });
}

/* ==================================================================== */
/* TORNAR CALIBRADO                                                     */
/* ==================================================================== */
function formTornarCalibrado(i, container){
  abrirModal({
    titulo: `Tornar calibrado — ${i.tag}`,
    fecharFora: false,
    corpo: `
      <div class="warn-box i">
        A <b>próxima</b> data é calculada pelo servidor conforme a periodicidade da família
        ${i.periodicidade_customizada ? '(customizada por fases)' : `(${esc(i.periodicidade_meses)} meses)`}
        e o relógio de standby. Você não digita a próxima data.
      </div>
      ${i.pedido_calibracao ? `
      <div class="warn-box g">
        A rastreabilidade <b>${esc(i.pedido_calibracao)}</b>, associada quando esta calibração
        foi solicitada, será gravada no registro automaticamente.
      </div>` : ''}
      <div class="g2">
        <div class="field full" id="wDataCal">
          <label for="fDataCal">Data da calibração<span class="req">*</span></label>
          <input type="date" id="fDataCal" value="${hojeISO()}" max="${hojeISO()}">
          <div class="hint">Com o controle mensal ligado, a validade vai até o último dia do mês de vencimento.</div>
          <div class="msg" id="mDataCal"></div>
        </div>

        <div class="field" id="wCertificado">
          <label>Certificado (PDF)<span class="req">*</span></label>
          <div class="file"><input type="file" id="fCertificado" accept="application/pdf">
            <div class="txt">Clique ou arraste o certificado</div></div>
          <div class="hint">Obrigatório: é o certificado que sustenta a validade numa auditoria.
            PDF de até ${CONFIG.MAX_MB_PDF} MB.</div>
          <div class="msg" id="mCertificado"></div>
        </div>
        <div class="field" id="wLaudo">
          <label>Laudo (PDF, opcional)</label>
          <div class="file"><input type="file" id="fLaudo" accept="application/pdf">
            <div class="txt">Clique ou arraste o laudo</div></div>
          <div class="msg" id="mLaudo"></div>
        </div>

        <div class="field full" id="wObs">
          <label for="fObs">Observações do metrologista</label>
          <textarea id="fObs" placeholder="Ajustes realizados, desvios encontrados, restrições de uso…"></textarea>
        </div>

        <div class="field field-inline full">
          <input type="checkbox" id="fStandbyApos">
          <label for="fStandbyApos">Guardar em standby após a calibração
            <span style="font-weight:400;color:var(--muted)">— a validade fica parada até a próxima saída.</span></label>
        </div>
      </div>`,
    acoes: [
      { rotulo:'Cancelar', classe:'btn-outline', onClick: f => f() },
      { rotulo:'Registrar calibração', classe:'btn-green', onClick: async (fechar, bt) => {
          const data   = document.getElementById('fDataCal').value;
          const fCert  = document.getElementById('fCertificado').files[0];
          const fLaudo = document.getElementById('fLaudo').files[0];

          if (!data){ toast('Informe a data da calibração.', 'error'); return; }
          if (data > hojeISO()){ toast('A data da calibração não pode estar no futuro.', 'error'); return; }
          // Calibrado sem certificado é afirmação sem prova. A trava
          // definitiva está na RPC registrar_calibracao; aqui é só para
          // avisar antes de o usuário perder o preenchimento.
          if (!fCert){
            document.getElementById('wCertificado').classList.add('err');
            document.getElementById('mCertificado').textContent =
              'Anexe o certificado de calibração.';
            toast('O certificado de calibração é obrigatório.', 'error');
            return;
          }

          bt.disabled = true; bt.textContent = 'Salvando…';
          try {
            const pasta = pastaDoInstrumento(i.tag);

            const certificado_path = await enviarArquivo(CONFIG.BUCKETS.certificados, fCert, pasta);
            const laudo_path       = fLaudo ? await enviarArquivo(CONFIG.BUCKETS.laudos, fLaudo, pasta) : null;

            // Sem rastreabilidade aqui de propósito: ela foi associada na
            // solicitação e o servidor a copia da coluna do instrumento.
            await registrarCalibracao(i.id, {
              data_calibracao: data,
              certificado_path,
              laudo_path,
              obs_metrologista: document.getElementById('fObs').value.trim(),
              standby_apos:     document.getElementById('fStandbyApos').checked
            });

            fechar();
            toast(`${i.tag} está calibrado.`, 'success');
            if (container) carregar(container, true);
          } catch (e){
            toast(msgErro(e), 'error');
            bt.disabled = false; bt.textContent = 'Registrar calibração';
          }
      } }
    ],
    aoAbrir: body => {
      body.querySelectorAll('.file input[type=file]').forEach(inp =>
        inp.addEventListener('change', () => {
          const caixa = inp.closest('.file'), a = inp.files[0];
          caixa.classList.toggle('ok', !!a);
          caixa.querySelector('.txt').textContent = a ? a.name : 'Clique ou arraste o arquivo';
        }));
      body.querySelector('#fDataCal').focus();
    }
  });
}
