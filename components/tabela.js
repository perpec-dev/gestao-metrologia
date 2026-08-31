/* =====================================================================
   Tabela ordenável, sem framework.

   Uso:
     const t = criarTabela(elemento, {
       colunas: [
         { chave:'tag', rotulo:'Tag', classe:'mono' },
         { chave:'status_efetivo', rotulo:'Situação', html: l => badge(l.status_efetivo) }
       ],
       linhas,
       classeLinha: l => classeLinha(l.status_efetivo),
       aoClicar: l => abrirDetalhe(l.id)
     });
     t.atualizar(novasLinhas);

   Ordenação e filtro acontecem no cliente — o volume aqui é de centenas
   de instrumentos, não de milhões de linhas.
   ===================================================================== */
import { esc, comparar, htmlVazio, delegar } from '../utils.js';

export function criarTabela(el, opcoes){
  const cfg = Object.assign({
    colunas: [], linhas: [], classeLinha: null, idLinha: null, aoClicar: null,
    vazio: 'Nada para mostrar.', ordem: null, rodape: true
  }, opcoes);

  let linhas = cfg.linhas.slice();
  let ordem  = cfg.ordem;   // { chave, dir: 1 | -1 }

  const valorDe = (col, l) => col.valor ? col.valor(l) : l[col.chave];

  function ordenadas(){
    if (!ordem) return linhas;
    const col = cfg.colunas.find(c => c.chave === ordem.chave);
    if (!col) return linhas;
    return linhas.slice().sort((a,b) => comparar(valorDe(col,a), valorDe(col,b)) * ordem.dir);
  }

  function pintar(){
    const dados = ordenadas();

    if (!dados.length){
      el.innerHTML = htmlVazio(cfg.vazio);
      return;
    }

    const cabecalho = cfg.colunas.map(c => {
      const ordenavel = c.ordenavel !== false;
      const dir = ordem && ordem.chave === c.chave ? (ordem.dir === 1 ? 'asc' : 'desc') : '';
      const seta = dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '↕';
      return `<th class="${ordenavel ? 'ord ' : ''}${dir}" data-col="${esc(c.chave)}"
                  ${c.largura ? `style="width:${c.largura}"` : ''}>${esc(c.rotulo)}${
                  ordenavel ? `<span class="seta">${seta}</span>` : ''}</th>`;
    }).join('');

    const corpo = dados.map((l, i) => {
      const cls = [
        cfg.classeLinha ? cfg.classeLinha(l) : '',
        cfg.aoClicar ? 'clicavel' : ''
      ].filter(Boolean).join(' ');
      const tds = cfg.colunas.map(c => {
        const conteudo = c.html ? c.html(l) : esc(valorDe(c, l) ?? '—');
        return `<td class="${esc(c.classe || '')}">${conteudo}</td>`;
      }).join('');
      const id = cfg.idLinha ? ` data-id="${esc(cfg.idLinha(l))}"` : '';
      return `<tr class="${cls}" data-i="${i}"${id}>${tds}</tr>`;
    }).join('');

    el.innerHTML = `
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr>${cabecalho}</tr></thead>
        <tbody>${corpo}</tbody>
      </table></div>` +
      (cfg.rodape ? `<div class="tbl-rodape"><span>${dados.length} ${dados.length === 1 ? 'registro' : 'registros'}</span></div>` : '');

    el._dados = dados;
  }

  // Um listener só, no container: sobrevive a todo repintar.
  delegar(el, 'click', 'th.ord', (e, th) => {
    const c = th.dataset.col;
    ordem = (ordem && ordem.chave === c) ? { chave:c, dir: -ordem.dir } : { chave:c, dir:1 };
    pintar();
  });

  if (cfg.aoClicar){
    delegar(el, 'click', 'tbody tr', (e, tr) => {
      if (e.target.closest('button, a, input, select')) return;   // ações próprias
      const l = el._dados[Number(tr.dataset.i)];
      if (l) cfg.aoClicar(l, e);
    });
  }

  pintar();

  return {
    atualizar(novas){ linhas = novas.slice(); pintar(); },
    get linhas(){ return ordenadas(); },
    repintar: pintar
  };
}
