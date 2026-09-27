import { useEffect, useRef, useState, type FormEvent } from 'react'
import { jsPDF } from 'jspdf'
import { clearSession, readSession, saveSession, validateLogin } from './auth'
import { firebaseEnabled, findClientByDocument, saveContractToFirestore } from './firebase'
import { parseAmount, roundAmount } from './money.js'
import loginBackground from './assets/login-background.jpg'
import './App.css'

type Contract = {
  id: string
  contractNumber: number
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
  notes: string
  promissoryNote: boolean
  restrictions: string
  createdAt: string
}

type ContractForm = Omit<Contract, 'id' | 'contractNumber' | 'createdAt'> & { contractNumber?: number }

const catalog = ['Traje', 'Camisa', 'Corbata', 'Zapato', 'Cinto']
const emptyContract: ContractForm = {
  tenant: '', address: '', document: '', phone: '', startDate: '', endDate: '',
  articles: [], articlePrices: {}, suit: '', size: '', color: '', totalValue: '', depositValue: '', notes: '',
  promissoryNote: true, restrictions: '',
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => !new URLSearchParams(window.location.search).has('login') && readSession())
  const [login, setLogin] = useState({ username: '', password: '' })
  const [loginError, setLoginError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [newArticle, setNewArticle] = useState('')
  const [printedContractNumber, setPrintedContractNumber] = useState<number | null>(null)
  const [view, setView] = useState<'home' | 'form' | 'review' | 'history'>('home')
  const [step, setStep] = useState(1)
  const [form, setForm] = useState<ContractForm>(emptyContract)
  const clientLookupSequence = useRef(0)
  const autoFilledClient = useRef<{ document: string; tenant: string; address: string; phone: string } | null>(null)
  const [clientLookupStatus, setClientLookupStatus] = useState<'idle' | 'loading' | 'found' | 'not-found' | 'error'>('idle')
  const [activeContractNumber, setActiveContractNumber] = useState(() => Number(localStorage.getItem('sastreria-next-contract-number') || '1'))
  const [contractNumber, setContractNumber] = useState(() => Number(localStorage.getItem('sastreria-next-contract-number') || '1'))
  const [contracts, setContracts] = useState<Contract[]>(() => {
    try { return JSON.parse(localStorage.getItem('sastreria-contracts') || '[]') } catch { return [] }
  })

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
  const saveContract = async () => {
    setSaveError('')
    setIsSaving(true)
    const contract: Contract = { ...form, totalValue: String(totalAmount), contractNumber: activeContractNumber, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
    let savedContract = contract

    try {
      if (firebaseEnabled) savedContract = await saveContractToFirestore(contract) as Contract
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'No se pudo guardar en Firebase.')
      setIsSaving(false)
      return
    }

    const next = [savedContract, ...contracts]
    setContracts(next)
    setContractNumber(savedContract.contractNumber + 1)
    setActiveContractNumber(savedContract.contractNumber + 1)
    localStorage.setItem('sastreria-contracts', JSON.stringify(next))
    localStorage.setItem('sastreria-next-contract-number', String(savedContract.contractNumber + 1))
    setView('history')
    setIsSaving(false)
  }
  const formatContractNumber = (value: number) => `002 - N° ${String(value).padStart(7, '0')}`
  const formatDate = (date: string) => date ? new Intl.DateTimeFormat('es-PY', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${date}T12:00:00`)) : 'Sin definir'
  const guarani = (value: string | number) => {
    const amount = parseAmount(value)
    return `GS. ${amount.toLocaleString('es-PY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  }
  const money = (value: string | number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(parseAmount(value))
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
  const downloadPdf = () => {
    const pdf = new jsPDF({ format: 'a4', unit: 'mm' })
    const contractId = reservePrintedNumber()
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

    y = 19
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
    <header className="topbar"><button className="brand" onClick={() => setView('home')}><span className="brand-mark">S</span><span>SASTRERÍA<br /><strong>CONTROL</strong></span></button><div className="topbar-actions"><div className="status"><span className="status-dot" /> {firebaseEnabled ? 'MODO FIREBASE' : 'MODO SIN CONEXIÓN'}</div><button className="logout-button" onClick={() => { clearSession(); setIsAuthenticated(false) }}>Cerrar sesión</button></div></header>
    <main>
      {view === 'home' && <><section className="hero-section"><div><p className="eyebrow">GESTIÓN DE ALQUILERES / 01</p><h1>Contratos</h1><p className="hero-copy">Crea contratos profesionales para cada traje, guarda tu historial y trabaja desde cualquier lugar.</p><button className="primary-button" onClick={startNew}>＋ Crear nuevo contrato <span>↗</span></button></div><div className="hero-figure"><div className="figure-label">ATELIER / 24</div><div className="suit-silhouette"><div className="lapel left" /><div className="lapel right" /><div className="shirt" /><div className="tie" /></div><div className="figure-caption">ORDEN · PRECISIÓN · ESTILO</div></div></section><section className="home-grid"><button className="feature-link" onClick={() => setView('history')}><span><b>02</b><strong>Contratos guardados</strong><small>Consulta y revisa tu archivo</small></span><span className="link-arrow">↗</span></button><div className="feature-note"><span className="tiny-rule" /><p>Todos tus documentos permanecen guardados en este dispositivo. No necesitas internet.</p></div></section></>}

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

      {view === 'review' && <section className="workspace"><div className="workspace-heading"><div><p className="eyebrow">VISTA PREVIA A4 / CONTRATO No. {String(form.contractNumber || contractNumber).padStart(4, '0')}</p><h2>Revisa los datos</h2></div><button className="text-button" onClick={() => setView('form')}>Editar ✎</button></div><article className="contract-preview"><div className="contract-head"><span>SC / CONTRATO No. {String(form.contractNumber || contractNumber).padStart(4, '0')}</span><b>SASTRERÍA<br />CONTROL</b></div><h3>Contrato de arrendamiento<br />de traje formal</h3><p>Entre Sastrería Control y <strong>{form.tenant || 'el arrendatario'}</strong>, identificado con documento <strong>{form.document || 'pendiente'}</strong>, se acuerda el alquiler de los artículos descritos:</p><div className="preview-data"><div><small>ARTÍCULOS</small><strong>{form.articles.join(' · ') || 'Pendiente'}</strong></div><div><small>TRAJE / TALLA / COLOR</small><strong>{form.suit || 'Pendiente'} / {form.size || '—'} / {form.color || '—'}</strong></div><div><small>VIGENCIA</small><strong>{formatDate(form.startDate)} — {formatDate(form.endDate)}</strong></div><div><small>VALOR TOTAL</small><strong>{money(totalAmount)}</strong></div></div><p>{form.restrictions || 'El arrendatario se compromete a devolver los artículos en las mismas condiciones en que los recibe.'}</p>{form.promissoryNote && <div className="note-box"><b>PAGARÉ AUTOMÁTICO · {money(promissoryValue)}</b><span>Valor correspondiente a cinco veces el costo total del alquiler.</span></div>}<div className="signatures"><span>Firma arrendatario</span><span>Firma responsable</span></div></article>{saveError && <p className="login-error">{saveError}</p>}<div className="form-actions review-actions"><button className="secondary-button" onClick={() => setView('form')}>← Volver a editar</button><button className="primary-button" onClick={() => window.print()}>Imprimir A4 <span>↗</span></button><button className="secondary-button" onClick={downloadPdf}>Descargar PDF ↓</button><button className="save-button" disabled={isSaving} onClick={saveContract}>{isSaving ? 'Guardando...' : 'Guardar contrato'}</button></div></section>}

      {view === 'history' && <section className="workspace"><div className="workspace-heading"><div><p className="eyebrow">ARCHIVO / {contracts.length} DOCUMENTOS</p><h2>Contratos guardados</h2></div><button className="primary-button compact" onClick={startNew}>＋ Nuevo</button></div>{contracts.length === 0 ? <div className="empty-state"><span>◌</span><h3>Aún no hay contratos</h3><p>Tu archivo aparecerá aquí después de guardar el primero.</p><button className="secondary-button" onClick={startNew}>Crear primer contrato</button></div> : <div className="history-list">{contracts.map((contract, index) => <button className="history-row" key={contract.id} onClick={() => { setForm(contract); setView('review') }}><span className="row-number">{String(contract.contractNumber || index + 1).padStart(4, '0')}</span><span><strong>{contract.tenant}</strong><small>{contract.suit} · {money(contract.totalValue)}</small></span><span className="row-status">GUARDADO</span><span>↗</span></button>)}</div>}</section>}
    </main><footer><span>SASTRERÍA CONTROL © 2026</span><span>DOCUMENTOS LOCALES · PRIVADOS</span></footer>
  </div>
}

export default App
