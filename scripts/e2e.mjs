// End-to-end run in a real browser: loads the sample pack, checks every rule,
// saves screenshots and writes the final package to output/.
// Usage: npm run build && npx vite preview --port 4173 & node scripts/e2e.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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

const pack = path.join(root, 'docs/sample-pack')
const docs = fs.readdirSync(path.join(pack, 'documents')).filter((f) => !f.startsWith('.')).map((f) => path.join(pack, 'documents', f))
const shots = path.join(root, 'screenshots')
fs.mkdirSync(shots, { recursive: true })
fs.mkdirSync(path.join(root, 'output'), { recursive: true })

let failed = 0
const check = (name, ok, extra = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ->  ${extra}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
await page.goto(URL_, { waitUntil: 'networkidle0' })
await page.waitForSelector('[data-testid=dropzone]')
await sleep(900)
await page.screenshot({ path: path.join(shots, '01-start.png') })

const statuses = () => page.$$eval('article[data-testid^="req-"]', (els) => Object.fromEntries(els.map((e) => [e.dataset.testid.slice(4), e.dataset.status])))
const setDate = (req, v) =>
  page.$eval(`[data-testid="date-${req}"]`, (el, val) => {
    el.value = val
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, v)
const useFile = (name, req) => page.select(`[data-testid="file-card"][data-name="${name}"] select`, req)
// Clicks through the DOM so a sticky header can never sit between the pointer and the button.
const tap = (sel) => page.$eval(sel, (el) => el.click())
const genDisabled = () => page.$eval('[data-testid=generate]', (b) => b.disabled)

// 4.1 + 4.2: everything in one go, including the PNG that must be rejected
const input = await page.$('[data-testid=file-input]')
await input.uploadFile(path.join(pack, 'requirements.json'), ...docs)
await page.waitForFunction(() => document.querySelectorAll('[data-testid=file-card]').length === 10, { timeout: 30000 })
await page.waitForFunction(() => !document.querySelector('[role=status][aria-live]'), { timeout: 30000 })
await page.waitForFunction(() => document.querySelectorAll('[data-testid=file-card] img').length === 10, { timeout: 30000 }).catch(() => {})
await sleep(600)

const order = await page.$$eval('article[data-testid^="req-"]', (els) => els.map((e) => e.dataset.testid.slice(4)))
check('4.1 documents listed in order', order.join() === 'R01,R02,R03,R04,R05,R06,R07,R08,R09,R10', order.join())
check('4.1 tender details shown', await page.$eval('[data-testid=tender-card]', (e) => e.textContent.includes('T-2026-0417') && e.textContent.includes('Meghna Tech Solutions Ltd.')))
const pages = await page.$$eval('[data-testid=file-card]', (els) => Object.fromEntries(els.map((e) => [e.dataset.name, e.querySelector('[data-testid=file-pages]').textContent])))
check('4.2 page counts', pages['02_technical_proposal.pdf'].startsWith('6 pages') && pages['scan_0042.pdf'].startsWith('1 page'), JSON.stringify(pages))
const rej = await page.$eval('[data-testid=rejected]', (e) => e.textContent)
check('4.2 non-PDF rejected with message', rej.includes('company_logo.png') && rej.includes('not a PDF'), rej.slice(0, 120))
const dups = await page.$$eval('[data-testid=file-card][data-dup="1"]', (els) => els.map((e) => e.dataset.name))
check('4.6 duplicates marked', dups.length === 2 && dups.every((n) => n.startsWith('experience_cert')), dups.join(' | '))

let st = await statuses()
check('5 initial: required = missing, optional = not provided', st.R01 === 'missing' && st.R06 === 'not_provided' && st.R07 === 'not_provided' && st.R10 === 'missing', JSON.stringify(st))
check('4.7 generate disabled at start', await genDisabled())
await page.screenshot({ path: path.join(shots, '02-files-added.png') })

// 4.3 manual matching through the picker dialog
await tap('[data-testid="pick-R02"]')
await page.waitForSelector('[data-testid=picker]')
await sleep(400)
await page.screenshot({ path: path.join(shots, '03-choose-file.png') })
await tap('[data-testid="picker-item"][data-name="03_tin_certificate.pdf"]')
await sleep(300)
st = await statuses()
check('4.3 match through dialog', st.R02 === 'ok', st.R02)
await tap('[data-testid="unmatch-R02"]')
await sleep(200)
check('4.3 match can be undone', (await statuses()).R02 === 'missing')

// bonus: auto-match by file names
await tap('[data-testid=auto-match]')
await sleep(700)
st = await statuses()
console.log('after auto-match:', JSON.stringify(st))
const matched = await page.$$eval('[data-testid=file-card]', (els) => Object.fromEntries(els.map((e) => [e.dataset.name, e.querySelector('select').value])))
console.log('matches:', JSON.stringify(matched))
check('auto-match: misleading numbers ignored', matched['01_financial_proposal.pdf'] === 'R09' && matched['02_technical_proposal.pdf'] === 'R08' && matched['03_tin_certificate.pdf'] === 'R02' && matched['04_vat_certificate.pdf'] === 'R03')
check('auto-match: valid trade license preferred', matched['trade_license_2026.pdf'] === 'R01' && matched['trade_license_2025.pdf'] === '')
check('auto-match: only one copy used', [matched['experience_cert.pdf'], matched['experience_cert (1).pdf']].filter(Boolean).join() === 'R05')
check('scan with unclear name left for the user', matched['scan_0042.pdf'] === '' && st.R10 === 'missing')

// 4.6 a copy must not go to a second document
const spare = matched['experience_cert.pdf'] ? 'experience_cert (1).pdf' : 'experience_cert.pdf'
await useFile(spare, 'R06').catch(() => {})
await sleep(300)
st = await statuses()
check('4.6 copy blocked from a different document', st.R06 === 'not_provided', st.R06)
const blockMsg = await page.$eval('[data-testid=toast]', (e) => e.textContent).catch(() => '')
check('4.6 clear message when a copy is blocked', blockMsg.includes('is a copy of'), blockMsg.slice(0, 90))
await page.$eval('[data-testid=toast] button:last-child', (b) => b.click()).catch(() => {})

// 4.4 + 5 expiry rules on the trade license
await useFile('trade_license_2025.pdf', 'R01')
await sleep(300)
st = await statuses()
check('5 expiry date needed when no date', st.R01 === 'need_date', st.R01)
await setDate('R01', '2025-06-30')
await sleep(200)
check('5 expired when before deadline', (await statuses()).R01 === 'expired')
check('4.7 generate disabled while blocked', await genDisabled())
await page.$eval('[data-testid=req-R01]', (e) => e.scrollIntoView({ block: 'center' }))
await sleep(400)
await page.screenshot({ path: path.join(shots, '04-statuses-with-problems.png') })
await setDate('R01', '2026-10-19')
await sleep(150)
check('5 one day before deadline = expired', (await statuses()).R01 === 'expired')
await setDate('R01', '2026-10-20')
await sleep(150)
check('5 same day as deadline = OK', (await statuses()).R01 === 'ok')
await setDate('R01', '2026-10-21')
await sleep(150)
check('5 after deadline = OK', (await statuses()).R01 === 'ok')

// resolve the real problems of the sample pack
await useFile('trade_license_2026.pdf', 'R01')
await sleep(250)
await setDate('R01', '2027-06-30')
await setDate('R04', '2026-12-31')
await useFile('scan_0042.pdf', 'R10')
await sleep(400)
st = await statuses()
console.log('final:', JSON.stringify(st))
check('5 final statuses', ['R01', 'R02', 'R03', 'R04', 'R05', 'R08', 'R09', 'R10'].every((k) => st[k] === 'ok') && st.R06 === 'not_provided' && st.R07 === 'not_provided')
check('4.7 generate enabled when nothing blocks', !(await genDisabled()))
await page.evaluate(() => window.scrollTo(0, 0))
await sleep(500)
await page.screenshot({ path: path.join(shots, '05-statuses-all-ok.png') })
await page.screenshot({ path: path.join(shots, '06-statuses-full-page.png'), fullPage: true })

// 4.9 Bangla
await tap('[data-testid=lang-bn]')
await sleep(900)
const bnTitle = await page.$eval('[data-testid=req-R01] h3', (e) => e.textContent)
check('4.9 Bangla titles from title_bn', bnTitle === 'ট্রেড লাইসেন্স', bnTitle)
await page.screenshot({ path: path.join(shots, '07-bangla.png') })
await page.screenshot({ path: path.join(shots, '08-bangla-full-page.png'), fullPage: true })
await tap('[data-testid=lang-en]')
await sleep(500)

// bonus: seal on the cover, checked on its own build, then removed for the plain package
const seal = await page.$('[data-testid=seal-input]')
await seal.uploadFile(path.join(pack, 'documents/company_logo.png'))
await page.waitForSelector('[data-testid=seal-box]')
await page.$eval('[data-testid=generate]', (b) => b.click())
await page.waitForSelector('[data-testid=download]', { timeout: 60000 })
const sealedSize = await page.$eval('[data-testid=download]', async (a) => (await (await fetch(a.href)).arrayBuffer()).byteLength)
await page.keyboard.press('Escape')
await tap('[data-testid=seal-remove]')
await sleep(300)

// 4.7 + 4.8 make and download
await page.$eval('[data-testid=generate]', (b) => b.click())
await page.waitForSelector('[data-testid=download]', { timeout: 60000 })
await sleep(1200)
const name = await page.$eval('[data-testid=download]', (a) => a.download)
check('4.8 file name', name === 'T-2026-0417_Package.pdf', name)
await page.screenshot({ path: path.join(shots, '09-package-ready.png') })
const b64 = await page.evaluate(async () => {
  const a = document.querySelector('[data-testid=download]')
  const u = new Uint8Array(await (await fetch(a.href)).arrayBuffer())
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
})
const pdfBytes = Buffer.from(b64, 'base64')
const outFile = path.join(root, 'output', name)
fs.writeFileSync(outFile, pdfBytes)
console.log('wrote', path.relative(root, outFile), pdfBytes.length, 'bytes')
check('seal adds a picture to the package', sealedSize > pdfBytes.length, `${sealedSize} > ${pdfBytes.length}`)

// Section 6: read the package back and check it page by page
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: true }).promise
const texts = []
for (let i = 1; i <= doc.numPages; i++) {
  const tc = await (await doc.getPage(i)).getTextContent()
  texts.push(tc.items.map((it) => it.str).join(' ').replace(/\s+/g, ' '))
}
const Y = doc.numPages
check('6 total pages = cover + index + 15 document pages', Y === 17, String(Y))
check('6.3 footer on every page', texts.every((t, i) => t.includes(`T-2026-0417 | Page ${i + 1} of ${Y}`)))
const cover = texts[0]
check('6.1 cover fields', ['T-2026-0417', 'Supply of IT Equipment', 'Directorate of Sample Services', 'Meghna Tech Solutions Ltd.', '2026-10-20', 'Package Date', 'Trade License', 'Signed Declaration'].every((s) => cover.includes(s)))
check('6.1 cover skips optional documents without a file', !cover.includes('Audited Financial Statement') && !cover.includes("Manufacturer's Authorization"))
const want = ['TRADE LICENSE', 'TIN', 'VAT', 'BANK SOLVENCY CERTIFICATE', 'EXPERIENCE CERTIFICATE', 'Items Supplied', 'Technical Proposal', 'Technical Proposal', 'Technical Proposal', 'Technical Proposal', 'Technical Proposal', 'Technical Proposal', 'Price Schedule', 'Payment Terms']
const body = texts.slice(2)
check('6.2 documents in order', want.every((w, i) => body[i].toLowerCase().includes(w.toLowerCase())), body.map((t) => t.slice(0, 40)).join(' || '))
check('6.2 valid trade license included', body[0].includes('2027-06-30'))
check('index page shows start pages', texts[1].includes('Index') && texts[1].includes('Starts on page'))

// phone
await page.keyboard.press('Escape')
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await sleep(700)
await page.evaluate(() => window.scrollTo(0, 0))
await sleep(300)
await page.screenshot({ path: path.join(shots, '10-phone.png') })
await page.$eval('[data-testid=req-R01]', (e) => e.scrollIntoView({ block: 'start' }))
await sleep(500)
await page.screenshot({ path: path.join(shots, '11-phone-statuses.png') })

check('no browser errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED')
process.exit(failed ? 1 : 0)
