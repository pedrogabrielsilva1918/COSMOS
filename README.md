# COSMOS

Gestão administrativa para empresas privadas e organizações públicas. Primeira versão funcional (MVP), com interface em português, servidor Node.js e banco SQLite persistente. Não depende de pacotes externos.

## Atalhos de período do histórico

No **Histórico**, clique em **Hoje**, **Últimos 7 dias** ou **Este mês** para preencher o intervalo e consultar imediatamente, mantendo o texto da busca. Os atalhos usam o calendário de Brasília: Hoje cobre o dia atual; Últimos 7 dias inclui hoje e os seis dias anteriores; Este mês vai do primeiro dia até hoje.

As datas continuam editáveis. O período aplicado segue para as páginas anteriores e o CSV, como nas consultas manuais. Nenhuma tarefa é agendada e não há alteração nas APIs ou no banco.

## Histórico por período

No **Histórico**, combine a busca com **A partir de** e **Até**. As datas incluem o dia inteiro no horário de Brasília (`America/Sao_Paulo`); deixe um dos limites vazio para um intervalo aberto. Clique em **Buscar** após alterar o texto ou as datas. **Limpar busca** remove também o período. Atualizar os dados preserva os valores; sair da conta os remove.

As APIs `/api/history` e `/api/history/export.csv` aceitam `from=AAAA-MM-DD` e `to=AAAA-MM-DD`, rejeitando datas inexistentes ou invertidas. O filtro ocorre antes da paginação e é reaplicado nas páginas anteriores e na exportação. A data das colunas do CSV continua em UTC. Não há alteração no banco ou nas permissões.

## Exportar histórico

Administradores podem usar **Histórico → Exportar histórico CSV** após concluir uma consulta. O arquivo inclui todos os registros correspondentes à busca, não apenas as páginas carregadas, com número do registro, data em UTC, responsável e ação. Os registros aparecem do mais recente para o mais antigo; a busca mantém as regras de acentos e palavras da tela.

Ao editar a busca, clique em **Buscar** antes de exportar. O botão fica desabilitado enquanto não houver consulta concluída ou durante o download. A exportação consulta os dados atuais no momento do download, podendo incluir movimentações posteriores à consulta da tela. Sem resultados, há somente cabeçalho.

`GET /api/history/export.csv?q=texto` exige administrador e usa a mesma seleção por organização e busca da API do histórico. Não aceita cursor `before`. O CSV usa UTF-8 com BOM, ponto e vírgula e proteção contra fórmulas; a resposta não é armazenada em cache. Não altera dados nem permissões.

## Exportar pessoas

Em **Pessoas → Exportar pessoas CSV**, administradores podem baixar nome, e-mail, setor, perfil e situação de acesso da equipe. A busca e os filtros de setor, perfil e acesso são aplicados também ao arquivo, usando a mesma função de filtro da tela. Sem resultados, o CSV contém apenas o cabeçalho. Inclui contas desativadas quando não houver filtro de acesso.

`GET /api/users/export.csv` aceita `q` (até 200 caracteres), `sector_id`, `role` (`admin` ou `colaborador`) e `access` (`active` ou `inactive`). Exige administrador e consulta somente a organização da sessão. Filtros inválidos são rejeitados com 400. Usa UTF-8 com BOM, separador ponto e vírgula, proteção contra fórmulas e resposta sem cache. Senhas, sessões e demais dados internos não entram no arquivo.

## Editar meu nome

Qualquer pessoa autenticada pode abrir **Minha conta → Editar meu nome**. O nome aceita até 120 caracteres e aparece atualizado na identificação da conta, nos pedidos e comentários vinculados. E-mail, setor, perfil, senha e sessões são preservados. O histórico registra o nome anterior e o novo.

`POST /api/account/profile` exige `name` e `expectedName` com o nome original. A atualização afeta apenas a conta da sessão, revalidada dentro da transação, e salva o histórico junto. Se o nome tiver sido alterado em outra janela, retorna 409 e orienta atualizar e reabrir o formulário. Salvar sem mudanças não cria movimentação. Não há migração do banco.

## Editar organização

Administradores podem abrir **Organização** no menu para atualizar nome e natureza pública ou privada. Salvar atualiza a identificação no sistema e nas novas impressões; pedidos, pessoas, setores e sessões são preservados. A natureza é uma identificação cadastral e não altera as permissões.

`POST /api/organization` aceita `name` (até 160 caracteres) e `type` (`publica` ou `privada`). O servidor usa somente a organização da sessão, verifica o perfil administrador novamente dentro da transação e grava as alterações junto do histórico. Salvar sem mudanças não cria movimentação. Colaboradores não veem o atalho e recebem 403 na API. Não há migração do banco.

## Decidir sobre o conteúdo atual

Ao aprovar ou recusar, o cliente envia `expected: {title, description}` com o texto que o administrador abriu para analisar. O servidor exige esses campos e os compara ao pedido atual dentro da transação da decisão. Se o solicitante tiver alterado o conteúdo, retorna 409 sem mudar a situação, o histórico ou as notificações. Feche o pedido, atualize os dados e reabra para conferir a versão atual antes de decidir.

Integrações com `POST /api/requests/:id/decision` também precisam enviar `expected` com título e descrição recebidos do workspace. Sem esse objeto, uma decisão elegível é rejeitada com 400. As restrições de perfil, organização, autoria e situação permanecem. A verificação compara o conteúdo atual, não mantém um contador de versões; editar e restaurar exatamente o mesmo texto não gera conflito. Não há migração do banco.

## Link direto para uma solicitação

Na janela do pedido, **Copiar link** gera um endereço como `https://seu-cosmos/?pedido=9`. Ele contém somente o ID, sem credenciais ou dados do pedido. Ao abrir, o COSMOS exige uma sessão válida e procura o pedido entre os registros já autorizados no workspace. Sem sessão, o destino é mantido até concluir o login. Pedidos indisponíveis à conta mostram uma mensagem genérica. IDs inválidos são rejeitados.

O link não concede acesso e não é um endereço público para o pedido. A pessoa deve ter acesso à mesma instalação do COSMOS e permissão para consultar a solicitação. A abertura automática ocorre uma vez por carregamento da página; recarregar tenta abrir novamente. O destino é preservado na URL. Se a cópia automática estiver bloqueada, há um campo selecionado para cópia manual.

