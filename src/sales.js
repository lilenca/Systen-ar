import { parseAmount } from './money.js';

export const defaultProducts = [
  { id: 'camisa-blanca', name: 'Camisa blanca', price: 120000 },
  { id: 'camisa-celeste', name: 'Camisa celeste', price: 140000 },
  { id: 'camisa-rosa', name: 'Camisa rosa', price: 135000 },
  { id: 'traje', name: 'Traje', price: 520000 },
  { id: 'zapato', name: 'Zapato', price: 180000 },
  { id: 'cinto', name: 'Cinto', price: 90000 },
  { id: 'corbata', name: 'Corbata', price: 50000 },
  { id: 'chaleco', name: 'Chaleco', price: 120000 },
  { id: 'pantalon-solo', name: 'Pantalón solo', price: 180000 },
];

export const paymentMethods = ['Tarjeta de crédito', 'Tarjeta de débito', 'Efectivo', 'Transferencia'];

export function getLocalDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildCashCloseSummary(openingBalance, cashIncome, countedCash) {
  const expectedCash = Number(openingBalance || 0) + Number(cashIncome || 0);
  const actualCash = Number(countedCash || 0);
  return { expectedCash, countedCash: actualCash, cashDifference: actualCash - expectedCash };
}

function belongsToCashSession(item, cashSessionId, sessionNumber) {
  if (!cashSessionId) return true;
  if (item.cashSessionId) return item.cashSessionId === cashSessionId;
  return sessionNumber === 1;
}

export function buildSalesSummary(sales = [], dateKey = getLocalDateKey(), cashSessionId, sessionNumber = 1) {
  const todaySales = sales.filter((sale) => {
    if (!sale.soldAt) return false;
    return getLocalDateKey(sale.soldAt) === dateKey && belongsToCashSession(sale, cashSessionId, sessionNumber);
  });

  const totalRevenue = todaySales.reduce((sum, sale) => sum + Number(sale.unitPrice || 0) * Number(sale.quantity || 0), 0);
  const totalItems = todaySales.reduce((sum, sale) => sum + Number(sale.quantity || 0), 0);

  return {
    totalRevenue,
    totalItems,
    todaySales: todaySales.length,
  };
}

export function buildCashReconciliation(sales = [], contracts = [], dateKey = getLocalDateKey(), cashSessionId, sessionNumber = 1) {
  const entries = [
    ...sales
      .filter((sale) => sale.soldAt && getLocalDateKey(sale.soldAt) === dateKey && belongsToCashSession(sale, cashSessionId, sessionNumber))
      .map((sale) => ({
        id: sale.id,
        customer: sale.customer || 'Venta directa',
        customerDocument: sale.customerDocument || '',
        reference: sale.receiptNumber || `REC-${String(sale.id || '').slice(0, 8).toUpperCase()}`,
        paymentMethod: paymentMethods.includes(sale.paymentMethod) ? sale.paymentMethod : 'Efectivo',
        amount: Number(sale.unitPrice || 0) * Number(sale.quantity || 0),
        concept: sale.productName || 'Venta',
        paidAt: sale.soldAt,
      })),
    ...contracts
      .filter((contract) => contract.createdAt && getLocalDateKey(contract.createdAt) === dateKey && belongsToCashSession(contract, cashSessionId, sessionNumber) && parseAmount(contract.depositValue) > 0)
      .map((contract) => ({
        id: `contract-${contract.id}`,
        customer: contract.tenant || 'Cliente sin nombre',
        customerDocument: contract.document || '',
        reference: `CONTRATO N° ${String(contract.contractNumber || '').padStart(7, '0')}`,
        paymentMethod: paymentMethods.includes(contract.depositPaymentMethod) ? contract.depositPaymentMethod : 'Efectivo',
        amount: parseAmount(contract.depositValue),
        concept: 'Seña de alquiler',
        paidAt: contract.createdAt,
      })),
  ].sort((first, second) => second.paidAt.localeCompare(first.paidAt));

  const totalsByMethod = Object.fromEntries(paymentMethods.map((method) => [method, 0]));
  for (const entry of entries) totalsByMethod[entry.paymentMethod] += entry.amount;

  return {
    entries,
    totalsByMethod,
    totalAmount: entries.reduce((sum, entry) => sum + entry.amount, 0),
  };
}
