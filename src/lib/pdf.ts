// pdf-lib is loaded on demand so the first screen stays light.
let pdfLib: Promise<typeof import('pdf-lib')> | null = null
export const loadPdfLib = () => (pdfLib ??= import('pdf-lib'))

/** A real PDF starts with "%PDF-" near the top, whatever the file is called. */
export function isPdfBytes(b: Uint8Array): boolean {
  const n = Math.min(b.length, 1024)
  for (let i = 0; i + 4 < n; i++) {
    if (b[i] === 0x25 && b[i + 1] === 0x50 && b[i + 2] === 0x44 && b[i + 3] === 0x46 && b[i + 4] === 0x2d) return true
  }
  return false
}

export function isImageBytes(b: Uint8Array): boolean {
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
  const jpg = b[0] === 0xff && b[1] === 0xd8
  return png || jpg
}

export type Inspect = { ok: true; pages: number } | { ok: false; reason: 'locked' | 'damaged' }

/** Opens the file the same way the package builder will, so a file that passes here can be merged. */
export async function inspectPdf(bytes: Uint8Array): Promise<Inspect> {
  const { PDFDocument } = await loadPdfLib()
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    const pages = doc.getPages().length
    if (!pages) return { ok: false, reason: 'damaged' }
    return { ok: true, pages }
  } catch (e) {
    const msg = String((e as Error)?.message ?? e)
    return { ok: false, reason: /encrypt/i.test(msg) ? 'locked' : 'damaged' }
  }
}

/** Content fingerprint used to find exact copies. */
export async function hashBytes(b: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource))
    let s = ''
    for (const x of d) s += x.toString(16).padStart(2, '0')
    return s
  }
  // crypto.subtle is missing on plain http pages: fall back to two FNV-1a passes plus the length.
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < b.length; i++) {
    h1 = Math.imul(h1 ^ b[i], 0x01000193)
    h2 = Math.imul(h2 ^ b[b.length - 1 - i], 0x85ebca6b)
  }
  return `${b.length}-${(h1 >>> 0).toString(16)}-${(h2 >>> 0).toString(16)}`
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