## Copiar protocolo

Na janela da solicitação, **Copiar protocolo** copia somente o identificador, como `COS-00009`, e confirma a cópia na tela. Se o navegador bloquear a área de transferência, o COSMOS apresenta o protocolo selecionado em um campo para cópia manual. A ação está disponível apenas nos pedidos que a pessoa já pode consultar. Não envia mensagens, não copia dados do pedido e não altera registros.

## Continuar a consulta após editar

Ao editar o próprio pedido, definir o prazo ou alterar o responsável, **Salvar** atualiza os dados e reabre o pedido correspondente. **Voltar ao pedido** descarta as alterações ainda não salvas e retorna aos detalhes. A edição continua sujeita às mesmas permissões e validações.

Se a gravação for concluída, mas a atualização falhar, a mensagem informa que os dados foram salvos e orienta usar **Atualizar dados**. Se o formulário tiver sido fechado ou outro modal aberto durante o processamento, o sistema não reabre o pedido por cima da nova janela. Trocar de conta invalida o retorno pendente. Os demais formulários mantêm Cancelar e o retorno habitual à lista.

## Janela de solicitação organizada

Ao abrir um pedido, o título, a situação, o solicitante e a data ficam no cabeçalho. **Detalhes** reúne setor, prioridade, prazo, responsável, justificativa e decisão. Administradores elegíveis continuam registrando a decisão nessa aba. Os botões **Alterar** ao lado do prazo e do responsável abrem os mesmos formulários de antes.

**Comentários** e **Movimentações** têm abas próprias, com seus controles de atualização e registros anteriores. Use as setas esquerda/direita, Home ou End ao focar uma aba para navegar pelo teclado. Editar, usar como modelo e imprimir continuam disponíveis conforme as permissões. A janela adapta-se ao celular e mantém o cabeçalho de fechamento fora da área de rolagem.

## Visual simples e leve

O visual usa fundo claro, menu lateral branco, verde nas ações principais e componentes com bordas discretas. A página inicial tem uma saudação curta e indicadores neutros, com menos decoração e espaçamentos mais compactos. A ilustração grande foi removida. Menu, tabelas, formulários, notificações e entrada seguem a mesma linguagem visual, com adaptação ao celular. Não há fontes, imagens ou bibliotecas externas novas. As funções, filtros e permissões permanecem as mesmas.

## Páginas de solicitações

A lista apresenta até **25 pedidos por página**, com **Anterior** e **Próxima** acima e abaixo da tabela. Os controles aparecem somente quando há mais de uma página. A indicação de resultados informa o intervalo exibido e o total filtrado.

A busca, os filtros e a ordenação são aplicados antes de dividir as páginas. Alterar um filtro, mudar a ordenação, ou atualizar os dados recarrega a primeira página. Trocar de tela preserva a página enquanto os dados não forem atualizados. Sair da conta também restaura a primeira página. Os cartões de resumo e os dois CSVs continuam considerando **todos os resultados filtrados**, não apenas a página visível.

A paginação acontece no navegador sobre os dados já autorizados do workspace; não reduz o volume recebido do servidor. Não há alteração nas APIs ou no banco.

## Filtros compactos de solicitações

Busca, situação e exportações ficam visíveis. Abra **Mais filtros e ordenação** para usar prazo, setor, prioridade, fila, ordenação e período. Recolher a área mantém os valores e a filtragem; o título indica quantos ajustes adicionais estão ativos, incluindo ordenação diferente de Mais recentes. Datas inicial e final contam separadamente.

**Atualizar dados** preserva os filtros e a abertura da área. **Limpar filtros** e sair da conta restauram os valores e recolhem a área. Um período inválido abre automaticamente os filtros para permitir a correção. O seletor de fila continua exclusivo de administradores.

## Resumo dos resultados na tela

Em **Solicitações**, quatro cartões mostram pendentes, aprovadas, recusadas e pendentes vencidas entre os pedidos que correspondem aos filtros atuais. Busca, período, setor, prioridade, situação e fila são considerados. Vencidas já estão incluídas nas pendentes; não some esse indicador ao total. Sem resultados, os cartões mostram zero.

O resumo é recalculado ao mudar os filtros e após atualizar os dados. Um período inválido oculta os cartões até a correção. Sair da conta remove os números da tela. O resumo usa apenas os pedidos já autorizados no workspace e não faz consultas adicionais.

## Relatório resumido por setor

Em **Solicitações → Resumo por setor**, baixe um CSV com uma linha por setor que tenha pedidos correspondentes aos filtros. Colunas: total, pendentes, aprovadas, recusadas, pendentes vencidas e pendentes urgentes. Os dois últimos indicadores são subconjuntos das pendentes e não devem ser somados ao total.

O relatório respeita busca, período, situação, setor, prioridade, prazo e fila selecionados. Por exemplo, filtrar somente aprovadas produz zero pendentes. A ordem das linhas é alfabética pelo nome atual do setor; a ordenação individual de pedidos não muda a ordem do resumo. Colaboradores recebem somente totais dos próprios pedidos; administradores, da organização. Sem resultados, o arquivo contém apenas o cabeçalho.

`GET /api/requests/summary.csv` aceita os mesmos parâmetros e validações do CSV detalhado e usa a mesma seleção autorizada antes de agrupar. O arquivo usa UTF-8 com BOM e ponto e vírgula e protege células de texto contra fórmulas. Não inclui nomes de pessoas, justificativas ou pareceres. Não há alteração no banco.

## Período de criação das solicitações

Em **Solicitações**, use **Criadas a partir de** e **Criadas até**. Os limites incluem todo o dia escolhido no fuso `America/Sao_Paulo` (horário de Brasília), independentemente do fuso do navegador. Preencha apenas uma data para deixar o outro limite em aberto. O período combina com busca, filtros e ordenação e também vale para o CSV.

**Atualizar dados** preserva as datas; **Limpar filtros** e sair da conta removem o período. Datas inválidas ou invertidas mostram uma mensagem e bloqueiam a exportação. A API de CSV aceita `from=AAAA-MM-DD` e `to=AAAA-MM-DD` e rejeita períodos inválidos com 400. A regra de data é compartilhada pelo navegador e servidor, sem alteração no banco ou nas permissões.

