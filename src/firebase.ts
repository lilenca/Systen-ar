import { getApps, initializeApp } from 'firebase/app'
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut as firebaseSignOut, type Unsubscribe } from 'firebase/auth'
import { collection, doc, getDoc, getDocs, getFirestore, query, runTransaction, setDoc, where, writeBatch } from 'firebase/firestore'
import { parseAmount } from './money.js'
import { getSaleDescription, getSaleTotal, type SaleRecord } from './sales.js'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const hasFirebaseConfig = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId)

export const firebaseEnabled = hasFirebaseConfig
export const firebaseApp = hasFirebaseConfig
  ? (getApps()[0] || initializeApp(firebaseConfig))
  : null
export const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null
export const firestore = firebaseApp ? getFirestore(firebaseApp) : null

export function observeAuthentication(
  onChange: (authenticated: boolean) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  if (!firebaseAuth) {
    onChange(false)
    return () => undefined
  }

  return onAuthStateChanged(
    firebaseAuth,
    (user) => onChange(Boolean(user)),
    onError,
  )
}

export async function signIn(email: string, password: string): Promise<void> {
  if (!firebaseAuth) throw new Error('Firebase no está configurado. Contacta al administrador.')
  await signInWithEmailAndPassword(firebaseAuth, email, password)
}

export async function signOut(): Promise<void> {
  if (!firebaseAuth) throw new Error('Firebase no está configurado. Contacta al administrador.')
  await firebaseSignOut(firebaseAuth)
}

export type CashWithdrawal = {
  id: string
  amount: number
  reason: string
  withdrawnAt: string
}

export type DailyCashSession = {
  id: string
  dateKey: string
  sessionNumber: number
  status: 'open' | 'closed'
  openingBalance: number
  openedAt: string
  continuesAcrossDays?: boolean
  closedAt?: string
  countedCash?: number
  expectedCash?: number
  cashDifference?: number
  totalsByMethod?: Record<string, number>
  totalIncome?: number
  withdrawals?: CashWithdrawal[]
  totalCashWithdrawals?: number
}

const localCashSessionsKey = 'sastreria-caja-sesiones'
const legacyLocalCashSessionKey = (dateKey: string) => `sastreria-caja-${dateKey}`

function getCachedCashSessions(): DailyCashSession[] {
  try {
    return JSON.parse(localStorage.getItem(localCashSessionsKey) || '[]') as DailyCashSession[]
  } catch {
    return []
  }
}

function cacheCashSession(session: DailyCashSession) {
  const sessions = getCachedCashSessions().filter((item) => item.id !== session.id)
  sessions.push(session)
  localStorage.setItem(localCashSessionsKey, JSON.stringify(sessions))
  localStorage.removeItem(legacyLocalCashSessionKey(session.dateKey))
}

function getCachedOpenCashSession(dateKey?: string): DailyCashSession | null {
  const cached = getCachedCashSessions()
    .filter((session) => (!dateKey || session.dateKey === dateKey) && session.status === 'open')
    .sort((first, second) => (second.openedAt || '').localeCompare(first.openedAt || ''))[0]
  if (cached) return cached

  if (!dateKey) return null
  try {
    const legacy = JSON.parse(localStorage.getItem(legacyLocalCashSessionKey(dateKey)) || 'null') as Partial<DailyCashSession> | null
    if (legacy?.status !== 'open') return null
    return { ...legacy, id: legacy.id || dateKey, dateKey, sessionNumber: legacy.sessionNumber || 1 } as DailyCashSession
  } catch {
    return null
  }
}

