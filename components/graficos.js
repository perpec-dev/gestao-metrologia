/* =====================================================================
   Gráficos em SVG puro. Sem biblioteca, sem canvas, sem dependência.

   Regras seguidas (design system de visualização):
     · marcas finas, grade e eixos em fio de cabelo, muito respiro;
     · vão de 2px entre marcas vizinhas, nunca uma borda para separar;
     · legenda sempre presente quando há 2 ou mais séries, e rótulo
       direto só onde ele cabe — nunca um número em cada ponto;
     · um eixo só. Nunca duas escalas no mesmo gráfico (por isso o
       Pareto desenha o acumulado em CONTAGEM, não em percentual);
     · toda leitura possível sem depender de cor: cada gráfico tem uma
       tabela-gêmea embutida, aberta por um clique.
   ===================================================================== */
import { esc, animarNumero } from '../utils.js';

const nfmt = n => new Intl.NumberFormat('pt-BR').format(n);
const pct  = (v, t) => t ? Math.round(v / t * 100) : 0;

/* Coordenada polar -> cartesiana. 180° = esquerda, 270° = topo, 360° = direita. */
function ponto(cx, cy, r, grau){
  const a = (grau * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arco(cx, cy, r, de, ate){
  const [x1, y1] = ponto(cx, cy, r, de);
  const [x2, y2] = ponto(cx, cy, r, ate);
  const grande = Math.abs(ate - de) > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${grande} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/* Retângulo com o topo arredondado e a base fixa na linha de referência. */
function barraV(x, y, larg, alt, raio = 4){
  const r = Math.min(raio, larg / 2, Math.max(alt, 0));
  if (alt <= 0.5) return '';
  return `M ${x} ${y + alt} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y}
          L ${x + larg - r} ${y} Q ${x + larg} ${y} ${x + larg} ${y + r}
          L ${x + larg} ${y + alt} Z`.replace(/\s+/g, ' ');
}

/* Retângulo deitado, com a ponta direita arredondada e a base fixa no
   eixo da esquerda — o espelho de barraV para barras horizontais. */
function barraH(x, y, larg, alt, raio = 4){
  const r = Math.min(raio, alt / 2, Math.max(larg, 0));
  if (larg <= 0.5) return '';
  return `M ${x} ${y} L ${x + larg - r} ${y} Q ${x + larg} ${y} ${x + larg} ${y + r}
          L ${x + larg} ${y + alt - r} Q ${x + larg} ${y + alt} ${x + larg - r} ${y + alt}
          L ${x} ${y + alt} Z`.replace(/\s+/g, ' ');
}

/* ---------------------------------------------------------------------
   Dica flutuante — o mesmo elemento serve os quatro gráficos.
   Tooltip nunca é o único caminho para um valor: a tabela-gêmea existe.
   --------------------------------------------------------------------- */
function ligarDica(raiz){
  const dica = document.createElement('div');
  dica.className = 'g-dica';
  raiz.appendChild(dica);

  raiz.addEventListener('mousemove', e => {
    const alvo = e.target.closest('[data-dica]');
    if (!alvo){ dica.classList.remove('on'); return; }
    const r = raiz.getBoundingClientRect();
    dica.innerHTML = alvo.dataset.dica;
    dica.style.left = (e.clientX - r.left) + 'px';
    dica.style.top  = (e.clientY - r.top)  + 'px';
    dica.classList.add('on');
  });
  raiz.addEventListener('mouseleave', () => dica.classList.remove('on'));
  return dica;
}

function tabelaGemea(colunas, linhas){
  return `<details class="g-tabela"><summary>Ver os números em tabela</summary>
    <table><thead><tr>${colunas.map((c,i) =>
      `<th${i ? ' class="num"' : ''}>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${linhas.map(l => `<tr>${l.map((v,i) =>
      `<td${i ? ' class="num"' : ''}>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></details>`;
}

const cartao = (titulo, sub, corpo) => `
  <div class="card">
    <div class="card-head"><h2>${esc(titulo)}</h2></div>
    <div class="card-body">
      ${sub ? `<div class="g-sub" style="margin:-4px 0 14px">${esc(sub)}</div>` : ''}
      ${corpo}
    </div>
  </div>`;

/* =====================================================================
   1. ARCO DE SITUAÇÃO  (rosca aberta, meia-lua)

   Por que meia-lua e não rosca fechada: numa rosca fechada o último
   segmento encosta no primeiro, e no semáforo isso põe VERDE colado no
   VERMELHO — ΔE 4,2 sob deuteranopia, reprovado pelo validador. O arco
   aberto tem adjacência linear: usa a ordem já validada (ΔE 21,4).
   ===================================================================== */
export function arcoSituacao(el, { segmentos, total, rotuloCentro = 'ativos' }){
  const L = 340, A = 196, cx = L/2, cy = 168;
  const rC = 112, espessura = 30;      // rC = raio da linha de centro do anel
  const soma = segmentos.reduce((s, d) => s + d.valor, 0) || 1;
  // A porcentagem é sempre sobre o acervo ativo — a mesma base dos três
  // gráficos, para que os números possam ser comparados entre eles.
  const base = total || soma;

  // Vão de 2px entre segmentos, convertido para graus no raio de centro.
  const vaoGrau = (2 / rC) * (180 / Math.PI);
  const usaveis = segmentos.filter(d => d.valor > 0);
  const totalVao = usaveis.length > 1 ? vaoGrau * usaveis.length : 0;
  const disponivel = 180 - totalVao;

  let ang = 180, marcas = '', i = 0;
  for (const d of usaveis){
    const larg = (d.valor / soma) * disponivel;
    const dica = `${esc(d.rotulo)}: ${pct(d.valor, base)}%` +
                 `<span class="l2">${nfmt(d.valor)} de ${nfmt(base)} instrumentos ativos</span>`;
    // pathLength="100" normaliza o traço: o mesmo keyframe desenha
    // qualquer arco, de qualquer tamanho, no mesmo tempo.
    marcas += `<path class="g-marca g-traco" d="${arco(cx, cy, rC, ang, ang + larg)}"
                 pathLength="100" stroke="${d.cor}" stroke-width="${espessura}" fill="none"
                 stroke-linecap="butt" style="animation-delay:${(i * 90)}ms"
                 data-dica="${dica}"><title>${esc(d.rotulo)}: ${nfmt(d.valor)}</title></path>`;
    ang += larg + vaoGrau;
    i++;
  }

  if (!usaveis.length){
    marcas = `<path d="${arco(cx, cy, rC, 180, 360)}" stroke="var(--grid)"
                stroke-width="${espessura}" fill="none"/>`;
  }

  const legenda = segmentos.map(d => `
    <div class="item">
      <span class="sw" style="background:${d.cor}"></span>
      <span>${esc(d.rotulo)}</span>
      <span class="qtd">${nfmt(d.valor)}</span>
    </div>`).join('');

  el.innerHTML = cartao('Situação do acervo',
    'Distribuição dos instrumentos ativos pela situação calculada agora.',
    `<div class="grafico">
       <svg viewBox="0 0 ${L} ${A}" role="img"
            aria-label="Distribuição dos instrumentos por situação">
         ${marcas}
         <text class="g-hero" x="${cx}" y="${cy - 14}" text-anchor="middle">${nfmt(total)}</text>
         <text class="g-hero-sub" x="${cx}" y="${cy + 6}" text-anchor="middle">${esc(rotuloCentro)}</text>
       </svg>
       <div class="g-legenda colunas">${legenda}</div>
       ${tabelaGemea(['Situação','Instrumentos','% do ativo'],
          segmentos.map(d => [d.rotulo, nfmt(d.valor), pct(d.valor, base) + '%']))}
     </div>`);

  animarNumero(el.querySelector('.g-hero'), total, 720);
  ligarDica(el.querySelector('.grafico'));
}

/* =====================================================================
   2. BARRAS — carga de calibração dos próximos meses
   Série única: uma cor só. Colorir cada barra de um tom diferente
   duplicaria a informação que a altura já dá.
   ===================================================================== */
export function barrasVencimento(el, { meses, totalAtivos = 0 }){
  const L = 360, A = 200;
  /* mE é a CALHA da escala, não uma margem decorativa: os números do
     eixo moram nela, fora da área de plotagem. Antes o rótulo era
     desenhado dentro do gráfico, encostado na esquerda — e a primeira
     barra passava por cima dele, escondendo justamente o mês corrente. */
  const mE = 30, mD = 8, mT = 22, mB = 34;
  const larguraPlot = L - mE - mD, alturaPlot = A - mT - mB;
  const max = Math.max(1, ...meses.map(m => m.valor));
  // Teto "redondo" para a grade não cair em número quebrado.
  const passo = Math.max(1, Math.ceil(max / 3));
  const teto  = passo * 3;

  const faixa = larguraPlot / meses.length;
  const larguraBarra = Math.min(38, faixa - 14);

  const grade = [0,1,2,3].map(i => {
    const v = passo * i;
    const y = mT + alturaPlot - (v / teto) * alturaPlot;
    // Número alinhado à direita na calha e centrado na própria linha da
    // grade: é a linha que ele nomeia, não o espaço acima dela.
    return `<line class="${i ? 'g-grid' : 'g-base'}" x1="${mE}" y1="${y}" x2="${L-mD}" y2="${y}"/>
            <text class="g-eixo" x="${mE - 7}" y="${y + 3.5}" text-anchor="end">${i ? nfmt(v) : ''}</text>`;
  }).join('');

  const barras = meses.map((m, i) => {
    const alt = (m.valor / teto) * alturaPlot;
    const x = mE + faixa * i + (faixa - larguraBarra) / 2;
    const y = mT + alturaPlot - alt;
    const dica = `${esc(m.rotuloLongo || m.rotulo)}: ${pct(m.valor, totalAtivos)}%` +
                 `<span class="l2">${nfmt(m.valor)} a calibrar, de ${nfmt(totalAtivos)} sob controle de calibração</span>`;
    return `
      <g data-dica="${dica}">
        <rect class="g-alvo" x="${mE + faixa*i}" y="${mT}" width="${faixa}" height="${alturaPlot}"/>
        ${m.valor > 0
          ? `<path class="g-marca g-barra" d="${barraV(x, y, larguraBarra, alt)}"
                   fill="${m.cor || 'var(--serie)'}" style="animation-delay:${i * 70}ms"/>`
          : ''}
        ${m.valor > 0
          ? `<text class="g-valor" x="${x + larguraBarra/2}" y="${y - 6}" text-anchor="middle"
                   style="animation-delay:${340 + i * 70}ms">${nfmt(m.valor)}</text>`
          : ''}
        <text class="g-eixo" x="${mE + faixa*i + faixa/2}" y="${A - mB + 16}" text-anchor="middle">${esc(m.rotulo)}</text>
      </g>`;
  }).join('');

  el.innerHTML = cartao('Carga de calibração por mês',
    'Quantos instrumentos vencem em cada um dos próximos seis meses. Serve para negociar agenda com o laboratório.',
    `<div class="grafico">
       <svg viewBox="0 0 ${L} ${A}" role="img" aria-label="Instrumentos a vencer por mês">
         ${grade}${barras}
       </svg>
       ${tabelaGemea(['Mês','A calibrar','% sob controle'],
          meses.map(m => [m.rotuloLongo || m.rotulo, nfmt(m.valor), pct(m.valor, totalAtivos) + '%']))}
     </div>`);

  ligarDica(el.querySelector('.grafico'));
}

/* =====================================================================
   3. INATIVOS — quanto do acervo está fora de uso, e por quê

   Duas perguntas numa carta só, porque uma não vale sem a outra:
   "12% do acervo está inativo" é um número que assusta ou tranquiliza
   dependendo do motivo — 12% aguardando manutenção é fila de trabalho,
   12% não encontrado é problema de controle patrimonial.

   Barras DEITADAS de propósito: o rótulo é texto de tamanho variável
   ("Necessário manutenção", "Não encontrado") e, na vertical, viraria
   texto inclinado ou abreviado. Deitado, cada nome é lido na horizontal,
   do jeito que se lê qualquer outra coisa.

   Série única, cor única: a altura (aqui, o comprimento) já carrega a
   informação, e pintar cada motivo de uma cor inventaria seis
   significados novos no semáforo que a aplicação já tem.
   ===================================================================== */
export function motivosInativos(el, { motivos, inativos = 0, acervo = 0 }){
  const percentual = pct(inativos, acervo);

  if (!inativos){
    el.innerHTML = cartao('Instrumentos inativos',
      'Quanto do acervo está fora de uso, e por qual motivo.',
      `<div class="warn-box g" style="margin:0">Nenhum instrumento inativo.
        Todo o acervo está em uso.</div>`);
    return;
  }

  const dados = motivos.filter(m => m.valor > 0)
                       .sort((a,b) => b.valor - a.valor)
                       .slice(0, 8);
  const max = Math.max(1, ...dados.map(m => m.valor));

  const L = 360, mE = 128, mD = 30, mT = 6, mB = 6, fila = 26, altura = 15;
  const A = mT + dados.length * fila + mB;
  const plot = L - mE - mD;

  const barras = dados.map((m, i) => {
    const y = mT + i * fila;
    const larg = (m.valor / max) * plot;
    const dica = `${esc(m.rotulo)}: ${pct(m.valor, inativos)}% dos inativos` +
                 `<span class="l2">${nfmt(m.valor)} instrumento(s) · ${pct(m.valor, acervo)}% do acervo</span>`;
    return `
      <g data-dica="${dica}">
        <rect class="g-alvo" x="0" y="${y}" width="${L}" height="${fila}"/>
        <text class="g-eixo" x="${mE - 8}" y="${y + altura - 3}" text-anchor="end">${esc(m.rotulo)}</text>
        <path class="g-marca" d="${barraH(mE, y + 2, larg, altura)}"
              fill="var(--serie)" style="animation-delay:${i * 60}ms"/>
        <text class="g-valor" x="${mE + larg + 6}" y="${y + altura - 3}"
              style="animation-delay:${300 + i * 60}ms">${nfmt(m.valor)}</text>
      </g>`;
  }).join('');

  el.innerHTML = cartao('Instrumentos inativos',
    'Quanto do acervo está fora de uso, e por qual motivo. A porcentagem é sobre o acervo inteiro — ativos e inativos.',
    `<div class="grafico">
       <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:14px">
         <span class="g-hero-num"><span data-num>${percentual}</span>%</span>
         <span class="g-sub">${nfmt(inativos)} de ${nfmt(acervo)} instrumentos do acervo
           estão inativos</span>
       </div>
       <svg viewBox="0 0 ${L} ${A}" role="img"
            aria-label="Instrumentos inativos por motivo">${barras}</svg>
       ${tabelaGemea(['Motivo','Instrumentos','% dos inativos','% do acervo'],
          dados.map(m => [m.rotulo, nfmt(m.valor),
                          pct(m.valor, inativos) + '%', pct(m.valor, acervo) + '%']))}
     </div>`);

  animarNumero(el.querySelector('[data-num]'), percentual, 700);
  ligarDica(el.querySelector('.grafico'));
}

/* =====================================================================
   4. PARETO — onde as pendências se concentram

   Um eixo só: as barras são contagem por família e a linha é a
   contagem ACUMULADA, na mesma escala. O percentual aparece como
   rótulo, não como segundo eixo — duas escalas num gráfico inventam
   uma correlação que não existe no dado.
   ===================================================================== */
export function pareto(el, { familias, totalAtivos = 0 }){
  const dados = familias.filter(f => f.valor > 0).sort((a,b) => b.valor - a.valor).slice(0, 8);
  const total = dados.reduce((s,f) => s + f.valor, 0);

  if (!total){
    el.innerHTML = cartao('Concentração das pendências', '',
      `<div class="warn-box g" style="margin:0">Nenhuma pendência de calibração no acervo.
        Não há o que priorizar.</div>`);
    return;
  }

  const L = 360, A = 210;
  const mE = 10, mD = 10, mT = 20, mB = 46;
  const larguraPlot = L - mE - mD, alturaPlot = A - mT - mB;
  const faixa = larguraPlot / dados.length;
  const larguraBarra = Math.min(34, faixa - 12);
  const yDe = v => mT + alturaPlot - (v / total) * alturaPlot;

  let acumulado = 0;
  const pontos = [];
  const barras = dados.map((f, i) => {
    acumulado += f.valor;
    const cx = mE + faixa * i + faixa / 2;
    pontos.push({ x: cx, y: yDe(acumulado), acc: acumulado, f });
    const alt = (f.valor / total) * alturaPlot;
    const x = cx - larguraBarra / 2;
    const dica = `${esc(f.rotulo)}: ${pct(f.valor, totalAtivos)}% do que está sob controle` +
                 `<span class="l2">${nfmt(f.valor)} pendente(s) · ${pct(acumulado, total)}% do total de pendências, acumulado</span>`;
    return `
      <g data-dica="${dica}">
        <rect class="g-alvo" x="${mE + faixa*i}" y="${mT}" width="${faixa}" height="${alturaPlot}"/>
        <path class="g-marca g-barra" d="${barraV(x, yDe(f.valor), larguraBarra, alt)}"
              fill="var(--serie)" style="animation-delay:${i * 70}ms"/>
        <text class="g-eixo" x="${cx}" y="${A - mB + 15}" text-anchor="middle">${esc(f.sigla)}</text>
      </g>`;
  }).join('');

  const linha = pontos.map((p,i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  // Rótulo direto só no ponto que cruza 80% — o resto fica na dica e na tabela.
  const cruza = pontos.find(p => p.acc / total >= 0.8) || pontos[pontos.length - 1];

  const marcadores = pontos.map((p, k) => `
    <circle class="g-ponto" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5"
            fill="var(--serie-2)" stroke="var(--surface)" stroke-width="2"
            style="animation-delay:${500 + k * 45}ms"/>`).join('');

  el.innerHTML = cartao('Concentração das pendências',
    'Famílias com instrumentos descalibrados ou vencendo. A linha é o acumulado — atacar as primeiras barras resolve a maior parte.',
    `<div class="grafico">
       <svg viewBox="0 0 ${L} ${A}" role="img"
            aria-label="Pendências de calibração por família, com acumulado">
         <line class="g-base" x1="${mE}" y1="${mT + alturaPlot}" x2="${L - mD}" y2="${mT + alturaPlot}"/>
         ${barras}
         <path class="g-traco" d="${linha}" pathLength="100" fill="none" stroke="var(--serie-2)"
               stroke-width="2" stroke-linejoin="round" stroke-linecap="round"
               style="animation-delay:.28s"/>
         ${marcadores}
         <text class="g-valor" x="${cruza.x}" y="${cruza.y - 12}" text-anchor="middle"
               fill="var(--serie-2)" style="animation-delay:.72s">${pct(cruza.acc, total)}%</text>
       </svg>
       <div class="g-legenda">
         <div class="item"><span class="sw" style="background:var(--serie)"></span>Pendências da família</div>
         <div class="item"><span class="sw linha" style="background:var(--serie-2)"></span>Acumulado</div>
       </div>
       ${tabelaGemea(['Família','Pendentes','% sob controle','Acumulado','% acumulado'],
          pontos.map(p => [p.f.rotulo, nfmt(p.f.valor), pct(p.f.valor, totalAtivos)+'%',
                           nfmt(p.acc), pct(p.acc, total)+'%']))}
     </div>`);

  ligarDica(el.querySelector('.grafico'));
}