## Busca ampliada de solicitações

Em **Solicitações**, pesquise por título, protocolo, nome do solicitante, setor ou descrição/justificativa. A busca ignora acentos e maiúsculas; todas as palavras precisam aparecer nos campos pesquisados, em qualquer ordem. Por exemplo, `material joao` encontra um pedido de João cuja justificativa mencione material. O protocolo mantém o formato `COS-00012`.

A mesma regra é compartilhada pela lista e pela exportação CSV, combinando com os demais filtros e a ordenação. Somente pedidos autorizados ao perfil entram na pesquisa. O setor e o nome da pessoa correspondem ao cadastro atual. Não há nova permissão nem alteração no banco.

## Usar um pedido como modelo

Abra um pedido próprio e clique em **Usar como modelo**. O COSMOS preenche título, justificativa, prioridade e setor ativo em um novo formulário. Revise os dados e clique em **Salvar** para enviar uma nova solicitação pendente, com novo protocolo. Cancelar ou fechar o formulário não cria registros. Pedidos pendentes, aprovados e recusados podem ser usados como modelo.

Se o setor original estiver desativado, será obrigatório escolher um setor ativo. Sem setores ativos, o sistema orienta procurar o administrador. A operação usa a criação normal de pedidos: não copia parecer, aprovação, prazo, responsável, comentários ou histórico. Administradores também usam apenas os próprios pedidos como modelo. O pedido original permanece intacto. Não há nova API nem alteração no banco.

## Editar meu pedido

Abra uma solicitação própria pendente e clique em **Editar meu pedido** para corrigir título e descrição/justificativa. A edição mantém protocolo, setor, prioridade, prazo, responsável, comentários e data de criação. Administradores também só editam os próprios pedidos; pedidos decididos não podem ser editados. As movimentações registram o título anterior e o novo e indicam se a justificativa foi atualizada, sem manter versões anteriores do texto completo.

Se outro navegador alterar o título ou a descrição, ou se uma decisão for registrada antes de salvar, a edição é rejeitada. Feche o formulário, atualize os dados e reabra o pedido para conferir a versão atual. Salvar sem mudanças não acrescenta movimentação.

`POST /api/requests/:id/edit` exige `title`, `description` e `expected: {title, description}` com os valores originais. A edição e a movimentação são gravadas na mesma transação. Não há mudança no esquema do banco.

## Notificações de decisões

Em **Mostrar avisos**, escolha **Todos**, **Não lidos** ou **Lidos**. O filtro é aplicado no servidor antes da paginação e permanece ao atualizar ou marcar avisos. O contador do menu e o total de não lidos incluem todos os seus avisos. Na opção Lidos, a leitura em lote fica desabilitada. Sair da conta restaura Todos.

**Marcar todas como lidas** alcança seus avisos até o mais recente da lista carregada, incluindo páginas anteriores. Avisos recebidos depois desse limite permanecem não lidos. A ação atualiza a lista e o contador; pode ser repetida sem alterar a data de leitura já registrada.


Quando um administrador aprova ou recusa um pedido, o solicitante recebe um aviso interno em **Notificações**. O contador do menu mostra seus avisos não lidos. **Atualizar dados** busca novas decisões; não há atualização automática, e-mail ou notificação no dispositivo.

A central apresenta páginas de até 50 avisos, com **Carregar avisos anteriores**. **Marcar como lida** atualiza apenas seu próprio aviso. **Ver pedido** também marca o aviso como lido, atualiza os dados e abre o pedido com a decisão atual. Essas ações recarregam a primeira página da central. Um administrador recebe os avisos dos próprios pedidos, sem acesso aos avisos de outras pessoas.

A inicialização cria a tabela de notificações e índices sem apagar registros. Decisões anteriores à atualização não geram avisos retroativos. A decisão, seu histórico e a notificação são salvos na mesma transação; uma falha desfaz o conjunto. Os estados de leitura são persistentes. Faça backup antes de iniciar a versão atualizada.

A API `GET /api/notifications?status=all|unread|read&before=ID` retorna `notifications`, `nextBefore` e `unreadCount` apenas para a pessoa e organização da sessão. `POST /api/notifications/:id/read`, com JSON `{}`, marca um aviso próprio; repetir a ação é permitido e não altera a primeira data de leitura. O workspace inclui `notification_unread`.

## Encerrar outros acessos

Em **Minha conta → Encerrar outros acessos**, qualquer pessoa pode invalidar as demais sessões da própria conta, mantendo a sessão atual e a senha. Os outros navegadores precisarão entrar novamente na próxima requisição ao servidor. O comando não altera contas de colegas nem de outras organizações. Repetir sem outros acessos não altera nada. Esta ação não troca a senha; se ela foi compartilhada, use também a troca de senha.

`POST /api/account/sessions/revoke-others`, com JSON `{}`, retorna `ok` e `revoked` (quantidade de registros de sessão removidos, incluindo eventuais registros expirados). A revogação e o histórico são gravados juntos; não há alteração no esquema do banco.

## Consultar todo o histórico

Administradores podem acessar **Histórico**, pesquisar por ação ou nome da pessoa responsável e clicar em **Buscar** ou pressionar Enter. A consulta ignora acentos e maiúsculas. Se houver várias palavras, todas precisam aparecer na ação ou no nome, em qualquer ordem. O nome é o cadastro atual da pessoa; a ação mantém o texto registrado na época.

A página apresenta até 50 registros mais recentes por vez. **Carregar registros anteriores** acrescenta a próxima página da mesma busca, sem repetir os já carregados. O contador indica quantos registros foram exibidos, e não o total de toda a base. **Limpar busca** retorna à primeira página de todas as ações. **Atualizar dados** e voltar à página recarregam a primeira página com a busca preenchida; sair da conta limpa a consulta. Falhas de leitura mostram uma mensagem e mantêm os resultados anteriores. Esse histórico continua sendo um registro de aplicação, sem garantia de imutabilidade.

