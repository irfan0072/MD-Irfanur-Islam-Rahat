// Checks the seal rules without a browser: page-list parsing, placement maths, and real packages
// built from portrait, landscape, small and rotated pages with very wide and very tall seal pictures.
// Usage: node scripts/seal-test.mjs [folder-to-keep-the-test-PDFs]
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import zlib from 'node:zlib'
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tpb-seal-'))
const keep = process.argv[2] ? path.resolve(process.argv[2]) : null
if (keep) fs.mkdirSync(keep, { recursive: true })

// The app's own builder, bundled as it is so the test runs the shipped code.
const bundle = path.join(tmp, 'build.mjs')
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [path.join(root, 'src/lib/build.ts'), '--bundle', '--format=esm', '--platform=node', '--log-level=error', `--outfile=${bundle}`])
const { buildPackage, checkPages, sealRect, SealError } = await import(pathToFileURL(bundle).href)
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

let failed = 0
let passed = 0
const check = (name, ok, extra = '') => {
  ok ? passed++ : failed++
  if (!ok || process.env.VERBOSE) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ->  ${extra}` : ''}`)
}

// ---------------------------------------------------------------- page lists
const list = (s, total = 8) => {
  const c = checkPages(s, total)
  return c.ok ? [...c.pages].sort((a, b) => a - b).join(',') : `refused:${c.reason}`
}
for (const [input, want] of [
  ['1 - 3', '1,2,3'],
  ['1-3', '1,2,3'],
  ['1 – 3', '1,2,3'],
  ['১, ৩-৫', '1,3,4,5'],
  ['১ - ৩', '1,2,3'],
  ['5-3', '3,4,5'],
  ['1,1, 2 2', '1,2'],
  ['  2 ,  4 ; 6  ', '2,4,6'],
  ['8', '8'],
  ['1-8', '1,2,3,4,5,6,7,8'],
  ['', 'refused:empty'],
  ['   ', 'refused:empty'],
  [',', 'refused:empty'],
  ['0', 'refused:range'],
  ['0-2', 'refused:range'],
  ['9', 'refused:range'],
  ['999', 'refused:range'],
  ['7-12', 'refused:range'],
  ['1, 999', 'refused:range'],
  ['99999999999999999999', 'refused:range'],
  ['abc', 'refused:bad'],
  ['1,abc', 'refused:bad'],
  ['1-', 'refused:bad'],
  ['-3', 'refused:bad'],
  ['1.5', 'refused:bad'],
  ['1-2-3', 'refused:bad'],
  ['0,999,abc', 'refused:range'],
]) check(`page list "${input}"`, list(input) === want, `${list(input)} (wanted ${want})`)

// ------------------------------------------------------------ placement maths
const frames = { 'A4 cover': { w: 595.28, h: 841.89, band: 44 }, 'A4 document': { w: 595.28, h: 871.89, band: 30 }, landscape: { w: 841.89, h: 637.71, band: 42.43 }, 'small page': { w: 200, h: 215, band: 15 }, 'huge scan': { w: 2480, h: 3633, band: 125 } }
const shapes = { square: [400, 400], 'very wide': [3000, 40], 'very tall': [40, 3000], 'one pixel wide': [1, 2000], 'one pixel tall': [2000, 1] }
let boxes = 0
let boxFails = []
for (const [fn, f] of Object.entries(frames))
  for (const [sn, [iw, ih]] of Object.entries(shapes))
    for (const pos of ['br', 'bc', 'bl', 'tr', 'tl', 'c'])
      for (const size of [0.1, 0.2, 0.4]) {
        const r = sealRect(f, iw, ih, pos, size)
        boxes++
        const inside = r.u >= -1e-6 && r.u + r.w <= f.w + 1e-6 && r.v >= f.band - 1e-6 && r.v + r.h <= f.h + 1e-6
        const ratio = Math.abs(r.w / r.h / (iw / ih) - 1) < 1e-6
        if (!inside || !ratio || !(r.w > 0 && r.h > 0)) boxFails.push(`${fn}/${sn}/${pos}/${size}`)
      }
check(`placement maths: ${boxes} combinations stay inside the page, above the footer, in proportion`, boxFails.length === 0, boxFails.slice(0, 5).join(' '))

