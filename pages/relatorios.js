/* =====================================================================
   RELATÓRIOS — filtros aplicados no servidor, prévia na tela,
   exportação para Excel (SheetJS) e PDF (pdfmake).

   O PDF é documento formal: sem tarja colorida de status, com logo,
   referência do documento e "Página X de Y" em todas as páginas.
   ===================================================================== */
import { esc, fmtData, hojeISO, toast, msgErro, htmlVazio, htmlCarregando,
         lerXLSX, lerPDFMake, baixarBlob, p2, slug } from '../utils.js';
import { consultarInstrumentos, listarFamilias } from '../supabase.js';
import { CONFIG } from '../config.js';
import { criarTabela } from '../components/tabela.js';
import { badge, classeLinha, rotulo, ORDEM_STATUS, STATUS, textoVencimento } from '../components/status-badge.js';
import { meuNome } from '../auth.js';

let resultado = [];
let tabela = null;
let familias = [];
/* Descrição do recorte que gerou `resultado`. Guardada no momento da
   consulta, não lida do formulário na hora de exportar: entre gerar e
   exportar o usuário pode ter mexido nos filtros sem clicar em Gerar. */
let descricao = { titulo:'Relatório geral do acervo', linha:'' };

export function destroy(){ resultado = []; tabela = null; }