O endpoint `GET /api/history?q=texto&before=ID` é exclusivo de administradores e consulta somente a organização da sessão. Ele valida o cursor e a busca, usa parâmetros SQL e retorna `history` e `nextBefore`. As páginas usam o ID do último registro para continuar a consulta mesmo que novas ações cheguem. A inicialização acrescenta apenas um índice de consulta ao histórico, sem apagar ou transformar registros. A resposta antiga `history` do workspace permanece limitada a 50 ações por compatibilidade.

## Encontrar pessoas da equipe

Administradores podem pesquisar em **Pessoas** por nome, e-mail ou nome do setor, sem diferenciar maiúsculas ou acentos. Várias palavras precisam aparecer nos campos pesquisados, em qualquer ordem. Combine a busca com setor, perfil (administrador ou colaborador) e acesso (ativo ou desativado). O setor é o cadastro atual da pessoa, e setores desativados também podem ser consultados.

O contador mostra quantas pessoas correspondem aos filtros. **Limpar busca** restaura a lista da organização. **Atualizar dados** preserva a consulta e os filtros válidos; sair da conta limpa tudo. O botão de edição continua ligado à pessoa selecionada, mesmo com a lista filtrada. No celular, os registros aparecem em cartões com nome, e-mail, setor, perfil, acesso e edição.

A pesquisa usa somente as pessoas já autorizadas no workspace do administrador. Colaboradores não recebem a lista nem ganham acesso à página. Não há exportação adicional, nova permissão ou migração do banco.

## Encontrar um setor

Em **Setores**, pesquise pelo nome ou pela descrição da área e combine com **Somente ativos** ou **Somente desativados**. A busca ignora diferenças de maiúsculas e acentos: `juridico` encontra Jurídico. Se houver mais de uma palavra, todas precisam aparecer no nome ou na descrição, em qualquer ordem.

O contador mostra quantos setores correspondem à consulta. **Limpar busca** restaura todos os setores disponíveis. **Atualizar dados** preserva a busca e a situação escolhida; sair da conta limpa os filtros. Os administradores mantêm os botões de cadastro e edição; colaboradores continuam apenas consultando. A busca usa os setores da organização já recebidos no workspace, sem nova permissão ou migração.

## Pedidos por setor

Na página inicial, **Pedidos por setor** resume total de pedidos, pendentes, vencidos e urgentes. Vencidos e urgentes contam somente os pendentes; aprovados e recusados participam apenas do total. Administradores veem os pedidos da sua organização; colaboradores veem somente os próprios.

Aparecem apenas setores com pedidos visíveis à conta, inclusive desativados, com identificação. A ordem prioriza quantidade de pendências, depois vencidos, urgentes e nome do setor. **Ver pedidos** abre a lista com o filtro daquele setor, limpando os outros filtros e restaurando Mais recentes. O resumo usa o setor de destino do pedido e é atualizado pelo botão **Atualizar dados**. Não há mudança nas permissões ou migração do banco.

## Atualizar os dados da equipe

O botão **Atualizar dados** no topo consulta novamente os dados permitidos à conta. O horário exibido indica a última atualização concluída, no horário do dispositivo; não é um indicador de conexão em tempo real. O botão fica desabilitado durante a consulta.

A atualização preserva a página aberta e os filtros, desde que o setor selecionado continue disponível. Indicadores, listas, responsáveis e histórico geral são atualizados juntos. Comentários e movimentações dentro de um pedido têm seus próprios botões **Atualizar**. Não há atualização automática em segundo plano. Falhas de rede mantêm os dados anteriores e mostram uma mensagem; sessão expirada volta à entrada. Respostas de consultas anteriores não substituem uma atualização mais recente nem reabrem uma sessão encerrada.

## Visual Horizonte

O COSMOS usa uma base clara com menu azul profundo, ações em verde e detalhes em coral. A página inicial destaca a saudação, indicadores, atalhos, solicitações recentes e pedidos por setor. A ilustração vetorial e os estilos são locais, sem fontes ou imagens externas.

O tema está em `public/horizonte.css`, aplicado após os estilos estruturais. A entrada, tabelas, filtros, setores e janelas seguem a mesma identidade. No celular, o menu fica compacto e os pedidos aparecem em cartões; o resumo por setor também se adapta à largura. Foco de teclado e preferência por movimento reduzido são mantidos. Não há migração do banco nem alteração nas operações do sistema.

## O que está disponível

- Cadastro de organização pública ou privada e do primeiro administrador.
- Troca da própria senha com encerramento de todas as sessões.
- Login e logout com sessões de 8 horas, cookies HttpOnly e senhas derivadas com scrypt e salt individual.
- Dados separados por organização no servidor.
- Cadastro, edição de nome, desativação e reativação de setores.
- Cadastro de pessoas, com perfis administrador e colaborador.
- Edição do nome, setor e perfil; desativação e reativação de pessoas.
- Bloqueio de login e encerramento de sessões ao desativar o acesso; novo login obrigatório ao alterar o perfil.
- Solicitações com protocolo, setor responsável, justificativa e prioridade.
- Prazos definidos pelo administrador, destaque de pendentes vencidas e filtro por atraso.
- Aprovação ou recusa com parecer obrigatório e identificação de quem decidiu.
- Comentários por solicitação, com autor, data e carregamento de mensagens anteriores.
- Um administrador não pode avaliar a própria solicitação. Cadastre outro administrador para isso.
- Colaboradores veem apenas seus pedidos; administradores veem todos os pedidos da organização.
- Painel com indicadores, busca por título/protocolo e filtro por situação.
- Exportação dos pedidos filtrados para CSV compatível com Excel.
- Histórico administrativo pesquisável, com páginas de 50 registros e acesso aos anteriores.
- Layout responsivo para computador, tablet e celular.

## Executar no computador

Instale **Node.js 24 ou superior**, baixe ou clone este repositório e abra o terminal na pasta COSMOS:

```bash
npm start
```

Abra **http://localhost:3000**. Não é necessário executar `npm install`.

1. Selecione **Cadastrar organização**.
2. Informe seu nome, organização, natureza pública/privada, e-mail e senha de pelo menos 12 caracteres.
3. Em **Setores**, cadastre as áreas da organização.
4. Em **Pessoas**, cadastre os colaboradores e outros administradores.
5. Crie um pedido em **Nova solicitação**.
6. Entre como outro administrador, abra o pedido e registre a decisão.

