import { parseAmount } from './money.js';

export function filterContracts(contracts, query = '') {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return contracts;

  return contracts.filter((contract) => {
    const searchableText = [
      contract.tenant,
      contract.document,
      contract.address,
      contract.phone,
      contract.suit,
      contract.color,
      Array.isArray(contract.articles) ? contract.articles.join(' ') : '',
      contract.notes,
    ].filter(Boolean).join(' ').toLowerCase();

    return searchableText.includes(normalizedQuery);
  });
}

export function summarizeContracts(contracts = []) {
  const totalContracts = contracts.length;
  const totalRevenue = contracts.reduce((sum, contract) => sum + parseAmount(contract.totalValue || 0), 0);
  const averageTicket = totalContracts ? Math.round(totalRevenue / totalContracts) : 0;

  const latestContractDate = contracts.reduce((latest, contract) => {
    if (!contract.createdAt) return latest;
    if (!latest) return contract.createdAt;
    return new Date(contract.createdAt) > new Date(latest) ? contract.createdAt : latest;
  }, '');

  return {
    totalContracts,
    totalRevenue,
    averageTicket,
    latestContractDate,
  };
}
