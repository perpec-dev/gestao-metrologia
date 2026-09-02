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
import { esc, fmtDT, htmlVazio } from '../utils.js';
import { listarArquivosInstrumento } from '../supabase.js';
import { ligarArquivos } from './timeline.js';

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
        </div>`).join('')}
    </div>`;
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

/** Carrega e desenha a pasta de um instrumento dentro de um elemento. */
export async function montarArquivosInstrumento(el, instrumentoId){
  if (!el) return;
  el.innerHTML = '<div class="carregando"><div class="spin"></div>Abrindo a pasta…</div>';
  try {
    el.innerHTML = htmlArquivos(await listarArquivosInstrumento(instrumentoId));
    ligarArquivos(el);
  } catch (e){
    el.innerHTML = `<div class="warn-box e">${esc(e.message || e)}</div>`;
  }
}
