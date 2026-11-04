// Textos iniciais de orientação; o administrador pode adaptar as atribuições.
const catalog = [
  [['Administração'], 'Organiza as rotinas administrativas e apoia o funcionamento dos demais setores.'],
  [['Documentação'], 'Organiza documentos, registros e arquivos e apoia sua consulta e tramitação.'],
  [['Financeiro'], 'Organiza pagamentos, recebimentos e o acompanhamento dos recursos financeiros.'],
  [['Gestão Financeira e Serviços - GFS', 'Gestão Financeira e Serviços – GFS', 'GFS'], 'Acompanha despesas e apoia a gestão dos serviços contratados pela organização.'],
  [['Marketing e Desenvolvimento de Soluções - MDS', 'Marketing e Desenvolvimento de Soluções – MDS', 'MDS'], 'Planeja ações de comunicação e propõe melhorias e soluções para a organização.'],
  [['Mobiliário'], 'Controla os móveis e acompanha pedidos de aquisição, manutenção e substituição.'],
  [['Recursos Humano', 'Recursos Humanos'], 'Apoia a gestão de pessoas e orienta sobre cadastros, rotinas e demandas da equipe.'],
  [['Suporte'], 'Recebe dúvidas e problemas dos usuários e acompanha sua resolução.'],
  [['Tecnologia', 'Tecnologia da Informação'], 'Cuida dos sistemas, equipamentos e acessos e apoia o uso da tecnologia.'],
  [['Jurídico'], 'Orienta sobre questões jurídicas e apoia a análise de documentos e contratos.'],
  [['Compras e Licitações'], 'Organiza aquisições e acompanha processos de compras e licitações, quando aplicáveis.'],
  [['Patrimônio e Almoxarifado'], 'Registra bens, controla materiais e acompanha estoques e sua distribuição.'],
];
const normalize = name => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
const descriptions = new Map(catalog.flatMap(([names, description]) => names.map(name => [normalize(name), description])));
export const defaultSectorDescription = name => descriptions.get(normalize(name)) || '';
