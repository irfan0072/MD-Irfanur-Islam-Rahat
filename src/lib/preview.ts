// pdf.js is only used for pictures and text hints, so it loads after the files are already listed.
type PdfJs = typeof import('pdfjs-dist')
let lib: Promise<PdfJs> | null = null

function loadPdfJs(): Promise<PdfJs> {
  return (lib ??= (async () => {
    const [pdfjs, worker] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ])
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    return pdfjs
  })())
}

export interface Peek {
  thumb?: string
  text: string
}

/** First-page picture plus the text of the first pages. Never throws. */
export async function peek(bytes: Uint8Array): Promise<Peek> {
  const out: Peek = { text: '' }
  try {
    const pdfjs = await loadPdfJs()
    // pdf.js takes ownership of the buffer, so hand it a copy.
    const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise
    try {
      const page = await doc.getPage(1)
      const base = page.getViewport({ scale: 1 })
      const vp = page.getViewport({ scale: 220 / base.width })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(vp.width)
      canvas.height = Math.ceil(vp.height)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport: vp }).promise
      out.thumb = canvas.toDataURL('image/webp', 0.75)
      const parts: string[] = []
      for (let i = 1; i <= Math.min(doc.numPages, 3); i++) {
        const p = i === 1 ? page : await doc.getPage(i)
        const tc = await p.getTextContent()
        parts.push(tc.items.map((it) => ('str' in it ? it.str : '')).join(' '))
      }
      out.text = parts.join('\n').replace(/[ \t]+/g, ' ').slice(0, 6000)
    } finally {
      doc.destroy()
    }
  } catch {
    /* a missing preview must never block the user */
  }
  return out
}

/** Draws every page into the given container, one after another. Returns a cancel function. */
export function renderAll(bytes: Uint8Array, host: HTMLElement, onCount?: (n: number) => void): () => void {
  let stop = false
  ;(async () => {
    try {
      const pdfjs = await loadPdfJs()
      const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise
      onCount?.(doc.numPages)
      const width = Math.min(host.clientWidth || 800, 900)
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      for (let i = 1; i <= doc.numPages && !stop; i++) {
        const page = await doc.getPage(i)
        const base = page.getViewport({ scale: 1 })
        const vp = page.getViewport({ scale: (width / base.width) * dpr })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(vp.width)
        canvas.height = Math.ceil(vp.height)
        canvas.className = 'pv-page'
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        if (stop) break
        host.appendChild(canvas)
        await page.render({ canvasContext: ctx, viewport: vp }).promise
      }
      doc.destroy()
    } catch {
      /* the caller shows a fallback link */
    }
  })()
  return () => {
    stop = true
  }
}