// ------------------------------------------------------------- real packages
function png(w, h) {
  const row = w * 4 + 1
  const raw = Buffer.alloc(row * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = y * row + 1 + x * 4
      const edge = x < 3 || y < 3 || x >= w - 3 || y >= h - 3
      raw[o] = edge ? 10 : 200
      raw[o + 1] = edge ? 20 : 40
      raw[o + 2] = edge ? 120 : 50
      raw[o + 3] = 255
    }
  const chunk = (type, data) => {
    const td = Buffer.concat([Buffer.from(type), data])
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const head = Buffer.alloc(13)
  head.writeUInt32BE(w, 0)
  head.writeUInt32BE(h, 4)
  head.set([8, 6, 0, 0, 0], 8)
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}

async function source(label, pages) {
  const d = await PDFDocument.create()
  const f = await d.embedFont(StandardFonts.HelveticaBold)
  for (const p of pages) {
    const page = d.addPage(p.size)
    const { width, height } = page.getSize()
    page.drawRectangle({ x: 1, y: 1, width: width - 2, height: height - 2, borderColor: rgb(0.2, 0.5, 0.5), borderWidth: 2 })
    page.drawText(label, { x: 12, y: height - 30, size: Math.max(8, width / 30), font: f })
    if (p.rot) page.setRotation(degrees(p.rot))
  }
  return d.save()
}
const A4 = [595.28, 841.89]
const items = [
  { order: 1, title_en: 'Portrait', title_bn: 'Portrait', fileName: 'a.pdf', bytes: await source('portrait A4, 2 pages', [{ size: A4 }, { size: A4 }]) },
  { order: 2, title_en: 'Landscape', title_bn: 'Landscape', fileName: 'b.pdf', bytes: await source('landscape', [{ size: [841.89, 595.28] }]) },
  { order: 3, title_en: 'Small', title_bn: 'Small', fileName: 'c.pdf', bytes: await source('small', [{ size: [200, 200] }]) },
  { order: 4, title_en: 'Rotated', title_bn: 'Rotated', fileName: 'd.pdf', bytes: await source('rotated', [{ size: A4, rot: 90 }, { size: A4, rot: 180 }, { size: A4, rot: 270 }]) },
]
const tender = { tender_id: 'SEAL-TEST', title: 'Seal placement test', procuring_entity: 'Test', bidder: 'Test', submission_deadline: '2026-10-20' }
// cover, index, then 2 + 1 + 1 + 3 document pages = 9 pages; last pages of documents are 4, 5, 6, 9
const TOTAL = 9
const want = { cover: [1], last: [4, 5, 6, 9], all: [1, 2, 3, 4, 5, 6, 7, 8, 9], custom: [1, 2, 3] }

/** Finds every picture drawn on a page and returns its box in screen units (top-left origin). */
async function pictures(page) {
  const vp = page.getViewport({ scale: 1 })
  const ops = await page.getOperatorList()
  const { OPS, Util } = pdfjs
  let ctm = [1, 0, 0, 1, 0, 0]
  const stack = []
  const found = []
  ops.fnArray.forEach((fn, i) => {
    if (fn === OPS.save) stack.push(ctm)
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm
    else if (fn === OPS.transform) ctm = Util.transform(ctm, ops.argsArray[i])
    else if (fn === OPS.paintImageXObject) {
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map((p) => vp.convertToViewportPoint(...Util.applyTransform(p, ctm)))
      const side = (a, b) => Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1])
      found.push({ minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])), minY: Math.min(...pts.map((p) => p[1])), maxY: Math.max(...pts.map((p) => p[1])), ratio: side(0, 1) / side(0, 2) })
    }
  })
  return { vp, found }
}

let builds = 0
for (const [shape, [iw, ih]] of Object.entries({ square: [300, 300], 'very wide': [900, 30], 'very tall': [30, 900] })) {
  const seal = png(iw, ih)
  for (const mode of ['cover', 'last', 'all', 'custom'])
    for (const pos of mode === 'all' ? ['br', 'bc', 'bl', 'tr', 'tl', 'c'] : ['br']) {
      const size = mode === 'all' ? 0.4 : 0.2
      const res = await buildPackage({ tender, items, withIndex: true, seal: { bytes: seal, pages: mode, custom: '1 - 3', pos, size } })
      builds++
      const doc = await pdfjs.getDocument({ data: res.bytes.slice(), verbosity: 0 }).promise
      const sealed = []
      const bad = []
      for (let n = 1; n <= doc.numPages; n++) {
        const { vp, found } = await pictures(await doc.getPage(n))
        if (!found.length) continue
        sealed.push(n)
        const band = n <= 2 ? 44 : 30 * Math.max(0.5, vp.width / 595.28)
        for (const b of found) {
          const inside = b.minX >= -0.5 && b.maxX <= vp.width + 0.5 && b.minY >= -0.5 && b.maxY <= vp.height - band + 0.5
          const inShape = Math.abs(b.ratio / (iw / ih) - 1) < 0.01
          if (found.length !== 1 || !inside || !inShape) bad.push(`p${n} ${Math.round(vp.width)}x${Math.round(vp.height)} box x ${b.minX.toFixed(1)}..${b.maxX.toFixed(1)} y ${b.minY.toFixed(1)}..${b.maxY.toFixed(1)} footer starts ${(vp.height - band).toFixed(1)} ratio ${b.ratio.toFixed(2)}`)
        }
      }
      check(`${shape} seal, ${mode}, ${pos}: on pages ${want[mode].join(',')} only, inside the page, clear of the footer, in proportion`, doc.numPages === TOTAL && sealed.join() === want[mode].join() && !bad.length, `pages ${sealed.join(',')} ${bad.slice(0, 2).join(' | ')}`)
      if (keep && mode === 'all' && pos === 'br') fs.writeFileSync(path.join(keep, `seal-${shape.replace(' ', '-')}.pdf`), res.bytes)
    }
}

// A seal that cannot be applied must stop the build with a clear reason.
const refuses = async (label, seal, kind) => {
  let got = 'no error'
  try {
    await buildPackage({ tender, items, withIndex: true, seal })
  } catch (e) {
    got = e instanceof SealError ? e.kind : String(e)
  }
  check(`${label} stops the package`, got === kind, got)
}
await refuses('damaged picture (PNG signature only)', { bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pages: 'cover', custom: '', pos: 'br', size: 0.2 }, 'image')
await refuses('page list "0,999,abc"', { bytes: png(50, 50), pages: 'custom', custom: '0,999,abc', pos: 'br', size: 0.2 }, 'pages')
await refuses('empty page list', { bytes: png(50, 50), pages: 'custom', custom: '', pos: 'br', size: 0.2 }, 'pages')

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`${passed} passed, ${failed} failed  (${builds} sealed packages built and read back)`)
process.exit(failed ? 1 : 0)
