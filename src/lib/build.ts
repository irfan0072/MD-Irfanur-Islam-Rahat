import type { PDFDocument, PDFFont, PDFImage, PDFPage, RGB } from 'pdf-lib'
import type { SealPages, SealPos, Tender } from '../types'
import { loadPdfLib } from './pdf'

export interface BuildItem {
  order: number
  title_en: string
  title_bn: string
  fileName: string
  bytes: Uint8Array
}

export interface SealOpt {
  bytes: Uint8Array
  pages: SealPages
  custom: string
  pos: SealPos
  size: number
}

/** Text drawn by the browser (used for Bangla, which the built-in PDF fonts cannot write). */
export interface TextImage {
  png: Uint8Array
  /** width divided by height */
  ratio: number
}

export interface BuildOpts {
  tender: Tender
  items: BuildItem[]
  withIndex: boolean
  seal?: SealOpt | null
  renderText?: (text: string, bold: boolean, color: string) => Promise<TextImage | null>
  now?: Date
  onProgress?: (done: number, total: number) => void
}

export interface BuildResult {
  bytes: Uint8Array
  totalPages: number
}

/** Thrown when one source file cannot be merged; carries the file name for the message. */
export class BuildError extends Error {
  constructor(public fileName: string) {
    super(`Cannot read ${fileName}`)
  }
}

const A4: [number, number] = [595.28, 841.89]
const M = 48
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function longDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!m) return isoDate
  return `${+m[3]} ${MONTH[+m[2] - 1] ?? m[2]} ${m[1]} (${isoDate})`
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Thrown when the seal cannot be applied as asked, so the package is never made without it. */
export class SealError extends Error {
  constructor(public kind: 'image' | 'pages') {
    super(`seal ${kind}`)
  }
}

export interface PageCheck {
  ok: boolean
  pages: Set<number>
  reason?: 'empty' | 'bad' | 'range'
  /** the piece of text, or the page number, that was refused */
  token?: string
}

/**
 * Reads a page list such as "1, 3-5", "1 - 3" or "১, ৩-৫".
 * Anything that is not a page of this package is refused as a whole; nothing is dropped quietly.
 */
export function checkPages(s: string, total: number): PageCheck {
  const pages = new Set<number>()
  const text = s
    .replace(/[০-৯]/g, (c) => String(c.charCodeAt(0) - 0x09e6))
    // Spaces around a dash belong to the range, so they must go before the list is split on spaces.
    .replace(/\s*[-–—]\s*/g, '-')
    .trim()
  if (!text) return { ok: false, pages, reason: 'empty' }
  for (const part of text.split(/[\s,;،]+/).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part)
    if (!m) return { ok: false, pages, reason: 'bad', token: part }
    const a = +m[1]
    const b = m[2] ? +m[2] : a
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    if (lo < 1) return { ok: false, pages, reason: 'range', token: String(lo) }
    if (hi > total) return { ok: false, pages, reason: 'range', token: String(hi) }
    for (let i = lo; i <= hi; i++) pages.add(i)
  }
  return pages.size ? { ok: true, pages } : { ok: false, pages, reason: 'empty' }
}

/** Package pages (counted from 1) that get the seal. Empty when the choice names no page. */
export function sealPageSet(mode: SealPages, custom: string, total: number, lastPages: number[]): Set<number> {
  if (mode === 'all') return new Set(Array.from({ length: total }, (_, i) => i + 1))
  if (mode === 'cover') return new Set([1])
  if (mode === 'last') return new Set(lastPages)
  const c = checkPages(custom, total)
  return c.ok ? c.pages : new Set()
}

/**
 * Where the seal goes on one page, measured from the visible bottom-left corner.
 * The picture keeps its proportions, always fits inside the page and never reaches into the footer strip.
 */
export function sealRect(f: { w: number; h: number; band: number }, imgW: number, imgH: number, pos: SealPos, size: number) {
  const gap = Math.min(f.w, f.h - f.band) * 0.05
  const maxW = Math.max(1, f.w - 2 * gap)
  const maxH = Math.max(1, f.h - f.band - 2 * gap)
  let w = f.w * size
  let h = (w * imgH) / imgW
  // A very tall or very wide picture is shrunk as a whole; it is never stretched or cut.
  const k = Math.min(1, maxW / w, maxH / h)
  w *= k
  h *= k
  const u = pos === 'br' || pos === 'tr' ? f.w - gap - w : pos === 'bl' || pos === 'tl' ? gap : (f.w - w) / 2
  const v = pos === 'tr' || pos === 'tl' ? f.h - gap - h : pos === 'c' ? f.band + (f.h - f.band - h) / 2 : f.band + gap
  return { u, v, w, h }
}

