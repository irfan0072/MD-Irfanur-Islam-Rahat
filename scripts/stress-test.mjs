// Harder cases than the sample pack, in a real browser, with files made on the spot (nothing is committed):
// 30-file and 50 MB limits, damaged and locked PDFs, a renamed copy, long and awkward titles and file names,
// CSV with commas, quotes, line breaks and Bangla, settings after reload, and browser storage that fails.
// Usage: npm run build && npm run preview (other terminal), then: node scripts/stress-test.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import puppeteer from 'puppeteer-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const URL_ = process.env.APP_URL || 'http://localhost:4173/'
const CHROME =
  process.env.CHROME ||
  [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ].find((p) => fs.existsSync(p))
const shots = path.join(root, 'screenshots', 'qa')
fs.mkdirSync(shots, { recursive: true })
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tpb-stress-'))
const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'tpb-stress-dl-'))

let failed = 0
let passed = 0
const check = (name, ok, extra = '') => {
  ok ? passed++ : failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra ? `  ->  ${extra}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------------ fixtures
async function pdf(text, pages = 1, classic = false) {
  const d = await PDFDocument.create()
  const f = await d.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < pages; i++) d.addPage([595.28, 841.89]).drawText(`${text} (page ${i + 1})`, { x: 50, y: 780, size: 16, font: f })
  return Buffer.from(await d.save({ useObjectStreams: !classic }))
}
const put = (name, bytes) => {
  const f = path.join(tmp, name)
  fs.writeFileSync(f, bytes)
  return f
}
const LONG = 'Certificate of "Incorporation", Memorandum & Articles of Association of the Bidding Company, including all amendments made up to the date of submission of this tender'
const BREAK = 'Bank Solvency\nCertificate (two lines)'
const WORD = 'Supercalifragilisticexpialidocious'.repeat(3)
const ODD = 'a, "quoted" name; with comma & ünïcödé বাংলা নাম.pdf'
const reqs = [
  { id: 'L1', order: 1, title_en: LONG, title_bn: 'দরদাতা কোম্পানির নিবন্ধন সনদ, সংঘস্মারক ও সংঘবিধি, দরপত্র জমা দেওয়ার তারিখ পর্যন্ত সকল সংশোধনীসহ', mandatory: true, has_expiry: false },
  { id: 'L2', order: 2, title_en: BREAK, title_bn: 'ব্যাংক সচ্ছলতা সনদ', mandatory: true, has_expiry: true },
  { id: 'L3', order: 3, title_en: WORD, title_bn: WORD, mandatory: false, has_expiry: false },
  ...Array.from({ length: 9 }, (_, i) => ({ id: `N${i + 4}`, order: i + 4, title_en: `Supporting document number ${i + 4}`, title_bn: `সহায়ক নথি ${i + 4}`, mandatory: false, has_expiry: i % 2 === 0 })),
]
const list = put('requirements.json', JSON.stringify({ tender: { tender_id: 'STRESS/2026-30', title: `${LONG} (${WORD})`, procuring_entity: 'A Very Long Procuring Entity Name, Department of Public Procurement and Stores', bidder: 'Bidder & Sons "Trading" Ltd.', submission_deadline: '2026-10-20' }, requirements: reqs }))

const first = await pdf('Document 01', 2, true)
const batch1 = [put(ODD, await pdf('Odd file name')), put('doc-01.pdf', first), put('renamed copy of doc 01.PDF', first)]
for (let i = 2; i <= 28; i++) batch1.push(put(`doc-${String(i).padStart(2, '0')} ${i === 5 ? 'with a very long file name that goes on and on and on to see how the card wraps on a narrow phone screen' : ''}.pdf`, await pdf(`Document ${i}`)))
const damaged = put('damaged.pdf', first.subarray(0, Math.floor(first.length * 0.45)))
const locked = put('locked.pdf', Buffer.from(first.toString('latin1').replace(/trailer\s*<</, 'trailer\n<< /Encrypt << /Filter /Standard /V 1 /R 2 /O (aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa) /U (bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb) /P -4 >>'), 'latin1'))
const fake = put('notes.pdf', 'plain text with a pdf name')
const extra = put('doc-31-one-too-many.pdf', await pdf('Document 31'))
const big = put('too-big-51MB.pdf', Buffer.concat([await pdf('Big file'), Buffer.alloc(51 * 1024 * 1024)]))

// ------------------------------------------------------------------- browser
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await (await browser.target().createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl })
await page.setViewport({ width: 1440, height: 900 })
await page.goto(URL_, { waitUntil: 'networkidle0' })
const upload = async (...files) => {
  await (await page.$('[data-testid=file-input]')).uploadFile(...files)
  await sleep(400)
  await page.waitForFunction(() => !document.querySelector('[role=status][aria-live]'), { timeout: 120000 })
  await sleep(300)
}
const count = () => page.$$eval('[data-testid=file-card]', (e) => e.length)
const rejected = () => page.$$eval('[data-testid=rejected] li', (els) => els.map((e) => e.textContent)).catch(() => [])
const statuses = () => page.$$eval('article[data-testid^="req-"]', (els) => els.map((e) => `${e.dataset.testid.slice(4)}:${e.dataset.status}`).join(' '))
const tap = (sel) => page.$eval(sel, (el) => el.click())
/** How far the widest visible thing sticks out past the right edge of the screen (0 = nothing does). */
const overflow = () => page.evaluate(() => {
  let worst = document.documentElement.scrollWidth - window.innerWidth
  for (const el of document.querySelectorAll('header *, main *')) {
    if (el.offsetParent === null || el.closest('.sr-only')) continue
    worst = Math.max(worst, Math.round(el.getBoundingClientRect().right - window.innerWidth))
  }
  return Math.max(0, worst)
})

// The bad files go first: once 30 files are in, anything more is refused for the limit, whatever it is.
await upload(list, damaged, locked, fake, ...batch1)
let rej = await rejected()
check('30 PDFs accepted in one go', (await count()) === 30, String(await count()))
check('damaged, locked and fake PDFs each refused with their own reason; app still working', rej.some((t) => t.includes('damaged.pdf') && t.includes('damaged')) && rej.some((t) => t.includes('locked.pdf') && t.includes('password')) && rej.some((t) => t.includes('notes.pdf') && t.includes('not a PDF')) && (await statuses()).startsWith('L1:missing'), rej.join(' | '))
check('renamed copy is marked as a copy', (await page.$$eval('[data-testid=file-card][data-dup="1"]', (els) => els.map((e) => e.dataset.name).sort().join('|'))) === 'doc-01.pdf|renamed copy of doc 01.PDF')
await tap('[data-testid=rejected] button')
await upload(extra)
rej = await rejected()
check('31st PDF refused: "up to 30 files"', (await count()) === 30 && rej.some((t) => t.includes('doc-31') && t.includes('up to 30 files')), rej.join(' | '))
await tap('[data-testid=rejected] button')
await page.$eval('[data-testid="file-card"][data-name="doc-28 .pdf"] [data-testid=remove-file]', (b) => b.click())
await sleep(300)
check('a file can be removed', (await count()) === 29)
await upload(big)
rej = await rejected()
check('51 MB file refused: "50 MB or less"', (await count()) === 29 && rej.some((t) => t.includes('too-big') && t.includes('50 MB or less')), rej.join(' | '))
await tap('[data-testid=rejected] button')
await sleep(300)

// matching with the awkward names; the copy must not serve a second document
const sel = (name) => `[data-testid="file-card"][data-name=${JSON.stringify(name)}] select`
await page.select(sel(ODD), 'L1')
await page.select(sel('doc-01.pdf'), 'L2')
await sleep(300)
await page.select(sel('renamed copy of doc 01.PDF'), 'L3')
await sleep(400)
const blockedMsg = await page.$eval('[data-testid=toast]', (e) => e.textContent).catch(() => '')
check('the renamed copy cannot be used for another document', (await statuses()).includes('L3:not_provided') && blockedMsg.includes('is a copy of'), blockedMsg)
await page.$eval('[data-testid=toast] button:last-child', (b) => b.click()).catch(() => {})
await page.$eval('[data-testid="date-L2"]', (el) => {
  el.value = '2026-10-20'
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
await sleep(300)
check('statuses with long titles: required OK, optional Not provided', (await statuses()).startsWith('L1:ok L2:ok L3:not_provided N4:not_provided'), await statuses())

// CSV with commas, quotes, a line break and Bangla
const parseCsv = (text) => {
  const rows = [[]]
  let cell = ''
  let quoted = false
  const t = text.replace(/^﻿/, '')
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') (cell += '"'), i++
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') (rows[rows.length - 1].push(cell), (cell = ''))
    else if (c === '\r' && t[i + 1] === '\n') (rows[rows.length - 1].push(cell), (cell = ''), rows.push([]), i++)
    else cell += c
  }
  rows[rows.length - 1].push(cell)
  return rows
}
const waitCsv = async () => {
  for (let i = 0; i < 60; i++) {
    const f = fs.readdirSync(dl).find((n) => n.endsWith('.csv'))
    if (f) return path.join(dl, f)
    await sleep(250)
  }
  return null
}
await tap('[data-testid=csv]')
const csvPath = await waitCsv()
const csv = csvPath ? parseCsv(fs.readFileSync(csvPath, 'utf8')) : []
check('checklist file name is safe for a tender ID with a slash', path.basename(csvPath ?? '') === 'STRESS-2026-30_Checklist.csv', path.basename(csvPath ?? ''))
check('CSV keeps commas, quotes, a line break and Unicode exactly', csv.length === 13 && csv.every((r) => r.length === 7) && csv[1][1] === LONG && csv[1][3] === ODD && csv[2][1] === BREAK && csv[2][5] === '2026-10-20' && csv[2][6] === 'OK' && csv[3][1] === WORD && csv[3][6] === 'Not provided', JSON.stringify(csv.slice(1, 3)))
if (csvPath) fs.rmSync(csvPath)
await tap('[data-testid=lang-bn]')
await sleep(600)
await tap('[data-testid=csv]')
const bnPath = await waitCsv()
const bn = bnPath ? parseCsv(fs.readFileSync(bnPath, 'utf8')) : []
check('Bangla CSV keeps the Bangla title and the same awkward file name', bn.length === 13 && bn[1][1] === reqs[0].title_bn && bn[1][3] === ODD && bn[1][6] === 'ঠিক আছে' && bn[3][6] === 'দেওয়া হয়নি', JSON.stringify(bn[1]))
await tap('[data-testid=lang-en]')
await sleep(500)

// settings survive a reload: index off, seal with its page choice and position
await tap('[role=switch]')
await (await page.$('[data-testid=seal-input]')).uploadFile(path.join(root, 'public/sample/documents/company_logo.png'))
await page.waitForSelector('[data-testid=seal-box]')
await page.select('[data-testid=seal-pages]', 'last')
await page.$$eval('[data-testid=seal-box] select', (s) => {
  s[1].value = 'tl'
  s[1].dispatchEvent(new Event('change', { bubbles: true }))
})
await sleep(900)
await page.reload({ waitUntil: 'networkidle0' })
await page.waitForSelector('[data-testid=tender-card]')
await sleep(900)
check('after reload: 29 files, matches, date, index off, seal picture, seal pages and position are all back', await page.evaluate(() =>
  document.querySelectorAll('[data-testid=file-card]').length === 29 &&
  document.querySelector('[data-testid=req-L1]').dataset.status === 'ok' &&
  document.querySelector('[data-testid="date-L2"]').value === '2026-10-20' &&
  document.querySelector('[role=switch]').getAttribute('aria-checked') === 'false' &&
  !!document.querySelector('[data-testid=seal-box] img') &&
  document.querySelector('[data-testid=seal-pages]').value === 'last' &&
  document.querySelectorAll('[data-testid=seal-box] select')[1].value === 'tl'))
check('seal page preview names the last page of each included document', (await page.$eval('[data-testid=seal-pages-ok]', (e) => e.textContent)) === 'Seal pages (2): 2, 4', await page.$eval('[data-testid=seal-pages-ok]', (e) => e.textContent).catch(() => 'missing'))

// package from this pack: no index, seal on last pages, long titles on the cover
await page.$eval('[data-testid=toast] button:last-child', (b) => b.click()).catch(() => {})
await tap('[data-testid=generate]')
await page.waitForSelector('[data-testid=download]', { timeout: 60000 })
const name = await page.$eval('[data-testid=download]', (a) => a.download)
const bytes = Buffer.from(await page.evaluate(async () => {
  const u = new Uint8Array(await (await fetch(document.querySelector('[data-testid=download]').href)).arrayBuffer())
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}), 'base64')
if (process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]), bytes)
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise
const texts = []
const images = []
for (let i = 1; i <= doc.numPages; i++) {
  const pg = await doc.getPage(i)
  texts.push((await pg.getTextContent()).items.map((it) => it.str).join(' ').replace(/\s+/g, ' '))
  images.push((await pg.getOperatorList()).fnArray.filter((f) => f === pdfjs.OPS.paintImageXObject).length)
}
check('package name is safe and exact', name === 'STRESS-2026-30_Package.pdf', name)
check('index off: cover, then 1 + 2 document pages; footer with the tender ID on each', doc.numPages === 4 && texts.every((t, i) => t.includes(`STRESS/2026-30 | Page ${i + 1} of 4`)) && texts[1].includes('Odd file name') && texts[2].includes('Document 01 (page 1)') && texts[3].includes('Document 01 (page 2)'), texts.map((t) => t.slice(-40)).join(' || '))
check('seal on the last page of each document only (pages 2 and 4)', images.join() === '0,1,0,1', images.join())
check('cover carries the long tender title and bidder with quotes', texts[0].includes('Certificate of "Incorporation", Memorandum') && texts[0].includes('Bidder & Sons "Trading" Ltd.'), texts[0].slice(0, 200))
await page.keyboard.press('Escape')

// layouts with 29 files and long titles
await page.setViewport({ width: 1440, height: 900 })
await sleep(500)
await page.evaluate(() => window.scrollTo(0, 0))
check('1440 px with long titles and 29 files: no sideways scroll', (await overflow()) <= 0, String(await overflow()))
await page.screenshot({ path: path.join(shots, '14-long-titles-desktop.png') })
for (const [w, h, mobile] of [[768, 1024, false], [390, 844, true], [320, 740, true]]) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile })
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('[data-testid=tender-card]')
  await sleep(900)
  await page.$eval('[data-testid=toast] button:last-child', (b) => b.click()).catch(() => {})
  const folded = await page.evaluate(() => document.querySelector('[data-testid=files]').offsetParent === null)
  await tap('[data-testid=jump-docs]')
  await sleep(900)
  const top = await page.evaluate(() => Math.round(document.getElementById('req-h').getBoundingClientRect().top))
  check(`${w} px with long titles and 29 files: no sideways scroll, list folded, one tap to the statuses`, (await overflow()) <= 0 && folded && top >= 0 && top < h * 0.5, `overflow ${await overflow()} folded ${folded} top ${top}`)
  if (w === 390) await page.screenshot({ path: path.join(shots, '15-long-titles-phone.png') })
  await tap('[data-testid=files-toggle]')
  await sleep(400)
  check(`${w} px: opened list of 29 files still does not scroll sideways`, (await overflow()) <= 0, String(await overflow()))
}
check('no script errors during the stress run', errors.length === 0, errors.slice(0, 2).join(' | '))

// browser storage that fails: the app must keep working and say so
for (const [label, breakIt] of [
  ['storage full (writes fail)', () => { IDBObjectStore.prototype.put = function () { throw new DOMException('full', 'QuotaExceededError') } }],
  ['storage blocked (cannot be opened)', () => { IDBFactory.prototype.open = function () { throw new DOMException('blocked', 'SecurityError') } }],
]) {
  const ctx = await browser.createBrowserContext()
  const p = await ctx.newPage()
  await p.setViewport({ width: 1440, height: 900 })
  await p.evaluateOnNewDocument(breakIt)
  await p.goto(URL_, { waitUntil: 'networkidle0' })
  const started = await p.waitForFunction(() => !document.getElementById('boot') && !!document.querySelector('[data-testid=dropzone]'), { timeout: 15000 }).then(() => true, () => false)
  await p.$eval('[data-testid=sample]', (b) => b.click())
  await p.waitForFunction(() => document.querySelectorAll('[data-testid=file-card] img').length === 10, { timeout: 30000 })
  const warned = await p.waitForSelector('[data-testid=save-warning]', { timeout: 15000 }).then(() => true, () => false)
  await p.$eval('[data-testid=auto-match]', (b) => b.click())
  await sleep(500)
  const works = await p.$$eval('article[data-testid^="req-"]', (els) => els.filter((e) => e.dataset.status === 'ok').length)
  check(`${label}: app starts, keeps working, and shows a standing "could not be saved" warning`, started && warned && works === 7 && (await p.$eval('[data-testid=save-warning]', (e) => e.textContent)).includes('could not be saved'), `started ${started} warned ${warned} ok ${works}`)
  if (label.startsWith('storage full')) await p.screenshot({ path: path.join(shots, '16-save-warning.png') })
  await ctx.close()
}

await browser.close()
fs.rmSync(tmp, { recursive: true, force: true })
fs.rmSync(dl, { recursive: true, force: true })
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