Não há usuário ou senha padrão, nem dados fictícios inseridos automaticamente.

## Executar no GitHub Codespaces

Com Node.js 24+ no Codespace, execute `npm start`. Abra a aba **PORTS / PORTAS**, localize a porta **3000** e escolha **Abrir no navegador**. Mantenha a porta privada durante os testes.

Para atualizar após integrar uma alteração no GitHub: pare o servidor com `Ctrl+C`, execute `git pull --ff-only` na branch `main` e inicie novamente com `npm start`. Se houver alterações locais, preserve-as antes de atualizar; não use comandos de descarte. O banco em `data/` é ignorado pelo Git e não é substituído por esta atualização.

Em **Minha conta**, qualquer usuário pode trocar a própria senha informando a atual. A nova senha deve ser diferente e ter pelo menos 12 caracteres. Todas as sessões da conta são encerradas, inclusive em outros navegadores. Não há recuperação de senha esquecida nesta versão.

## Executar no Replit

1. Importe este repositório no Replit.
2. Use um ambiente com **Node.js 24+** (`node --version` confirma a versão).
3. Configure o comando de execução como `npm start` e clique em **Run**.
4. Abra a janela de visualização do aplicativo. O servidor usa `0.0.0.0` e respeita a variável `PORT`.
5. Se a visualização usar HTTPS, configure `COOKIE_SECURE=true` em Secrets.

Os dados ficam em `data/cosmos.sqlite`. A execução precisa de disco persistente; instâncias efêmeras podem perder o arquivo ao reiniciar ou republicar. Não use múltiplas instâncias compartilhando esse SQLite. GitHub armazena o código; não executa o backend. GitHub Pages não é compatível com este servidor.

## Porta de desenvolvimento

A prévia e o servidor aceitam porta e host pela linha de comando:

```bash
npm run dev -- --host 0.0.0.0 --port 4173 --strictPort
```

As opções `--port` e `--host` têm prioridade sobre `PORT` e `HOST`; sem opções ou variáveis, o padrão continua `0.0.0.0:3000`. A porta não é trocada silenciosamente se estiver ocupada. A opção `--strictPort` é aceita para compatibilidade com ferramentas de prévia, mas esse comportamento já é o padrão. Para uso normal no Codespaces, continue com `npm start` e abra a porta 3000.

## Configuração

| Variável | Padrão | Uso |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP |
| `HOST` | `0.0.0.0` | Interface de rede |
| `DATABASE_PATH` | `data/cosmos.sqlite` | Caminho do banco persistente |
| `COOKIE_SECURE` | `false` | Use `true` quando acessado por HTTPS |

Há um `.env.example` como referência. Variáveis podem ser definidas no ambiente ou copiadas para `.env` e carregadas com `node --env-file=.env server.js`. O arquivo `.env` não é carregado automaticamente por `npm start` e não deve ser enviado ao Git.

## Movimentações por solicitação

Abra um pedido e consulte **Movimentações**, abaixo dos comentários. A lista mostra as novas ações de criação, prazo, responsável, comentário e decisão, com autor e data, da mais recente para a mais antiga. Use **Atualizar** após uma nova ação ou **Carregar movimentações anteriores** para consultar páginas de 50 registros.

O solicitante vê somente o histórico dos próprios pedidos; administradores podem consultar os da mesma organização. A migração acrescenta um vínculo opcional ao registro de auditoria e um índice. As ações antigas continuam no histórico geral, mas não são associadas automaticamente a pedidos a partir de seus textos. Por isso, pedidos antigos podem apresentar uma lista vazia até que uma nova ação seja registrada. Faça backup do arquivo SQLite com o servidor parado antes de atualizar, como nas demais migrações.

A API `GET /api/requests/:id/history?before=ID` retorna `history` e `nextBefore`, com as mesmas restrições de acesso do pedido. Ela não altera os dados.

## Imprimir ou salvar um pedido em PDF

Abra uma solicitação e clique em **Imprimir / salvar PDF**. O resumo abre em outra aba com dados consultados novamente no servidor: organização, protocolo, situação, título, solicitante, setor, prioridade, prazo, responsável, descrição e decisão. Na nova aba, clique em **Imprimir / salvar PDF** e escolha **Salvar como PDF** no destino da impressão do navegador, ou uma impressora disponível.

Datas e horários são apresentados no horário de Brasília. O resumo mostra o momento da geração e não possui assinatura digital. Comentários e movimentações continuam disponíveis na consulta do pedido no sistema. Para obter uma cópia atualizada, abra novamente o resumo.

O endpoint `GET /api/requests/:id/print` exige sessão válida e permite somente o autor ou administradores da mesma organização. A resposta usa `Cache-Control: no-store`. Se a sessão expirar, entre novamente no COSMOS e reabra o resumo. Não há alteração no banco de dados.

## Ordenação das solicitações

Em **Solicitações → Ordenar solicitações**, escolha **Mais recentes** (padrão), **Mais antigas**, **Maior prioridade** ou **Prazo mais próximo**. A ordenação combina com os filtros e vale também para o CSV. O botão **Atualizar dados** preserva a escolha. **Limpar filtros** e sair da conta restauram Mais recentes.

Recentes e antigas usam a sequência de cadastro (ID/protocolo). Maior prioridade mostra Urgente, Alta e Normal; empates mostram os pedidos mais antigos primeiro. Prazo mais próximo mostra datas em ordem crescente, incluindo vencidas antes das futuras, e deixa pedidos sem prazo por último. Na mesma data, desempata por prioridade e depois pelos mais antigos. Com todas as situações selecionadas, pedidos já decididos também participam da ordenação.

O atalho de pendentes vencidas abre a fila por prazo. O CSV aceita o parâmetro opcional `order=recent|oldest|priority|deadline`, validado no servidor. A lista e a exportação usam a mesma regra de ordenação; as permissões existentes são mantidas. Nenhuma migração do banco é necessária.

## Filtros das solicitações

Em **Solicitações**, combine busca por título/protocolo, situação, prazo, setor e prioridade. Administradores também podem usar o responsável. O contador indica quantos pedidos estão sendo exibidos dentre os permitidos à sua conta. **Limpar filtros** restaura a lista completa permitida ao perfil.