export async function loadDailyCashSession(dateKey: string): Promise<DailyCashSession | null> {
  if (!firestore) {
    const active = getCachedCashSessions()
      .filter((session) => session.status === 'open' && (session.continuesAcrossDays || session.dateKey === dateKey))
      .sort((first, second) => (second.openedAt || '').localeCompare(first.openedAt || ''))[0]
      || getCachedOpenCashSession(dateKey)
    if (!active) return null
    const session = { ...active, continuesAcrossDays: true }
    cacheCashSession(session)
    return session
  }

  const sessionsSnapshot = await getDocs(query(collection(firestore, 'cajas'), where('dateKey', '==', dateKey)))
  const sessions = sessionsSnapshot.docs.map((snapshot) => ({
    ...snapshot.data(),
    id: snapshot.id,
    dateKey,
    sessionNumber: Number(snapshot.data().sessionNumber || 1),
  })) as DailyCashSession[]
  sessions.forEach(cacheCashSession)
  const todaySession = sessions.filter((session) => session.status === 'open')
    .sort((first, second) => (second.openedAt || '').localeCompare(first.openedAt || ''))[0]
  const activePointerRef = doc(firestore, 'configuracion', 'caja-activa')
  const dailyPointerRef = doc(firestore, 'configuracion', `caja-activa-${dateKey}`)
  const activeSession = await runTransaction(firestore, async (transaction) => {
    const [pointer, dailyPointer] = await Promise.all([
      transaction.get(activePointerRef),
      transaction.get(dailyPointerRef),
    ])
    const activeId = pointer.exists()
      ? pointer.data().sessionId
      : dailyPointer.exists() ? dailyPointer.data().sessionId : todaySession?.id
    if (typeof activeId !== 'string') {
      if (!pointer.exists()) transaction.set(activePointerRef, { sessionId: null })
      return null
    }

    const activeSnapshot = await transaction.get(doc(firestore!, 'cajas', activeId))
    if (!activeSnapshot.exists() || activeSnapshot.data().status !== 'open') {
      transaction.set(activePointerRef, { sessionId: null })
      return null
    }
    if (!pointer.exists()) transaction.set(activePointerRef, { sessionId: activeId })
    return { ...activeSnapshot.data(), id: activeId, sessionNumber: Number(activeSnapshot.data().sessionNumber || 1) } as DailyCashSession
  })
  if (activeSession) cacheCashSession(activeSession)
  return activeSession
}

export async function openDailyCashSession(dateKey: string, openingBalance: number): Promise<DailyCashSession> {
  const currentSession = await loadDailyCashSession(dateKey)
  if (currentSession) return currentSession
  const openedAt = new Date().toISOString()

  if (firestore) {
    const existingSessions = await getDocs(query(collection(firestore, 'cajas'), where('dateKey', '==', dateKey)))
    const storedSessionNumbers = [
      ...existingSessions.docs.map((snapshot) => Number(snapshot.data().sessionNumber || 1)),
      ...getCachedCashSessions().filter((session) => session.dateKey === dateKey).map((session) => session.sessionNumber),
    ]
    const firstAvailableSessionNumber = Math.max(0, ...storedSessionNumbers) + 1
    const session = await runTransaction(firestore, async (transaction) => {
      const activePointerRef = doc(firestore!, 'configuracion', 'caja-activa')
      const pointerRef = doc(firestore, 'configuracion', `caja-activa-${dateKey}`)
      const counterRef = doc(firestore, 'configuracion', `caja-contador-${dateKey}`)
      const [activePointerSnapshot, counterSnapshot] = await Promise.all([
        transaction.get(activePointerRef),
        transaction.get(counterRef),
      ])
      const activeId = activePointerSnapshot.data()?.sessionId
      if (typeof activeId === 'string') {
        const activeRef = doc(firestore, 'cajas', activeId)
        const activeSnapshot = await transaction.get(activeRef)
        if (activeSnapshot.exists() && activeSnapshot.data().status === 'open') {
          return { ...activeSnapshot.data(), id: activeId } as DailyCashSession
        }
      }
      const sessionNumber = Math.max(Number(counterSnapshot.data()?.nextNumber || 1), firstAvailableSessionNumber)
      const id = `${dateKey}-${String(sessionNumber).padStart(3, '0')}`
      const sessionRef = doc(firestore, 'cajas', id)
      const openedSession: DailyCashSession = { id, dateKey, sessionNumber, status: 'open', openingBalance, openedAt }
      transaction.set(sessionRef, openedSession)
      transaction.set(counterRef, { nextNumber: sessionNumber + 1 }, { merge: true })
      transaction.set(pointerRef, { dateKey, sessionId: id }, { merge: true })
      transaction.set(activePointerRef, { sessionId: id })
      return openedSession
    })
    cacheCashSession(session)
    return session
  }

  const sessions = getCachedCashSessions().filter((item) => item.dateKey === dateKey)
  const sessionNumber = sessions.reduce((next, item) => Math.max(next, item.sessionNumber + 1), 1)
  const session: DailyCashSession = { id: `${dateKey}-${String(sessionNumber).padStart(3, '0')}`, dateKey, sessionNumber, status: 'open', openingBalance, openedAt, continuesAcrossDays: true }
  cacheCashSession(session)
  return session
}

