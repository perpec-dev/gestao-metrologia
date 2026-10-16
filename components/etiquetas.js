/* =====================================================================
   ETIQUETAS — o que vai colado no instrumento.

   Três coisas moram aqui, e nenhuma delas fala com o banco:
     1. O CONTEÚDO de cada etiqueta, a partir de uma linha de
        vw_instrumentos_status (regras do documento "Gerador de etiquetas").
     2. A DISTRIBUIÇÃO nas folhas da etiquetadora: posições FIXAS, até 7
        por folha, no arranjo do modelo aprovado pela metrologia.
     3. O DESENHO e a impressão — HTML em milímetros, impresso por um
        iframe com @page do tamanho exato da folha.

   Medidas da folha, das etiquetas e as posições ficam em FOLHA, TAMANHO
   e POSICOES, logo abaixo: trocar o rolo é mudar números aqui.
   ===================================================================== */
import { esc, p2 } from '../utils.js';

/* ---- Medidas, em milímetros ----------------------------------------
   A folha e as posições foram medidas no modelo aprovado (imagem de
   referência da metrologia, 104 mm de largura): três colunas por três
   linhas de etiquetas TMMDE, com as duas primeiras posições da linha de
   cima vazias — é ali que fica a área que a etiquetadora não imprime.
   Sem margens: as posições já dizem onde cada etiqueta cai. */
export const FOLHA = { largura: 104, altura: 72.5 };

/* Paisagem, como nas imagens do modelo. */
export const TAMANHO = {
  TMMDE:      { largura: 30, altura: 20 },
  REFERENCIA: { largura: 40, altura: 15 }
};

/* Ordem de preenchimento: de cima para baixo, da esquerda para a direita.
   TMMDE: exatamente o arranjo do modelo.
   REFERÊNCIA: o modelo não traz folha de referência; o arranjo segue a
   mesma ideia — duas colunas por quatro linhas, a posição de cima à
   esquerda vazia (cairia na área não imprimível), sete etiquetas. */
export const POSICOES = {
  TMMDE: [
                                        { x: 67.6, y:  7.8 },
    { x: 3.4, y: 29.1 }, { x: 34.7, y: 29.1 }, { x: 67.6, y: 29.1 },
    { x: 3.4, y: 50.3 }, { x: 34.7, y: 50.3 }, { x: 67.6, y: 50.3 }
  ],
  REFERENCIA: [
                         { x: 51.3, y:  7.8 },
    { x: 9.8, y: 23.6 }, { x: 51.3, y: 23.6 },
    { x: 9.8, y: 39.4 }, { x: 51.3, y: 39.4 },
    { x: 9.8, y: 55.2 }, { x: 51.3, y: 55.2 }
  ]
};

/* ==================================================================== */
/* 1. CONTEÚDO                                                          */
/* ==================================================================== */

/** timestamptz -> 'AAAA-MM-DD' no fuso de quem imprime. */
function dataLocal(v){
  const d = new Date(v);
  return isNaN(d) ? null : d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}

/**
 * O que a etiqueta diz. Regras do documento:
 *   · referência            -> só a tag;
 *   · em standby            -> tag + quadrado cheio, SEM datas;
 *   · saiu do standby       -> tag + quadrado cheio, calibração = data de
 *                              saída do standby, validade contada dela;
 *   · sem standby           -> tag + calibração + validade, quadrado vazio.
 * A validade já vem contada da saída: calcular_data_proxima usa a maior
 * entre a calibração e o início do relógio.
 */
export function conteudoEtiqueta(i){
  if (i.tipo === 'REFERENCIA') return { id: i.id, tipo: 'REFERENCIA', tag: i.tag };

  const base = { id: i.id, tipo: 'TMMDE', tag: i.tag };
  if (i.standby && !i.data_inicio_relogio)
    return { ...base, caso: 'standby', standby: true, calibracao: null, validade: null };
  if (i.standby)
    return { ...base, caso: 'saiu_standby', standby: true,
             calibracao: dataLocal(i.data_inicio_relogio), validade: i.data_proxima };
  return { ...base, caso: 'normal', standby: false,
           calibracao: i.ultima_calibracao, validade: i.data_proxima };
}

