/* =====================================================================
   RECEBIMENTO — entrada de instrumento novo no acervo.

   Um formulário só: documento de entrada, identificação, inspeção
   visual e (opcional) certificado de calibração. Tudo grava numa única
   transação no servidor (criar_instrumento_completo): ou entra
   instrumento + inspeção + calibração, ou não entra nada.
   ===================================================================== */
import { esc, toast, msgErro } from '../utils.js';
import { criarInstrumentoCompleto } from '../supabase.js';
import { htmlFormInstrumento, ligarFormInstrumento,
         coletarFormInstrumento, limparFormInstrumento } from '../components/form-instrumento.js';
import { irPara } from '../router.js';

export async function render(container){
  container.innerHTML = `
    <form id="formReceb" novalidate>
      ${htmlFormInstrumento({ comNotaFiscal:true, comInspecao:true, comCertificado:true })}
      <div class="act-bar">
        <div style="font-size:12.5px;color:var(--muted);max-width:520px">
          A tag definitiva é confirmada pelo servidor no momento de salvar.
          Se outro usuário cadastrar um instrumento da mesma família antes de você,
          a sua tag avança sozinha — sem duplicar.
        </div>
        <div class="act-group">
          <button type="button" class="btn btn-outline" id="btLimpar">Limpar formulário</button>
          <button type="submit" class="btn btn-red btn-xl" id="btSalvar" style="width:auto;min-width:280px">
            REGISTRAR RECEBIMENTO
          </button>
        </div>
      </div>
    </form>
    <div id="ultimos"></div>`;

  const form = container.querySelector('#formReceb');
  await ligarFormInstrumento(form, { comCertificado:true });

  const registrados = [];

  container.querySelector('#btLimpar').addEventListener('click', () => {
    limparFormInstrumento(form);
    form.querySelector('#fFamilia').focus();
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const bt = container.querySelector('#btSalvar');
    bt.disabled = true; bt.textContent = 'SALVANDO…';
    try {
      const dados = await coletarFormInstrumento(form, {
        comNotaFiscal:true, comInspecao:true, comCertificado:true, origem:'recebimento'
      });
      if (!dados) return;

      const novo = await criarInstrumentoCompleto(dados.instrumento, dados.inspecao, dados.calibracao);

      registrados.unshift({ tag: novo.tag, descricao: novo.descricao, id: novo.id,
                            calibrado: !!dados.calibracao });
      pintarUltimos();
      toast('Recebimento registrado. Tag ' + novo.tag, 'success');
      limparFormInstrumento(form);
      form.querySelector('#fNotaFiscal').focus();
      window.scrollTo({ top:0, behavior:'smooth' });
    } catch (err){
      console.error(err);
      toast(msgErro(err), 'error');
    } finally {
      bt.disabled = false; bt.textContent = 'REGISTRAR RECEBIMENTO';
    }
  });

  function pintarUltimos(){
    const el = container.querySelector('#ultimos');
    if (!registrados.length){ el.innerHTML = ''; return; }
    el.innerHTML = `
      <div class="card">
        <div class="card-head"><h2>Registrados nesta sessão</h2>
          <span class="right">${registrados.length}</span></div>
        <div class="card-body tight">
          ${registrados.map(r => `
            <div class="rec s-${r.calibrado ? 'calibrado' : 'descalibrado'}">
              <div class="rec-in"><div class="rec-grid">
                <div><div class="k">Tag</div><div class="v" style="font-family:'Courier New',monospace">${esc(r.tag)}</div></div>
                <div><div class="k">Descrição</div><div class="v">${esc(r.descricao)}</div></div>
                <div><div class="k">Situação</div><div class="v">${r.calibrado ? 'Calibrado' : 'Descalibrado — sem certificado'}</div></div>
                <div style="display:flex;align-items:flex-end">
                  <button class="btn btn-outline btn-sm" data-abrir="${esc(r.id)}">Abrir na calibração</button>
                </div>
              </div></div>
            </div>`).join('')}
        </div>
      </div>`;
    el.querySelectorAll('[data-abrir]').forEach(b =>
      b.addEventListener('click', () => irPara('calibracao', b.dataset.abrir)));
  }
}