/* ==================================================================== */
export async function render(container){
  familias = await listarFamilias();

  container.innerHTML = `
    <div class="card">
      <div class="card-head"><span class="step">1</span><h2>Filtros</h2></div>
      <div class="card-body">
        <div class="field">
          <label>Situação</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:4px">
            ${ORDEM_STATUS.map(s => `
              <label class="field-inline" style="cursor:pointer">
                <input type="checkbox" class="fSt" value="${s}">
                <span style="font-size:13.5px;font-weight:600">${esc(STATUS[s].rotulo)}</span>
              </label>`).join('')}
          </div>
          <div class="hint">Nenhuma marcada = todas as situações.</div>
        </div>

        <div class="g4" style="margin-top:16px">
          <div class="field">
            <label for="fFamilia">Família</label>
            <select id="fFamilia"><option value="">Todas</option>
              ${familias.map(f => `<option value="${esc(f.id)}">${esc(f.codigo)} — ${esc(f.nome)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="fCondicao">Condição física</label>
            <select id="fCondicao">
              <option value="ativo">Ativos</option>
              <option value="inativo">Inativos</option>
              <option value="">Todas</option>
            </select>
          </div>
          <div class="field">
            <label for="fTipo">Tipo</label>
            <select id="fTipo">
              <option value="">Todos</option>
              <option value="TMMDE">TMMDE — instrumento de uso</option>
              <option value="REFERENCIA">Referência</option>
            </select>
          </div>
          <div class="field"></div>

          <div class="field">
            <label for="fProxDe">Próxima calibração — de</label>
            <input type="date" id="fProxDe">
          </div>
          <div class="field">
            <label for="fProxAte">Próxima calibração — até</label>
            <input type="date" id="fProxAte">
          </div>
          <div class="field">
            <label for="fCalDe">Última calibração — de</label>
            <input type="date" id="fCalDe">
          </div>
          <div class="field">
            <label for="fCalAte">Última calibração — até</label>
            <input type="date" id="fCalAte">
          </div>
        </div>

        <div style="margin-top:14px;display:flex;gap:9px;flex-wrap:wrap">
          <button class="btn btn-outline btn-sm" data-atalho="vencidos">Vencidos hoje</button>
          <button class="btn btn-outline btn-sm" data-atalho="mes">Vencem neste mês</button>
          <button class="btn btn-outline btn-sm" data-atalho="trimestre">Vencem no trimestre</button>
          <button class="btn btn-outline btn-sm" data-atalho="limpar">Limpar filtros</button>
        </div>
      </div>
    </div>

    <div class="act-bar">
      <div id="contagem" style="font-size:13px;color:var(--muted)">Nenhuma consulta feita ainda.</div>
      <div class="act-group">
        <button class="btn btn-outline" id="btExcel" disabled>Exportar para Excel</button>
        <button class="btn btn-outline" id="btPDF" disabled>Exportar para PDF</button>
        <button class="btn btn-red" id="btGerar" style="min-width:200px">GERAR RELATÓRIO</button>
      </div>
    </div>

    <div id="previa">${htmlVazio('Escolha os filtros e clique em "Gerar relatório".')}</div>`;

  container.querySelector('#btGerar').addEventListener('click', () => gerar(container));
  container.querySelector('#btExcel').addEventListener('click', () => exportarExcel(container));
  container.querySelector('#btPDF').addEventListener('click',  () => exportarPDF(container));

  container.querySelectorAll('[data-atalho]').forEach(b =>
    b.addEventListener('click', () => atalho(container, b.dataset.atalho)));
}

/* ==================================================================== */
function lerFiltros(container){
  const v = id => container.querySelector('#'+id).value || null;
  const status = Array.from(container.querySelectorAll('.fSt:checked')).map(c => c.value);
  return {
    status_efetivo: status,
    familia_id:     v('fFamilia'),
    condicao_fisica:v('fCondicao'),
    tipo:           v('fTipo'),
    proxima_de:     v('fProxDe'),
    proxima_ate:    v('fProxAte'),
    calibracao_de:  v('fCalDe'),
    calibracao_ate: v('fCalAte')
  };
}

/* ---------------------------------------------------------------------
   Descrição legível do recorte.

   Um relatório impresso sem dizer o que foi filtrado é uma lista de
   números sem contexto: quem recebe não tem como saber se está vendo o
   acervo inteiro ou uma fatia. Vai no cabeçalho do PDF e na tela.
   --------------------------------------------------------------------- */
function descreverFiltros(f){
  const partes = [];

  partes.push(f.status_efetivo?.length
    ? 'Situação: ' + f.status_efetivo.map(rotulo).join(', ')
    : 'Situação: todas');

  if (f.familia_id){
    const fam = familias.find(x => x.id === f.familia_id);
    partes.push('Família: ' + (fam ? `${fam.codigo} — ${fam.nome}` : '—'));
  }

  partes.push('Condição física: ' +
    (f.condicao_fisica === 'ativo' ? 'ativos'
     : f.condicao_fisica === 'inativo' ? 'inativos' : 'todas'));

  if (f.tipo) partes.push('Tipo: ' + (f.tipo === 'TMMDE' ? 'TMMDE (uso)' : 'Referência'));

  const faixa = (rot, de, ate) => {
    if (de && ate) return `${rot}: ${fmtData(de)} a ${fmtData(ate)}`;
    if (de)        return `${rot}: a partir de ${fmtData(de)}`;
    if (ate)       return `${rot}: até ${fmtData(ate)}`;
    return null;
  };
  const p = faixa('Próxima calibração', f.proxima_de, f.proxima_ate);
  const c = faixa('Última calibração',  f.calibracao_de, f.calibracao_ate);
  if (p) partes.push(p);
  if (c) partes.push(c);

  /* Título curto: o recorte mais específico é o que nomeia o relatório. */
  let titulo = 'Relatório geral do acervo';
  if (f.status_efetivo?.length === 1) titulo = 'Instrumentos — ' + rotulo(f.status_efetivo[0]);
  else if (f.status_efetivo?.length > 1) titulo = 'Instrumentos por situação';
  if (f.familia_id){
    const fam = familias.find(x => x.id === f.familia_id);
    if (fam) titulo += ' · ' + fam.nome;
  }
  if (f.condicao_fisica === 'inativo') titulo += ' · inativos';

  return { titulo, linha: partes.join('  ·  ') };
}

function atalho(container, qual){
  const set = (id, val) => container.querySelector('#'+id).value = val;
  container.querySelectorAll('.fSt').forEach(c => c.checked = false);
  ['fProxDe','fProxAte','fCalDe','fCalAte'].forEach(id => set(id,''));

  const hoje = new Date();
  const iso = d => d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());

  if (qual === 'vencidos'){
    container.querySelector('.fSt[value="descalibrado"]').checked = true;
  } else if (qual === 'mes'){
    set('fProxDe', iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)));
    set('fProxAte', iso(new Date(hoje.getFullYear(), hoje.getMonth()+1, 0)));
  } else if (qual === 'trimestre'){
    set('fProxDe', hojeISO());
    set('fProxAte', iso(new Date(hoje.getFullYear(), hoje.getMonth()+3, hoje.getDate())));
  } else {
    set('fFamilia',''); set('fTipo',''); set('fCondicao','ativo');
    container.querySelector('#previa').innerHTML = htmlVazio('Escolha os filtros e clique em "Gerar relatório".');
    resultado = []; tabela = null;
    container.querySelector('#btExcel').disabled = true;
    container.querySelector('#btPDF').disabled = true;
    container.querySelector('#contagem').textContent = 'Nenhuma consulta feita ainda.';
    return;
  }
  gerar(container);
}

async function gerar(container){
  const alvo = container.querySelector('#previa');
  alvo.innerHTML = htmlCarregando('Consultando…');
  tabela = null;
  const filtros = lerFiltros(container);
  try {
    resultado = await consultarInstrumentos(filtros);
  } catch (e){
    alvo.innerHTML = `<div class="warn-box e">${esc(msgErro(e))}</div>`;
    return;
  }
  descricao = descreverFiltros(filtros);

  container.querySelector('#contagem').innerHTML =
    `<b style="color:var(--text)">${esc(descricao.titulo)}</b><br>
     <span style="font-size:12px">${esc(descricao.linha)}</span><br>
     <span style="font-size:12px">${resultado.length} instrumento(s) · gerado em ${esc(fmtData(hojeISO()))}</span>`;
  container.querySelector('#btExcel').disabled = !resultado.length;
  container.querySelector('#btPDF').disabled   = !resultado.length;

  if (!resultado.length){
    alvo.innerHTML = htmlVazio('Nenhum instrumento atende a esses filtros.');
    return;
  }

  tabela = criarTabela(alvo, {
    linhas: resultado,
    ordem: { chave:'data_proxima', dir:1 },
    classeLinha: l => classeLinha(l.status_efetivo),
    colunas: [
      { chave:'tag', rotulo:'Tag', classe:'mono', largura:'110px' },
      { chave:'descricao', rotulo:'Descrição' },
      { chave:'familia_nome', rotulo:'Família', largura:'140px' },
      { chave:'tipo', rotulo:'Tipo', largura:'100px' },
      { chave:'status_efetivo', rotulo:'Situação', largura:'170px', html: l => badge(l.status_efetivo) },
      { chave:'condicao_fisica', rotulo:'Condição', largura:'90px' },
      { chave:'ultima_calibracao', rotulo:'Última', largura:'110px', html: l => esc(fmtData(l.ultima_calibracao)) },
      { chave:'data_proxima', rotulo:'Próxima', largura:'110px', html: l => esc(fmtData(l.data_proxima)) },
      { chave:'dias_para_vencer', rotulo:'Vence', classe:'num', largura:'110px',
        valor: l => l.dias_para_vencer, html: l => esc(textoVencimento(l)) },
      { chave:'localizacao_atual', rotulo:'Localização', largura:'150px',
        html: l => esc(l.localizacao_atual || '—') }
    ]
  });
}

/* ==================================================================== */
/* Linhas planas — mesma base para Excel e PDF                          */
/* ==================================================================== */
const CABECALHOS = ['Tag','Descrição','Família','Tipo','Situação','Condição',
                    'Última calibração','Próxima calibração','Vence em','Localização',
                    'Fabricante','Nº de série','Resolução','Entrada'];

function linhasPlanas(){
  const base = tabela ? tabela.linhas : resultado;
  return base.map(i => [
    i.tag, i.descricao, i.familia_nome,
    i.tipo === 'TMMDE' ? 'TMMDE' : 'Referência',
    rotulo(i.status_efetivo),
    i.condicao_fisica === 'ativo' ? 'Ativo' : 'Inativo',
    fmtData(i.ultima_calibracao), fmtData(i.data_proxima), textoVencimento(i),
    i.localizacao_atual || '—', i.fabricante || '—', i.num_serie || '—',
    i.resolucao || '—', fmtData(i.data_entrada)
  ]);
}

function nomeArquivo(ext){
  const d = new Date();
  // O nome do arquivo também carrega o recorte: uma pasta com cinco
  // "Relatorio-Metrologia-20260831.pdf" não ajuda ninguém.
  const recorte = slug(descricao.titulo);
  return `Relatorio-Metrologia-${recorte}-${d.getFullYear()}${p2(d.getMonth()+1)}${p2(d.getDate())}.${ext}`;
}

/* ---- Excel ---------------------------------------------------------- */
async function exportarExcel(container){
  const bt = container.querySelector('#btExcel');
  bt.disabled = true; bt.textContent = 'Gerando…';
  try {
    const XLSX = await lerXLSX();
    const dados = [CABECALHOS, ...linhasPlanas()];
    const aba = XLSX.utils.aoa_to_sheet(dados);
    aba['!cols'] = CABECALHOS.map((c,i) => ({ wch: i === 1 ? 42 : Math.max(12, c.length + 3) }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, aba, 'Metrologia');
    const buf = XLSX.write(wb, { bookType:'xlsx', type:'array' });
    baixarBlob(nomeArquivo('xlsx'),
      new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    toast('Planilha gerada.', 'success');
  } catch (e){ toast('Falha ao gerar a planilha: ' + msgErro(e), 'error'); }
  finally { bt.disabled = false; bt.textContent = 'Exportar para Excel'; }
}

/* ---- PDF ------------------------------------------------------------ */
async function exportarPDF(container){
  const bt = container.querySelector('#btPDF');
  bt.disabled = true; bt.textContent = 'Gerando…';
  try {
    const pdfMake = await lerPDFMake();
    const linhas = linhasPlanas();
    const emitido = new Date();

    // Colunas enxutas: PDF em paisagem ainda tem largura finita.
    const cols = [0,1,2,4,6,7,8,9];
    const cab  = cols.map(i => CABECALHOS[i]);
    const corpo = linhas.map(l => cols.map(i => String(l[i] ?? '—')));

    const doc = {
      pageSize: 'A4',
      pageOrientation: 'landscape',
      // Topo maior: o cabeçalho agora carrega o recorte aplicado, que
      // pode ocupar duas linhas quando há muitos filtros.
      pageMargins: [28, 92, 28, 40],

      header: () => ({
        margin: [28, 16, 28, 0],
        columns: [
          window.LOGO_B64
            ? { image: window.LOGO_B64, width: 104, margin:[0,2,0,0] }
            : { text: CONFIG.EMPRESA, bold:true, fontSize:12 },
          { stack: [
              { text:'RELATÓRIO DE METROLOGIA', bold:true, fontSize:11.5, alignment:'right' },
              // O recorte aplicado é parte do documento: sem ele, ninguém
              // que recebe o PDF sabe se está vendo tudo ou uma fatia.
              { text: descricao.titulo, bold:true, fontSize:9, color:'#C0392B',
                alignment:'right', margin:[0,2,0,0] },
              { text: descricao.linha, fontSize:7, color:'#87827D',
                alignment:'right', margin:[0,2,0,0] },
              { text:`${linhas.length} instrumento(s)  ·  emitido em ${fmtData(hojeISO())} às ${p2(emitido.getHours())}:${p2(emitido.getMinutes())} por ${meuNome()}`,
                fontSize:7, color:'#87827D', alignment:'right', margin:[0,1,0,0] }
            ] }
        ]
      }),

      footer: (pagina, total) => ({
        margin: [28, 8, 28, 0],
        columns: [
          { text:`${CONFIG.EMPRESA}  •  ${CONFIG.DOC_REF}`, fontSize:6.5, italics:true, color:'#AAA5A0' },
          { text:`Página ${pagina} de ${total}`, fontSize:6.5, color:'#AAA5A0', alignment:'right' }
        ]
      }),

      content: [
        { canvas:[{ type:'line', x1:0, y1:0, x2:786, y2:0, lineWidth:0.8, lineColor:'#C0392B' }], margin:[0,0,0,10] },
        {
          table: {
            headerRows: 1,
            widths: ['auto','*','auto','auto','auto','auto','auto','auto'],
            body: [
              cab.map(t => ({ text:t, bold:true, fontSize:7.5, color:'#F0E6E4', fillColor:'#1A1210' })),
              ...corpo.map(l => l.map(c => ({ text:c, fontSize:8 })))
            ]
          },
          layout: {
            hLineWidth: i => i <= 1 ? 0.8 : 0.3,
            vLineWidth: () => 0,
            hLineColor: i => i <= 1 ? '#1A1210' : '#E0DBD5',
            paddingTop: () => 3.5, paddingBottom: () => 3.5,
            fillColor: i => i > 0 && i % 2 === 0 ? '#F8F7F5' : null
          }
        }
      ],
      defaultStyle: { font:'Roboto' }
    };

    pdfMake.createPdf(doc).download(nomeArquivo('pdf'));
    toast('PDF gerado.', 'success');
  } catch (e){
    console.error(e);
    toast('Falha ao gerar o PDF: ' + msgErro(e), 'error');
  } finally { bt.disabled = false; bt.textContent = 'Exportar para PDF'; }
}