/**
 * Por que este instrumento NÃO recebe etiqueta — ou null, se recebe.
 * Etiqueta é afirmação de calibração válida colada no instrumento:
 * imprimir uma com data vencida, ou para um instrumento declarado
 * descalibrado, seria pôr no chão de fábrica uma prova falsa.
 */
export function motivoSemEtiqueta(i, hoje){
  if (i.condicao_fisica === 'inativo') return 'Inativo';
  if (i.tipo === 'REFERENCIA') return null;
  if (!i.calibracao_id) return 'Sem calibração registrada';
  if (i.status_efetivo === 'descalibrado') return 'Descalibrado';
  if (i.standby && !i.data_inicio_relogio) return null;       // standby: sem datas, mas válido
  if (!i.data_proxima) return 'Sem data de validade';
  if (i.data_proxima < hoje) return 'Calibração vencida';
  return null;
}

const MESES = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];

/** 'AAAA-MM-DD' -> 'DD/MM/AA', como no modelo. */
export const fmtCalibracao = iso =>
  iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(2, 4) : '';

/** Validade como no modelo — "ABR/2027" — quando ela cai no último dia
    do mês, o controle mensal de vencimento. Se não cair, a data inteira:
    "FEV/2027" para quem vence em 17/02 prometeria validade até o fim do
    mês, que o instrumento não tem. */
export function fmtValidade(iso){
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  const ultimo = new Date(a, m, 0).getDate();
  return d === ultimo ? MESES[m - 1] + '/' + a : fmtCalibracao(iso);
}

/** Uma linha de texto para a lista de seleção. */
export function resumoEtiqueta(c){
  if (c.tipo === 'REFERENCIA') return 'Só a tag';
  if (c.caso === 'standby') return 'Standby ■ · sem datas';
  const datas = `Cal. ${fmtCalibracao(c.calibracao)} · Val. ${fmtValidade(c.validade)}`;
  return c.caso === 'saiu_standby' ? datas + ' · Standby ■' : datas;
}

/* ==================================================================== */
/* 2. DISTRIBUIÇÃO NAS FOLHAS                                           */
/*                                                                      */
/* Uma classificação por folha: as posições de TMMDE e de referência    */
/* não se encaixam umas nas outras. TMMDE primeiro, depois referência,  */
/* cada folha preenchida na ordem de POSICOES.                          */
/* ==================================================================== */

/**
 * Conteúdos -> folhas. Cada folha é { tipo, etiquetas: [{ c, x, y }] },
 * em mm, medidos do canto superior esquerdo da folha.
 */
export function distribuir(conteudos){
  const folhas = [];
  for (const tipo of ['TMMDE', 'REFERENCIA']){
    const fila = conteudos.filter(c => c.tipo === tipo);
    const pos = POSICOES[tipo];
    for (let i = 0; i < fila.length; i += pos.length)
      folhas.push({ tipo, etiquetas: fila.slice(i, i + pos.length).map((c, k) => ({ c, ...pos[k] })) });
  }
  return folhas;
}

/* ==================================================================== */
/* 3. DESENHO E IMPRESSÃO                                               */
/* ==================================================================== */

/* A logo é o PNG oficial (logo.js), recortado para mostrar só o símbolo
   e "PERPEC" — o "OILFIELD SUPPLY" de baixo não cabe na etiqueta. O
   recorte é por CSS, em proporção da largura: no PNG de 3154 × 845 px, a
   linha do PERPEC vai de y = 60 a y = 525. */
const LOGO_TOPO = 60 / 3154, LOGO_ALTURA = 465 / 3154;

function cssLogo(seletor, larguraMm){
  return `${seletor}{width:${larguraMm}mm;height:${(larguraMm * LOGO_ALTURA).toFixed(2)}mm;` +
         `background-position:0 -${(larguraMm * LOGO_TOPO).toFixed(2)}mm}`;
}

