/* =====================================================================
   ARQUIVOS DE UM INSTRUMENTO — a pasta do equipamento.

   Os arquivos sempre existiram, mas cada um morava numa tabela: o
   certificado em `calibracoes`, o termo em `movimentacoes`, a foto em
   `inspecoes`, o resto em `documentos`. Para achar "o certificado do
   P-PAQ-03" era preciso abrir a ficha e caçar na linha do tempo, evento
   por evento. A view vw_arquivos junta os quatro; este componente os
   desenha como pastas.

   Duas telas usam o mesmo desenho: a ficha do instrumento (bloco
   "Arquivos") e a tela Arquivos (uma pasta por equipamento). Ter um
   desenho só significa que abrir um certificado é o mesmo gesto nas
   duas.

   Os links do Storage são assinados na hora do clique — ligarArquivos,
   emprestado da linha do tempo, já faz exatamente isso.
   ===================================================================== */
import { esc, fmtDT, htmlVazio, toast, msgErro } from '../utils.js';
import { listarArquivosInstrumento, removerArquivo, enviarArquivo,
         anexarFotoInstrumento, pastaDoInstrumento } from '../supabase.js';
import { ligarArquivos } from './timeline.js';
import { abrirModal } from './modal.js';
import { souAdmin } from '../auth.js';
import { CONFIG } from '../config.js';

/* Ordem de leitura das subpastas: primeiro o que se procura mais.
   Quem abre a pasta de um instrumento está atrás do certificado em nove
   de cada dez vezes. */
const ORDEM_TIPO = ['Certificado','Laudo','Foto','Termo'];

const ICONE = {
  Certificado: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6M9 15l2 2 4-4"/>',
  Laudo:       '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6M8 13h8M8 17h5"/>',
  Foto:        '<path d="M3 7h4l2-3h6l2 3h4v13H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/>',
  Termo:       '<path d="M16 2H8a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2ZM9 8h6M9 12h6M9 16h3"/>',
  Documento:   '<path d="M4 4h6l2 3h8v13H4z"/>'
};

