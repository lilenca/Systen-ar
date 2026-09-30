import { useEffect, useRef, useState, type FormEvent } from 'react'
import { jsPDF } from 'jspdf'
import { clearSession, readSession, saveSession, validateLogin } from './auth'
import { closeDailyCashSession, firebaseEnabled, findClientByDocument, loadBusinessData, loadDailyCashSession, openDailyCashSession, saveContractToFirestore, saveSaleToFirestore, type DailyCashSession } from './firebase'
import { filterContracts, summarizeContracts } from './contractInsights.js'
import { buildCashCloseSummary, buildCashReconciliation, buildSalesSummary, defaultProducts, getLocalDateKey, paymentMethods, type SaleProduct } from './sales.js'
import { parseAmount, roundAmount } from './money.js'
import loginBackground from './assets/login-background.jpg'
import './App.css'

type Contract = {
  id: string
  contractNumber: number
  cashSessionId?: string
  tenant: string
  address: string
  document: string
  phone: string
  startDate: string
  endDate: string
  articles: string[]
  articlePrices: Record<string, string>
  suit: string
  size: string
  color: string
  totalValue: string
  depositValue: string
  depositPaymentMethod: string
  notes: string
  promissoryNote: boolean
  restrictions: string
  createdAt: string
}

type ContractForm = Omit<Contract, 'id' | 'contractNumber' | 'createdAt'> & { contractNumber?: number }
type Sale = {
  id: string
  productId: string
  productName: string
  quantity: number
  unitPrice: number
  soldAt: string
  cashSessionId?: string
  customerDocument: string
  customer: string
  paymentMethod: string
  receiptNumber: string
}
type SaleForm = {
  productId: string
  quantity: number
  unitPrice: string
  customerDocument: string
  customer: string
  paymentMethod: string
}

type RegisteredClient = {
  document: string
  name: string
  phone?: string
  address?: string
  updatedAt?: string
}

const catalog = ['Traje', 'Camisa', 'Corbata', 'Zapato', 'Cinto']
const emptyContract: ContractForm = {
  tenant: '', address: '', document: '', phone: '', startDate: '', endDate: '',
  articles: [], articlePrices: {}, suit: '', size: '', color: '', totalValue: '', depositValue: '', notes: '',
  depositPaymentMethod: 'Efectivo', promissoryNote: true, restrictions: '',
}
const saleDefaultForm: SaleForm = { productId: defaultProducts[0]?.id || '', quantity: 1, unitPrice: String(defaultProducts[0]?.price || 0), customerDocument: '', customer: '', paymentMethod: 'Efectivo' }