export async function recordCashWithdrawal(
  sessionToUpdate: DailyCashSession,
  withdrawal: CashWithdrawal,
): Promise<DailyCashSession> {
  const sessionRef = firestore ? doc(firestore, 'cajas', sessionToUpdate.id) : null

  if (firestore && sessionRef) {
    const session = await runTransaction(firestore, async (transaction) => {
      const snapshot = await transaction.get(sessionRef)
      if (!snapshot.exists()) throw new Error('No se encontró la sesión de caja.')
      const current = { ...snapshot.data(), id: sessionToUpdate.id, dateKey: sessionToUpdate.dateKey } as DailyCashSession
      if (current.status !== 'open') throw new Error('No se pueden registrar retiros en una caja cerrada.')
      if (current.withdrawals?.some((item) => item.id === withdrawal.id)) return current

      const updatedSession = { ...current, withdrawals: [...(current.withdrawals || []), withdrawal] }
      transaction.set(sessionRef, updatedSession)
      return updatedSession
    })
    cacheCashSession(session)
    return session
  }

  const current = getCachedCashSessions().find((session) => session.id === sessionToUpdate.id)
    || getCachedOpenCashSession(sessionToUpdate.dateKey)
  if (!current) throw new Error('No se encontró la sesión de caja.')
  if (current.status !== 'open') throw new Error('No se pueden registrar retiros en una caja cerrada.')
  if (current.withdrawals?.some((item) => item.id === withdrawal.id)) return current

  const session = { ...current, withdrawals: [...(current.withdrawals || []), withdrawal] }
  cacheCashSession(session)
  return session
}

export async function closeDailyCashSession(
  sessionToClose: DailyCashSession,
  closing: Pick<DailyCashSession, 'countedCash' | 'expectedCash' | 'cashDifference' | 'totalsByMethod' | 'totalIncome' | 'totalCashWithdrawals'>,
): Promise<DailyCashSession> {
  const sessionRef = firestore ? doc(firestore, 'cajas', sessionToClose.id) : null

  if (firestore && sessionRef) {
    const session = await runTransaction(firestore, async (transaction) => {
      const pointerRef = doc(firestore, 'configuracion', `caja-activa-${sessionToClose.dateKey}`)
      const activePointerRef = doc(firestore, 'configuracion', 'caja-activa')
      const [snapshot, pointerSnapshot, activePointerSnapshot] = await Promise.all([
        transaction.get(sessionRef),
        transaction.get(pointerRef),
        transaction.get(activePointerRef),
      ])
      if (!snapshot.exists()) throw new Error('Todavía no se abrió la caja de hoy.')
      const current = { ...snapshot.data(), id: sessionToClose.id, dateKey: sessionToClose.dateKey } as DailyCashSession
      if (current.status !== 'open') throw new Error('La caja de hoy ya está cerrada.')
      const closedSession: DailyCashSession = { ...current, ...closing, status: 'closed', closedAt: new Date().toISOString() }
      transaction.set(sessionRef, closedSession)
      if (pointerSnapshot.data()?.sessionId === sessionToClose.id) {
        transaction.set(pointerRef, { dateKey: sessionToClose.dateKey, sessionId: null }, { merge: true })
      }
      if (activePointerSnapshot.data()?.sessionId === sessionToClose.id) {
        transaction.set(activePointerRef, { sessionId: null })
      }
      return closedSession
    })
    cacheCashSession(session)
    return session
  }

  const current = getCachedCashSessions().find((session) => session.id === sessionToClose.id) || getCachedOpenCashSession(sessionToClose.dateKey)
  if (!current) throw new Error('Todavía no se abrió la caja de hoy.')
  if (current.status !== 'open') throw new Error('La caja de hoy ya está cerrada.')
  const session: DailyCashSession = { ...current, ...closing, status: 'closed', closedAt: new Date().toISOString() }
  cacheCashSession(session)
  return session
}

