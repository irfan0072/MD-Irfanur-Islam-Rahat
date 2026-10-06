import type { TextImage } from './build'

const FAMILY = '"Hind Siliguri", "Noto Sans Bengali", "Nirmala UI", "Kohinoor Bangla", "Bangla Sangam MN", Vrinda, sans-serif'

/**
 * Lets the browser draw a line of text and returns it as a PNG.
 * The browser shapes Bangla letters correctly, which the built-in PDF fonts cannot do.
 */
export async function renderText(text: string, bold: boolean, color: string): Promise<TextImage | null> {
  const px = 72
  const weight = bold ? 700 : 500
  try {
    await document.fonts.load(`${weight} ${px}px "Hind Siliguri"`, text)
  } catch {
    /* system fonts will be used */
  }
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const font = `${weight} ${px}px ${FAMILY}`
  ctx.font = font
  canvas.width = Math.ceil(ctx.measureText(text).width) + 8
  canvas.height = Math.ceil(px * 1.5)
  ctx.font = font
  ctx.fillStyle = color
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(text, 4, px * 1.1)
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
  if (!blob) return null
  return { png: new Uint8Array(await blob.arrayBuffer()), ratio: canvas.width / canvas.height }
}