O setor é o destino registrado no pedido, não o setor atual do solicitante. Setores desativados continuam disponíveis no filtro para consultar pedidos antigos. Os atalhos **Minha fila** e **Pendentes vencidas** limpam os demais filtros para mostrar toda a fila correspondente. Ao sair da conta, os filtros são limpos.

A exportação CSV aplica todos os filtros selecionados. Os parâmetros opcionais `sector_id=ID` e `priority=normal|alta|urgente` são validados no servidor e mantêm o isolamento entre organizações e a restrição de colaboradores aos próprios pedidos. Nenhuma migração do banco é necessária.

## Fila de análise

Administradores têm o atalho **Minha fila** na página inicial. Ele abre os pedidos pendentes atribuídos à conta conectada. O contador e a lista usam os dados carregados no workspace; atualize a página para buscar alterações feitas por outras pessoas.

Em **Solicitações → Filtrar responsável**, escolha **Minha fila (pendentes)** ou **Pendentes sem responsável ativo**. O segundo inclui pedidos sem atribuição e aqueles cujo responsável está desativado ou deixou de ser administrador. Selecionar essas opções ajusta a situação para Pendentes. Busca, prazo e situação podem ser combinados; uma combinação incompatível retorna lista vazia.

A exportação CSV refaz a consulta no servidor e aplica os mesmos filtros. Os parâmetros opcionais `assignment=mine` e `assignment=unassigned` são exclusivos de administradores e não aceitam IDs de terceiros. Colaboradores continuam vendo e exportando somente seus pedidos e não recebem esses controles. O filtro não altera o responsável, as permissões ou a decisão.

## Responsável pela análise

Como administrador, abra um pedido pendente e clique em **Definir responsável**. Escolha um administrador ativo da mesma organização, exceto o solicitante. Selecione **Sem responsável** para remover. Atribuição, troca e remoção ficam registradas no histórico. Pedidos aprovados ou recusados mantêm o vínculo para consulta e não aceitam sua alteração.

O nome aparece na lista, no detalhe e na última coluna do CSV. A atribuição indica quem acompanha a análise; as permissões de consulta e decisão continuam as mesmas. Nenhum administrador pode aprovar o próprio pedido. Colaboradores não podem alterar responsáveis e continuam consultando apenas seus pedidos.

Se o responsável for desativado ou perder o perfil de administrador, o pedido pendente mostra **Reatribuição necessária**. O vínculo fica preservado até um administrador escolher outro responsável ou removê-lo. O nome exibido acompanha o cadastro atual. Não há envio de notificações nesta etapa.

A atualização adiciona `requests.assigned_to` com chave estrangeira, sem apagar dados; os pedidos antigos começam sem responsável. Faça backup com servidor parado antes de atualizar. O CSV passa a ter 13 colunas, com as 12 anteriores na mesma ordem.

## Prazos das solicitações

Administradores podem abrir um pedido pendente e usar **Definir ou alterar prazo**. Escolha a data limite ou deixe o campo vazio para remover. Somente administradores da mesma organização podem alterar o prazo, e pedidos já aprovados ou recusados não aceitam essa alteração.

O pedido fica vencido a partir do dia seguinte à data limite, pelo calendário de **America/Sao_Paulo (Brasília)**. O dia do prazo ainda está dentro do período. Datas passadas são aceitas para registrar compromissos existentes. Apenas pedidos pendentes são destacados como vencidos; a data fica preservada após a decisão.

O painel mostra um aviso com atalho para os pendentes vencidos. Na lista, use **Filtrar prazo → Pendentes vencidas**. O filtro combina com a busca e a situação. O colaborador continua vendo apenas seus próprios pedidos. A classificação é atualizada ao carregar os dados; atualize a página para refletir a mudança de dia. Não há envio automático de lembretes nesta versão.

A exportação CSV inclui a data limite na última coluna, no formato AAAA-MM-DD, e respeita o filtro de vencidos. A atualização adiciona `requests.due_date` ao banco sem apagar dados; pedidos anteriores começam sem prazo. Faça backup com o servidor parado antes de atualizar.

## Exportar solicitações

Em **Solicitações**, ajuste a busca, a situação e o prazo e clique em **Exportar CSV**. A consulta é refeita no servidor no momento da exportação: pode incluir pedidos criados desde a última atualização da tela. Administradores exportam os pedidos da própria organização; colaboradores exportam apenas seus pedidos. Se não houver resultados, o arquivo contém apenas os títulos das colunas.

O CSV usa UTF-8 com BOM, separador ponto e vírgula e datas ISO em UTC. Contém protocolo, título, solicitante, setor, situação, prioridade, descrição, datas, parecer da decisão e prazo limite (data sem horário). Não inclui senhas, e-mails nem comentários. Caso o Excel não separe as colunas automaticamente, importe o arquivo escolhendo UTF-8 e `;` como delimitador.

Textos que possam ser interpretados como fórmulas recebem um apóstrofo inicial na exportação. Aspas e quebras de linha são preservadas pelo formato CSV. Isso não modifica os dados originais. O arquivo baixado contém dados dos pedidos e deve ser compartilhado apenas com quem tem autorização.

## Conversar sobre uma solicitação

Abra o pedido e use **Comentários** para registrar esclarecimentos. O autor do pedido e os administradores da mesma organização podem ler e comentar, inclusive depois de uma aprovação ou recusa. Outros colaboradores não podem consultar a conversa.

Cada mensagem aceita até 2.000 caracteres. A tela carrega as 50 mais recentes, com **Carregar anteriores** para consultar as demais e **Atualizar** para buscar novas mensagens. Não há atualização automática, edição ou exclusão de comentários nesta versão. Desativar um autor preserva suas mensagens; o nome exibido acompanha seu cadastro atual.

O servidor cria automaticamente a tabela de comentários ao iniciar, sem alterar pedidos ou contas. Comentários não são incluídos na resposta geral do workspace: são consultados por pedido, com validação de acesso no servidor.

## Setores complementares

Os setores Jurídico, Compras e Licitações e Patrimônio e Almoxarifado já cadastrados permanecem no banco. O aviso e o botão de inclusão em lote foram retirados da interface. Para cadastrar outras áreas, use **Setores → Novo setor**; para alterar um cadastro, use **Editar**.