function saleMovement(sale: Record<string, unknown>) {
  return {
    id: String(sale.id),
    type: 'venta',
    cashSessionId: sale.cashSessionId || '',
    customer: sale.customer || 'Venta directa',
    customerDocument: sale.customerDocument || '',
    reference: sale.receiptNumber || `REC-${String(sale.id).slice(0, 8).toUpperCase()}`,
    paymentMethod: sale.paymentMethod || 'Efectivo',
    amount: getSaleTotal(sale as SaleRecord),
    concept: getSaleDescription(sale as SaleRecord),
    paidAt: sale.soldAt,
  }
}

function depositMovement(contract: Record<string, unknown>) {
  const contractId = String(contract.id)
  const depositValue = typeof contract.depositValue === 'string' || typeof contract.depositValue === 'number'
    ? contract.depositValue
    : 0
  return {
    id: `contrato-${contractId}`,
    type: 'seña',
    cashSessionId: contract.cashSessionId || '',
    customer: contract.tenant || 'Cliente sin nombre',
    customerDocument: contract.document || '',
    reference: `CONTRATO N° ${String(contract.contractNumber || '').padStart(7, '0')}`,
    paymentMethod: contract.depositPaymentMethod || 'Efectivo',
    amount: parseAmount(depositValue),
    concept: 'Seña de alquiler',
    paidAt: contract.createdAt,
  }
}

async function saveDocuments(documents: Array<{ collectionName: string; id: string; data: Record<string, unknown> }>) {
  if (!firestore) return
  for (let offset = 0; offset < documents.length; offset += 450) {
    const batch = writeBatch(firestore)
    for (const item of documents.slice(offset, offset + 450)) {
      batch.set(doc(firestore, item.collectionName, item.id), item.data, { merge: true })
    }
    await batch.commit()
  }
}

