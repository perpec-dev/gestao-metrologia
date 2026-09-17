/* =====================================================================
   Modal único, reaproveitado por todas as telas.

   abrirModal({ titulo, corpo, acoes, largo, aoAbrir })
     corpo  — string HTML já escapada por quem chamou
     acoes  — [{ rotulo, classe, onClick(fecha), id }]
     aoAbrir(elBody, fechar) — para ligar listeners depois do DOM existir

   confirmar({...}) devolve Promise<boolean>.
   pedirJustificativa({...}) devolve Promise<string|null>.
   ===================================================================== */
import { esc } from '../utils.js';

let elModal = null;
let fecharAtual = null;

function garantirElemento(){
  if (elModal) return elModal;
  elModal = document.getElementById('modal');
  if (!elModal){
    elModal = document.createElement('div');
    elModal.id = 'modal';
    elModal.className = 'modal';
    elModal.hidden = true;
    document.body.appendChild(elModal);
  }
  return elModal;
}

export function fecharModal(){
  if (!elModal) return;
  elModal.hidden = true;
  elModal.innerHTML = '';
  document.body.style.overflow = '';
  fecharAtual = null;
}

function aoTeclar(e){
  if (e.key === 'Escape' && fecharAtual) fecharAtual();
}
document.addEventListener('keydown', aoTeclar);

export function abrirModal({ titulo, corpo, acoes = [], largo = false, aoAbrir = null, fecharFora = true }){
  const m = garantirElemento();

  m.innerHTML = `
    <div class="modal-card${largo ? ' lg' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h3>${esc(titulo)}</h3>
        <button class="x" data-fechar aria-label="Fechar">&times;</button>
      </div>
      <div class="modal-body">${corpo}</div>
      ${acoes.length ? `<div class="modal-foot">${
        acoes.map((a,i) => `<button class="btn ${esc(a.classe || 'btn-outline')}"
                                    data-acao="${i}" ${a.id ? `id="${esc(a.id)}"` : ''}
                                    ${a.desabilitado ? 'disabled' : ''}>${esc(a.rotulo)}</button>`).join('')
      }</div>` : ''}
    </div>`;

  m.hidden = false;
  document.body.style.overflow = 'hidden';
  fecharAtual = fecharModal;

  m.querySelector('[data-fechar]').onclick = fecharModal;
  if (fecharFora) m.onclick = e => { if (e.target === m) fecharModal(); };
  else m.onclick = null;

  acoes.forEach((a, i) => {
    const b = m.querySelector(`[data-acao="${i}"]`);
    if (b && a.onClick) b.onclick = () => a.onClick(fecharModal, b);
  });

  const body = m.querySelector('.modal-body');
  if (aoAbrir) aoAbrir(body, fecharModal);
  return { elemento: m, corpo: body, fechar: fecharModal };
}

/** Confirmação simples. */
export function confirmar({ titulo = 'Confirmar', texto, rotuloOk = 'Confirmar', classeOk = 'btn-red' }){
  return new Promise(resolve => {
    abrirModal({
      titulo,
      corpo: `<p style="font-size:14.5px;line-height:1.55">${texto}</p>`,
      acoes: [
        { rotulo:'Cancelar', classe:'btn-outline', onClick: f => { f(); resolve(false); } },
        { rotulo: rotuloOk,  classe: classeOk,     onClick: f => { f(); resolve(true);  } }
      ]
    });
  });
}

/** Justificativa obrigatória — usada em toda alteração auditada. */
export function pedirJustificativa({ titulo, texto = '', rotuloOk = 'Salvar', minimo = 10 }){
  return new Promise(resolve => {
    abrirModal({
      titulo,
      corpo: `
        <!-- 'fixa': este texto diz O QUE está sendo alterado (a família,
             o instrumento). É contexto da decisão, não dica de tela. -->
        ${texto ? `<div class="warn-box w fixa">${texto}</div>` : ''}
        <div class="field" id="wJust">
          <label for="fJust">Justificativa<span class="req">*</span></label>
          <textarea id="fJust" placeholder="Explique o motivo desta alteração. Este texto vai para a trilha de auditoria."></textarea>
          <div class="hint">Mínimo de ${minimo} caracteres. Fica registrado com seu e-mail e a data.</div>
          <div class="msg" id="mJust"></div>
        </div>`,
      acoes: [
        { rotulo:'Cancelar', classe:'btn-outline', onClick: f => { f(); resolve(null); } },
        { rotulo: rotuloOk,  classe:'btn-red', onClick: (f) => {
            const v = document.getElementById('fJust').value.trim();
            if (v.length < minimo){
              document.getElementById('wJust').classList.add('err');
              document.getElementById('mJust').textContent = `Escreva pelo menos ${minimo} caracteres.`;
              return;
            }
            f(); resolve(v);
        } }
      ],
      aoAbrir: body => body.querySelector('#fJust').focus()
    });
  });
}

/** Trava o botão enquanto a promessa não resolve — evita duplo clique. */
export async function comBotaoOcupado(botao, rotuloOcupado, fn){
  if (!botao) return fn();
  const original = botao.textContent;
  botao.disabled = true; botao.textContent = rotuloOcupado;
  try { return await fn(); }
  finally { botao.disabled = false; botao.textContent = original; }
}