/** CSS das etiquetas e da folha. Serve à prévia na tela e à impressão. */
export function cssEtiquetas(){
  const logo = window.LOGO_B64 ? `background-image:url("${window.LOGO_B64}");` : '';
  return `
.etq-folha{position:relative;width:${FOLHA.largura}mm;height:${(FOLHA.altura - 0.2).toFixed(1)}mm;
  overflow:hidden;background:#fff}
.etq-conteudo{position:absolute;left:0;top:0;width:${FOLHA.largura}mm;height:${FOLHA.altura}mm}
.etq,.etq *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.etq{position:absolute;overflow:hidden;background:#000;border-radius:1.6mm;padding:.45mm;
  display:flex;flex-direction:column;gap:.4mm;color:#000;
  font-family:Arial,Helvetica,sans-serif;font-weight:800;line-height:1}
.etq-t{width:${TAMANHO.TMMDE.largura}mm;height:${TAMANHO.TMMDE.altura}mm}
.etq-r{width:${TAMANHO.REFERENCIA.largura}mm;height:${TAMANHO.REFERENCIA.altura}mm}
.etq-cab{background:#fff;border-radius:1.2mm 1.2mm .3mm .3mm;display:flex;align-items:center;flex:0 0 auto}
.etq-t .etq-cab{height:5.6mm;padding:0 .8mm 0 .9mm;justify-content:space-between}
.etq-r .etq-cab{height:5.3mm;justify-content:center}
.etq-logo{${logo}background-repeat:no-repeat;background-size:100% auto}
${cssLogo('.etq-t .etq-logo', 18)}
${cssLogo('.etq-r .etq-logo', 24)}
.etq-logo-txt{font-size:3mm;letter-spacing:.3mm}
.etq-sb{display:flex;flex-direction:column;align-items:center;gap:.3mm}
.etq-sb-q{width:2.5mm;height:2.5mm;border:.32mm solid #000;background:#fff}
.etq-sb-q.cheio{background:#000}
.etq-sb-t{font-size:1.15mm;letter-spacing:.02mm}
.etq-linha{background:#fff;border-radius:.9mm;display:flex;align-items:center;gap:.6mm;
  padding:0 .7mm;flex:1 1 0;min-height:0;white-space:nowrap;overflow:hidden}
.etq-k{font-size:1.5mm;flex:0 0 auto}
.etq-v{flex:1 1 auto;text-align:center;overflow:hidden}
.etq-r .etq-linha{flex:0 0 4.3mm}
.etq-r .etq-k{font-size:1.9mm}
.etq-rodape{flex:1 1 0;display:flex;align-items:center;justify-content:center;gap:.9mm;
  color:#fff;font-size:1.75mm;letter-spacing:.03mm;white-space:nowrap}
.etq-rodape svg{width:2.4mm;height:2.4mm;flex:0 0 auto}
.etq-barra{width:.25mm;height:2.6mm;background:#fff}
.etq-vaga{position:absolute;box-sizing:border-box;border:.25mm dashed #CFC8BF;border-radius:1.6mm;
  pointer-events:none}`;
}

/** Tamanho da fonte (mm) para o texto caber em `larguraMm`. */
const fonte = (texto, larguraMm, maximo) =>
  Math.min(maximo, larguraMm / (Math.max(String(texto).length, 1) * 0.66)).toFixed(2);

const htmlLogo = () => window.LOGO_B64
  ? '<div class="etq-logo"></div>' : '<span class="etq-logo-txt">PERPEC</span>';

const CRUZ = `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4">
  <circle cx="12" cy="12" r="8"/><path d="M12 1v22M1 12h22"/></svg>`;

const mm = v => Number(v).toFixed(2) + 'mm';

