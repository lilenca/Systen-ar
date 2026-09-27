import { getApps, initializeApp } from 'firebase/app'
import { collection, doc, getDoc, getFirestore, runTransaction } from 'firebase/firestore'

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
export const firestore = firebaseApp ? getFirestore(firebaseApp) : null

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

export async function saveContractToFirestore(contract: Record<string, unknown>) {
  if (!firestore) throw new Error('Firebase no está configurado.')

  const contractRef = doc(collection(firestore, 'contratos'), String(contract.id))
  const clientRef = doc(firestore, 'clientes', String(contract.document).trim())
  const counterRef = doc(firestore, 'configuracion', 'contratos')

  return runTransaction(firestore, async (transaction) => {
    const counterSnapshot = await transaction.get(counterRef)
    const nextNumber = Number(counterSnapshot.data()?.nextNumber || 1)
    const savedContract = { ...contract, contractNumber: nextNumber }

    transaction.set(counterRef, { nextNumber: nextNumber + 1 }, { merge: true })
    transaction.set(clientRef, {
      name: contract.tenant,
      document: contract.document,
      phone: contract.phone,
      address: contract.address,
      updatedAt: new Date().toISOString(),
    }, { merge: true })
    transaction.set(contractRef, savedContract)

    return savedContract
  })
}