interface Frame {
  w: number
  h: number
  rot: number
  /** footer band height, already inside the frame */
  band: number
  toUser: (u: number, v: number) => { x: number; y: number }
}

export async function buildPackage(o: BuildOpts): Promise<BuildResult> {
  const { PDFDocument, StandardFonts, rgb, degrees } = await loadPdfLib()
  const out = await PDFDocument.create()
  const font = await out.embedFont(StandardFonts.Helvetica)
  const bold = await out.embedFont(StandardFonts.HelveticaBold)
  const now = o.now ?? new Date()
  const t = o.tender

  const INK = rgb(0.09, 0.13, 0.16)
  const MUTED = rgb(0.38, 0.44, 0.48)
  const LINE = rgb(0.85, 0.89, 0.9)
  const BRAND = rgb(0.059, 0.36, 0.388)
  const SOFT = rgb(0.94, 0.97, 0.97)
  const WHITE = rgb(1, 1, 1)

  const items = [...o.items].sort((a, b) => a.order - b.order)
  const srcs: PDFDocument[] = []
  for (let i = 0; i < items.length; i++) {
    try {
      srcs.push(await PDFDocument.load(items[i].bytes, { updateMetadata: false }))
    } catch {
      throw new BuildError(items[i].fileName)
    }
    o.onProgress?.(i + 1, items.length * 2 + 2)
  }
  const counts = srcs.map((s) => s.getPageCount())
  const front = 1 + (o.withIndex ? 1 : 0)
  const total = front + counts.reduce((a, b) => a + b, 0)
  let next = front + 1
  const starts = counts.map((c) => {
    const s = next
    next += c
    return s
  })

  // ---- text helpers -------------------------------------------------------
  const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim()
  const canWrite = (s: string, f: PDFFont) => {
    try {
      f.encodeText(s)
      return true
    } catch {
      return false
    }
  }
  const ascii = (s: string, f: PDFFont) => (canWrite(s, f) ? s : [...s].map((c) => (canWrite(c, f) ? c : '?')).join(''))
  const fit = (s: string, f: PDFFont, size: number, max: number) => {
    if (f.widthOfTextAtSize(s, size) <= max) return s
    let cut = s
    while (cut.length > 1 && f.widthOfTextAtSize(cut + '...', size) > max) cut = cut.slice(0, -1)
    return cut.trimEnd() + '...'
  }
  const wrap = (s: string, f: PDFFont, size: number, max: number, maxLines: number) => {
    const words = s.split(' ')
    const lines: string[] = []
    let cur = ''
    for (const w of words) {
      const trial = cur ? `${cur} ${w}` : w
      if (f.widthOfTextAtSize(trial, size) <= max || !cur) cur = trial
      else {
        lines.push(cur)
        cur = w
      }
    }
    if (cur) lines.push(cur)
    if (lines.length > maxLines) {
      const kept = lines.slice(0, maxLines)
      kept[maxLines - 1] = fit(kept[maxLines - 1] + ' ' + lines.slice(maxLines).join(' '), f, size, max)
      return kept
    }
    return lines.map((l) => fit(l, f, size, max))
  }

  const imgCache = new Map<string, PDFImage | null>()
  const textImage = async (s: string, isBold: boolean, hex: string): Promise<{ img: PDFImage; ratio: number } | null> => {
    if (!o.renderText) return null
    const key = `${isBold}|${hex}|${s}`
    if (!imgCache.has(key)) {
      const r = await o.renderText(s, isBold, hex).catch(() => null)
      imgCache.set(key, r ? await out.embedPng(r.png) : null)
    }
    const img = imgCache.get(key)
    return img ? { img, ratio: img.width / img.height } : null
  }

  /** Writes one line. Falls back to a browser-drawn picture when the PDF font lacks the letters. */
  const line = async (
    page: PDFPage, raw: unknown, x: number, y: number, size: number, f: PDFFont, color: RGB, max: number, hex = '#172126',
  ) => {
    const s = clean(raw)
    if (!s) return
    if (canWrite(s, f)) {
      page.drawText(fit(s, f, size, max), { x, y, size, font: f, color })
      return
    }
    const ti = await textImage(s, f === bold, hex)
    if (!ti) {
      page.drawText(fit(ascii(s, f), f, size, max), { x, y, size, font: f, color })
      return
    }
    // The picture is 1.5 em tall with its baseline 1.1 em from the top.
    let h = size * 1.5
    let w = h * ti.ratio
    if (w > max) {
      h *= max / w
      w = max
    }
    page.drawImage(ti.img, { x, y: y - h * (0.4 / 1.5), width: w, height: h })
  }

  const footerText = (n: number) => ascii(`${clean(t.tender_id)} | Page ${n} of ${total}`, font)

  // ---- cover --------------------------------------------------------------
  const cover = out.addPage(A4)
  const [W, H] = A4
  cover.drawRectangle({ x: 0, y: H - 172, width: W, height: 172, color: BRAND })
  cover.drawRectangle({ x: 0, y: H - 178, width: W, height: 6, color: rgb(0.96, 0.62, 0.04) })
  cover.drawText('TENDER DOCUMENT PACKAGE', { x: M, y: H - 58, size: 11, font: bold, color: rgb(0.72, 0.9, 0.89) })
  {
    const title = clean(t.title) || 'Tender'
    if (canWrite(title, bold)) {
      let size = 26
      let lines = wrap(title, bold, size, W - 2 * M, 2)
      if (lines.length > 1) {
        size = 21
        lines = wrap(title, bold, size, W - 2 * M, 2)
      }
      lines.forEach((l, i) => cover.drawText(l, { x: M, y: H - 96 - i * (size + 5), size, font: bold, color: WHITE }))
    } else {
      await line(cover, title, M, H - 96, 24, bold, WHITE, W - 2 * M, '#ffffff')
    }
    await line(cover, `Tender ID: ${clean(t.tender_id)}`, M, H - 152, 12, font, rgb(0.86, 0.95, 0.95), W - 2 * M, '#dbf2f2')
  }

  let y = H - 214
  const rows: [string, string][] = [
    ['Tender ID', clean(t.tender_id)],
    ['Tender Title', clean(t.title)],
    ['Procuring Entity', clean(t.procuring_entity)],
    ['Bidder', clean(t.bidder)],
    ['Submission Deadline', longDate(clean(t.submission_deadline))],
    ['Package Date', longDate(isoOf(now))],
  ]
  for (const [label, value] of rows) {
    cover.drawText(label, { x: M, y, size: 9.5, font: bold, color: MUTED })
    await line(cover, value || '-', M + 140, y, 11, font, INK, W - 2 * M - 140)
    cover.drawLine({ start: { x: M, y: y - 8 }, end: { x: W - M, y: y - 8 }, thickness: 0.5, color: LINE })
    y -= 23
  }

  y -= 14
  cover.drawText('Included Documents (in submission order)', { x: M, y, size: 12.5, font: bold, color: BRAND })
  y -= 12
  const tableTop = y
  const floor = 62
  const rowH = Math.max(9, Math.min(21, (tableTop - 20 - floor) / Math.max(items.length, 1)))
  const fs = Math.min(10.5, rowH * 0.62)
  cover.drawRectangle({ x: M, y: y - 18, width: W - 2 * M, height: 18, color: SOFT })
  cover.drawText('No.', { x: M + 8, y: y - 12.5, size: 8.5, font: bold, color: MUTED })
  cover.drawText('Document', { x: M + 44, y: y - 12.5, size: 8.5, font: bold, color: MUTED })
  const pagesHead = 'Pages'
  cover.drawText(pagesHead, { x: W - M - 8 - bold.widthOfTextAtSize(pagesHead, 8.5), y: y - 12.5, size: 8.5, font: bold, color: MUTED })
  y -= 18
  for (let i = 0; i < items.length; i++) {
    const base = y - rowH + (rowH - fs) / 2 + 1
    cover.drawText(String(i + 1), { x: M + 8, y: base, size: fs, font: bold, color: BRAND })
    await line(cover, items[i].title_en, M + 44, base, fs, font, INK, W - 2 * M - 44 - 60)
    const pc = String(counts[i])
    cover.drawText(pc, { x: W - M - 8 - font.widthOfTextAtSize(pc, fs), y: base, size: fs, font, color: INK })
    cover.drawLine({ start: { x: M, y: y - rowH }, end: { x: W - M, y: y - rowH }, thickness: 0.4, color: LINE })
    y -= rowH
  }
  if (!items.length) cover.drawText('No documents included.', { x: M + 8, y: y - 16, size: 10, font, color: MUTED })

  // ---- index (bonus) ------------------------------------------------------
  if (o.withIndex) {
    const ix = out.addPage(A4)
    ix.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: BRAND })
    ix.drawText('Index', { x: M, y: H - 78, size: 26, font: bold, color: BRAND })
    await line(ix, 'সূচিপত্র', M + bold.widthOfTextAtSize('Index', 26) + 14, H - 78, 20, font, MUTED, 200, '#5f6f78')
    await line(ix, `${clean(t.tender_id)}  -  ${clean(t.title)}`, M, H - 100, 10.5, font, MUTED, W - 2 * M, '#5f6f78')

    let iy = H - 132
    const colNo = M + 8
    const colEn = M + 40
    const colBn = M + 252
    const colPg = W - M - 8
    ix.drawRectangle({ x: M, y: iy - 20, width: W - 2 * M, height: 20, color: SOFT })
    ix.drawText('No.', { x: colNo, y: iy - 13.5, size: 8.5, font: bold, color: MUTED })
    ix.drawText('Document', { x: colEn, y: iy - 13.5, size: 8.5, font: bold, color: MUTED })
    await line(ix, 'নথির নাম', colBn, iy - 13.5, 8.5, bold, MUTED, 120, '#5f6f78')
    const sh = 'Starts on page'
    ix.drawText(sh, { x: colPg - bold.widthOfTextAtSize(sh, 8.5), y: iy - 13.5, size: 8.5, font: bold, color: MUTED })
    iy -= 20
    const iRow = Math.max(10, Math.min(26, (iy - floor) / Math.max(items.length, 1)))
    const ifs = Math.min(10.5, iRow * 0.52)
    for (let i = 0; i < items.length; i++) {
      const base = iy - iRow + (iRow - ifs) / 2 + 1
      ix.drawText(String(i + 1), { x: colNo, y: base, size: ifs, font: bold, color: BRAND })
      await line(ix, items[i].title_en, colEn, base, ifs, font, INK, colBn - colEn - 10)
      if (clean(items[i].title_bn) && clean(items[i].title_bn) !== clean(items[i].title_en)) {
        await line(ix, items[i].title_bn, colBn, base, ifs, font, MUTED, colPg - colBn - 70, '#42525a')
      }
      const sp = String(starts[i])
      ix.drawText(sp, { x: colPg - bold.widthOfTextAtSize(sp, ifs + 1), y: base, size: ifs + 1, font: bold, color: INK })
      const range = counts[i] > 1 ? `${starts[i]}-${starts[i] + counts[i] - 1}` : ''
      if (range) ix.drawText(range, { x: colPg - 62, y: base, size: Math.max(6.5, ifs - 2), font, color: MUTED })
      ix.drawLine({ start: { x: M, y: iy - iRow }, end: { x: W - M, y: iy - iRow }, thickness: 0.4, color: LINE })
      iy -= iRow
    }
  }

  // ---- documents ----------------------------------------------------------
  const frames: Frame[] = []
  const a4Frame = (): Frame => ({ w: W, h: H, rot: 0, band: 44, toUser: (u, v) => ({ x: u, y: v }) })
  frames.push(a4Frame())
  if (o.withIndex) frames.push(a4Frame())

  for (let i = 0; i < items.length; i++) {
    let copied: PDFPage[]
    try {
      copied = await out.copyPages(srcs[i], srcs[i].getPageIndices())
    } catch {
      throw new BuildError(items[i].fileName)
    }
    for (const page of copied) {
      out.addPage(page)
      frames.push(reserveFooterBand(page))
    }
    o.onProgress?.(items.length + i + 1, items.length * 2 + 2)
  }

  /**
   * Makes room for the footer by growing the page at its visible bottom edge.
   * The original content is not moved, scaled or covered.
   */
  function reserveFooterBand(page: PDFPage): Frame {
    const rot = ((Math.round(page.getRotation().angle / 90) * 90) % 360 + 360) % 360
    const c = page.getCropBox()
    const m = page.getMediaBox()
    const visW = rot % 180 === 0 ? c.width : c.height
    const k = Math.max(0.5, visW / A4[0])
    const band = 30 * k
    const n = { x: c.x, y: c.y, width: c.width, height: c.height }
    let strip: { x: number; y: number; width: number; height: number }
    if (rot === 0) {
      n.y -= band
      n.height += band
      strip = { x: c.x, y: c.y - band, width: c.width, height: band }
    } else if (rot === 90) {
      n.width += band
      strip = { x: c.x + c.width, y: c.y, width: band, height: c.height }
    } else if (rot === 180) {
      n.height += band
      strip = { x: c.x, y: c.y + c.height, width: c.width, height: band }
    } else {
      n.x -= band
      n.width += band
      strip = { x: c.x - band, y: c.y, width: band, height: c.height }
    }
    const x0 = Math.min(m.x, n.x)
    const y0 = Math.min(m.y, n.y)
    const x1 = Math.max(m.x + m.width, n.x + n.width)
    const y1 = Math.max(m.y + m.height, n.y + n.height)
    page.setMediaBox(x0, y0, x1 - x0, y1 - y0)
    page.setCropBox(n.x, n.y, n.width, n.height)
    // Anything that sat outside the old visible area must not show through the footer.
    page.drawRectangle({ ...strip, color: WHITE })
    const toUser = (u: number, v: number) => {
      if (rot === 90) return { x: n.x + n.width - v, y: n.y + u }
      if (rot === 180) return { x: n.x + n.width - u, y: n.y + n.height - v }
      if (rot === 270) return { x: n.x + v, y: n.y + n.height - u }
      return { x: n.x + u, y: n.y + v }
    }
    return { w: visW, h: (rot % 180 === 0 ? n.height : n.width), rot, band, toUser }
  }

  // ---- footer on every page -----------------------------------------------
  const pages = out.getPages()
  pages.forEach((page, i) => {
    const f = frames[i]
    const k = Math.max(0.5, f.w / A4[0])
    const size = 9.5 * k
    const text = footerText(i + 1)
    const tw = font.widthOfTextAtSize(text, size)
    const lineV = i < front ? 38 : f.band - 4 * k
    const textV = i < front ? 22 : f.band * 0.36
    page.drawLine({ start: f.toUser(M * k, lineV), end: f.toUser(f.w - M * k, lineV), thickness: 0.6 * k, color: LINE })
    const p = f.toUser((f.w - tw) / 2, textV)
    page.drawText(text, { x: p.x, y: p.y, size, font, color: rgb(0.2, 0.25, 0.28), rotate: degrees(f.rot) })
  })

  // ---- seal or signature (bonus) -------------------------------------------
  if (o.seal) {
    const b = o.seal.bytes
    let img: PDFImage
    try {
      img = b[0] === 0xff && b[1] === 0xd8 ? await out.embedJpg(b) : await out.embedPng(b)
    } catch {
      throw new SealError('image')
    }
    const chosen = sealPageSet(o.seal.pages, o.seal.custom, total, starts.map((s, i) => s + counts[i] - 1))
    // A seal that was asked for must land on at least one page; otherwise the user is told, not handed a bare package.
    if (!chosen.size) throw new SealError('pages')
    for (const n of chosen) {
      const page = pages[n - 1]
      const f = frames[n - 1]
      if (!page || !f) continue
      const r = sealRect(f, img.width, img.height, o.seal.pos, o.seal.size)
      const p = f.toUser(r.u, r.v)
      page.drawImage(img, { x: p.x, y: p.y, width: r.w, height: r.h, rotate: degrees(f.rot), opacity: 0.92 })
    }
  }

  out.setTitle(`${clean(t.tender_id)} Package`)
  out.setSubject(clean(t.title))
  out.setAuthor(clean(t.bidder))
  out.setCreator('Tender Package Builder')
  out.setProducer('Tender Package Builder (pdf-lib)')
  out.setCreationDate(now)
  out.setModificationDate(now)
  o.onProgress?.(items.length * 2 + 1, items.length * 2 + 2)
  const bytes = await out.save()
  return { bytes, totalPages: total }
}
