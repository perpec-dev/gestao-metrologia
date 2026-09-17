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

   REFERÊNCIA entra no anel — padrão de aferição é instrumento ativo do
   acervo, e deixá-lo fora fazia o total do anel não bater com o acervo
   ativo. Ele vai no FIM da ordem, e não no meio: azul (#3D5AC0), roxo
   (#6D4AAE) e teal (#1F7A8C) são os três tons que mais se aproximam sob
   deuteranopia, então teal fica encostado só no verde de "calibrado" —
   par que se separa bem porque o verde clareia para amarelado e o teal
   escurece para azul-acinzentado. O fim da fila também é a leitura certa:
   referência não é pendência, é classificação.

   Antes de mexer nesta ordem, rode o validador de novo — em especial o
   par teal/verde, que é o mais apertado desta lista.
   --------------------------------------------------------------------- */
export const ORDEM_GRAFICO = [
  'descalibrado','em_calibracao_externa','proximo_vencimento','solicitado',
  'calibrado','referencia'
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

/* ---------------------------------------------------------------------
   QUEM PODE SER INATIVADO

   Inativar é declarar o instrumento fora do acervo em uso — sucateado,
   danificado, não encontrado, em manutenção. Duas situações impedem
   isso, e as duas por motivo prático, não burocrático:

     · EMPRESTADO. O instrumento está na mão de outro setor. Declará-lo
       segregado sem ter recebido de volta é registrar uma coisa e ter
       outra na prateleira. Primeiro a devolução.

     · CALIBRAÇÃO EM ANDAMENTO ('solicitado' ou 'em calibração externa').
       Existe pedido aberto e, quase sempre, o instrumento está no
       laboratório. Inativar aqui abandona a solicitação no meio sem
       cancelá-la. Volte para descalibrado — o que também desvincula a
       rastreabilidade — e então inative.

   Padrão de referência não participa do fluxo de calibração, então só a
   primeira trava se aplica a ele.

   A trava de verdade está em inativar_instrumento(), no banco. Esta
   função existe para a tela poder dizer POR QUÊ antes do clique.
   --------------------------------------------------------------------- */
export function bloqueioInativacao(i){
  if (!i || i.condicao_fisica === 'inativo') return null;
  if (i.emprestado)
    return `Está emprestado para ${i.emprestado_para || 'outro setor'}${
      i.setor_atual ? ' (' + i.setor_atual + ')' : ''}. Registre a devolução antes de inativar.`;
  if (i.tipo !== 'REFERENCIA' && !['calibrado','descalibrado'].includes(i.status_workflow))
    return `A calibração está em andamento (${rotulo(i.status_workflow)}). Só instrumentos ` +
           `calibrados ou descalibrados podem ser inativados — encerre ou cancele a solicitação primeiro.`;
  return null;
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