## Descrições dos setores

Os cartões exibem uma descrição curta do que cada área faz. Administradores podem preencher ou ajustar esse texto em **Setores → Novo setor / Editar → O que este setor faz**, com até 300 caracteres. O conteúdo é mostrado como texto, inclusive para colaboradores da mesma organização.

Na primeira atualização, uma migração adiciona `sectors.description` e preenche descrições iniciais para os setores conhecidos: Administração, Documentação, Financeiro, GFS, MDS, Mobiliário, Recursos Humanos (também Recursos Humano), Suporte, Tecnologia, Jurídico, Compras e Licitações e Patrimônio e Almoxarifado. São sugestões gerais, que devem ser adaptadas às atribuições da organização. Nomes com variação de caixa ou acentos são reconhecidos. Setores desconhecidos ficam sem descrição.

A migração ocorre uma vez, sem substituir textos personalizados em reinicializações. Não renomeia setores nem altera pessoas, pedidos ou situação de acesso. Faça backup com o servidor parado antes de atualizar. A descrição também é aceita na API em `description` (texto opcional); ao editar sem esse campo, o valor existente é mantido.

## Gerenciar setores

Como administrador, abra **Setores → Editar** para renomear, descrever, desativar ou reativar uma área. Para desativar, primeiro transfira as pessoas ativas para outro setor (ou desative seus acessos) e conclua a avaliação dos pedidos pendentes. Os pedidos concluídos e as pessoas já desativadas permanecem vinculados para consulta.

Setores desativados não aparecem nas opções de novos pedidos ou pessoas. Ao reativar uma pessoa cujo setor foi desativado, escolha um setor ativo. Renomear mantém os vínculos e exibe o nome atual nos pedidos e nas exportações; o nome anterior fica registrado na ação do histórico. Não há exclusão física de setores.

A atualização adiciona `sectors.active` automaticamente, com os setores existentes ativos. Não apaga dados. Faça backup com o servidor parado antes de atualizar.

## Gerenciar pessoas

Como administrador, abra **Pessoas → Editar** para alterar nome, setor, perfil ou situação de acesso. O e-mail permanece como identificador de login e não é editável nesta versão. Desativar preserva os pedidos e o histórico; reativar permite entrar novamente com a senha existente. Alterar o perfil também encerra as sessões da pessoa.

Um administrador não pode desativar o próprio acesso nem reduzir o próprio perfil: outro administrador deve fazê-lo. O servidor também impede a remoção do último administrador ativo. Mudanças são registradas no histórico.

A atualização adiciona automaticamente a coluna `active` ao banco existente e mantém as contas atuais ativas. Pare o servidor e faça backup do diretório `data/` antes de atualizar. A migração é aditiva; não apaga cadastros, pedidos ou sessões.

## Limite de tentativas atrás de proxy

O padrão `TRUST_PROXY=false` usa o IP da conexão e ignora `X-Forwarded-For`. Mantenha esse padrão no Codespace enquanto a configuração do proxy de entrada não for conhecida. Quando vários usuários chegam pelo mesmo proxy, eles podem compartilhar o contador nesse modo.

Em uma infraestrutura controlada, defina `TRUST_PROXY=true` e `TRUSTED_PROXY_IPS` com os IPs individuais dos proxies confiáveis, separados por vírgula. Não são aceitos curingas ou intervalos CIDR. A aplicação recusa iniciar nesse modo se a lista estiver vazia ou contiver IP inválido. O proxy deve sobrescrever o cabeçalho ou acrescentar o IP da conexão recebida, e não apenas repassar um cabeçalho informado pelo cliente.

Somente conexões originadas de um IP cadastrado podem usar o cabeçalho. A cadeia é percorrida da direita para a esquerda, parando no primeiro IP que não é um proxy confiável. Valores anteriores a esse ponto não definem o contador. Cabeçalhos inválidos ou com mais de 32 endereços usam o IP da conexão. Endereços IPv6 equivalentes e IPv4 mapeado são normalizados para evitar contadores diferentes para o mesmo IP.

Não inclua redes de usuários na lista de proxies. Esta configuração não detecta automaticamente a infraestrutura do GitHub Codespaces, não resolve usuários atrás de NAT e não compartilha contadores entre processos. A janela e os limites existentes são mantidos.

## Backup do banco

