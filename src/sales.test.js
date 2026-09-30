import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCashCloseSummary, buildCashReconciliation, buildSalesSummary, defaultProducts, getLocalDateKey } from './sales.js';

test('sale products include the requested items without stock tracking', () => {
  assert.deepEqual(defaultProducts.filter((product) => ['corbata', 'chaleco', 'pantalon-solo'].includes(product.id)).map((product) => product.name), [
    'Corbata',
    'Chaleco',
    'Pantalón solo',
  ]);
  assert.equal(defaultProducts.some((product) => 'stock' in product), false);
});

test('summarize daily sales by revenue and number of products sold', () => {
  const sales = [
    { productId: 'camisa-blanca', productName: 'Camisa blanca', quantity: 2, unitPrice: 120000, soldAt: '2026-09-29T09:00:00.000Z' },
    { productId: 'traje', productName: 'Traje', quantity: 1, unitPrice: 450000, soldAt: '2026-09-29T12:30:00.000Z' },
    { productId: 'zapato', productName: 'Zapato', quantity: 1, unitPrice: 180000, soldAt: '2026-09-28T18:00:00.000Z' },
  ];

  assert.deepEqual(buildSalesSummary(sales, '2026-09-29'), {
    totalRevenue: 690000,
    totalItems: 3,
    todaySales: 2,
  });
});

test('reconcile daily sales and contract deposits by payment method and reference', () => {
  const result = buildCashReconciliation([
    { id: 'sale-1', productName: 'Camisa blanca', quantity: 2, unitPrice: 120000, soldAt: '2026-09-29T09:00:00.000Z', customer: 'Ana Pérez', paymentMethod: 'Tarjeta de débito', receiptNumber: 'REC-000001' },
    { id: 'sale-2', productName: 'Zapato', quantity: 1, unitPrice: 180000, soldAt: '2026-09-28T18:00:00.000Z', customer: 'Luis Vera', paymentMethod: 'Efectivo' },
  ], [
    { id: 'contract-1', contractNumber: 42, tenant: 'Carlos Díaz', depositValue: '50000', depositPaymentMethod: 'Transferencia', createdAt: '2026-09-29T10:00:00.000Z' },
    { id: 'contract-2', contractNumber: 43, tenant: 'Marta Ruiz', depositValue: '0', depositPaymentMethod: 'Efectivo', createdAt: '2026-09-29T11:00:00.000Z' },
  ], '2026-09-29');

  assert.equal(result.totalAmount, 290000);
  assert.deepEqual(result.totalsByMethod, {
    'Tarjeta de crédito': 0,
    'Tarjeta de débito': 240000,
    Efectivo: 0,
    Transferencia: 50000,
  });
  assert.deepEqual(result.entries.map(({ customer, reference }) => [customer, reference]), [
    ['Carlos Díaz', 'CONTRATO N° 0000042'],
    ['Ana Pérez', 'REC-000001'],
  ]);
});

test('cash closing compares the counted amount with opening balance plus cash payments', () => {
  assert.deepEqual(buildCashCloseSummary(500000, 240000, 730000), {
    expectedCash: 740000,
    countedCash: 730000,
    cashDifference: -10000,
  });
});

test('build local date keys from the device calendar', () => {
  assert.equal(getLocalDateKey(new Date(2026, 8, 29, 9, 30)), '2026-09-29');
});

test('cash reconciliation isolates multiple sessions opened on the same day', () => {
  const sales = [
    { id: 'first', cashSessionId: 'session-1', productName: 'Camisa', quantity: 1, unitPrice: 100000, soldAt: '2026-09-29T09:00:00.000Z' },
    { id: 'second', cashSessionId: 'session-2', productName: 'Corbata', quantity: 1, unitPrice: 50000, soldAt: '2026-09-29T12:00:00.000Z' },
  ];
  const contracts = [
    { id: 'rental-1', cashSessionId: 'session-1', contractNumber: 1, tenant: 'Ana', depositValue: '20000', depositPaymentMethod: 'Efectivo', createdAt: '2026-09-29T09:30:00.000Z' },
    { id: 'rental-2', cashSessionId: 'session-2', contractNumber: 2, tenant: 'Luis', depositValue: '15000', depositPaymentMethod: 'Efectivo', createdAt: '2026-09-29T12:30:00.000Z' },
  ];

  assert.equal(buildSalesSummary(sales, '2026-09-29', 'session-1', 1).totalRevenue, 100000);
  assert.equal(buildSalesSummary(sales, '2026-09-29', 'session-2', 2).totalRevenue, 50000);
  const firstCash = buildCashReconciliation(sales, contracts, '2026-09-29', 'session-1', 1);
  const secondCash = buildCashReconciliation(sales, contracts, '2026-09-29', 'session-2', 2);
  assert.equal(firstCash.totalAmount, 120000);
  assert.equal(secondCash.totalAmount, 65000);
  assert.deepEqual(secondCash.entries.map((entry) => entry.concept), ['Seña de alquiler', 'Corbata']);
});
