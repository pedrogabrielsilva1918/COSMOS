# COSMOS

Gestão administrativa para empresas privadas e organizações públicas. Primeira versão funcional (MVP), com interface em português, servidor Node.js e banco SQLite persistente. Não depende de pacotes externos.

## Visual Conexão Coral

A interface usa fundo claro, coral e verde-água, com ícones vetoriais locais e tipografia mais legível. A página inicial tem atalhos para solicitações, setores e o guia **Como funciona**, com orientações conforme o perfil de acesso. O nome da saudação e os indicadores continuam usando os dados da conta conectada.

No celular, os pedidos aparecem em cartões para consultar os detalhes sem rolagem lateral. As tabelas administrativas continuam disponíveis com rolagem quando necessário. A interface respeita a preferência do dispositivo por movimento reduzido. Nenhuma alteração no banco é necessária para este redesign.

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
- Histórico das últimas 50 ações administrativas e de solicitações.
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

## Gerenciar setores

Como administrador, abra **Setores → Editar** para renomear, desativar ou reativar uma área. Para desativar, primeiro transfira as pessoas ativas para outro setor (ou desative seus acessos) e conclua a avaliação dos pedidos pendentes. Os pedidos concluídos e as pessoas já desativadas permanecem vinculados para consulta.

Setores desativados não aparecem nas opções de novos pedidos ou pessoas. Ao reativar uma pessoa cujo setor foi desativado, escolha um setor ativo. Renomear mantém os vínculos e exibe o nome atual nos pedidos e nas exportações; o nome anterior fica registrado na ação do histórico. Não há exclusão física de setores.

A atualização adiciona `sectors.active` automaticamente, com os setores existentes ativos. Não apaga dados. Faça backup com o servidor parado antes de atualizar.

## Gerenciar pessoas

Como administrador, abra **Pessoas → Editar** para alterar nome, setor, perfil ou situação de acesso. O e-mail permanece como identificador de login e não é editável nesta versão. Desativar preserva os pedidos e o histórico; reativar permite entrar novamente com a senha existente. Alterar o perfil também encerra as sessões da pessoa.

Um administrador não pode desativar o próprio acesso nem reduzir o próprio perfil: outro administrador deve fazê-lo. O servidor também impede a remoção do último administrador ativo. Mudanças são registradas no histórico.

A atualização adiciona automaticamente a coluna `active` ao banco existente e mantém as contas atuais ativas. Pare o servidor e faça backup do diretório `data/` antes de atualizar. A migração é aditiva; não apaga cadastros, pedidos ou sessões.

## Testes

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
public/index.html   Interface
public/styles.css   Layout responsivo
public/app.js       Navegação e integração com a API
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
| POST | `/api/sectors` | Administrador |
| POST | `/api/sectors/:id` | Administrador da mesma organização; edita nome e situação |
| POST | `/api/users` | Administrador |
| POST | `/api/users/:id` | Administrador da mesma organização: edita nome, setor, perfil e acesso |
| POST | `/api/requests` | Autenticado |
| GET | `/api/requests/export.csv?q=busca&status=pendente&deadline=overdue` | Autenticado; mesmas permissões da lista; filtros opcionais |
| GET | `/api/requests/:id/comments?before=ID` | Autor ou administrador da mesma organização; páginas de até 50 mensagens |
| POST | `/api/requests/:id/comments` | Autor ou administrador da mesma organização; JSON com `content` |
| POST | `/api/requests/:id/deadline` | Administrador da mesma organização; JSON com `due_date` (AAAA-MM-DD ou null); apenas pendentes |
| POST | `/api/requests/:id/decision` | Administrador da mesma organização, exceto autor |

## Limites desta versão

Este MVP não é uma implantação de produção. Antes de usar dados reais de funcionários ou órgãos, configure HTTPS, persistência e backups com restauração validada, revisão de acesso e política de retenção. O cadastro de organizações está aberto; restrinja-o no ambiente institucional se necessário. A proteção de tentativas é por IP e processo, sem confiar em cabeçalhos de proxy.

Ainda não há recuperação de senha esquecida, MFA, convites por e-mail, edição de e-mail, anexos, edição de solicitações, notificações ou integração com sistemas governamentais. Não há garantia automática de conformidade com LGPD ou regras administrativas. O histórico é um registro de aplicação no banco, não uma trilha imutável de auditoria.

Faça backup com o servidor parado, copiando o diretório `data` completo (incluindo eventuais arquivos WAL/SHM). Guarde o backup fora do repositório e limite o acesso ao diretório do banco.