export async function loadBusinessData(
  fallbackProducts: Array<{ id: string; name: string; price: number }>,
  fallbackSales: Array<Record<string, unknown>>,
  fallbackContracts: Array<Record<string, unknown>>,
) {
  if (!firestore) return { products: fallbackProducts, sales: fallbackSales, contracts: fallbackContracts, cashMovements: [], clients: [], nextContractNumber: 1 }

  const [salesSnapshot, contractsSnapshot, cashSnapshot, clientsSnapshot, counterSnapshot] = await Promise.all([
    getDocs(collection(firestore, 'ventas')),
    getDocs(collection(firestore, 'contratos')),
    getDocs(collection(firestore, 'caja')),
    getDocs(collection(firestore, 'clientes')).catch(() => null),
    getDoc(doc(firestore, 'configuracion', 'contratos')),
  ])

  const sales: Array<Record<string, unknown>> = salesSnapshot.empty
    ? fallbackSales.map((sale): Record<string, unknown> => ({ ...sale, paymentMethod: sale.paymentMethod || 'Efectivo' }))
    : salesSnapshot.docs.map((snapshot): Record<string, unknown> => ({ ...snapshot.data(), id: snapshot.id }))
  const contracts: Array<Record<string, unknown>> = contractsSnapshot.empty
    ? fallbackContracts
    : contractsSnapshot.docs.map((snapshot): Record<string, unknown> => ({ ...snapshot.data(), id: snapshot.id }))
  const clients = clientsSnapshot?.docs.map((snapshot) => ({ ...snapshot.data(), document: snapshot.id })) || []

  const documentsToSave: Array<{ collectionName: string; id: string; data: Record<string, unknown> }> = []
  if (salesSnapshot.empty) {
    sales.forEach((sale) => documentsToSave.push({ collectionName: 'ventas', id: String(sale.id), data: sale }))
  }
  if (contractsSnapshot.empty) {
    contracts.forEach((contract) => documentsToSave.push({ collectionName: 'contratos', id: String(contract.id), data: contract }))
  }

  const cashMovements = cashSnapshot.docs.map((snapshot) => ({ ...snapshot.data(), id: snapshot.id }))
  const movementIds = new Set(cashMovements.map((movement) => String(movement.id)))
  for (const sale of sales) {
    const movement = saleMovement(sale)
    if (!movementIds.has(movement.id)) {
      cashMovements.push(movement)
      documentsToSave.push({ collectionName: 'caja', id: movement.id, data: movement })
    }
  }
  for (const contract of contracts) {
    const movement = depositMovement(contract)
    if (movement.amount > 0 && !movementIds.has(movement.id)) {
      cashMovements.push(movement)
      documentsToSave.push({ collectionName: 'caja', id: movement.id, data: movement })
    }
  }

  await saveDocuments(documentsToSave)
  const nextContractNumber = Math.max(
    Number(counterSnapshot.data()?.nextNumber) || 1,
    ...contracts.map((contract) => (Number(contract.contractNumber) || 0) + 1),
  )
  return { products: fallbackProducts, sales, contracts, cashMovements, clients, nextContractNumber }
}

export async function findClientByDocument(document: string) {
  const normalizedDocument = document.trim()
  if (!firestore || !normalizedDocument) return null

  const clientSnapshot = await getDoc(doc(firestore, 'clientes', normalizedDocument))
  if (!clientSnapshot.exists()) return null

  const client = clientSnapshot.data()
  return {
    name: typeof client.name === 'string' ? client.name : '',
    phone: typeof client.phone === 'string' ? client.phone : '',
    address: typeof client.address === 'string' ? client.address : '',
  }
}

export async function updateClientInFirestore(client: { document: string; name: string; phone: string; address: string }) {
  if (!firestore) return
  const updatedAt = new Date().toISOString()
  await setDoc(doc(firestore, 'clientes', client.document.trim()), {
    name: client.name.trim().toLocaleUpperCase('es'),
    document: client.document.trim(),
    phone: client.phone,
    address: client.address,
    manuallyEdited: true,
    updatedAt,
  }, { merge: true })
}

export async function renameClientInFirestore(oldDocument: string, client: { document: string; name: string; phone: string; address: string }) {
  if (!firestore) return
  const from = oldDocument.trim()
  const to = client.document.trim()
  const updatedAt = new Date().toISOString()

  if (from === to) {
    await updateClientInFirestore(client)
    return
  }

  const targetSnapshot = await getDoc(doc(firestore, 'clientes', to))
  if (targetSnapshot.exists()) throw new Error('Ya existe un cliente con esa CI.')

  const [contractsSnapshot, salesSnapshot] = await Promise.all([
    getDocs(query(collection(firestore, 'contratos'), where('document', '==', from))),
    getDocs(query(collection(firestore, 'ventas'), where('customerDocument', '==', from))),
  ])

  const batch = writeBatch(firestore)
  batch.set(doc(firestore, 'clientes', to), { name: client.name.trim().toLocaleUpperCase('es'), document: to, phone: client.phone, address: client.address, manuallyEdited: true, updatedAt })
  batch.delete(doc(firestore, 'clientes', from))
  contractsSnapshot.docs.forEach((snapshot) => batch.update(snapshot.ref, { document: to }))
  salesSnapshot.docs.forEach((snapshot) => batch.update(snapshot.ref, { customerDocument: to }))
  await batch.commit()
}

