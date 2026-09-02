# Gestão de Metrologia — Perpec Oilfield Supply

**`APP-MET-001`** · Controle de calibração de instrumentos: cadastro, calibração,
empréstimo, inventário, arquivos e relatórios.

O código da aplicação segue o padrão `APP-<SETOR>-<NNN>`, descrito em
[`PADRAO-APLICACOES.md`](PADRAO-APLICACOES.md) — isto é um sistema, não um formulário, e
por isso saiu do padrão `FP-XXX-0000`. Ele se ajusta num lugar só, `CONFIG.APP_REF` em
`config.js`, e aparece sozinho na faixa do topo, no login e no rodapé dos PDFs. O registro
de todas as aplicações da Perpec é um documento à parte, fora deste projeto — e não tem
relação nenhuma com a aba **Inventário** daqui, que é o acervo de instrumentos.

**Stack:** Supabase (Postgres + Auth + Storage + Realtime + RLS) e frontend em
HTML/CSS/JS puro com ES Modules nativos. Sem Node, sem bundler, sem framework,
sem etapa de build. "Deploy" é copiar arquivos.

---

## Sumário

- [Instalação](#instalação)
- [Arquivos](#arquivos)
- [Como o sistema decide a situação de um instrumento](#como-o-sistema-decide-a-situação-de-um-instrumento)
- [Regras de negócio que moram no banco](#regras-de-negócio-que-moram-no-banco)
- [Uso diário](#uso-diário)
- [Papéis e permissões](#papéis-e-permissões)
- [Apagar e reimportar em massa](#apagar-e-reimportar-em-massa)
- [Os gráficos do painel](#os-gráficos-do-painel)
- [Backup](#backup)
- [Problemas comuns](#problemas-comuns)
- [Checklist antes de publicar](#checklist-antes-de-publicar)

---

## Instalação

### 1. Projeto Supabase

Crie o projeto na região **South America (São Paulo) · sa-east-1**, plano Pro.

### 2. Banco de dados

No **SQL Editor**, rode os arquivos **nesta ordem**, um de cada vez:

| Ordem | Arquivo | O que faz |
|---|---|---|
| 1 | `sql/01_schema.sql` | Tabelas, funções de domínio, gatilhos, RPCs |
| 2 | `sql/02_rls.sql` | Permissões de coluna, RLS, buckets do Storage, Realtime |
| 3 | `sql/03_views.sql` | `vw_instrumentos_status` e as RPCs que dependem dela |
| 4 | `sql/04_seed.sql` | Configurações obrigatórias e famílias iniciais |
| 5 | `sql/05_admin.sql` | Gestão de perfis, apagamento em massa, receitas de manutenção |

Os arquivos **06**, **07** e **08** são **migrações**, não instalação: numa
instalação nova os arquivos 01 a 05 já entregam tudo, e você pode pular os três.

| Migração | Para quem | Ordem |
|---|---|---|
| `sql/06_emprestimos_historico.sql` | banco anterior ao histórico de empréstimos | **06 → 02 → 03** |
| `sql/07_revisao.sql` | banco anterior à revisão descrita abaixo | **07 → 01 → 02 → 03** |
| `sql/08_revisao2.sql` | banco anterior à segunda revisão | **08 → 01 → 02 → 03** |

`sql/07_revisao.sql` acrescenta o pedido de compra na solicitação da calibração,
o cadastro enxuto de instrumento de referência, os motivos novos de inativação,
o vencimento no último dia do mês e a relação de e-mails por setor. Ele só cria
colunas, tabela e configurações — as funções e a view vêm de 01 e 03, que precisam
rodar **depois**.

`sql/08_revisao2.sql` destrava a gravação dos parâmetros pelo administrador
(o bug em que todo **Salvar** respondia "operação bloqueada pelo banco"), torna
obrigatórias a rastreabilidade da solicitação e o certificado de calibração,
impede inativar instrumento emprestado ou com calibração em andamento, passa a
inativação para o metrologista (apagar continua só do administrador), muda o
alerta de vencimento para o fim do próximo mês e cria a view `vw_arquivos`, que
é a pasta de cada equipamento. Vale a mesma regra: ele prepara a configuração,
e as funções e views vêm de 01 e 03, **depois**.

> Rodando as duas migrações no mesmo dia? A ordem é
> **07 → 08 → 01 → 02 → 03**: as duas só mexem em coluna, tabela e
> configuração, e o 01/02/03 no fim resolve funções, permissões e views de
> uma vez só.

**Confirme antes de avançar** para o frontend:

```sql
select tag, status_efetivo, data_proxima, dias_para_vencer
  from public.vw_instrumentos_status;
```

Se a view responder (ainda que vazia), o banco está de pé.

### 3. Autenticação

`Authentication → Providers → Email`:

- **Confirm email: desligado.**
- **Allow new users to sign up:** ligado ou desligado, conforme a política da
  empresa. Com ele desligado, só o administrador cria usuários pelo painel.

Crie o primeiro usuário em `Authentication → Users → Add user`, com
**Auto Confirm** ligado. O perfil nasce sozinho (gatilho `on_auth_user_created`),
sempre como `metrologista`.

O administrador inicial é **joao@perpec.com.br**, e o bloco 4 de
`sql/04_seed.sql` já o promove a `admin`. **Ordem importa:** crie o usuário no
Auth primeiro e só então rode o `04`. Se rodar antes, o bloco não falha em
silêncio — ele emite um `WARNING` dizendo exatamente o que fazer, e você roda de
novo depois. Pode rodar quantas vezes quiser.

Para promover outra pessoa depois, use a tela `Administração → Usuários`, ou:

```sql
update public.profiles set papel='admin' where email='fulano@perpec.com.br';
```

### 4. Frontend

Em `config.js`, preencha:

```js
SUPABASE_URL:      'https://SEU-PROJETO.supabase.co',   // sem /rest/v1
SUPABASE_ANON_KEY: '...'                                // chave anon, NUNCA a service_role
```

Depois é só servir os arquivos estáticos. Qualquer uma destas serve:

- **Supabase Storage:** crie um bucket **público** chamado `app`, suba a árvore
  inteira preservando as pastas (`pages/`, `components/`) e acesse
  `https://<projeto>.supabase.co/storage/v1/object/public/app/index.html`.
- Um servidor interno (IIS, nginx, Apache), uma pasta compartilhada publicada,
  GitHub Pages, Netlify — qualquer host estático.

> **Não abra por `file://`.** ES Modules exigem `http://` ou `https://`.
> Para testar na máquina, qualquer servidor estático resolve; se houver Python
> instalado: `python -m http.server 8080` na pasta do projeto.

### 5. Logo

`logo.js` já contém a logo em base64 (`window.LOGO_B64`), usada no cabeçalho e
no PDF. Para trocar:

```powershell
$bytes = [System.IO.File]::ReadAllBytes("PERPEC - LOGO PRINCIPAL.png")
$b64   = [System.Convert]::ToBase64String($bytes)
$txt   = 'window.LOGO_B64 = "data:image/png;base64,' + $b64 + '";'
[System.IO.File]::WriteAllText("logo.js", $txt, (New-Object System.Text.UTF8Encoding($false)))
```

---

## Arquivos

```
/
├── index.html              login (o gate começa visível)
├── app.html                shell: cabeçalho, navegação e <main>
├── config.js               URL, chave anon, limites, textos  ← ponto único de manutenção
├── supabase.js             cliente singleton + camada de dados
├── auth.js                 login, logout, guarda de rota
├── router.js               roteador de hash, sem reload
├── utils.js                esc(), datas, toast, validação, CDNs
├── style.css               design system (tokens da Perpec)
├── /pages/                 uma tela por módulo: render(container) + destroy()
│   ├── dashboard.js  cadastro.js  calibracao.js
│   ├── referencia.js       padrões de aferição (tela irmã da calibração)
│   ├── arquivos.js         uma pasta por equipamento
│   ├── emprestimo.js inventario.js   relatorios.js
│   └── admin.js            usuários, parâmetros, manutenção, auditoria
├── /components/
│   ├── tabela.js           tabela ordenável
│   ├── modal.js            modal, confirmação, pedido de justificativa
│   ├── status-badge.js     situação, cor e regra de inativação num só lugar
│   ├── graficos.js         arco, barras e Pareto em SVG puro
│   ├── timeline.js         linha do tempo do instrumento
│   ├── arquivos.js         pasta de documentos (ficha e tela Arquivos)
│   └── form-instrumento.js formulário de cadastro (documento de entrada opcional)
├── /sql/                   01_schema · 02_rls · 03_views · 04_seed · 05_admin
│                           06_emprestimos_historico · 07_revisao · 08_revisao2
└── logo.js                 logo em base64
```

Cada página é um módulo ES que exporta `render(container, params)` e,
opcionalmente, `destroy()`. O roteador chama `render` ao entrar e `destroy` ao
sair — é em `destroy()` que os canais de Realtime são desligados.

Bibliotecas externas entram por CDN, sob demanda: **SheetJS** (Excel) e
**pdfmake** (PDF) só são baixados quando alguém clica em exportar.

---

## Como o sistema decide a situação de um instrumento

Esta é a parte que mais confunde quem mexe no código depois, então vale ler.

`instrumentos.status_workflow` guarda **apenas o que uma pessoa declarou**:
`calibrado`, `descalibrado`, `solicitado`, `em_calibracao_externa`.

`status_efetivo` é **calculado na hora**, pela view `vw_instrumentos_status`, e é
o que a tela sempre lê. Ele nunca é gravado em lugar nenhum — não existe cron
mudando linha de instrumento à meia-noite.

A ordem de decisão da view:

1. classificação `REFERENCIA` → **`referencia`**, e para por aí.
2. `solicitado` ou `em_calibracao_externa` → vence o resto.
3. `descalibrado` declarado → `descalibrado`.
4. standby com `data_inicio_relogio` nulo → **`standby_pausado`**.
5. sem `data_proxima` → `descalibrado`.
6. `data_proxima` no passado → `descalibrado`.
7. vence até `limite_alerta_vencimento()` → `proximo_vencimento`.
8. caso contrário → `calibrado`.

O passo 7 é o **horizonte do alerta**, e ele é mensal por padrão: entra em âmbar
tudo que vence até o **último dia do mês que vem**. A conta está em
`public.limite_alerta_vencimento()`, e é a mesma para o painel, a lista de
calibração, o contador da aba e os relatórios — mexeu ali, mexeu em todos.
Desligando `alerta_vencimento_proximo_mes` em **Administração → Parâmetros**,
volta a valer a janela em dias de `dias_proximo_vencimento`.

### Semáforo

| Situação | Cor | Significado |
|---|---|---|
| Calibrado | verde | dentro do prazo |
| Próximo do vencimento | âmbar | vence dentro da janela configurada |
| Descalibrado | vermelho | vencido, sem calibração, ou declarado |
| Calibração solicitada | azul | pedido feito, instrumento na empresa |
| Em calibração externa | roxo | está no laboratório |
| Standby (relógio parado) | cinza | calibrado e guardado; validade não corre |
| Referência | teal | padrão de aferição, sem controle de validade |

As cores estão em `style.css` como tokens `--status-*`, e os rótulos em
`components/status-badge.js`. **Mudou ali, mudou em toda a aplicação** — tela,
badge, tabela, painel, Excel e PDF.

### Vencimento no último dia do mês

O controle de vencimentos da metrologia é **mensal**, não diário. Com o parâmetro
`vencimento_fim_do_mes` ligado (padrão), `calcular_data_proxima()` empurra a data
para o último dia do mês em que ela cai:

| Calibrado em | Periodicidade | Vencia em | Vence em |
|---|---|---|---|
| 20/08/2025 | 12 meses | 20/08/2026 | **31/08/2026** |
| 31/01/2026 | 1 mês | 28/02/2026 | **28/02/2026** |
| 15/03/2026 | 12 meses | 15/03/2027 | **31/03/2027** |

O cálculo é `date_trunc('month', data) + 1 mês - 1 dia`, que acerta fevereiro e
ano bissexto sozinho — somar 30 dias, não. Como a data gravada já é a real, a
tela continua mostrando o dia: `31/08/2026` é verdade, não arredondamento.

Desligue em **Administração → Parâmetros** para voltar ao vencimento no dia
exato. Vale para as **próximas** calibrações registradas: as datas já calculadas
não mudam sozinhas, do mesmo jeito que uma mudança de periodicidade não mexe no
passado.

Para alinhar o acervo que **já está no banco**, o item 6 de `sql/07_revisao.sql`
tem o comando pronto, comentado, com uma consulta de conferência antes. Ele não
roda sozinho de propósito: reescrever validade de calibração em massa é decisão
da metrologia, não da migração. O ajuste só empurra a data para a frente, dentro
do mesmo mês — nenhum instrumento passa a vencer mais cedo.

### Relógio de standby

Instrumento marcado como **standby** e ainda não movimentado tem
`data_inicio_relogio = NULL` e `data_proxima = NULL`: a calibração não expira
enquanto ele estiver na gaveta.

Na **primeira saída**, a RPC `registrar_movimentacao`:

1. grava `data_inicio_relogio = now()`;
2. recalcula a `data_proxima` da última calibração a partir daquele instante.

A partir daí ele passa a envelhecer como qualquer outro.

### Periodicidade customizada

Uma família pode ter **fases**: intervalos diferentes conforme a idade do
instrumento. Exemplo do seed (blocos padrão):

| Ordem | Intervalo | Vale até | Âncora |
|---|---|---|---|
| 1 | 12 meses | 24 meses de idade | entrada |
| 2 | 24 meses | 60 meses de idade | entrada |
| 3 | 36 meses | — (última) | entrada |

A âncora define de onde a idade é contada: **data de entrada** ou **primeira
calibração**. A última fase, com vigência em branco, vale indefinidamente.

---

## Regras de negócio que moram no banco

A página é pública e o JavaScript é todo visível, inclusive a chave `anon`.
Por isso nenhuma regra crítica depende da tela:

| Regra | Onde é garantida |
|---|---|
| Só instrumento calibrado sai emprestado | `registrar_movimentacao()` — a tela não tem `INSERT` em `movimentacoes` |
| Posse e externo exigem termo | constraint `termo_obrigatorio` + a mesma RPC |
| Inativar exige motivo e justificativa | `inativar_instrumento()`; a coluna `condicao_fisica` não tem `GRANT` de UPDATE |
| Não se inativa instrumento emprestado nem em calibração | `inativar_instrumento()` consulta `movimentacoes` em aberto e `status_workflow` |
| Solicitar calibração exige rastreabilidade | `definir_status_workflow()` recusa `solicitado` sem pedido |
| Calibrado exige certificado | `registrar_calibracao()` recusa `certificado_path` vazio |
| Parâmetro do sistema só o administrador grava | `salvar_config()` verifica `sou_admin()` |
| Alterar periodicidade exige justificativa | `alterar_periodicidade()`; `familias.periodicidade_meses` não tem `GRANT` de UPDATE |
| Auditoria é somente-inclusão | sem `GRANT` de UPDATE/DELETE, sem policy, e gatilhos que levantam exceção |
| `data_proxima` não é escolhida pelo usuário | gatilho `calibracoes_data_proxima` sobrescreve sempre |
| Tag não se repete | `gerar_tag()` deriva do maior sufixo existente, e `tag` é `UNIQUE` |
| Instrumento inativo fica fora do fluxo de calibração | `definir_status_workflow()` e `registrar_calibracao()` recusam `condicao_fisica = 'inativo'` |
| Pedido da calibração não é digitado no fim | `registrar_calibracao()` copia de `instrumentos.pedido_calibracao` e zera a coluna |
| Referência não vence | `calcular_data_proxima()` devolve `NULL` para `tipo = 'REFERENCIA'` |
| E-mail de setor só o administrador cadastra | `salvar_email_setor()` / `remover_email_setor()`; `setores_email` não tem policy de escrita |

Se a tela deixar passar alguma coisa, o banco recusa e o erro chega ao usuário
traduzido por `msgErro()` em `utils.js`.

---

## Uso diário

**Painel.** Primeira tela do dia: quantos instrumentos estão descalibrados, quais
vencem **até o fim do próximo mês**, e quais empréstimos passaram do prazo. Os
números grandes são clicáveis e levam à lista já filtrada. O cartão e a lista de
vencimento mostram a data-limite por extenso ("até 31/10/2026"), porque quem
fecha o mês precisa da data, não de uma contagem de dias.

**Cadastro.** A única porta de entrada do acervo, em quatro abas: novo
instrumento, import de instrumentos por planilha, criação de famílias e import de
famílias.

A aba **Novo instrumento** atende os dois casos que antes eram duas telas. O que
separava "Recebimento" de "Cadastro avulso" era a documentação de entrada, que
agora é um bloco **opcional**: preencheu nota fiscal ou pedido de compra, o
instrumento é gravado com `origem = 'recebimento'`; deixou em branco, com
`origem = 'avulso'`. Duas telas quase idênticas viravam dúvida sobre qual usar, e
partiam o histórico do acervo em duas portas.

A **classificação do instrumento**, no topo do formulário, decide o resto da tela:

| Classificação | O que aparece |
|---|---|
| **TMMDE** — instrumento de uso | tudo: resolução, localização, standby, documento de entrada, inspeção visual e certificado |
| **Referência** — padrão de aferição | só tag (que é a rastreabilidade), descrição, fabricante, número de série, data de cadastro, foto e observações |

**Obrigatórios nas duas classificações:** descrição, **fabricante**, **data de
entrada** e **foto do instrumento**. A foto fica no cartão de identificação, e
não no de inspeção, porque ela responde "é este mesmo o instrumento?" — pergunta
que a conferência de inventário faz sobre qualquer item do acervo, inclusive os
padrões de referência, que não passam por inspeção de entrada.

A **inspeção visual** tem um campo só, o **laudo**, em texto longo e opcional:
descreve o estado em que o instrumento foi recebido. Antes eram dois campos
("laudo" e "comentário") pedindo a mesma coisa, e o resultado prático era metade
da informação em cada um.

Instrumento de referência **não tem exigência de calibração** neste controle: não
vence, não fica descalibrado, não entra na fila de trabalho da metrologia e não
aparece no painel. Ele pode ser emprestado e pode ser inativado, com motivo e
justificativa, como qualquer outro. Os campos que só atendem TMMDE somem em vez
de ficarem cinzas — campo desabilitado ainda ocupa a leitura de quem chega.

A tag aparece assim que família e classificação são escolhidas, e é reconfirmada
pelo servidor ao salvar: se o outro usuário cadastrar um instrumento da mesma
família enquanto você digita, a sua tag avança sozinha. Instrumento + inspeção +
primeira calibração entram numa única transação.

Os dois imports mostram prévia com as linhas problemáticas marcadas antes de
gravar qualquer coisa. Há botão para baixar o modelo de planilha em cada aba — o
de instrumentos vem com cinco linhas de exemplo, uma por caso de preenchimento.

### Colunas da planilha de instrumentos

| Coluna | Obrigatória | Valores aceitos |
|---|---|---|
| `codigo` | sim | código da família já cadastrada (`PAQ`, `MIC`…) |
| `descricao` | sim | texto livre |
| `familia` | não | nome da família — informativo, ou usado se o código não bater |
| `fabricante`, `resolucao`, `num_serie`, `localizacao` | não | texto livre |
| `classificacao` (ou `tipo`) | não | `TMMDE` ou `REFERENCIA` (padrão: o escolhido na tela) |
| `observacoes` | não | texto livre |
| `nota_fiscal`, `pedido_compra` | não | preenchidos, a linha entra como recebimento |
| `data_entrada` | não | `AAAA-MM-DD` (padrão: o escolhido na tela) |
| `standby` | não | `sim` / `não` — ignorado em linhas de referência |
| `status` | não | `calibrado`, `descalibrado`, `solicitado`, `em calibracao externa` — **padrão `descalibrado`**; ignorado em linhas de referência |
| `data_calibracao` | só se `status=calibrado` | `AAAA-MM-DD` — ignorado em linhas de referência |
| `rastreabilidade` | só se `status=solicitado` | número do pedido, requisição ou ordem de serviço |
| `situacao` | não | `ativo` / `inativo` — também aceita `sucateado`, `vago`, `não entregue`, `danificado`, que já viram o motivo. **Padrão `ativo`** |
| `justificativa_inativo` | só se inativo | texto com 10+ caracteres |

O que a prévia checa e recusa antes de gravar: `calibrado` sem `data_calibracao`
(sem data não existe validade), `solicitado` sem `rastreabilidade`,
`data_calibracao` no futuro ou anterior à entrada, linha inativa importada por
quem não é administrador, e linha inativa que chega com a calibração solicitada
ou em laboratório — inativar no meio da solicitação a abandona sem cancelá-la.

A **próxima calibração nunca vem da planilha** — quem calcula é o servidor, pela
periodicidade da família e pelo relógio de standby. Certificados em PDF também
não vêm por planilha: são anexados depois, na tela de Calibração.

**Calibração.** A lista de trabalho, e **só dos instrumentos TMMDE**. Filtre por
situação, família ou texto livre; clique num instrumento para abrir a ficha com
os arquivos e o histórico completo. A tela é atualizada ao vivo: quando o outro
usuário registra uma calibração, a linha pisca aqui.

O ciclo tem uma ordem, e a **rastreabilidade entra no começo dele**:

1. **Solicitar calibração** — pergunta a **rastreabilidade de solicitação**: o
   número que identifica o pedido do serviço (pedido de compra, requisição,
   ordem de serviço). É **obrigatória**, na tela e no banco. É o momento em que
   ela nasce; perguntá-la no fim, quando o serviço já acabou e o número está num
   e-mail de duas semanas atrás, é a receita para o campo passar em branco. Fica
   guardada em `instrumentos.pedido_calibracao`.
2. **Enviar para calibração externa** — mesma rastreabilidade, o instrumento sai.
3. **Tornar calibrado** — pede data, **certificado (obrigatório)**, observações e
   laudo. A rastreabilidade guardada é copiada para o registro da calibração pelo
   servidor e zerada no instrumento: ela não reaparece na próxima calibração. A
   próxima data é calculada pelo servidor, nunca digitada.

Calibrado **sem certificado** é afirmação sem prova: é o certificado que sustenta
a validade numa auditoria. A tela exige o anexo, e `registrar_calibracao()`
recusa no banco. (A importação em massa continua aceitando calibração sem PDF —
lá o certificado é anexado depois, aqui não.)

Voltar para **descalibrado** cancela a solicitação e desvincula a rastreabilidade
— a tela avisa antes.

Instrumento **inativo** não tem nenhum desses botões: ele pode estar não
encontrado, em manutenção ou na sucata, e solicitar calibração dele não quer
dizer nada. A trava não é só visual — `definir_status_workflow()` e
`registrar_calibracao()` recusam instrumento inativo no banco. Reative no
Inventário primeiro.

**Referência.** Tela própria para os padrões de aferição, irmã da de Calibração e
separada dela de propósito: padrão de referência não vence, não é cobrado e não
entra na fila de trabalho — misturá-lo fazia a lista de calibração contar itens
que nunca vão vencer.

As colunas respondem a outra pergunta — não "quando vence", mas "quais padrões eu
tenho e onde estão": **tag** (a rastreabilidade do padrão), **descrição**,
**família** e **localização**, que mostra o setor e o nome de quem está com ele
quando está emprestado, igual à tela de calibração. Um filtro de **inativos** com
três posições — ocultar, incluir, apenas — porque padrão de referência também é
inativado (danificado, vago, sucateado), e às vezes o que se quer ver é
justamente a lista dos que saíram de uso.

**Empréstimo.** Busque por tag ou descrição. Se o instrumento não puder sair, a
tela diz o motivo antes de você preencher qualquer campo. Casual não pede termo;
posse e externo não salvam sem ele. A aba **Em aberto** lista o que está fora e
registra devolução — que exige informar **quem recebeu**, fechando o par da entrega.

Quando um empréstimo passa do prazo de alerta, a aba **Em aberto** oferece
**Notificar responsável**: abre no seu cliente de e-mail uma mensagem pronta para
o setor — destinatário, tags, datas, dias fora e prazo já preenchidos — e você
confere e envia. O botão **Notificar os setores responsáveis** faz o mesmo em
lote, **um e-mail por setor**: cobrar cinco instrumentos em cinco mensagens é o
jeito mais rápido de ninguém responder nenhuma.

O e-mail sai do cliente da própria pessoa de propósito: chega assinado por quem
cobra e a resposta volta para ela, não para uma caixa de sistema que ninguém lê.
Os destinatários vêm de **Administração → E-mails por setor**; sem e-mail
cadastrado o botão fica desabilitado e diz por quê. Metrologista também notifica;
cadastrar e alterar é do administrador.

> **Onde se edita o texto do e-mail:** em `config.js`, no bloco
> `EMAIL_COBRANCA` — assunto, saudação, abertura, o modelo de cada linha da
> lista, o fechamento e a assinatura, cada um num campo, com os marcadores
> (`{setor}`, `{responsavel}`, `{tag}`, `{dias}`…) documentados ali mesmo. A
> montagem fica em `pages/emprestimo.js`, na função `montarEmail()`; para mudar
> só a redação, não é preciso abrir esse arquivo.

A aba **Histórico** guarda todas as saídas e devoluções já registradas, com filtro
por período, tipo, situação (devolvidos, em aberto, fora do prazo) e busca livre.
Exporta para Excel e para PDF, e o PDF carrega no cabeçalho o recorte aplicado.
Nada é apagado quando o instrumento volta: a devolução preenche a mesma linha da
saída, então o par entrega/devolução é sempre íntegro. Devolução só acontece pela
RPC `registrar_devolucao` — não há `UPDATE` direto em `movimentacoes` pela API.

**Inventário.** O acervo inteiro, com condição física e classificação. Filtre por
TMMDE ou Referência; o KPI **Referências** leva direto ao recorte. Inativar abre um
modal com motivo e justificativa obrigatórios — os dois vão para a auditoria.

**Quando dá para inativar.** Só instrumento **calibrado** ou **descalibrado**, e
só se **não estiver emprestado**:

| Situação | Inativa? | Por quê |
|---|---|---|
| Calibrado ou descalibrado, na prateleira | sim | — |
| Emprestado | não | está na mão de outro setor; declarar segregado o que não voltou é registrar uma coisa e ter outra na prateleira |
| Calibração solicitada | não | existe pedido aberto; inativar abandona a solicitação no meio sem cancelá-la |
| Em calibração externa | não | o instrumento está no laboratório |
| Referência | sim | não participa do fluxo de calibração — nela vale só a regra do empréstimo |

O botão fica **desabilitado com o motivo no título**, em vez de sumir: quem
procura "Inativar" e não acha conclui que o sistema quebrou; quem lê "está
emprestado para Fulano" sabe o que fazer em seguida. A trava de verdade está em
`inativar_instrumento()`, no banco.

Os motivos vêm do parâmetro `motivos_inativacao` e saem de fábrica assim:
sucateado, vago, não entregue, danificado, **não encontrado**, **necessário
manutenção** e **outros**. "Outros" é a saída de emergência da lista e tem
tratamento próprio: escolhê-lo abre um campo obrigatório de **descrição da
segregação** — onde o instrumento foi parar e como está identificado — que entra
na justificativa gravada na auditoria, prefixada por `Segregação:`.

Instrumento de referência é inativado pelo mesmo caminho, com os mesmos campos.

**Arquivos.** Uma pasta por equipamento. Os documentos sempre existiram, mas cada
um morava numa coluna de uma tabela diferente — certificado em `calibracoes`,
termo em `movimentacoes`, foto em `inspecoes` — visíveis só dentro da linha do
tempo do instrumento. Ótimo para contar a história, péssimo para responder "cadê
o certificado do P-PAQ-03".

Aqui cada instrumento é uma pasta que abre e fecha, com subpastas por tipo
(certificados, laudos, fotos, termos) e um resumo na etiqueta. Filtre por tag,
instrumento ou nome do arquivo, recorte por tipo de documento, e ligue **Mostrar
pastas vazias** para achar os instrumentos que ainda não têm nenhum documento
anexado — a pergunta que aparece na véspera da auditoria. O mesmo bloco de
arquivos aparece na ficha de cada instrumento.

Os arquivos sobem para `<bucket>/<tag>/<data>-<nome>`, então a pasta existe dos
dois lados: nesta tela e no painel do Supabase. Os links são assinados na hora do
clique — os buckets são privados, não existe URL pública.

**Relatórios.** Filtros aplicados no servidor, prévia na tela, exportação para
Excel e para PDF. Há atalhos para os recortes mais pedidos (vencidos hoje,
vencem no mês, vencem no trimestre).

Escolher **Inativos** na condição física libera o filtro de **motivo da
inativação**, para tirar só os não encontrados, ou só os que aguardam manutenção.
Nesse recorte a prévia e as exportações ganham as colunas **motivo** e
**justificativa** — um relatório de inativos sem o motivo é uma lista de tags sem
resposta —, e no PDF elas tomam o lugar da localização.

---

## Papéis e permissões

São dois papéis, e só dois. Mais granularidade do que isto vira burocracia
sem ganho numa equipe de metrologia.

| | metrologista | admin |
|---|---|---|
| Consultar tudo | sim | sim |
| Receber, cadastrar e importar | sim | sim |
| Registrar calibração | sim | sim |
| Emprestar e registrar devolução | sim | sim |
| Alterar periodicidade (com justificativa) | sim | sim |
| Inativar / reativar instrumento (com justificativa) | sim | sim |
| **Apagar** instrumentos | **não** | sim |
| Notificar setor sobre devolução em atraso | sim | sim |
| Alterar parâmetros do sistema | **não** | sim |
| Cadastrar e-mails por setor | **não** | sim |
| Gerenciar papéis e acessos | **não** | sim |

**Inativar não é do administrador, e isso é proposital.** Quem abre a gaveta, não acha o
instrumento e precisa registrar o fato é o metrologista. Exigir um administrador para
essa operação não protegia nada — só adiava o registro, e inventário que se registra
depois é inventário que não se registra. O que protege continua valendo: motivo
obrigatório, justificativa obrigatória e tudo na auditoria com e-mail e data. **Apagar**,
esse sim, segue exclusivo do administrador: inativar preserva o histórico, apagar destrói.

### Pela tela — `Administração → Usuários`

A aba aparece no menu só para quem é `admin`. Ali dá para escrever o **nome** de cada
pessoa, trocar o papel e bloquear ou liberar o acesso, com a mudança indo para a trilha
de auditoria.

O nome merece uma linha à parte porque ele aparece em quatro lugares: a saudação do
painel ("Olá, João. Tudo sob controle?"), o cabeçalho, a assinatura do e-mail de cobrança
e o "emitido por" dos relatórios em PDF. Como o perfil nasce do e-mail, ele começa como
`joao` — o sistema corrige a caixa e os acentos que reconhece (`nomeProprio()`, em
`utils.js`), mas **acento não se deduz**: "sergio" tanto pode ser Sérgio quanto Sergio.
A lista de nomes conhecidos está lá para ser aumentada; o conserto definitivo é escrever
o nome completo neste campo.

Duas travas propositais, que valem tanto na tela quanto na API:

- você **não** consegue rebaixar nem bloquear o seu próprio usuário;
- o sistema **não** deixa bloquear o último administrador ativo.

### Como entra gente nova

O Supabase é quem cria a credencial; a tela define o que a pessoa pode fazer.

1. Painel do Supabase → `Authentication → Users → Add user`, com **Auto Confirm** ligado.
2. O gatilho `on_auth_user_created` cria o perfil sozinho, como **metrologista ativo**.
3. Em `Administração → Usuários`, ajuste o papel se for o caso.

> Se `Allow new users to sign up` estiver ligado, qualquer pessoa com o link
> consegue criar conta e entrar como metrologista. Numa ferramenta interna,
> **desligue** e crie os usuários você mesmo.

### Bloquear ≠ apagar

Bloquear (`ativo = false`) tira o acesso na hora — todas as políticas de RLS
passam por `sou_ativo()` — e preserva o histórico do que a pessoa fez. É o que
você quer quando alguém sai da empresa. Apagar o usuário no painel do Supabase
também funciona, mas leva o perfil junto e deixa a auditoria com um e-mail sem
dono.

### Pelo SQL, se preferir

```sql
update public.profiles set papel='admin' where email='fulano@perpec.com.br';
update public.profiles set ativo=false   where email='fulano@perpec.com.br';
```

---

## Apagar e reimportar em massa

Feito para o ciclo normal de implantação: subir a planilha, ver que o dado
saiu errado, limpar e subir de novo.

**O que "apagar" leva junto.** Por cascata: calibrações, inspeções,
movimentações e documentos daquele instrumento. **Não** leva a trilha de
auditoria — ela é somente-inclusão, e o próprio apagamento entra nela com o
seu e-mail, a data e a justificativa. Famílias, parâmetros e usuários ficam
de pé, então a reimportação funciona logo em seguida.

**Os arquivos do Storage não somem.** Certificados, termos, laudos e fotos
continuam nos buckets. Para reimportar isso não atrapalha; para faxina
completa, a consulta que lista os órfãos está em `sql/05_admin.sql`, item 4.7.

### Três caminhos, do mais cirúrgico ao mais amplo

| Onde | O que faz | Como confirma |
|---|---|---|
| `Inventário` → marcar linhas → **Apagar selecionados** | só o que você marcou | justificativa de 10+ caracteres |
| `Administração → Manutenção` → **Apagar por família** | todos de uma família | justificativa de 10+ caracteres |
| `Administração → Manutenção` → **Limpar todo o acervo** | o acervo inteiro | digitar `APAGAR TUDO` + justificativa |

Todos os três exigem papel `admin` — e a verificação está na RPC, no banco,
não no botão.

### Pelo SQL Editor

Quando é mais rápido pelo banco (rodando como `postgres`, sem passar pelas
RPCs auditadas), as receitas prontas estão no item 4 de `sql/05_admin.sql`:
contagem por tabela, apagar tudo, desfazer só a importação de hoje, apagar por
família, zerar também as famílias, e — apenas para ambiente de teste — como
desligar e religar os gatilhos append-only para limpar a própria auditoria.

---

## Os gráficos do painel

Quatro, e cada um responde uma pergunta diferente. Todos em SVG escrito à mão
(`components/graficos.js`) — nenhuma biblioteca de gráficos entra no projeto.

| Gráfico | Pergunta que responde |
|---|---|
| **Arco de situação** | Como está o acervo ativo agora? |
| **Carga por mês** | Quantas calibrações caem em cada um dos próximos 6 meses? Serve para negociar agenda com o laboratório. |
| **Instrumentos inativos** | Quanto do acervo está fora de uso, e por quê? |
| **Pareto por família** | Onde atacar primeiro? A linha acumulada mostra quantas famílias resolvem 80% das pendências. |

Cada um tem uma **tabela-gêmea** embutida (*"Ver os números em tabela"*): nenhum
valor depende de enxergar cor ou de acertar o mouse num ponto.

### A tinta dos gráficos é a paleta institucional

Onde a cor **não** carrega significado — barras de série única, linha de acumulado, grade
e eixo — ela vem direto do padrão Perpec, sem tom inventado no meio do caminho:

| Token | Cor | Onde aparece |
|---|---|---|
| `--serie` | `#3F415B` · Pantone 5265 C | barras: carga por mês, inativos, Pareto |
| `--serie-2` | `#E6332C` · Pantone 179 C | linha e pontos do acumulado do Pareto |
| `--grid` | `#EDEDED` · Pantone 663 C | grade em fio de cabelo |
| `--eixo` | `#3F3F3E` · Pantone 446 C | linha de base (o zero) |

Azul-marinho e vermelho vivo é o par de maior separação da paleta: barra e linha
acumulada não se confundem nem impressas em preto e branco, porque a diferença de
luminosidade é grande.

**O semáforo não usa esta paleta, e não é esquecimento.** Verde e âmbar não existem no
padrão Perpec — e sem eles não há como dizer "calibrado", "vencendo" e "descalibrado" pela
cor. No semáforo a cor é informação; na tinta de gráfico, é identidade. Os dois sistemas
convivem: o anel de situação fala em semáforo, as barras falam em Perpec.

### Três denominadores, e cada gráfico usa o seu

Confundir os três é a forma mais fácil de publicar um percentual errado:

| Recorte | O que é | Quem usa |
|---|---|---|
| **acervo ativo** | tudo em uso, **referência incluída** | arco de situação |
| **sob controle** | só os TMMDE, que são os que vencem | carga por mês, Pareto |
| **acervo inteiro** | ativos + inativos | gráfico de inativos |

**Referência entra no anel.** Padrão de aferição é instrumento ativo do acervo — deixá-lo
de fora fazia o número do centro (acervo ativo) não fechar com a soma dos gomos. Ele é
gomo próprio, em teal, porque "referência" não é uma situação de calibração: é uma
classificação, e a situação dela é não ter validade a vencer.

### O gráfico de inativos

Duas leituras numa carta só, porque uma não vale sem a outra: o **percentual do acervo**
que está fora de uso, em número grande, e a **estratificação por motivo** logo abaixo.
12% inativo é fila de trabalho se o motivo for "necessário manutenção" e é problema de
controle patrimonial se for "não encontrado" — o percentual sozinho não diz qual dos dois.

Barras **deitadas**, porque os motivos são texto de tamanho variável ("Necessário
manutenção") e, na vertical, virariam rótulo inclinado ou abreviado. Série única, cor
única: o comprimento já carrega a informação, e pintar cada motivo de uma cor inventaria
seis significados novos no semáforo que a aplicação já tem. Instrumento inativado sem
motivo registrado (importação antiga) aparece como **"Sem motivo registrado"** em vez de
sumir da conta.

### Por que meia-lua e não rosca fechada

Não é escolha estética. As cores do semáforo foram medidas com o validador de
paleta do design system (ΔE em OKLab, simulação de daltonismo Machado 2009,
contra a superfície branca do cartão):

- Numa **rosca fechada**, o último segmento encosta no primeiro — o que põe
  **verde colado no vermelho**: ΔE 4,2 sob deuteranopia. Reprovado. Nenhuma das
  24 ordens circulares possíveis passa, porque o problema é a paleta (que é
  padrão da empresa e não se mexe), não a ordem.
- O **arco aberto** tem adjacência linear. Na ordem
  `descalibrado → externa → próximo → solicitado → calibrado`, o pior par
  adjacente dá **ΔE 21,4 sob deuteranopia e 24,3 em visão normal** — bem acima
  dos pisos de 8 e 15.

**Standby fica fora dos gráficos.** Croma 0,022: como cinza ele é um ótimo
rótulo e um péssimo segmento — viraria uma mancha morta no anel. Nos gráficos
ele entra somado a "calibrado", que é exatamente o que ele é: um instrumento
válido com o relógio parado. Na tabela, na lista e no badge ele continua
aparecendo com nome próprio.

**Referência entrou no fim da ordem**, e não no meio: azul (`#3D5AC0`), roxo (`#6D4AAE`)
e teal (`#1F7A8C`) são os três tons que mais se aproximam sob deuteranopia, então o teal
fica encostado só no verde de "calibrado" — par que se separa bem, porque sob
deuteranopia o verde clareia para amarelado e o teal escurece para azul-acinzentado. O fim
da fila também é a leitura certa: referência não é pendência. **Este par (teal/verde) é o
mais apertado da lista — passe o validador nele antes de mexer na ordem.**

A ordem está em `ORDEM_GRAFICO`, em `components/status-badge.js`, com o raciocínio no
comentário. **Se mexer nas cores do semáforo, rode o validador de novo antes de
publicar.**

---

## Backup

O plano Pro faz **backup diário automático com 7 dias de retenção** — isso já
cobre o acidente comum. O que ele não cobre é o erro percebido três semanas
depois.

**Dump semanal para fora do Supabase.** A rota confiável é externa ao banco,
porque `pg_dump` não roda de dentro do Postgres:

```powershell
# Tarefa agendada semanal no Windows, ou um job de CI.
# A senha do banco está em Settings -> Database.
$data = Get-Date -Format 'yyyy-MM-dd'
pg_dump "postgresql://postgres:SENHA@db.SEU-PROJETO.supabase.co:5432/postgres" `
        --no-owner --format=custom `
        --file="\\servidor\backups\metrologia\metrologia-$data.dump"
```

Guarde os dumps num caminho com retenção maior que a do Supabase, e **teste a
restauração pelo menos uma vez** — backup que nunca foi restaurado é hipótese,
não backup.

Alternativa dentro da plataforma: uma **Edge Function** agendada por `pg_cron` +
`pg_net` que exporta as tabelas em CSV para um bucket privado. Funciona, mas
exporta dados, não o esquema — serve como complemento, não como substituto do
dump.

Os arquivos do Storage (certificados, termos, laudos, fotos) **não entram no
dump do banco**. Faça uma cópia periódica dos buckets à parte.

---

## Problemas comuns

**"Seu usuário não tem perfil cadastrado."**
O usuário existe em `auth.users` mas não em `public.profiles` — normalmente
porque foi criado antes de o esquema ser instalado. Rode o diagnóstico no fim de
`03_views.sql`:

```sql
select u.id, u.email, u.email_confirmed_at, p.papel, p.ativo
  from auth.users u left join public.profiles p on p.id=u.id order by u.created_at;
```

Insira a linha faltante em `public.profiles`.

**Login aceito, mas nenhuma tela mostra dados.**
`profiles.ativo = false`, ou a RLS não foi aplicada. Todas as políticas passam
por `sou_ativo()`.

**"E-mail ainda não confirmado."**
`Confirm email` ligado no painel. Desligue, ou confirme o usuário manualmente.

**A tela abre em branco e o console acusa CORS ou módulo.**
A página foi aberta por `file://`. ES Modules precisam de `http://`/`https://`.

**Alterei um `.js` e o navegador insiste no arquivo velho.**
`Ctrl+F5`. Hosts estáticos guardam cache de `.js` com folga.

**"Operação bloqueada pelo banco: seu papel não permite alterar este campo."**
É o comportamento esperado: `condicao_fisica` e a periodicidade só mudam pelas
RPCs auditadas. Use os botões da tela, não a API direta.

**Uma calibração ficou sem data de próxima.**
O instrumento está em standby com o relógio parado, e isso é correto: a validade
começa a contar na primeira saída. Confira com:

```sql
select tag, standby, data_inicio_relogio, ultima_calibracao, data_proxima, status_efetivo
  from public.vw_instrumentos_status where tag = 'P-PAQ-01';
```

**O Realtime não atualiza entre os dois usuários.**
Confira se as tabelas estão na publicação:

```sql
select tablename from pg_publication_tables where pubname='supabase_realtime';
```

O bloco final de `02_rls.sql` faz isso; rode-o de novo se necessário.

---

## Checklist antes de publicar

**Segurança**

- [ ] Nenhuma chave `service_role` nos arquivos publicados
- [ ] RLS ligada em todas as tabelas; nenhuma política atende `anon`
- [ ] `auditoria` sem `GRANT` de update/delete, e os dois gatilhos no lugar
- [ ] `condicao_fisica` e periodicidade sem `GRANT` de update direto
- [ ] Buckets do Storage com `public = false`
- [ ] Todo texto de usuário passa por `esc()` antes de virar `innerHTML`
- [ ] O gate de login começa visível em `index.html` e em `app.html`
- [ ] Sair apaga o cache local (`esquecerTudo()`)

**Funcionamento**

- [ ] `vw_instrumentos_status` responde no SQL Editor
- [ ] `gerar_tag` testado nas duas famílias e nos dois tipos
- [ ] `calcular_data_proxima` testado nos quatro casos: standby sem uso,
      standby com uso, fase simples, fase customizada
- [ ] Empréstimo de instrumento descalibrado é recusado **pelo banco**
- [ ] Posse e externo recusados sem termo
- [ ] Inativação sem justificativa é recusada
- [ ] Dois usuários logados ao mesmo tempo veem a mudança um do outro

**Interface**

- [ ] Legenda de cores visível nas telas que usam o semáforo
- [ ] Campos com 16px
- [ ] PDF sai com logo e com "Página X de Y"
- [ ] Excel abre no Excel em português sem passo de importação
- [ ] Testado com `Ctrl+F5` depois de publicar

---

*Perpec Oilfield Supply · APP-MET-001 · padrão de arquitetura do `KIT-INICIAL.md`*
