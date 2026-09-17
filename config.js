/* =====================================================================
   CONFIG — ponto único de manutenção.
   Tudo que alguém um dia vai querer ajustar sem entender o código
   está aqui, comentado.
   ===================================================================== */

export const CONFIG = {
  /* ---- Conexão -----------------------------------------------------
     Project URL do Supabase, SEM /rest/v1 no fim, e a chave `anon`
     (Settings -> API). Jamais a chave service_role: esta página é
     pública e todo o JavaScript é visível.                            */
  SUPABASE_URL:      'https://vexkhzlsxcbxlkjpdogl.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZleGtoemxzeGNieGxranBkb2dsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5MzE4MDEsImV4cCI6MjEwMzUwNzgwMX0.vdnwTWvOJuLBfoj44Zfx20vPYj_opDsIvdJCwns6jEc',

  /* ---- Identidade do documento ------------------------------------ */
  DOC_REF:  'FP-ENG-0018 RevForm.00',
  APP_NOME: 'Gestão de Metrologia',
  APP_SUB:  'Controle de calibração de instrumentos',
  EMPRESA:  'Perpec Oilfield Supply',

  /* ---- Bibliotecas externas (CDN) ---------------------------------
     Versões fixadas de propósito: atualização de CDN não pode quebrar
     a tela sozinha numa segunda-feira.                                */
  /* Referência apenas: `import` estático não aceita URL variável, então
     esta versão está repetida literalmente no topo de supabase.js.
     Ao atualizar, altere nos dois lugares.                            */
  CDN_SUPABASE: 'https://esm.sh/@supabase/supabase-js@2.45.4',
  CDN_XLSX:     'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm',
  CDN_PDFMAKE:  'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/pdfmake.min.js',
  CDN_PDFFONTS: 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/vfs_fonts.js',

  /* ---- Buckets do Storage ----------------------------------------- */
  BUCKETS: {
    certificados: 'certificados',
    laudos:       'laudos',
    fotos:        'fotos',
    termos:       'termos'
  },

  /* ---- Limites de upload ------------------------------------------
     Acima disso o navegador trava em conexão ruim de fábrica.
     Valor em MB.                                                      */
  MAX_MB_PDF:  15,
  MAX_MB_FOTO: 10,

  /* ---- Cache local -------------------------------------------------
     Só conveniência (últimos filtros usados). O servidor é sempre a
     fonte da verdade; sair da conta apaga isto.                       */
  DB_KEY: 'perpec.metrologia.v1',

  /* ---- Termo de responsabilidade (texto base do formulário) -------- */
  TERMO: 'Declaro ter recebido o instrumento acima identificado em perfeitas ' +
         'condições de uso e conservação, comprometendo-me a zelar por sua ' +
         'integridade, a não realizar ajustes ou intervenções, e a devolvê-lo ' +
         'ao setor de Metrologia na data prevista ou imediatamente após o ' +
         'término da atividade.'
};