export async function saveContractToFirestore(contract: Record<string, unknown>) {
  if (!firestore) throw new Error('Firebase no está configurado.')

  const contractRef = doc(collection(firestore, 'contratos'), String(contract.id))
  const cashRef = doc(collection(firestore, 'caja'), `contrato-${String(contract.id)}`)
  const clientRef = doc(firestore, 'clientes', String(contract.document).trim())
  const counterRef = doc(firestore, 'configuracion', 'contratos')

  return runTransaction(firestore, async (transaction) => {
    const counterSnapshot = await transaction.get(counterRef)
    const nextNumber = Math.max(Number(counterSnapshot.data()?.nextNumber) || 1, Number(contract.contractNumber) || 1)
    const savedContract = {
      ...contract,
      tenant: typeof contract.tenant === 'string' ? contract.tenant.trim().toLocaleUpperCase('es') : '',
      contractNumber: nextNumber,
    }

    transaction.set(counterRef, { nextNumber: nextNumber + 1 }, { merge: true })
    transaction.set(clientRef, {
      name: savedContract.tenant,
      document: contract.document,
      phone: contract.phone,
      address: contract.address,
      updatedAt: new Date().toISOString(),
    }, { merge: true })
    transaction.set(contractRef, savedContract)
    const movement = depositMovement(savedContract)
    if (movement.amount > 0) transaction.set(cashRef, movement)

    return savedContract
  })
}

export async function saveSaleToFirestore(
  sale: Record<string, unknown>,
) {
  if (!firestore) throw new Error('Firebase no está configurado.')

  const saleRef = doc(firestore, 'ventas', String(sale.id))
  const cashRef = doc(firestore, 'caja', String(sale.id))
  const receiptCounterRef = doc(firestore, 'configuracion', 'recibos')
  const customerDocument = typeof sale.customerDocument === 'string' ? sale.customerDocument.trim() : ''
  const customerRef = customerDocument ? doc(firestore, 'clientes', customerDocument) : null

  return runTransaction(firestore, async (transaction) => {
    const [receiptCounterSnapshot, customerSnapshot] = await Promise.all([
      transaction.get(receiptCounterRef),
      customerRef ? transaction.get(customerRef) : Promise.resolve(null),
    ])
    const nextReceiptNumber = Number(receiptCounterSnapshot.data()?.nextNumber || 1)
    const savedSale = {
      ...sale,
      customer: typeof sale.customer === 'string' ? sale.customer.trim().toLocaleUpperCase('es') : '',
      receiptNumber: `REC-${String(nextReceiptNumber).padStart(7, '0')}`,
    }
    transaction.set(receiptCounterRef, { nextNumber: nextReceiptNumber + 1 }, { merge: true })
    transaction.set(saleRef, savedSale)
    transaction.set(cashRef, saleMovement(savedSale))
    if (customerRef && customerDocument) {
      const existingCustomer = customerSnapshot?.data()
      const customerName = typeof sale.customer === 'string' && sale.customer.trim()
        ? sale.customer.trim().toLocaleUpperCase('es')
        : typeof existingCustomer?.name === 'string' ? existingCustomer.name : ''
      const customerPhone = typeof sale.customerPhone === 'string' && sale.customerPhone.trim()
        ? sale.customerPhone.trim()
        : typeof existingCustomer?.phone === 'string' ? existingCustomer.phone : ''
      const customerAddress = typeof sale.customerAddress === 'string' && sale.customerAddress.trim()
        ? sale.customerAddress.trim()
        : typeof existingCustomer?.address === 'string' ? existingCustomer.address : ''
      transaction.set(customerRef, {
        name: customerName,
        document: customerDocument,
        phone: customerPhone,
        address: customerAddress,
        updatedAt: new Date().toISOString(),
      }, { merge: true })
    }
    return { sale: savedSale }
  })
}