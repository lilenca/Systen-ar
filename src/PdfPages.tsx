import { useEffect, useRef, useState } from 'react'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

export default function PdfPages({ url, onReady }: { url: string; onReady: (ready: boolean) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    let destroy: (() => Promise<void>) | undefined
    const container = containerRef.current
    const renderPages = async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
        const task = pdfjs.getDocument({ url })
        destroy = () => task.destroy()
        const pdf = await task.promise
        for (let number = 1; number <= pdf.numPages; number += 1) {
          if (cancelled) return
          const page = await pdf.getPage(number)
          if (cancelled) return
          const viewport = page.getViewport({ scale: 1.5 })
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          canvas.setAttribute('aria-label', `Página ${number} del contrato`)
          const context = canvas.getContext('2d')
          if (!context) throw new Error('No se pudo preparar la vista previa.')
          await page.render({ canvas, canvasContext: context, viewport }).promise
          if (cancelled) return
          container?.appendChild(canvas)
        }
        if (!cancelled) {
          setLoading(false)
          onReady(true)
        }
      } catch (reason) {
        if (!cancelled) {
          setLoading(false)
          setError(reason instanceof Error ? reason.message : 'No se pudo mostrar el PDF.')
        }
      }
    }

    void renderPages()
    return () => {
      cancelled = true
      if (destroy) void destroy().catch((reason) => console.error('No se pudo liberar la vista previa del PDF.', reason))
      container?.replaceChildren()
    }
  }, [url, onReady])

  return <div className="pdf-preview-content">
    {loading && <p role="status">Cargando vista previa del contrato...</p>}
    {error && <p role="alert">No se pudo mostrar la vista previa: {error}. Puedes descargar el PDF o abrirlo en otra pestaña.</p>}
    <div ref={containerRef} className="pdf-preview-pages" />
  </div>
}
