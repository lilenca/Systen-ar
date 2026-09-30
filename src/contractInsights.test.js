import test from 'node:test';
import assert from 'node:assert/strict';
import { filterContracts, summarizeContracts } from './contractInsights.js';

test('filterContracts matches tenant, document and article on a single term', () => {
  const contracts = [
    { tenant: 'Ana Lopez', document: '1234567', articles: ['Traje', 'Camisa'], totalValue: '250000' },
    { tenant: 'Carlos Ruiz', document: '7654321', articles: ['Corbata'], totalValue: '90000' },
  ];

  assert.deepEqual(filterContracts(contracts, 'ana'), [contracts[0]]);
  assert.deepEqual(filterContracts(contracts, '765'), [contracts[1]]);
  assert.deepEqual(filterContracts(contracts, 'camisa'), [contracts[0]]);
});

test('summarizeContracts returns the total income and latest contract', () => {
  const contracts = [
    { tenant: 'Ana Lopez', totalValue: '250000', createdAt: '2026-09-10T12:00:00.000Z' },
    { tenant: 'Carlos Ruiz', totalValue: '120000', createdAt: '2026-09-18T12:00:00.000Z' },
    { tenant: 'Marta Diaz', totalValue: '300000', createdAt: '2026-09-20T12:00:00.000Z' },
  ];

  assert.deepEqual(summarizeContracts(contracts), {
    totalContracts: 3,
    totalRevenue: 670000,
    averageTicket: 223333,
    latestContractDate: '2026-09-20T12:00:00.000Z',
  });
});
