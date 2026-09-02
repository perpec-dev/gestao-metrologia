/* =====================================================================
   Situação e cor num só lugar.

   Nunca decida cor no meio do render. Cartão, tabela, contador de aba,
   painel, gráfico, Excel e PDF consomem esta tabela — se um status
   mudar de cor, muda aqui e muda em todo lugar.
   ===================================================================== */
import { esc } from '../utils.js';

export const STATUS = {
  calibrado: {
    rotulo:'Calibrado',                cor:'#2E7D32', fundo:'#EDF6EE',
    ajuda:'Dentro do prazo de validade da calibração.' },
  proximo_vencimento: {
    rotulo:'Próximo do vencimento',    cor:'#B7791F', fundo:'#FDF6E7',
    ajuda:'Vence dentro da janela de alerta configurada.' },
  descalibrado: {
    rotulo:'Descalibrado',             cor:'#C0392B', fundo:'#FDEEEC',
    ajuda:'Vencido, sem calibração registrada ou marcado como descalibrado.' },
  solicitado: {
    rotulo:'Calibração solicitada',    cor:'#3D5AC0', fundo:'#EEF1FD',
    ajuda:'Calibração já pedida, instrumento ainda na empresa.' },
  em_calibracao_externa: {
    rotulo:'Em calibração externa',    cor:'#6D4AAE', fundo:'#F3EFFB',
    ajuda:'Instrumento em laboratório externo.' },
  standby_pausado: {
    rotulo:'Standby (relógio parado)', cor:'#6A7480', fundo:'#F2F4F6',
    ajuda:'Calibrado e guardado sem uso: a validade só começa a contar na primeira saída.' },
  referencia: {
    rotulo:'Referência',               cor:'#1F7A8C', fundo:'#E9F4F6',
    ajuda:'Padrão de aferição: cadastro de rastreabilidade, sem exigência de calibração periódica.' }
};

/** Ordem de leitura na interface: do mais urgente ao resolvido. */
export const ORDEM_STATUS = [
  'descalibrado','proximo_vencimento','em_calibracao_externa',
  'solicitado','standby_pausado','calibrado','referencia'
];

/** Situações que existem só para instrumento sob controle de calibração. */
export const ORDEM_STATUS_TMMDE = ORDEM_STATUS.filter(s => s !== 'referencia');

/* ---------------------------------------------------------------------
   Ordem dos segmentos em gráfico.

   NÃO é a mesma da interface, e a diferença não é estética.
   Rodando o validador do design system (OKLab ΔE, simulação de daltonismo
   Machado 2009, superfície #FFFFFF) sobre estes seis tons:

     · a ordem da interface põe azul (#3D5AC0) ao lado de roxo (#6D4AAE):
       ΔE 7,9 em visão normal e 3,2 sob deuteranopia — reprovado.
     · a ordem abaixo separa esse par: ΔE 24,3 normal e 21,4 deuteranopia.
     · standby (#6A7480) fica FORA: croma 0,022, muito abaixo do piso de
       0,10. Como cinza ele é um ótimo rótulo e um péssimo segmento —
       nos gráficos ele entra somado a "calibrado", que é o que ele é:
       um instrumento válido com o relógio parado.

   Antes de mexer nesta ordem, rode o validador de novo.
   --------------------------------------------------------------------- */
export const ORDEM_GRAFICO = [
  'descalibrado','em_calibracao_externa','proximo_vencimento','solicitado','calibrado'
];

/** Status que permitem empréstimo (a trava definitiva está no banco).
    'referencia' entra porque o padrão de aferição não tem validade a
    vencer — cobrar calibração em dia dele seria cobrar uma regra que a
    própria classificação dispensa. */
export const PODE_EMPRESTAR = ['calibrado','standby_pausado','referencia'];

export const meta   = s => STATUS[s] || { rotulo: s || '—', cor:'#807C74', fundo:'#F1EFEB', ajuda:'' };
export const rotulo = s => meta(s).rotulo;
export const cor    = s => meta(s).cor;

/** Ponto colorido + rótulo. A cor nunca carrega o significado sozinha. */
export function badge(status){
  const m = meta(status);
  return `<span class="bdg s-${esc(status)}" title="${esc(m.ajuda)}">${esc(m.rotulo)}</span>`;
}

export function badgeCondicao(condicao){
  return condicao === 'inativo'
    ? '<span class="bdg s-inativo">Inativo</span>'
    : '<span class="bdg s-ativo">Ativo</span>';
}

export const classeLinha = status => 'l-' + status;

export function legenda(statusList = ORDEM_STATUS){
  return `<div class="legenda">` + statusList.map(s => {
    const m = meta(s);
    return `<span title="${esc(m.ajuda)}"><i style="background:${m.cor}"></i>${esc(m.rotulo)}</span>`;
  }).join('') + `</div>`;
}

/** Texto curto para a coluna "vence em". */
export function textoVencimento(inst){
  if (inst.status_efetivo === 'referencia')      return 'não se aplica';
  if (inst.status_efetivo === 'standby_pausado') return 'sem contagem';
  const d = inst.dias_para_vencer;
  if (d == null) return '—';
  if (d < 0)   return `vencido há ${Math.abs(d)} d`;
  if (d === 0) return 'vence hoje';
  return `em ${d} d`;
}