function formatTime24(value?: string) {
  if (!value) return '--:--'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '--:--' : new Intl.DateTimeFormat('es-PY', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}

function formatDateTime24(value?: string) {
  if (!value) return 'Sin fecha'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Sin fecha' : new Intl.DateTimeFormat('es-PY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => !new URLSearchParams(window.location.search).has('login') && readSession())
  const [login, setLogin] = useState({ username: '', password: '' })
  const [loginError, setLoginError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [cashError, setCashError] = useState('')
  const [isSavingSale, setIsSavingSale] = useState(false)
  const [saleClientLookupStatus, setSaleClientLookupStatus] = useState<'idle' | 'loading' | 'found' | 'not-found' | 'error'>('idle')
  const [cashDateKey, setCashDateKey] = useState(() => getLocalDateKey())
  const [dailyCashSession, setDailyCashSession] = useState<DailyCashSession | null>(null)
  const [cashSessionStatus, setCashSessionStatus] = useState<'checking' | 'missing' | 'open' | 'closed' | 'error'>('checking')
  const [openingBalanceInput, setOpeningBalanceInput] = useState('')
  const [closingCashInput, setClosingCashInput] = useState('')
  const [isOpeningCash, setIsOpeningCash] = useState(false)
  const [isClosingCash, setIsClosingCash] = useState(false)
  const [isClosingCashDialogOpen, setIsClosingCashDialogOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [newArticle, setNewArticle] = useState('')
  const [printedContractNumber, setPrintedContractNumber] = useState<number | null>(null)
  const [view, setView] = useState<'home' | 'form' | 'review' | 'history' | 'cash' | 'clients'>('home')
  const [step, setStep] = useState(1)
  const [form, setForm] = useState<ContractForm>(emptyContract)
  const clientLookupSequence = useRef(0)
  const saleClientLookupSequence = useRef(0)
  const autoFilledClient = useRef<{ document: string; tenant: string; address: string; phone: string } | null>(null)
  const [clientLookupStatus, setClientLookupStatus] = useState<'idle' | 'loading' | 'found' | 'not-found' | 'error'>('idle')
  const [activeContractNumber, setActiveContractNumber] = useState(() => Number(localStorage.getItem('sastreria-next-contract-number') || '1'))
  const [contractNumber, setContractNumber] = useState(() => Number(localStorage.getItem('sastreria-next-contract-number') || '1'))
  const [contracts, setContracts] = useState<Contract[]>(() => {
    try { return JSON.parse(localStorage.getItem('sastreria-contracts') || '[]') } catch { return [] }
  })
  const [searchTerm, setSearchTerm] = useState('')
  const [clientSearchTerm, setClientSearchTerm] = useState('')
  const [firebaseClients, setFirebaseClients] = useState<RegisteredClient[]>(() => {
    try { return JSON.parse(localStorage.getItem('sastreria-clientes') || '[]') } catch { return [] }
  })
  const products: SaleProduct[] = defaultProducts
  const [sales, setSales] = useState<Sale[]>(() => {
    try { return JSON.parse(localStorage.getItem('sastreria-sales') || '[]') } catch { return [] }
  })
  const [saleForm, setSaleForm] = useState<SaleForm>(saleDefaultForm)

  useEffect(() => {
    const interval = window.setInterval(() => setCashDateKey(getLocalDateKey()), 60_000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    setCashSessionStatus('checking')
    void loadDailyCashSession(cashDateKey).then((session) => {
      if (cancelled) return
      setDailyCashSession(session)
      setCashSessionStatus(session?.status || 'missing')
      setCashError('')
    }).catch((error) => {
      if (cancelled) return
      setCashSessionStatus('error')
      setCashError(error instanceof Error ? error.message : 'No se pudo consultar la caja en Firebase.')
    })
    return () => { cancelled = true }
  }, [isAuthenticated, cashDateKey])

  useEffect(() => {
    if (!firebaseEnabled) return
    let cancelled = false
    void loadBusinessData(products, sales, contracts).then((data) => {
      if (cancelled) return
      setSales(data.sales as Sale[])
      setContracts(data.contracts as Contract[])
      setFirebaseClients(data.clients as RegisteredClient[])
      localStorage.setItem('sastreria-sales', JSON.stringify(data.sales))
      localStorage.setItem('sastreria-contracts', JSON.stringify(data.contracts))
      localStorage.setItem('sastreria-clientes', JSON.stringify(data.clients))
    }).catch((error) => {
      if (!cancelled) setCashError(error instanceof Error ? error.message : 'No se pudieron cargar los datos de Firebase.')
    })
    return () => { cancelled = true }
  }, [])

  const contractSummary = summarizeContracts(contracts)
  const filteredContracts = filterContracts(contracts, searchTerm)
  const clientsByDocument = new Map<string, RegisteredClient>()
  const addRegisteredClient = (client: Partial<RegisteredClient>) => {
    const document = String(client.document || '').trim()
    if (!document) return
    const previous = clientsByDocument.get(document)
    clientsByDocument.set(document, {
      ...previous,
      ...client,
      document,
      name: client.name?.trim() || previous?.name || 'Cliente sin nombre',
      phone: client.phone || previous?.phone || '',
      address: client.address || previous?.address || '',
    })
  }
  firebaseClients.forEach(addRegisteredClient)
  contracts.forEach((contract) => addRegisteredClient({ document: contract.document, name: contract.tenant, phone: contract.phone, address: contract.address, updatedAt: contract.createdAt }))
  sales.forEach((sale) => addRegisteredClient({ document: sale.customerDocument, name: sale.customer, updatedAt: sale.soldAt }))
  const registeredClients = [...clientsByDocument.values()].sort((first, second) => first.name.localeCompare(second.name, 'es'))
  const normalizedClientSearch = clientSearchTerm.trim().toLocaleLowerCase('es')
  const filteredClients = registeredClients.filter((client) => `${client.name} ${client.document} ${client.phone || ''} ${client.address || ''}`.toLocaleLowerCase('es').includes(normalizedClientSearch))
  const salesSummary = buildSalesSummary(sales, cashDateKey, dailyCashSession?.id, dailyCashSession?.sessionNumber)
  const cashReconciliation = buildCashReconciliation(sales, contracts, cashDateKey, dailyCashSession?.id, dailyCashSession?.sessionNumber)
  const todaySales = sales.filter((sale) => getLocalDateKey(sale.soldAt) === cashDateKey && (!dailyCashSession?.id || sale.cashSessionId === dailyCashSession.id || (!sale.cashSessionId && dailyCashSession.sessionNumber === 1)))
  const cashCloseSummary = buildCashCloseSummary(dailyCashSession?.openingBalance || 0, cashReconciliation.totalsByMethod.Efectivo, parseAmount(closingCashInput))
  const expectedCash = cashCloseSummary.expectedCash
  const dateLabel = new Intl.DateTimeFormat('es-PY', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(`${cashDateKey}T12:00:00`))

  const update = <K extends keyof ContractForm>(field: K, value: ContractForm[K]) => setForm((current) => ({ ...current, [field]: value }))
  const updateDocument = (value: string) => {
    clientLookupSequence.current += 1
    const previousClient = autoFilledClient.current
    autoFilledClient.current = null
    setClientLookupStatus('idle')
    setForm((current) => ({
      ...current,
      document: value,
      tenant: previousClient?.document === current.document.trim() && current.tenant === previousClient.tenant ? '' : current.tenant,
      address: previousClient?.document === current.document.trim() && current.address === previousClient.address ? '' : current.address,
      phone: previousClient?.document === current.document.trim() && current.phone === previousClient.phone ? '' : current.phone,
    }))
  }
  const lookupClient = async () => {
    const document = form.document.trim()
    if (!document || !firebaseEnabled) return

    const request = ++clientLookupSequence.current
    const currentValues = { tenant: form.tenant, address: form.address, phone: form.phone }
    setClientLookupStatus('loading')

    try {
      const client = await findClientByDocument(document)
      if (request !== clientLookupSequence.current) return
      if (!client) {
        setClientLookupStatus('not-found')
        return
      }

      autoFilledClient.current = { document, tenant: client.name, address: client.address, phone: client.phone }
      setForm((current) => request !== clientLookupSequence.current ? current : ({
        ...current,
        tenant: current.tenant === currentValues.tenant ? client.name : current.tenant,
        address: current.address === currentValues.address ? client.address : current.address,
        phone: current.phone === currentValues.phone ? client.phone : current.phone,
      }))
      setClientLookupStatus('found')
    } catch {
      if (request === clientLookupSequence.current) setClientLookupStatus('error')
    }
  }
  const lookupSaleClient = async () => {
    const document = saleForm.customerDocument.trim()
    if (!document) return
    if (!firebaseEnabled) {
      setSaleClientLookupStatus('error')
      return
    }

    const request = ++saleClientLookupSequence.current
    setSaleClientLookupStatus('loading')
    try {
      const client = await findClientByDocument(document)
      if (request !== saleClientLookupSequence.current) return
      if (!client?.name) {
        setSaleClientLookupStatus('not-found')
        return
      }
      setSaleForm((current) => current.customerDocument.trim() === document ? { ...current, customer: client.name } : current)
      setSaleClientLookupStatus('found')
    } catch {
      if (request === saleClientLookupSequence.current) setSaleClientLookupStatus('error')
    }
  }
  const handleOpenCash = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setCashError('')
    setIsOpeningCash(true)
    try {
      const session = await openDailyCashSession(cashDateKey, parseAmount(openingBalanceInput))
      setDailyCashSession(session)
      setCashSessionStatus(session.status)
      setOpeningBalanceInput('')
    } catch (error) {
      setCashError(error instanceof Error ? error.message : 'No se pudo abrir la caja.')
    } finally {
      setIsOpeningCash(false)
    }
  }
  const downloadCashReport = (session: DailyCashSession) => {
    const pdf = new jsPDF({ format: 'a4', unit: 'mm' })
    const left = 14
    const right = 196
    const width = right - left
    const gold = [214, 173, 104] as const
    const ink = [35, 29, 25] as const
    const muted = [112, 103, 93] as const
    let y = 0

    const drawBrandHeader = (continued = false) => {
      pdf.setFillColor(...ink)
      pdf.roundedRect(left, 12, width, 34, 2, 2, 'F')
      pdf.setFillColor(...gold)
      pdf.roundedRect(left + 7, 18, 22, 22, 1.5, 1.5, 'F')
      pdf.setTextColor(...ink)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(12)
      pdf.text('SV', left + 18, 31.5, { align: 'center' })
      pdf.setTextColor(248, 239, 222)
      pdf.setFontSize(15)
      pdf.text('SASTRERÍA VLADIMIR', left + 36, 24)
      pdf.setFont('helvetica', 'normal')
      pdf.setTextColor(222, 210, 193)
      pdf.setFontSize(8)
      pdf.text(`CAJA N° ${session.sessionNumber} · ${continued ? 'CONTINUACIÓN' : 'CIERRE DIARIO'}`, left + 36, 31)
      pdf.setTextColor(...gold)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(9)
      pdf.text(dateLabel.toUpperCase(), right - 7, 37, { align: 'right' })
      pdf.setFontSize(6.5)
      pdf.text(`APERTURA ${formatTime24(session.openedAt)} · CIERRE ${formatTime24(session.closedAt)}`, left + 36, 39)
      pdf.setTextColor(...ink)
    }

    const drawTableHeader = (top: number) => {
      pdf.setFillColor(...ink)
      pdf.roundedRect(left, top, width, 9, 1, 1, 'F')
      pdf.setTextColor(255, 255, 255)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(7.5)
      pdf.text('HORA', left + 3, top + 5.8)
      pdf.text('CLIENTE / CI', left + 22, top + 5.8)
      pdf.text('CONCEPTO / REFERENCIA', left + 72, top + 5.8)
      pdf.text('PAGO', left + 132, top + 5.8)
      pdf.text('IMPORTE', right - 3, top + 5.8, { align: 'right' })
      pdf.setTextColor(...ink)
    }

    drawBrandHeader()
    y = 56
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(10)
    pdf.text('RESUMEN DE CAJA', left, y)

    const summaryCards = [
      ['FONDO INICIAL', guarani(session.openingBalance)],
      ['INGRESOS DEL DÍA', guarani(cashReconciliation.totalAmount)],
      ['EFECTIVO ESPERADO', guarani(session.expectedCash || 0)],
      ['EFECTIVO CONTADO', guarani(session.countedCash || 0)],
    ]
    const cardGap = 3
    const cardWidth = (width - cardGap * 3) / 4
    summaryCards.forEach(([label, value], index) => {
      const x = left + index * (cardWidth + cardGap)
      pdf.setFillColor(247, 243, 235)
      pdf.setDrawColor(226, 216, 201)
      pdf.roundedRect(x, 60, cardWidth, 20, 1.2, 1.2, 'FD')
      pdf.setFont('helvetica', 'normal')
      pdf.setTextColor(...muted)
      pdf.setFontSize(6.5)
      pdf.text(label, x + 3, 66)
      pdf.setFont('helvetica', 'bold')
      pdf.setTextColor(...ink)
      pdf.setFontSize(8.5)
      pdf.text(value, x + 3, 74)
    })

    pdf.setFillColor(248, 239, 222)
    pdf.roundedRect(left, 83, width, 10, 1, 1, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    pdf.setTextColor(...muted)
    pdf.text('DIFERENCIA DE EFECTIVO', left + 4, 89.5)
    pdf.setTextColor(...ink)
    pdf.text(guarani(session.cashDifference || 0), right - 4, 89.5, { align: 'right' })

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9)
    pdf.setTextColor(...ink)
    pdf.text('TOTALES POR MEDIO DE PAGO', left, 103)
    const methodGap = 3
    const methodWidth = (width - methodGap * 3) / 4
    paymentMethods.forEach((method, index) => {
      const x = left + index * (methodWidth + methodGap)
      pdf.setFillColor(255, 255, 255)
      pdf.setDrawColor(226, 216, 201)
      pdf.roundedRect(x, 107, methodWidth, 18, 1.2, 1.2, 'FD')
      pdf.setFont('helvetica', 'normal')
      pdf.setTextColor(...muted)
      pdf.setFontSize(6.8)
      pdf.text(method.toUpperCase(), x + 3, 113)
      pdf.setFont('helvetica', 'bold')
      pdf.setTextColor(...ink)
      pdf.setFontSize(8.5)
      pdf.text(guarani(cashReconciliation.totalsByMethod[method]), x + 3, 120)
    })

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(10)
    pdf.setTextColor(...ink)
    pdf.text('MOVIMIENTOS DEL DÍA', left, 136)
    drawTableHeader(140)
    y = 153

    if (cashReconciliation.entries.length === 0) {
      pdf.setFont('helvetica', 'normal')
      pdf.setTextColor(...muted)
      pdf.setFontSize(9)
      pdf.text('No se registraron movimientos en esta fecha.', left + 3, y)
    }

    cashReconciliation.entries.forEach((entry, index) => {
      const time = formatTime24(entry.paidAt)
      const customerLines = pdf.splitTextToSize(entry.customer || 'Venta directa', 44)
      const documentLines = pdf.splitTextToSize(`CI ${entry.customerDocument || 'N/D'}`, 44)
      const conceptLines = pdf.splitTextToSize(entry.concept || 'Movimiento', 53)
      const referenceLines = pdf.splitTextToSize(entry.reference || 'Sin referencia', 53)
      const methodLines = pdf.splitTextToSize(entry.paymentMethod, 28)
      const detailLines = [...conceptLines, ...referenceLines]
      const contentLines = Math.max(customerLines.length + documentLines.length, detailLines.length, methodLines.length, 1)
      const rowHeight = Math.max(12, contentLines * 3.5 + 5)

      if (y + rowHeight > 278) {
        pdf.addPage()
        drawBrandHeader(true)
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(9)
        pdf.setTextColor(...ink)
        pdf.text('MOVIMIENTOS DEL DÍA · CONTINUACIÓN', left, 56)
        drawTableHeader(60)
        y = 73
      }

      if (index % 2 === 0) pdf.setFillColor(250, 248, 244)
      else pdf.setFillColor(255, 255, 255)
      pdf.rect(left, y - 4, width, rowHeight, 'F')
      pdf.setDrawColor(231, 225, 216)
      pdf.line(left, y + rowHeight - 4, right, y + rowHeight - 4)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(8)
      pdf.setTextColor(...ink)
      pdf.text(time, left + 3, y + 2)
      pdf.setFont('helvetica', 'bold')
      pdf.text(customerLines, left + 22, y + 1)
      pdf.setFont('helvetica', 'normal')
      pdf.setTextColor(...muted)
      pdf.setFontSize(7)
      pdf.text(documentLines, left + 22, y + 1 + customerLines.length * 3.5)
      pdf.setTextColor(...ink)
      pdf.setFontSize(7.5)
      pdf.text(conceptLines, left + 72, y + 1)
      pdf.setTextColor(...muted)
      pdf.setFontSize(7)
      pdf.text(referenceLines, left + 72, y + 1 + conceptLines.length * 3.5)
      pdf.setTextColor(...ink)
      pdf.setFontSize(7)
      pdf.text(methodLines, left + 132, y + 1)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(8)
      pdf.text(guarani(entry.amount), right - 3, y + 2, { align: 'right' })
      y += rowHeight
    })

    const pageCount = pdf.getNumberOfPages()
    for (let page = 1; page <= pageCount; page += 1) {
      pdf.setPage(page)
      pdf.setDrawColor(...gold)
      pdf.setLineWidth(0.4)
      pdf.line(left, 285, right, 285)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(7)
      pdf.setTextColor(...muted)
      pdf.text('SASTRERÍA VLADIMIR · CONTROL DIARIO DE CAJA', left, 290)
      pdf.text(`PÁGINA ${page} DE ${pageCount}`, right, 290, { align: 'right' })
    }

    pdf.save(`cierre-caja-${cashDateKey}-caja-${session.sessionNumber}.pdf`)
  }
  const handleCloseCash = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!dailyCashSession || cashSessionStatus !== 'open') return
    setCashError('')
    setIsClosingCash(true)
    const sessionData = {
      countedCash: cashCloseSummary.countedCash,
      expectedCash: cashCloseSummary.expectedCash,
      cashDifference: cashCloseSummary.cashDifference,
      totalsByMethod: cashReconciliation.totalsByMethod,
      totalIncome: cashReconciliation.totalAmount,
    }
    try {
      const session = await closeDailyCashSession(dailyCashSession, sessionData)
      setDailyCashSession(session)
      setCashSessionStatus('closed')
      setIsClosingCashDialogOpen(false)
      setClosingCashInput('')
      downloadCashReport(session)
    } catch (error) {
      setCashError(error instanceof Error ? error.message : 'No se pudo cerrar la caja.')
    } finally {
      setIsClosingCash(false)
    }
  }
  const toggleArticle = (article: string) => {
    const selected = form.articles.includes(article)
    update('articles', selected ? form.articles.filter((item) => item !== article) : [...form.articles, article])
    if (!selected && !form.articlePrices?.[article]) update('articlePrices', { ...(form.articlePrices || {}), [article]: '' })
  }
  const addArticle = () => {
    const article = newArticle.trim()
    if (!article || form.articles.includes(article)) return
    update('articles', [...form.articles, article])
    update('articlePrices', { ...(form.articlePrices || {}), [article]: '' })
    setNewArticle('')
  }
  const startNew = () => { clientLookupSequence.current += 1; autoFilledClient.current = null; setClientLookupStatus('idle'); setForm(emptyContract); setPrintedContractNumber(null); setActiveContractNumber(contractNumber); setStep(1); setView('form') }
  const saveContract = async (keepReview = false): Promise<Contract | null> => {
    setSaveError('')
    if (cashSessionStatus !== 'open') {
      setSaveError('Abre la caja del día antes de registrar pagos o contratos.')
      return null
    }
    setIsSaving(true)
    const contract: Contract = { ...form, totalValue: String(totalAmount), contractNumber: activeContractNumber, cashSessionId: dailyCashSession?.id, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
    let savedContract = contract

    try {
      if (firebaseEnabled) savedContract = await saveContractToFirestore(contract) as Contract
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'No se pudo guardar en Firebase.')
      setIsSaving(false)
      return null
    }

    const next = [savedContract, ...contracts]
    setContracts(next)
    setContractNumber(savedContract.contractNumber + 1)
    localStorage.setItem('sastreria-contracts', JSON.stringify(next))
    localStorage.setItem('sastreria-next-contract-number', String(savedContract.contractNumber + 1))
    setForm(savedContract)
    setPrintedContractNumber(savedContract.contractNumber)
    setActiveContractNumber(savedContract.contractNumber + 1)
    setView(keepReview ? 'review' : 'history')
    setIsSaving(false)
    return savedContract
  }
  const formatContractNumber = (value: number) => `002 - N° ${String(value).padStart(7, '0')}`
  const formatDate = (date: string) => date ? new Intl.DateTimeFormat('es-PY', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${date}T12:00:00`)) : 'Sin definir'
  const guarani = (value: string | number) => {
    const amount = parseAmount(value)
    return `GS. ${amount.toLocaleString('es-PY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  }
  const money = (value: string | number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(parseAmount(value))
  const formatGsInput = (value: string | number) => parseAmount(value).toLocaleString('es-PY', { maximumFractionDigits: 0 })
  const calculatedTotal = form.articles.reduce((sum, article) => sum + parseAmount(form.articlePrices?.[article] || 0), 0)
  const totalAmount = roundAmount(calculatedTotal || parseAmount(form.totalValue))
  const promissoryValue = roundAmount(totalAmount * 5)
  const señaAmount = Math.min(parseAmount(form.depositValue), totalAmount)
  const balanceAmount = roundAmount(totalAmount - señaAmount)
  const rentalEntries = form.articles.length ? form.articles : ['SIN ARTÍCULOS SELECCIONADOS']
  const reservePrintedNumber = () => {
    const currentNumber = Number(form.contractNumber || printedContractNumber || activeContractNumber)
    if (!form.contractNumber && printedContractNumber === null) {
      setPrintedContractNumber(currentNumber)
      setContractNumber(currentNumber + 1)
      localStorage.setItem('sastreria-next-contract-number', String(currentNumber + 1))
    }
    return currentNumber
  }
  useEffect(() => {
    if (view !== 'review' || form.contractNumber || printedContractNumber !== null) return
    const currentNumber = reservePrintedNumber()
    setForm((current) => current.contractNumber ? current : { ...current, contractNumber: currentNumber })
  }, [view, form.contractNumber, printedContractNumber])
  const printContract = async () => {
    if ('id' in form && form.id) {
      window.print()
      return
    }
    const savedContract = await saveContract(true)
    if (savedContract) setTimeout(() => window.print(), 0)
  }
  const deleteContract = (id: string) => {
    const nextContracts = contracts.filter((contract) => contract.id !== id)
    setContracts(nextContracts)
    localStorage.setItem('sastreria-contracts', JSON.stringify(nextContracts))

    if ('id' in form && form.id === id) {
      setForm(emptyContract)
      setPrintedContractNumber(null)
      setView('history')
    }
  }
  const handleSaleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setCashError('')
    if (!dailyCashSession || cashSessionStatus !== 'open') {
      setCashError('Abre la caja del día antes de registrar ventas.')
      return
    }

    const selectedProduct = products.find((product) => product.id === saleForm.productId)
    const quantity = Number(saleForm.quantity || 0)
    const unitPrice = parseAmount(saleForm.unitPrice)
    if (!selectedProduct || quantity <= 0 || unitPrice <= 0) return

    let sale: Sale = {
      id: crypto.randomUUID(),
      productId: selectedProduct.id,
      productName: selectedProduct.name,
      quantity,
      unitPrice,
      soldAt: new Date().toISOString(),
      cashSessionId: dailyCashSession.id,
      customerDocument: saleForm.customerDocument.trim(),
      customer: saleForm.customer.trim() || 'Venta directa',
      paymentMethod: saleForm.paymentMethod,
      receiptNumber: `REC-${String(sales.length + 1).padStart(7, '0')}`,
    }

    setIsSavingSale(true)
    try {
      if (firebaseEnabled) {
        const result = await saveSaleToFirestore(sale)
        sale = result.sale as Sale
      }
      const nextSales = [sale, ...sales]
      setSales(nextSales)
      localStorage.setItem('sastreria-sales', JSON.stringify(nextSales))
      setSaleForm({ ...saleDefaultForm, productId: selectedProduct.id, unitPrice: String(selectedProduct.price) })
    } catch (error) {
      setCashError(error instanceof Error ? error.message : 'No se pudo guardar la venta.')
    } finally {
      setIsSavingSale(false)
    }
  }
  const downloadSavedPdf = async () => {
    if ('id' in form && form.id) {
      downloadPdf()
      return
    }
    const savedContract = await saveContract(true)
    if (savedContract) downloadPdf(savedContract)
  }
  const downloadPdf = (savedContract?: Contract) => {
    const pdf = new jsPDF({ format: 'a4', unit: 'mm' })
    const contractId = savedContract?.contractNumber || reservePrintedNumber()
    const number = formatContractNumber(contractId)
    const pageWidth = 210
    const margin = 10
    const contentWidth = pageWidth - margin * 2
    let y = 14

    const writeParagraph = (text: string, size = 7.2) => {
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(size)
      const lines = pdf.splitTextToSize(text, contentWidth)
      pdf.text(lines, margin, y)
      y += lines.length * (size * 0.48) + 2.5
    }

    const writeClause = (label: string, text: string) => {
      const labelWidth = pdf.getTextWidth(label)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(7.2)
      pdf.text(label, margin, y)
      pdf.line(margin + labelWidth, y + 0.8, margin + labelWidth + 1.5, y + 0.8)
      pdf.setFont('helvetica', 'normal')
      const rest = pdf.splitTextToSize(text, contentWidth - labelWidth - 10)
      pdf.text(rest, margin + labelWidth + 5, y)
      y += Math.max(rest.length, 1) * 3.25 + 2.2
    }

    pdf.setTextColor(0, 0, 0)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(13)
    pdf.text('CONTRATO DE ALQUILER', 105, 12, { align: 'center' })
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    pdf.text(number, 195, 12, { align: 'right' })
    const issuedAt = savedContract?.createdAt || ('createdAt' in form && typeof form.createdAt === 'string' ? form.createdAt : new Date().toISOString())
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(6.5)
    pdf.text(`EMITIDO ${formatDateTime24(issuedAt)}`, margin, 18)

    y = 23
    writeParagraph('El presente contrato de alquiler se efectuará entre la empresa SASTRERIA VLADIMIR ubicada en las calles 14 de mayo el Carlos Antonio López y Balderrama, en la ciudad de Luque y el denominado en adelante EL CLIENTE, que han convenido en celebrar el presente contrato sobre las cláusulas y condiciones siguientes:')

    writeClause('PRIMERA:', 'SASTRERIA VLADIMIR hace entrega en este acto a EL CLIENTE de la (las) prenda(s) y/o accesorios, en perfectas condiciones, y este lo recibe conforme, para el uso de la ocasión.')
    writeClause('SEGUNDA:', 'EL CLIENTE se compromete a dar buen uso a la (las) prenda(s) y/o accesorios, de acuerdo a los usos normales, expresamente a adoptar todas las medidas que sean necesarias a efectos de mantener la integridad y calidad de la prenda alquilada, así como a prevenir cualquier tipo de daño que se pudiere causar a la misma.')
    writeClause('TERCERA:', 'Por cada día de MORA en la entrega de la (las) prenda(s) y/o accesorios, se abonará una multa equivalente a cincuenta mil guaraníes (GS.50.000).')
    writeClause('CUARTA:', 'EL CLIENTE se compromete a hacer entrega de la (las) prenda(s) y/o accesorios el día estipulado en el presente contrato. En caso de que sea feriado, el día laboral inmediatamente siguiente en horas laborables de la SASTRERIA VLADIMIR. En caso de que transcurran más de cinco (5) días calendario contados a partir de la fecha de entrega acordada entre las partes sin que EL CLIENTE haya retornado la(s) prenda(s) y/o accesorios alquilados, la SASTRERIA VLADIMIR quedará facultada para adoptar las medidas judiciales y extrajudiciales que considere pertinente a efecto de obtener el pago de reposición de la prenda.')
    writeClause('QUINTA:', 'EL CLIENTE responderá a la SASTRERIA VLADIMIR por todo daño menor, desmejoras y/o ruina parcial de la(s) prenda(s), tanto en sus partes principales como en sus accesorios.')
    writeClause('SEXTA:', 'EL CLIENTE, en ningún caso podrá realizar arreglos, modificaciones, alteraciones, lavado u otros procesos sobre la(s) prenda(s) alquiladas. En caso de hacerlo, LA SASTRERIA VLADIMIR se reserva el derecho de cobrarle al CLIENTE la totalidad del valor de reposición de la prenda correspondiente.')
    writeClause('SEPTIMA:', 'EL CLIENTE no podrá dar en uso o subarrendar la(s) prenda(s) y/o accesorios objeto del alquiler descritos en el presente contrato a terceras personas bajo ninguna circunstancia.')
    writeClause('OCTAVA:', 'SASTRERIA VLADIMIR tendrá derecho a ejercer acciones legales, civiles, mercantiles o penales pertinentes contra EL CLIENTE, en caso de que no devuelva la(s) prenda(s) y/o accesorios, en el término pactado en este contrato.')
    writeClause('NOVENA:', 'EL CLIENTE está de acuerdo con el término y condiciones de la SASTRERIA VLADIMIR para el alquiler de prendas y accesorios.')

    writeParagraph('El presente contrato ha sido convenido en la ciudad de Luque, siendo el día ........ del mes de ........ del 202......')

    const clientX = margin
    const orderX = 110
    const clientWidth = 80
    const orderWidth = 90

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(10)
    pdf.text('FICHA DEL CLIENTE', clientX, y + 5)
    pdf.text('DETALLE DE ORDEN DE PEDIDO', orderX, y + 5)
    y += 9

    pdf.rect(clientX, y, clientWidth, 68)
    pdf.rect(orderX, y, orderWidth, 68)

    const clientFields = [
      ['FIRMA', ''],
      ['NOMBRE', form.tenant || ''],
      ['C.I. N°', form.document || ''],
      ['DIRECCIÓN', form.address || ''],
      ['TELEFONO', form.phone || ''],
      ['F. RETIRO', formatDate(form.startDate) || ''],
      ['F. DEVOLUCIÓN', formatDate(form.endDate) || ''],
      ['TOTAL', guarani(totalAmount)],
      ['SEÑA', guarani(señaAmount)],
      ['SALDO', guarani(balanceAmount)],
    ]

    pdf.setFontSize(6.8)
    clientFields.forEach(([label, value], index) => {
      const rowY = y + 6 + index * 7.2
      pdf.setFont('helvetica', 'bold')
      pdf.text(label, clientX + 4, rowY)
      pdf.setFont('helvetica', 'normal')
      pdf.text(value || '__________', clientX + 32, rowY)
    })

    const orderItems = [...rentalEntries, 'TOTAL']
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(6.5)
    pdf.text('ALQUILER', orderX + 2, y + 6)
    pdf.text('CANT.', orderX + 25, y + 6)
    pdf.text('CODIGO', orderX + 41, y + 6)
    pdf.text('DETALLE', orderX + 57, y + 6)
    pdf.text('PRECIO', orderX + 80, y + 6)

    orderItems.forEach((item, index) => {
      const rowY = y + 11 + index * 5.1
      pdf.setFont('helvetica', 'normal')
      pdf.text(item.toUpperCase(), orderX + 2, rowY)
      pdf.text(item === 'TOTAL' ? '1' : '1', orderX + 26, rowY)
      pdf.text('', orderX + 42, rowY)
      pdf.text('', orderX + 58, rowY)
      pdf.text(item === 'TOTAL' ? guarani(totalAmount) : guarani(parseAmount(form.articlePrices?.[item] || 0)), orderX + 88, rowY, { align: 'right' })
    })

    y += 76

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(10)
    pdf.text('PAGARÉ A LA ORDEN', 105, y + 6, { align: 'center' })
    y += 10

    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7.2)
    pdf.text(`Vencimiento: ${formatDate(form.endDate)}`, margin, y)
    pdf.text(`Monto: ${guarani(promissoryValue)}`, 140, y)
    y += 5
    pdf.text(`Nombre: ${form.tenant || '________________'}`, margin, y)
    pdf.text(number, 150, y, { align: 'right' })
    y += 9

    pdf.text(`C.I. N° ${form.document || '________________'}`, margin, y)
    y += 6

    const pagareText = `El día ${formatDate(form.endDate)} pagaré a SASTRERIA VLADIMIR, en su local comercial de esta ciudad, el importe de guaraníes ${guarani(promissoryValue)} por igual valor recibido en mercaderías a mi (nuestra) entera satisfacción. Este documento autoriza en forma irrevocable a la consulta y a la base de datos de inforconf conforme a lo establecido en la Ley 168, como también para que se pueda proveer la información a terceros interesados.`
    const pagareLines = pdf.splitTextToSize(pagareText, contentWidth)
    pdf.text(pagareLines, margin, y)
    y += pagareLines.length * 3.4 + 7

    pdf.text('Firma __________', margin, y)
    pdf.text(`Domicilio: ${form.address || '________________'}`, 77, y)
    pdf.text(`C.I. N° ${form.document || '________________'}`, 156, y)

    pdf.save(`contrato-${String(contractId).padStart(7, '0')}.pdf`)
  }

  const handleLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!login.username.trim() || !login.password.trim()) {
      setLoginError('Debes ingresar usuario y contraseña.')
      return
    }

    if (validateLogin(login)) {
      saveSession()
      setIsAuthenticated(true)
      setLoginError('')
      return
    }

    setLoginError('Usuario o contraseña incorrectos.')
  }

  if (!isAuthenticated) return <div className="login-screen"><div className="login-visual"><img src={loginBackground} alt="Sastrería Vladimir" /><strong>SASTRERÍA<br />VLADIMIR</strong><span>ALQUILERES · CONTRATOS · ESTILO</span></div><div className="login-panel"><div className="login-logo">S</div><p className="eyebrow">SASTRERÍA VLADIMIR / ADMIN</p><h1>Acceso privado.</h1><p className="login-copy">Ingresa para gestionar contratos y documentos locales.</p><form onSubmit={handleLogin} className="login-form"><label>Usuario<input autoFocus required value={login.username} onChange={(event) => setLogin({ ...login, username: event.target.value })} placeholder="admin" /></label><label>Contraseña<input required type="password" value={login.password} onChange={(event) => setLogin({ ...login, password: event.target.value })} placeholder="••••••••" /></label>{loginError && <p className="login-error">{loginError}</p>}<button className="primary-button" type="submit">Entrar al sistema <span>↗</span></button></form><small className="login-hint">Sesión guardada solo en este dispositivo.</small></div></div>

  return <div className="app-shell">
    <header className="topbar"><button className="brand" aria-label="Volver al inicio" title="Volver al inicio" onClick={() => setView('home')}><span className="brand-mark">S</span><span>SASTRERÍA<br /><strong>CONTROL</strong></span></button><div className="topbar-actions"><div className="status"><span className="status-dot" /> {firebaseEnabled ? 'MODO FIREBASE' : 'MODO SIN CONEXIÓN'}</div><button className="header-nav-button" onClick={() => setView('clients')}>Clientes</button>{view !== 'home' && <button className="header-nav-button" onClick={() => setView('home')}>Inicio</button>}<button className="logout-button" onClick={() => { clearSession(); setIsAuthenticated(false) }}>Cerrar sesión</button></div></header>
    <main>
      {view === 'home' && <><section className="hero-section"><div><p className="eyebrow">GESTIÓN DE ALQUILERES / 01</p><h1>Contratos</h1><p className="hero-copy">Crea contratos profesionales para cada traje, guarda tu historial y trabaja desde cualquier lugar.</p><button className="primary-button" onClick={startNew}>＋ Crear nuevo contrato <span>↗</span></button></div><div className="hero-figure"><div className="figure-label">ATELIER / 24</div><div className="suit-silhouette"><div className="lapel left" /><div className="lapel right" /><div className="shirt" /><div className="tie" /></div><div className="figure-caption">ORDEN · PRECISIÓN · ESTILO</div></div></section><section className="stats-grid"><div className="stat-card"><span>Contratos</span><strong>{contractSummary.totalContracts}</strong></div><div className="stat-card"><span>Ingresos</span><strong>{money(contractSummary.totalRevenue)}</strong></div><div className="stat-card"><span>Ticket promedio</span><strong>{money(contractSummary.averageTicket)}</strong></div><div className="stat-card"><span>Último registro</span><strong>{contractSummary.latestContractDate ? formatDateTime24(contractSummary.latestContractDate) : 'Sin datos'}</strong></div></section><section className="home-grid"><button className="feature-link" onClick={() => setView('history')}><span><b>02</b><strong>Contratos guardados</strong><small>Consulta y revisa tu archivo</small></span><span className="link-arrow">↗</span></button><button className="feature-link" onClick={() => setView('cash')}><span><b>03</b><strong>Caja y ventas</strong><small>Stock, ventas del día y control</small></span><span className="link-arrow">↗</span></button><div className="feature-note"><span className="tiny-rule" /><p>Todos tus documentos permanecen guardados en este dispositivo. No necesitas internet.</p></div></section></>}
      {view === 'home' && <><section className="hero-section"><div><p className="eyebrow">GESTIÓN DE ALQUILERES / 01</p><h1>Contratos</h1><p className="hero-copy">Crea contratos profesionales para cada traje, guarda tu historial y trabaja desde cualquier lugar.</p><button className="primary-button" onClick={startNew}>＋ Crear nuevo contrato <span>↗</span></button></div><div className="hero-figure"><div className="figure-label">ATELIER / 24</div><div className="suit-silhouette"><div className="lapel left" /><div className="lapel right" /><div className="shirt" /><div className="tie" /></div><div className="figure-caption">ORDEN · PRECISIÓN · ESTILO</div></div></section><section className="stats-grid"><div className="stat-card"><span>Contratos</span><strong>{contractSummary.totalContracts}</strong></div><div className="stat-card"><span>Ingresos</span><strong>{money(contractSummary.totalRevenue)}</strong></div><div className="stat-card"><span>Ticket promedio</span><strong>{money(contractSummary.averageTicket)}</strong></div><div className="stat-card"><span>Último registro</span><strong>{contractSummary.latestContractDate ? formatDateTime24(contractSummary.latestContractDate) : 'Sin datos'}</strong></div></section><section className="home-grid"><button className="feature-link" onClick={() => setView('history')}><span><b>02</b><strong>Contratos guardados</strong><small>Consulta y revisa tu archivo</small></span><span className="link-arrow">↗</span></button><button className="feature-link" onClick={() => setView('cash')}><span><b>03</b><strong>Caja y ventas</strong><small>Stock, ventas del día y control</small></span><span className="link-arrow">↗</span></button><div className="feature-note"><span className="tiny-rule" /><p>Todos tus documentos permanecen guardados en este dispositivo. No necesitas internet.</p></div></section></>}

      {view === 'form' && <section className="workspace"><div className="workspace-heading"><div><p className="eyebrow">CONTRATO No. {String(contractNumber).padStart(4, '0')} / PASO 0{step}</p><h2>{step === 1 ? 'Datos del arrendatario' : step === 2 ? 'Artículos y valor' : 'Pagaré y restricciones'}</h2></div><button className="text-button" onClick={() => setView('home')}>Cerrar ×</button></div><div className="progress"><span className="active" /><span className={step >= 2 ? 'active' : ''} /><span className={step >= 3 ? 'active' : ''} /></div><div className="form-card"><form onSubmit={(event) => { event.preventDefault(); if (step < 3) setStep(step + 1); else setView('review') }}><div className="field-grid">
        {step === 1 && <>
          <label>CI<input required aria-label="CI" value={form.document} onChange={(event) => updateDocument(event.target.value)} onBlur={() => void lookupClient()} placeholder="Ingrese CI" autoComplete="off" />
            {!firebaseEnabled && <small>La búsqueda de clientes requiere Firebase. Puedes completar los datos manualmente.</small>}
            {clientLookupStatus === 'loading' && <small role="status">Buscando cliente...</small>}
            {clientLookupStatus === 'found' && <small role="status">Cliente encontrado. Datos completados.</small>}
            {clientLookupStatus === 'not-found' && <small role="status">No se encontró un cliente con ese CI.</small>}
            {clientLookupStatus === 'error' && <small role="alert">No se pudo consultar el cliente. Verifica la conexión y los permisos de Firebase.</small>}
          </label>
          <label>Nombre completo<input required value={form.tenant} onChange={(event) => update('tenant', event.target.value)} placeholder="Ej. Juan Pérez" /></label>
          <label>Número de teléfono<input required value={form.phone} onChange={(event) => update('phone', event.target.value)} placeholder="+57 300 000 0000" /></label>
          <label>Dirección de residencia<input required value={form.address} onChange={(event) => update('address', event.target.value)} placeholder="Calle, número, ciudad" /></label>
          <label>Inicio del contrato<input required type="date" value={form.startDate} onChange={(event) => update('startDate', event.target.value)} /></label>
          <label>Fin del contrato<input required type="date" value={form.endDate} onChange={(event) => update('endDate', event.target.value)} /></label>
        </>}
        {step === 2 && <><fieldset className="article-picker wide"><legend>Selecciona los artículos a alquilar</legend><div className="article-grid">{catalog.map((article) => <label className="article-option" key={article}><input type="checkbox" checked={form.articles.includes(article)} onChange={() => toggleArticle(article)} /><span>{form.articles.includes(article) ? '✓' : '+'}</span>{article}</label>)}{form.articles.filter((article) => !catalog.includes(article)).map((article) => <label className="article-option" key={article}><input type="checkbox" checked onChange={() => toggleArticle(article)} /><span>✓</span>{article}</label>)}</div><div className="custom-article"><input value={newArticle} onChange={(e) => setNewArticle(e.target.value)} placeholder="Otro artículo" /><button type="button" className="secondary-button" onClick={addArticle}>Agregar artículo</button></div></fieldset><div className="wide price-list"><b>Precio de cada artículo (GS.)</b>{form.articles.map((article) => <label key={article}>{article}<input type="number" min="0" value={form.articlePrices?.[article] || ''} onChange={(e) => update('articlePrices', { ...(form.articlePrices || {}), [article]: e.target.value })} placeholder="Ej. 150000" /></label>)}<strong>TOTAL: {guarani(totalAmount)}</strong></div><label>Seña abonada<input type="number" min="0" max={totalAmount} value={form.depositValue} onChange={(e) => update('depositValue', e.target.value)} placeholder="Ej. 50000" /><small>Saldo pendiente: {guarani(balanceAmount)}</small></label><label>Talla<input required value={form.size} onChange={(e) => update('size', e.target.value)} placeholder="Ej. 40R" /></label><label>Color<input required value={form.color} onChange={(e) => update('color', e.target.value)} placeholder="Ej. Negro carbón" /></label><label>Valor total del alquiler<input required type="number" min="0" value={totalAmount || ''} readOnly /></label><label className="wide">Observaciones del estado<textarea value={form.notes} onChange={(e) => update('notes', e.target.value)} placeholder="Accesorios incluidos, detalles o condiciones..." /></label></>}
        {step === 3 && <><label className="toggle wide"><input type="checkbox" checked={form.promissoryNote} onChange={(e) => update('promissoryNote', e.target.checked)} /><span className="checkmark">✓</span><span><b>Incluir pagaré automático</b><small>Se generará por {money(promissoryValue)} (5 × {money(totalAmount)}).</small></span></label><label className="wide">Restricciones y condiciones<textarea value={form.restrictions} onChange={(e) => update('restrictions', e.target.value)} placeholder="Ej. Entregar limpio y sin modificaciones..." /></label></>}
      </div><div className="form-actions">{step > 1 && <button type="button" className="secondary-button" onClick={() => setStep(step - 1)}>← Atrás</button>}<button type="submit" className="primary-button">{step < 3 ? 'Continuar' : 'Revisar contrato'} <span>↗</span></button></div></form></div></section>}

      {view === 'review' && <section className="workspace"><div className="workspace-heading"><div><p className="eyebrow">VISTA PREVIA A4 / CONTRATO No. {String(form.contractNumber || contractNumber).padStart(4, '0')}</p><h2>Revisa los datos</h2></div><button className="text-button" onClick={() => setView('form')}>Editar ✎</button></div><article className="contract-preview"><div className="contract-head"><span>SC / CONTRATO No. {String(form.contractNumber || contractNumber).padStart(4, '0')}</span><b>SASTRERÍA<br />CONTROL</b></div><h3>Contrato de arrendamiento<br />de traje formal</h3><p>Entre Sastrería Control y <strong>{form.tenant || 'el arrendatario'}</strong>, identificado con documento <strong>{form.document || 'pendiente'}</strong>, se acuerda el alquiler de los artículos descritos:</p><div className="preview-data"><div><small>ARTÍCULOS</small><strong>{form.articles.join(' · ') || 'Pendiente'}</strong></div><div><small>TRAJE / TALLA / COLOR</small><strong>{form.suit || 'Pendiente'} / {form.size || '—'} / {form.color || '—'}</strong></div><div><small>VIGENCIA</small><strong>{formatDate(form.startDate)} — {formatDate(form.endDate)}</strong></div><div><small>VALOR TOTAL</small><strong>{money(totalAmount)}</strong></div></div><p>{form.restrictions || 'El arrendatario se compromete a devolver los artículos en las mismas condiciones en que los recibe.'}</p>{form.promissoryNote && <div className="note-box"><b>PAGARÉ AUTOMÁTICO · {money(promissoryValue)}</b><span>Valor correspondiente a cinco veces el costo total del alquiler.</span></div>}<div className="signatures"><span>Firma arrendatario</span><span>Firma responsable</span></div></article>{saveError && <p className="login-error">{saveError}</p>}<div className="form-actions review-actions"><button className="secondary-button" onClick={() => setView('form')}>← Volver a editar</button><button className="primary-button" onClick={() => void printContract()}>Imprimir A4 <span>↗</span></button><button className="secondary-button" onClick={() => void downloadSavedPdf()}>Descargar PDF ↓</button><button className="save-button" disabled={isSaving} onClick={() => void saveContract()}>{isSaving ? 'Guardando...' : 'Guardar contrato'}</button></div></section>}

      {view === 'cash' && <section className="workspace">
        <div className="workspace-heading"><div><p className="eyebrow">CAJA / {dateLabel.toUpperCase()}</p><h2>Control de caja</h2><p className="cash-session-status">{cashSessionStatus === 'open' ? `CAJA N° ${dailyCashSession?.sessionNumber} ABIERTA ${formatTime24(dailyCashSession?.openedAt)} · SALDO INICIAL ${guarani(dailyCashSession?.openingBalance || 0)}` : 'CERRADA'}</p></div><div className="cash-heading-actions">{cashSessionStatus === 'open' && <button className="save-button" onClick={() => setIsClosingCashDialogOpen(true)}>Cerrar caja</button>}{cashSessionStatus === 'closed' && dailyCashSession && <button className="secondary-button" onClick={() => downloadCashReport(dailyCashSession)}>Descargar cierre PDF</button>}<button className="text-button" onClick={() => setView('home')}>Cerrar ×</button></div></div>
        {cashError && <p className="login-error" role="alert">{cashError}</p>}
        {cashSessionStatus === 'closed' ? <div className="cash-card full-width"><h3>Caja N° {dailyCashSession?.sessionNumber} cerrada · {formatTime24(dailyCashSession?.closedAt)}</h3><p>El historial de ventas y movimientos de esta caja quedó archivado en el PDF. Los contratos de alquileres se conservan en su historial.</p><button className="primary-button" onClick={() => { setOpeningBalanceInput(''); setCashSessionStatus('missing') }}>Abrir otra caja hoy <span>↗</span></button></div> : <>
          <div className="stats-grid cash-stats"><div className="stat-card"><span>Ventas hoy</span><strong>{salesSummary.todaySales}</strong></div><div className="stat-card"><span>Ingresos por ventas</span><strong>{guarani(salesSummary.totalRevenue)}</strong></div><div className="stat-card"><span>Artículos vendidos</span><strong>{salesSummary.totalItems}</strong></div></div>
          <div className="cash-grid sales-only">
            <form className="cash-card" onSubmit={(event) => void handleSaleSubmit(event)}>
              <h3>Registrar venta</h3>
              <label>Producto<select required value={saleForm.productId} onChange={(event) => { const product = products.find((item) => item.id === event.target.value); setSaleForm({ ...saleForm, productId: event.target.value, unitPrice: String(product?.price || 0) }) }}>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
              <label>Cantidad<input type="number" min="1" value={saleForm.quantity} onChange={(event) => setSaleForm({ ...saleForm, quantity: Number(event.target.value) || 1 })} /></label>
              <label>Precio unitario (GS.)<input required type="text" inputMode="numeric" value={formatGsInput(saleForm.unitPrice)} onChange={(event) => setSaleForm({ ...saleForm, unitPrice: event.target.value.replace(/\D/g, '') })} placeholder="150.000" /><small>Total de esta venta: {guarani(parseAmount(saleForm.unitPrice) * saleForm.quantity)}</small></label>
              <label>CI del comprador<input required value={saleForm.customerDocument} onChange={(event) => { saleClientLookupSequence.current += 1; setSaleClientLookupStatus('idle'); setSaleForm({ ...saleForm, customerDocument: event.target.value, customer: '' }) }} onBlur={() => void lookupSaleClient()} placeholder="Ingrese CI" autoComplete="off" />{saleClientLookupStatus === 'loading' && <small role="status">Buscando en Firebase...</small>}{saleClientLookupStatus === 'found' && <small role="status">Cliente encontrado en Firebase.</small>}{saleClientLookupStatus === 'not-found' && <small role="status">No existe ese CI en Firebase; completa el nombre para registrarlo.</small>}{saleClientLookupStatus === 'error' && <small role="alert">No se pudo consultar Firebase. Verifica la conexión.</small>}</label>
              <label>Nombre del comprador<input required value={saleForm.customer} onChange={(event) => setSaleForm({ ...saleForm, customer: event.target.value })} placeholder="Nombre y apellido" /></label>
              <label>Forma de pago<select value={saleForm.paymentMethod} onChange={(event) => setSaleForm({ ...saleForm, paymentMethod: event.target.value })}>{paymentMethods.map((method) => <option key={method} value={method}>{method}</option>)}</select></label>
              <button type="submit" className="primary-button" disabled={isSavingSale}>{isSavingSale ? 'Guardando...' : 'Guardar venta'} <span>↗</span></button>
            </form>
          </div>
          <div className="cash-card full-width">
            <h3>Arqueo del día</h3>
            <div className="payment-totals">{paymentMethods.map((method) => <div className="payment-total" key={method}><span>{method}</span><strong>{guarani(cashReconciliation.totalsByMethod[method])}</strong></div>)}<div className="payment-total payment-grand-total"><span>Total ingresado</span><strong>{guarani(cashReconciliation.totalAmount)}</strong></div></div>
            {cashReconciliation.entries.length === 0 ? <p className="cash-empty">Aún no hay cobros registrados hoy.</p> : <div className="sales-list">{cashReconciliation.entries.map((entry) => <div className="sale-row reconciliation-row" key={entry.id}><span><strong>{entry.customer}</strong><small>CI {entry.customerDocument || 'N/D'} · {entry.reference} · {entry.concept}</small></span><span>{entry.paymentMethod}</span><strong>{guarani(entry.amount)}</strong><small>{formatTime24(entry.paidAt)}</small></div>)}</div>}
          </div>
          <div className="cash-card full-width"><h3>Historial de ventas del día</h3>{todaySales.length === 0 ? <p className="cash-empty">Aún no hay ventas registradas hoy.</p> : <div className="sales-list">{todaySales.map((sale) => <div className="sale-row" key={sale.id}><span><strong>{sale.customer}</strong><small>CI {sale.customerDocument || 'N/D'} · {sale.productName} · {sale.receiptNumber || `REC-${String(sale.id).slice(0, 8).toUpperCase()}`}</small></span><span>{sale.quantity} und</span><span>{sale.paymentMethod || 'Efectivo'}</span><strong>{guarani(sale.unitPrice * sale.quantity)}</strong></div>)}</div>}</div>
        </>}
      </section>}

      {view === 'history' && <section className="workspace"><div className="workspace-heading"><div><p className="eyebrow">ARCHIVO / {contracts.length} DOCUMENTOS</p><h2>Contratos guardados</h2></div><button className="primary-button compact" onClick={startNew}>＋ Nuevo</button></div><div className="history-toolbar"><input className="search-input" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Buscar por cliente, CI o artículo" /><span className="history-summary">{filteredContracts.length} resultados</span></div>{contracts.length === 0 ? <div className="empty-state"><span>◌</span><h3>Aún no hay contratos</h3><p>Tu archivo aparecerá aquí después de guardar el primero.</p><button className="secondary-button" onClick={startNew}>Crear primer contrato</button></div> : <div className="history-list">{filteredContracts.map((contract, index) => <div className="history-row" key={contract.id}><button type="button" className="history-main" onClick={() => { setForm(contract); setView('review') }}><span className="row-number">{String(contract.contractNumber || index + 1).padStart(4, '0')}</span><span><strong>{contract.tenant}</strong><small>{contract.suit || 'Sin traje'} · {money(contract.totalValue)} · {formatDateTime24(contract.createdAt)}</small></span><span className="row-status">GUARDADO</span><span>↗</span></button><button type="button" className="delete-button" onClick={() => deleteContract(contract.id)}>Eliminar</button></div>)}</div>}{filteredContracts.length === 0 && contracts.length > 0 && <div className="empty-state compact-empty"><span>⌕</span><h3>No hay coincidencias</h3><p>Prueba otra palabra clave o limpia la búsqueda.</p><button className="secondary-button" onClick={() => setSearchTerm('')}>Ver todos</button></div>}</section>}
      {(view === 'form' || view === 'review') && <section className="workspace payment-method-section"><div className="cash-card"><h3>Pago de la seña</h3><label>Forma de pago<select value={form.depositPaymentMethod || 'Efectivo'} onChange={(event) => update('depositPaymentMethod', event.target.value)}>{paymentMethods.map((method) => <option key={method} value={method}>{method}</option>)}</select></label><small>Se registra junto al contrato y su número en el arqueo diario.</small></div></section>}
      {isAuthenticated && cashSessionStatus !== 'open' && cashSessionStatus !== 'closed' && <div className="cash-modal-backdrop"><section className="cash-modal" role="dialog" aria-modal="true" aria-labelledby="open-cash-title">
        <p className="eyebrow">NUEVA APERTURA DE CAJA / {dateLabel.toUpperCase()}</p>
        {cashSessionStatus === 'checking' ? <><h2 id="open-cash-title">Consultando caja</h2><p>Verificando la caja del día en {firebaseEnabled ? 'Firebase' : 'este dispositivo'}...</p></> : cashSessionStatus === 'error' ? <><h2 id="open-cash-title">No se pudo consultar</h2><p>{cashError || 'Verifica tu conexión y los permisos de Firebase.'}</p><div className="cash-modal-actions"><button className="secondary-button" onClick={() => { setCashSessionStatus('checking'); void loadDailyCashSession(cashDateKey).then((session) => { setDailyCashSession(session); setCashSessionStatus(session?.status || 'missing'); setCashError('') }).catch((error) => { setCashSessionStatus('error'); setCashError(error instanceof Error ? error.message : 'No se pudo consultar Firebase.') }) }}>Reintentar</button><button className="text-button" onClick={() => { clearSession(); setIsAuthenticated(false) }}>Cerrar sesión</button></div></> : <><h2 id="open-cash-title">Aún no se abrió la caja</h2><p>Ingresa el fondo inicial para abrir la caja del {dateLabel}. Las ventas y los cobros de alquiler quedarán juntos en esta caja.</p><form onSubmit={(event) => void handleOpenCash(event)}><label>Monto de apertura (GS.)<input autoFocus required type="number" min="0" step="1" value={openingBalanceInput} onChange={(event) => setOpeningBalanceInput(event.target.value)} placeholder="Ej. 500000" /></label>{cashError && <p className="login-error" role="alert">{cashError}</p>}<button type="submit" className="primary-button" disabled={isOpeningCash}>{isOpeningCash ? 'Abriendo...' : 'Abrir caja'} <span>↗</span></button></form></>}
      </section></div>}
      {isClosingCashDialogOpen && <div className="cash-modal-backdrop"><section className="cash-modal" role="dialog" aria-modal="true" aria-labelledby="close-cash-title">
        <p className="eyebrow">CIERRE DE CAJA / {dateLabel.toUpperCase()}</p><h2 id="close-cash-title">Cuenta el efectivo</h2>
        <div className="cash-close-summary"><span>Fondo inicial<strong>{guarani(dailyCashSession?.openingBalance || 0)}</strong></span><span>Efectivo esperado<strong>{guarani(expectedCash)}</strong></span><span>Ingresos totales<strong>{guarani(cashReconciliation.totalAmount)}</strong></span></div>
        <form onSubmit={(event) => void handleCloseCash(event)}><label>Efectivo contado en caja (GS.)<input autoFocus required type="number" min="0" step="1" value={closingCashInput} onChange={(event) => setClosingCashInput(event.target.value)} placeholder="Monto contado" /></label><p className="cash-difference">Diferencia: <strong>{guarani(cashCloseSummary.cashDifference)}</strong></p>{cashError && <p className="login-error" role="alert">{cashError}</p>}<div className="cash-modal-actions"><button type="button" className="secondary-button" onClick={() => setIsClosingCashDialogOpen(false)} disabled={isClosingCash}>Cancelar</button><button type="submit" className="save-button" disabled={isClosingCash}>{isClosingCash ? 'Cerrando...' : 'Cerrar caja y descargar PDF'}</button></div></form>
      </section></div>}
      {view === 'clients' && <section className="workspace clients-workspace"><div className="workspace-heading"><div><p className="eyebrow">DIRECTORIO / {registeredClients.length} CLIENTES</p><h2>Clientes registrados</h2></div></div><div className="history-toolbar"><input className="search-input" value={clientSearchTerm} onChange={(event) => setClientSearchTerm(event.target.value)} placeholder="Buscar por nombre, CI, teléfono o dirección" /><span className="history-summary">{filteredClients.length} resultados</span></div>{filteredClients.length === 0 ? <div className="empty-state compact-empty"><span>⌕</span><h3>{registeredClients.length === 0 ? 'Aún no hay clientes registrados' : 'No hay coincidencias'}</h3><p>{registeredClients.length === 0 ? 'Los clientes aparecerán aquí al guardar contratos o ventas con CI.' : 'Prueba otro nombre o número de documento.'}</p></div> : <div className="client-list">{filteredClients.map((client) => <article className="client-row" key={client.document}><span className="client-monogram">{client.name.charAt(0).toUpperCase()}</span><span className="client-primary"><strong>{client.name}</strong><small>CI {client.document}</small></span><span className="client-detail">{client.phone || 'Teléfono no registrado'}</span><span className="client-detail">{client.address || 'Dirección no registrada'}</span><span className="client-updated">{client.updatedAt ? `ACTUALIZADO ${formatDateTime24(client.updatedAt)}` : 'REGISTRADO'}</span></article>)}</div>}</section>}
    </main><footer><span>SASTRERÍA CONTROL © 2026</span><span>{firebaseEnabled ? 'DATOS SINCRONIZADOS CON FIREBASE' : 'DOCUMENTOS LOCALES · PRIVADOS'}</span></footer>
  </div>
}

export default App
