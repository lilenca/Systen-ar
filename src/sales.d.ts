export type PaymentMethod = 'Tarjeta de crédito' | 'Tarjeta de débito' | 'Efectivo' | 'Transferencia'

export type SaleProduct = {
  id: string
  name: string
  price: number
}

export const defaultProducts: SaleProduct[]
export const paymentMethods: readonly PaymentMethod[]
export function getLocalDateKey(value?: Date | string): string
export function buildCashCloseSummary(openingBalance: number, cashIncome: number, countedCash: number): {
  expectedCash: number
  countedCash: number
  cashDifference: number
}

export function buildSalesSummary(sales: Array<{
  cashSessionId?: string
  soldAt?: string
  unitPrice?: number
  quantity?: number
}>, dateKey?: string, cashSessionId?: string, sessionNumber?: number): {
  totalRevenue: number
  totalItems: number
  todaySales: number
}

export function buildCashReconciliation(
  sales: Array<{
    id?: string
    cashSessionId?: string
    customer?: string
    customerDocument?: string
    receiptNumber?: string
    paymentMethod?: string
    unitPrice?: number
    quantity?: number
    productName?: string
    soldAt?: string
  }>,
  contracts: Array<{
    id?: string
    cashSessionId?: string
    tenant?: string
    document?: string
    contractNumber?: number
    depositValue?: string | number
    depositPaymentMethod?: string
    createdAt?: string
  }>,
  dateKey?: string,
  cashSessionId?: string,
  sessionNumber?: number,
): {
  entries: Array<{
    id: string
    customer: string
    customerDocument: string
    reference: string
    paymentMethod: PaymentMethod
    amount: number
    concept: string
    paidAt: string
  }>
  totalsByMethod: Record<PaymentMethod, number>
  totalAmount: number
}