function htmlEtiqueta(c, x, y){
  const pos = `left:${mm(x)};top:${mm(y)}`;

  if (c.tipo === 'REFERENCIA') return `
    <div class="etq etq-r" style="${pos}">
      <div class="etq-cab">${htmlLogo()}</div>
      <div class="etq-linha"><span class="etq-k">TAG:</span>
        <span class="etq-v" style="font-size:${fonte(c.tag, 31, 2.9)}mm">${esc(c.tag)}</span></div>
      <div class="etq-rodape">${CRUZ}<span class="etq-barra"></span>INSTRUMENTO DE REFERÊNCIA</div>
    </div>`;

  const cal = fmtCalibracao(c.calibracao), val = fmtValidade(c.validade);
  return `
    <div class="etq etq-t" style="${pos}">
      <div class="etq-cab">${htmlLogo()}
        <div class="etq-sb"><div class="etq-sb-q${c.standby ? ' cheio' : ''}"></div>
          <div class="etq-sb-t">STANDBY</div></div>
      </div>
      <div class="etq-linha"><span class="etq-k">TAG:</span>
        <span class="etq-v" style="font-size:${fonte(c.tag, 22, 2.6)}mm">${esc(c.tag)}</span></div>
      <div class="etq-linha"><span class="etq-k">Calibração:</span>
        <span class="etq-v" style="font-size:${fonte(cal, 16.5, 2.4)}mm">${esc(cal)}</span></div>
      <div class="etq-linha"><span class="etq-k">Validade:</span>
        <span class="etq-v" style="font-size:${fonte(val, 18.5, 2.4)}mm">${esc(val)}</span></div>
    </div>`;
}

/**
 * Folhas -> HTML. `guias` desenha as posições vagas (só na prévia: mostra
 * onde caem as próximas). `ajuste` desloca tudo em mm — compensa a
 * etiquetadora que puxa o papel um pouco torto.
 */
export function htmlFolhas(folhas, { guias = false, ajuste = { x: 0, y: 0 } } = {}){
  const desloca = `transform:translate(${Number(ajuste.x) || 0}mm,${Number(ajuste.y) || 0}mm)`;
  return folhas.map(f => {
    const { largura, altura } = TAMANHO[f.tipo];
    const vagas = guias ? POSICOES[f.tipo].slice(f.etiquetas.length).map(p =>
      `<div class="etq-vaga" style="left:${mm(p.x)};top:${mm(p.y)};width:${mm(largura)};height:${mm(altura)}"></div>`
    ).join('') : '';
    return `
      <div class="etq-folha">
        <div class="etq-conteudo" style="${desloca}">${vagas}${
          f.etiquetas.map(e => htmlEtiqueta(e.c, e.x, e.y)).join('')}</div>
      </div>`;
  }).join('');
}

/**
 * Imprime por um iframe invisível: a página de impressão tem @page do
 * tamanho exato da folha e margem zero (o que também some com cabeçalho
 * e rodapé do navegador).
 */
export async function imprimirEtiquetas(folhas, ajuste){
  const ifr = document.createElement('iframe');
  ifr.setAttribute('aria-hidden', 'true');
  ifr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(ifr);

  const doc = ifr.contentDocument;
  doc.open();
  doc.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Etiquetas</title>
    <style>
      @page{size:${FOLHA.largura}mm ${FOLHA.altura}mm;margin:0}
      html,body{margin:0;padding:0;background:#fff}
      ${cssEtiquetas()}
      .etq-folha{break-after:page}
      .etq-folha:last-child{break-after:auto}
    </style></head><body>${htmlFolhas(folhas, { ajuste })}</body></html>`);
  doc.close();

  // A logo é fundo em CSS: espera ela decodificar, senão a primeira
  // folha pode sair sem ela.
  if (window.LOGO_B64){
    const img = new Image();
    img.src = window.LOGO_B64;
    try { await img.decode(); } catch (e){ /* imprime sem esperar */ }
  }
  try { await doc.fonts?.ready; } catch (e){ /* idem */ }
  await new Promise(r => setTimeout(r, 300));

  const w = ifr.contentWindow;
  w.addEventListener('afterprint', () => setTimeout(() => ifr.remove(), 500), { once: true });
  setTimeout(() => { if (ifr.isConnected) ifr.remove(); }, 120000);
  w.focus();
  w.print();
}
