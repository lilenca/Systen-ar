export function filterContracts<T>(contracts: T[], query?: string): T[]

export function summarizeContracts(contracts: Array<{
  totalValue: string | number
  createdAt?: string
}>): {
  totalContracts: number
  totalRevenue: number
  averageTicket: number
  latestContractDate: string
}