Implementação baseada na [API de backup do SQLite no Node.js 24](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html#sqlitebackupsourceDb-path-options).

Na pasta do COSMOS, execute:

```bash
npm run backup
```

O comando lê `DATABASE_PATH` do ambiente ou usa `data/cosmos.sqlite`. Cria um arquivo com nome único em `backups/`, mostra o caminho e verifica sua integridade e os vínculos entre registros antes de anunciar sucesso. A cópia usa a API de backup do SQLite, incluindo dados confirmados no WAL; pode ser executada com o servidor aberto, embora seja mais simples parar o servidor antes de atualizações. Escritas simultâneas podem prolongar a operação. O comando não aplica migrações nem altera os registros da origem.

Para usar outro banco ou pasta:

```bash
npm run backup -- --database /caminho/cosmos.sqlite --output-dir /caminho/copias
```

O `.env` não é carregado automaticamente. Se você o usa para configurar o banco, execute `node --env-file=.env backup.js` ou informe `--database` com o mesmo caminho usado pelo servidor. Um banco inexistente não será criado silenciosamente. O comando não substitui backups existentes e só publica o arquivo final após a conferência. No Linux, novas pastas recebem permissão 700 e o arquivo recebe 600. Pastas existentes mantêm suas permissões; os arquivos são ignorados pelo Git.

A cópia contém os dados de todas as organizações, senhas protegidas e sessões existentes. Guarde-a em local privado e faça download para fora do Codespace: apagar o Codespace também pode apagar as cópias locais. O comando não envia arquivos nem agenda backups automaticamente.

### Conferir uma restauração

Com o servidor parado, copie o arquivo gerado para **uma pasta nova de teste**, preservando o backup e o diretório `data/` atuais. Inicie o COSMOS apontando `DATABASE_PATH` para essa cópia, usando uma porta privada diferente se necessário. Confira login, setores, pessoas, pedidos, comentários e movimentações. Ao terminar, pare essa instância antes de voltar ao banco habitual. A cópia testada pode receber migrações ao iniciar; por isso use uma cópia, nunca o único backup. Não coloque o arquivo restaurado ao lado de WAL/SHM pertencentes a outro banco. Nenhuma restauração sobre o banco atual é realizada pelo comando de backup.

## Testes

Execute `npm run check` para conferir a sintaxe do servidor, da interface, das descrições de setores e dos testes. Execute `npm test` para rodar a suíte de integração. Não é preciso instalar dependências externas.

No GitHub, abra **Actions → Testes COSMOS** para acompanhar cada execução. O fluxo roda em pushes, pull requests e manualmente pelo botão **Run workflow** na branch que contém essa configuração. Ele usa Node.js 24, verifica a sintaxe antes da integração e tem limite de dez minutos. Execuções anteriores do mesmo pull request ou da mesma branch são canceladas quando uma atualização chega. Os testes usam bancos temporários; o banco do seu Codespace não é acessado.

Antes de integrar um PR, confira se **Sintaxe e integração (Node 24)** ficou verde. Essa verificação não configura bloqueio obrigatório de merge nas regras do repositório.

```bash
npm test
```

Testes de integração com banco temporário verificam autenticação, persistência após reinício, permissões, isolamento entre organizações, decisões, bloqueio de autoaprovação, expiração por logout, origem das requisições e limite de tentativas.

## Conferência da interface

Nesta etapa, as telas foram conferidas no navegador com dados fictícios e respostas de API simuladas, usando os arquivos reais da interface. Foram verificados painel, formulários de pessoa/setor/conta, criação e decisão de solicitações, comentários e navegação do colaborador em uma largura de 390 px. O menu móvel agora quebra em linhas, mantendo suas opções visíveis.

Essa conferência não substitui um teste com login real no seu Codespace. Autenticação, permissões, persistência e exportação são verificadas separadamente pelos testes de integração da API. O teste de inicialização também executa o servidor com host/porta explícitos, como ferramentas de prévia fazem.

## Estrutura

```text
server.js           API HTTP, autenticação e banco SQLite
backup.js           Backup SQLite com validação de integridade
public/index.html   Interface
public/styles.css   Layout responsivo
public/app.js       Navegação e integração com a API
request-print.js    Resumo HTML seguro da solicitação
public/print.css    Layout de tela e impressão A4
public/print.js     Abertura da impressão pelo navegador
test/app.test.js    Testes de integração
```

## API

Todas as operações de escrita recebem JSON. O cookie de sessão é emitido pelo servidor.

| Método | Rota | Acesso |
| --- | --- | --- |
| POST | `/api/register` | Cadastro de nova organização e administrador |
| POST | `/api/login` | Login |
| POST | `/api/logout` | Autenticado |
| POST | `/api/account/password` | Troca de senha da própria conta; exige senha atual |
| GET | `/api/workspace` | Dados visíveis ao usuário autenticado |
| GET | `/api/notifications?before=ID` | Avisos próprios da conta e organização da sessão |
| POST | `/api/notifications/read-all` | Marca avisos próprios até `through` (ID inteiro positivo); preserva novos avisos |
| POST | `/api/notifications/:id/read` | Marca aviso próprio como lido; JSON `{}` |
| GET | `/api/notifications?before=ID` | Avisos próprios da conta e organização da sessão |
| POST | `/api/notifications/read-all` | Marca avisos próprios até `through` (ID inteiro positivo); preserva novos avisos |
| POST | `/api/notifications/:id/read` | Marca aviso próprio como lido; JSON `{}` |
| GET | `/api/history?q=busca&before=ID` | Administrador da organização; páginas de até 50 ações |
| POST | `/api/sectors` | Administrador |
| POST | `/api/sectors/suggested` | Administrador; JSON `{}`; inclui os três sugeridos sem duplicação |
| POST | `/api/sectors/:id` | Administrador da mesma organização; edita nome e situação |
| POST | `/api/users` | Administrador |
| POST | `/api/users/:id` | Administrador da mesma organização: edita nome, setor, perfil e acesso |
| POST | `/api/requests` | Autenticado |
| GET | `/api/requests/:id/print` | Autor ou administrador da mesma organização; resumo HTML para impressão |
| GET | `/api/requests/export.csv?q=busca&status=pendente&deadline=overdue&assignment=mine&sector_id=1&priority=alta` | Autenticado; mesmas permissões da lista; filtros opcionais |
| GET | `/api/requests/:id/comments?before=ID` | Autor ou administrador da mesma organização; páginas de até 50 mensagens |
| POST | `/api/requests/:id/comments` | Autor ou administrador da mesma organização; JSON com `content` |
| POST | `/api/requests/:id/assignee` | Administrador; JSON com `assigned_to` (ID numérico ou null); apenas pendentes da mesma organização |
| POST | `/api/requests/:id/deadline` | Administrador da mesma organização; JSON com `due_date` (AAAA-MM-DD ou null); apenas pendentes |
| POST | `/api/requests/:id/decision` | Administrador da mesma organização, exceto autor |

## Limites desta versão

Este MVP não é uma implantação de produção. Antes de usar dados reais de funcionários ou órgãos, configure HTTPS, persistência e backups com restauração validada, revisão de acesso e política de retenção. O cadastro de organizações está aberto; restrinja-o no ambiente institucional se necessário. A proteção de tentativas é por IP e processo; por padrão ignora cabeçalhos de proxy. O modo opcional de proxy exige uma lista explícita de IPs confiáveis, conforme descrito abaixo.

Ainda não há recuperação de senha esquecida, MFA, convites por e-mail, edição de e-mail, anexos, notificações por e-mail ou integração com sistemas governamentais. Não há garantia automática de conformidade com LGPD ou regras administrativas. O histórico é um registro de aplicação no banco, não uma trilha imutável de auditoria.

Use `npm run backup` para gerar uma cópia SQLite autônoma e verificada. Como alternativa manual, pare o servidor e copie o diretório `data` completo, incluindo eventuais arquivos WAL/SHM. Guarde uma cópia fora do Codespace e limite o acesso.