const icone = tipo =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONE[tipo] || ICONE.Documento}</svg>`;

/** Agrupa por tipo, na ordem de leitura, com o resto no fim. */
function agrupar(arquivos){
  const mapa = new Map();
  arquivos.forEach(a => {
    const t = a.tipo || 'Documento';
    if (!mapa.has(t)) mapa.set(t, []);
    mapa.get(t).push(a);
  });
  const conhecidos = ORDEM_TIPO.filter(t => mapa.has(t));
  const resto = [...mapa.keys()].filter(t => !ORDEM_TIPO.includes(t)).sort();
  return [...conhecidos, ...resto].map(t => [t, mapa.get(t)]);
}

/** Nome do arquivo como ele está no Storage — o último trecho do caminho. */
const nomeArquivo = caminho => String(caminho || '').split('/').pop();

/** Uma subpasta (Certificados, Laudos, Fotos, Termos) com seus arquivos. */
function htmlGrupo(tipo, itens){
  /* O botão de remover só existe para administrador, e não por capricho
     de hierarquia: a política de DELETE do Storage exige admin. Mostrá-lo
     para o metrologista seria oferecer um botão que o banco recusa. */
  const podeRemover = souAdmin();
  return `
    <div class="arq-grupo">
      <div class="arq-grupo-cab">${icone(tipo)}<b>${esc(tipo)}</b>
        <span class="arq-qtd">${itens.length}</span></div>
      ${itens.map(a => `
        <div class="arq-item">
          <div class="arq-txt">
            <div class="arq-nome">${esc(a.nome)}</div>
            <div class="arq-meta">${esc(fmtDT(a.quando))}${
              a.autor ? ' · ' + esc(a.autor) : ''} · <span class="arq-path">${
              esc(nomeArquivo(a.arquivo_path))}</span></div>
          </div>
          <button class="btn btn-outline btn-sm" data-arquivo="${esc(a.arquivo_path)}"
                  data-bucket="${esc(a.bucket)}">Abrir</button>
          ${podeRemover ? `<button class="btn btn-perigo btn-sm" data-remover="${esc(a.origem)}"
                  data-registro="${esc(a.registro_id)}" title="Remover ou substituir este arquivo"
            >Remover</button>` : ''}
        </div>`).join('')}
    </div>`;
}

/* ---------------------------------------------------------------------
   REMOVER OU SUBSTITUIR

   Um arquivo anexado por engano — o certificado de um instrumento na
   calibração de outro — precisa sair. O que não pode sair junto é a
   explicação: por isso a justificativa é obrigatória e vai para a trilha
   de auditoria, onde fica depois que o arquivo já não existe.

   O anexo de substituição vem primeiro no formulário de propósito.
   Trocar o errado pelo certo é o desfecho normal do engano; remover sem
   pôr nada no lugar deixa o registro de calibração sem a prova que o
   sistema exige na entrada — e a tela diz isso com todas as letras antes
   de confirmar.
   --------------------------------------------------------------------- */
const ACEITA = { fotos:'image/*' };

export function modalRemoverArquivo(arq, aoConcluir){
  const ehCertificado = arq.origem === 'calibracao_certificado';
  const ehTermo       = arq.origem === 'movimentacao_termo';

  abrirModal({
    titulo: `Remover arquivo — ${arq.tag}`,
    fecharFora: false,
    corpo: `
      <div class="kv" style="margin-bottom:16px">
        <div><div class="k">Arquivo</div><div class="v">${esc(arq.nome)}</div></div>
        <div><div class="k">Tipo</div><div class="v">${esc(arq.tipo)}</div></div>
        <div><div class="k">Anexado em</div><div class="v">${esc(fmtDT(arq.quando))}</div></div>
        <div><div class="k">Por</div><div class="v">${esc(arq.autor || '—')}</div></div>
      </div>

      <div class="warn-box e fixa">
        <b>O arquivo sai do acervo e não volta.</b> A remoção é registrada na trilha de
        auditoria com o seu e-mail, a data e a justificativa abaixo — o histórico do
        instrumento guarda que este arquivo existiu e foi retirado.
      </div>

      <div class="field" id="wSubstituto">
        <label>Anexar o arquivo correto no lugar</label>
        <div class="file"><input type="file" id="fSubstituto"
             accept="${ACEITA[arq.bucket] || 'application/pdf'}">
          <div class="txt">Clique ou arraste o arquivo correto</div></div>
        <div class="hint">
          ${ehCertificado
            ? 'Recomendado. <b>Sem substituto, esta calibração fica sem certificado</b> — e certificado é o que sustenta a validade numa auditoria.'
            : ehTermo
              ? 'Obrigatório em empréstimo de posse ou externo: esses não existem sem termo assinado.'
              : 'Opcional. Em branco, o arquivo é apenas removido.'}
        </div>
        <div class="msg" id="mSubstituto"></div>
      </div>

      <div class="field" id="wJustArq" style="margin-top:12px">
        <label for="fJustArq">Justificativa<span class="req">*</span></label>
        <textarea id="fJustArq" placeholder="Ex.: certificado do P-PAQ-03 anexado por engano nesta calibração."></textarea>
        <div class="hint">Mínimo de 10 caracteres. Fica na auditoria depois que o arquivo já não existe.</div>
        <div class="msg" id="mJustArq"></div>
      </div>`,
    acoes: [
      { rotulo:'Cancelar', classe:'btn-outline', onClick: f => f() },
      { rotulo:'Remover arquivo', classe:'btn-red', onClick: async (fechar, bt) => {
          const just = document.getElementById('fJustArq').value.trim();
          const novo = document.getElementById('fSubstituto').files[0] || null;

          if (just.length < 10){
            document.getElementById('wJustArq').classList.add('err');
            document.getElementById('mJustArq').textContent = 'Escreva pelo menos 10 caracteres.';
            return;
          }

          bt.disabled = true; bt.textContent = 'Removendo…';
          try {
            // O substituto sobe ANTES: se o upload falhar, nada foi
            // removido e o usuário tenta de novo sem estrago.
            const substituto = novo
              ? await enviarArquivo(arq.bucket, novo, pastaDoInstrumento(arq.tag))
              : null;

            const { orfao } = await removerArquivo({
              origem: arq.origem, registroId: arq.registro_id,
              justificativa: just, bucket: arq.bucket,
              caminho: arq.arquivo_path, substituto
            });

            fechar();
            toast(substituto ? 'Arquivo substituído e registrado na auditoria.'
                             : 'Arquivo removido e registrado na auditoria.', 'success');
            if (orfao) toast('O arquivo saiu da pasta, mas continua no Storage. ' +
                             'Peça a limpeza pelo item 4.7 de 05_admin.sql.', 'error');
            if (aoConcluir) aoConcluir();
          } catch (e){
            toast(msgErro(e), 'error');
            bt.disabled = false; bt.textContent = 'Remover arquivo';
          }
      } }
    ],
    aoAbrir: body => {
      body.querySelectorAll('.file input[type=file]').forEach(inp =>
        inp.addEventListener('change', () => {
          const caixa = inp.closest('.file'), a = inp.files[0];
          caixa.classList.toggle('ok', !!a);
          caixa.querySelector('.txt').textContent = a ? a.name : 'Clique ou arraste o arquivo correto';
        }));
      body.querySelector('#fJustArq').focus();
    }
  });
}

/* ---------------------------------------------------------------------
   ANEXAR FOTO DEPOIS DO CADASTRO

   A tela de cadastro exige a foto, e com razão: é por ela que se
   reconhece o instrumento na conferência do inventário. A IMPORTAÇÃO EM
   MASSA não tem como exigir — uma planilha de duzentas linhas não carrega
   duzentas imagens, e o acervo antigo entra por ali. Sem um caminho para
   anexar depois, a saída seria recadastrar o instrumento: tag nova,
   histórico no lixo.

   A foto entra como registro de momento 'posterior', e o histórico diz
   isso com todas as letras — "Foto do instrumento anexada", não "Inspeção
   visual". A inspeção de entrada prova o estado em que o instrumento
   CHEGOU; uma foto tirada hoje mostra o instrumento de hoje.
   --------------------------------------------------------------------- */
export function modalAnexarFoto(instr, aoConcluir){
  let urlPrevia = null;

  abrirModal({
    titulo: `Anexar foto — ${instr.tag}`,
    fecharFora: false,
    corpo: `
      <p style="font-size:13.5px;color:var(--text2);margin:0 0 14px">
        ${esc(instr.descricao || '')}</p>

      <div class="field" id="wFotoNova">
        <label>Foto do instrumento<span class="req">*</span></label>
        <div class="file" id="dFotoNova">
          <input type="file" id="fFotoNova" accept="image/*" capture="environment">
          <div class="txt">Clique para escolher ou tirar a foto</div>
        </div>
        <div class="hint">JPG ou PNG, até ${CONFIG.MAX_MB_FOTO} MB. No celular, a câmera abre direto.</div>
        <div class="msg" id="mFotoNova"></div>
        <div id="previaFoto" hidden style="margin-top:10px">
          <img alt="Prévia da foto escolhida" style="max-width:100%;max-height:240px;
               border-radius:8px;border:1px solid var(--linha)">
        </div>
      </div>

      <div class="field" id="wObsFoto" style="margin-top:12px">
        <label for="fObsFoto">Observação</label>
        <textarea id="fObsFoto" placeholder="Ex.: instrumento localizado na bancada 2; foto tirada na conferência do inventário."></textarea>
        <div class="hint">Opcional. Vai para a linha do tempo junto com a foto.</div>
      </div>`,
    acoes: [
      { rotulo:'Cancelar', classe:'btn-outline', onClick: f => { limpar(); f(); } },
      { rotulo:'Anexar foto', classe:'btn-green', onClick: async (fechar, bt) => {
          const inp = document.getElementById('fFotoNova');
          const img = inp.files[0] || null;
          if (!img){
            document.getElementById('wFotoNova').classList.add('err');
            document.getElementById('mFotoNova').textContent = 'Escolha a imagem do instrumento.';
            return;
          }

          bt.disabled = true; bt.textContent = 'Enviando…';
          try {
            await anexarFotoInstrumento(instr.id, instr.tag, img,
              document.getElementById('fObsFoto').value.trim());
            limpar(); fechar();
            toast('Foto anexada à pasta do instrumento.', 'success');
            if (aoConcluir) aoConcluir();
          } catch (e){
            toast(msgErro(e), 'error');
            bt.disabled = false; bt.textContent = 'Anexar foto';
          }
      } }
    ],
    aoAbrir: body => {
      const inp = body.querySelector('#fFotoNova');
      inp.addEventListener('change', () => {
        const caixa = inp.closest('.file'), a = inp.files[0];
        caixa.classList.toggle('ok', !!a);
        caixa.querySelector('.txt').textContent = a ? a.name : 'Clique para escolher ou tirar a foto';

        // Prévia: a pergunta de quem anexa foto é "é esta mesmo?", e ela
        // não se responde pelo nome do arquivo — IMG_4821.jpg não diz nada.
        const previa = body.querySelector('#previaFoto');
        limpar();
        if (a){
          urlPrevia = URL.createObjectURL(a);
          previa.querySelector('img').src = urlPrevia;
          previa.hidden = false;
        } else previa.hidden = true;
      });
    }
  });

  // O object URL segura a imagem na memória até ser revogado.
  function limpar(){
    if (urlPrevia){ URL.revokeObjectURL(urlPrevia); urlPrevia = null; }
  }
}

/** Botão "Anexar foto" — carrega no próprio elemento o que o modal precisa. */
export const htmlBotaoFoto = (instr, rotulo = 'Anexar foto') => `
  <button class="btn btn-outline btn-sm" data-foto="${esc(instr.id)}"
          data-tag="${esc(instr.tag)}" data-desc="${esc(instr.descricao || '')}"
          title="Anexar uma foto deste instrumento">${esc(rotulo)}</button>`;

/** Liga os botões "Anexar foto" de uma tela já desenhada. */
export function ligarAnexoFoto(raiz, aoConcluir){
  raiz.querySelectorAll('[data-foto]').forEach(b => b.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    modalAnexarFoto({ id:b.dataset.foto, tag:b.dataset.tag, descricao:b.dataset.desc },
                    aoConcluir);
  }));
}

/** Liga os botões "Remover" de uma pasta já desenhada. */
export function ligarRemocao(raiz, arquivos, aoConcluir){
  raiz.querySelectorAll('[data-remover]').forEach(b => b.addEventListener('click', () => {
    const arq = arquivos.find(a => a.origem === b.dataset.remover
                               && String(a.registro_id) === b.dataset.registro);
    if (arq) modalRemoverArquivo(arq, aoConcluir);
  }));
}

/** Conteúdo de uma pasta: as subpastas por tipo. */
export function htmlArquivos(arquivos, vazio = 'Nenhum arquivo anexado a este instrumento.'){
  if (!arquivos || !arquivos.length) return htmlVazio(vazio);
  return `<div class="arqs">${agrupar(arquivos).map(([t, itens]) => htmlGrupo(t, itens)).join('')}</div>`;
}

/** Resumo de uma linha: "3 certificados · 1 termo" — o que a pasta tem
    sem precisar abrir. */
export function resumoArquivos(arquivos){
  return agrupar(arquivos)
    .map(([t, itens]) => `${itens.length} ${t.toLowerCase()}${itens.length > 1 ? 's' : ''}`)
    .join(' · ');
}

/** Carrega e desenha a pasta de um instrumento dentro de um elemento.
    `aoMudar` é chamado quando um arquivo é removido ou substituído —
    quem chamou decide se repinta a ficha, a lista, ou os dois. */
export async function montarArquivosInstrumento(el, instrumentoId, aoMudar = null){
  if (!el) return;
  el.innerHTML = '<div class="carregando"><div class="spin"></div>Abrindo a pasta…</div>';
  try {
    const arquivos = await listarArquivosInstrumento(instrumentoId);
    el.innerHTML = htmlArquivos(arquivos);
    ligarArquivos(el);
    /* Quem chamou sabe repintar melhor do que nós: dentro da ficha, o
       modal de remoção substituiu a própria ficha na tela (o modal é um
       elemento só), então repintar este bloco não adiantaria nada — é a
       ficha inteira que precisa voltar. Sem callback, a pasta se
       recarrega sozinha. */
    ligarRemocao(el, arquivos,
      aoMudar || (() => montarArquivosInstrumento(el, instrumentoId)));
  } catch (e){
    el.innerHTML = `<div class="warn-box e">${esc(e.message || e)}</div>`;
  }
}
