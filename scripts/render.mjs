// Renders pages of the built package to PNG files so the result can be checked by eye.
// Usage: node scripts/render.mjs [pdf] [outDir] [pages e.g. 1,2,3]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pdf = path.resolve(process.argv[2] || path.join(root, 'output/T-2026-0417_Package.pdf'))
const outDir = path.resolve(process.argv[3] || path.join(root, 'screenshots/package'))
const want = (process.argv[4] || '1,2,3').split(',').map(Number)
const CHROME = process.env.CHROME || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
].find((p) => fs.existsSync(p))
fs.mkdirSync(outDir, { recursive: true })

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] })
const page = await browser.newPage()
await page.setViewport({ width: 900, height: 1200 })
const lib = pathToFileURL(path.join(root, 'node_modules/pdfjs-dist/build/pdf.min.mjs')).href
const worker = pathToFileURL(path.join(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs')).href
const html = path.join(outDir, '_r.html')
fs.writeFileSync(html, '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#888"><canvas id="c"></canvas>')
await page.goto(pathToFileURL(html).href)
const data = fs.readFileSync(pdf).toString('base64')
for (const n of want) {
  const size = await page.evaluate(async (lib, worker, b64, n) => {
    const pdfjs = await import(lib)
    pdfjs.GlobalWorkerOptions.workerSrc = worker
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const doc = await pdfjs.getDocument({ data: bytes }).promise
    const pg = await doc.getPage(n)
    const vp = pg.getViewport({ scale: 1.3 })
    const c = document.getElementById('c')
    c.width = vp.width
    c.height = vp.height
    await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise
    const raw = pg.getViewport({ scale: 1 })
    return { w: Math.round(raw.width * 100) / 100, h: Math.round(raw.height * 100) / 100, pages: doc.numPages, rot: pg.rotate }
  }, lib, worker, data, n)
  const el = await page.$('#c')
  await el.screenshot({ path: path.join(outDir, `page-${String(n).padStart(2, '0')}.png`) })
  console.log(`page ${n}: ${size.w} x ${size.h} pt, rotate ${size.rot}, of ${size.pages}`)
}
fs.unlinkSync(html)
await browser.close()
