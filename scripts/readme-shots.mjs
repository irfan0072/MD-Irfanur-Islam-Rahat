// Captures the screenshots shown in README.md from the running preview, using only the fictional sample pack.
// It drives the app like a user would and changes nothing in it.
// Usage: npm run build && npm run preview   (other terminal)   then   node scripts/readme-shots.mjs
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

const sample = path.join(root, 'public/sample')
const docs = fs.readdirSync(path.join(sample, 'documents')).filter((f) => !f.startsWith('.')).map((f) => path.join(sample, 'documents', f))
const out = path.join(root, 'screenshots')
fs.mkdirSync(out, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
const desktop = (h = 1000) => page.setViewport({ width: 1440, height: h, deviceScaleFactor: 1 })
const tap = (sel) => page.$eval(sel, (el) => el.click())
const shot = async (name) => {
  await page.$eval('[data-testid=toast] button:last-child', (b) => b.click()).catch(() => {})
  await sleep(450)
  await page.screenshot({ path: path.join(out, name) })
  console.log('saved', name)
}
const settle = async () => {
  await sleep(200)
  await page.waitForFunction(() => !document.querySelector('[role=status][aria-live]'), { timeout: 30000 })
  await sleep(300)
}
const setDate = (req, v) =>
  page.$eval(`[data-testid="date-${req}"]`, (el, val) => {
    el.value = val
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, v)
const useFile = (name, req) => page.select(`[data-testid="file-card"][data-name="${name}"] select`, req)
/** Puts the given element near the top of the screen, just under the sticky header. */
const scrollTo = (sel, gap = 76) =>
  page.$eval(sel, (el, g) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - g, behavior: 'instant' }), gap)
const reload = async () => {
  await sleep(700) // saved work is written about 350 ms after the last change
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('[data-testid=tender-card]')
  await page.waitForFunction(() => !document.getElementById('boot'))
  await sleep(900)
}

// 1. landing
await desktop(900)
await page.goto(URL_, { waitUntil: 'networkidle0' })
await page.waitForSelector('[data-testid=dropzone]')
await sleep(1500)
await shot('01-landing.png')

// load the whole sample pack at once: tender list, ten PDFs and the PNG logo
await (await page.$('[data-testid=file-input]')).uploadFile(path.join(sample, 'requirements.json'), ...docs)
await page.waitForFunction(() => document.querySelectorAll('[data-testid=file-card]').length === 10, { timeout: 30000 })
await settle()
await page.waitForFunction(() => document.querySelectorAll('[data-testid=file-card] img').length === 10, { timeout: 20000 }).catch(() => {})
await page.$eval('[data-testid=rejected] button', (b) => b.click()).catch(() => {}) // the logo message is shown in the app; the list shots stay clean
await sleep(300)

// 2. blocked: Expired, Missing, Expiry date needed and OK side by side; generation disabled
await useFile('trade_license_2025.pdf', 'R01')
await sleep(250)
await setDate('R01', '2025-06-30')
await useFile('04_vat_certificate.pdf', 'R03')
await useFile('bank_solvency.pdf', 'R04')
await sleep(400)
await desktop(1120)
await sleep(300)
await scrollTo('#req-h')
await sleep(400)
await shot('02-statuses-blocked.png')

// 3. phone, same blocked state (restored from the browser's saved work)
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await reload()
await tap('[data-testid=jump-docs]')
await sleep(1000)
await shot('05-mobile.png')

// 4. resolved: renewed license, dates entered, remaining files matched, scanned declaration matched by hand
await desktop(1000)
await reload()
await useFile('trade_license_2026.pdf', 'R01')
await sleep(250)
await setDate('R01', '2027-06-30')
await setDate('R04', '2026-12-31')
await tap('[data-testid=auto-match]')
await sleep(700)
await useFile('scan_0042.pdf', 'R10')
await sleep(500)
const final = await page.$$eval('article[data-testid^="req-"]', (els) => Object.fromEntries(els.map((e) => [e.dataset.testid.slice(4), e.dataset.status])))
console.log('resolved statuses:', JSON.stringify(final))
const okRequired = ['R01', 'R02', 'R03', 'R04', 'R05', 'R08', 'R09', 'R10'].every((k) => final[k] === 'ok')
if (!okRequired || final.R06 !== 'not_provided' || final.R07 !== 'not_provided') throw new Error('sample pack did not resolve as expected')
await page.setViewport({ width: 1440, height: 1500, deviceScaleFactor: 1 })
await sleep(300)
await scrollTo('#req-R04', 90)
await sleep(400)
await shot('03-checklist-resolved.png')

// 5. Bangla
await desktop(1000)
await tap('[data-testid=lang-bn]')
await sleep(1000)
await scrollTo('#req-h')
await sleep(400)
await shot('04-bangla.png')
await tap('[data-testid=lang-en]')
await sleep(700)

// 6. package ready
await desktop(900)
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
await tap('[data-testid=generate]')
await page.waitForSelector('[data-testid=download]', { timeout: 60000 })
await sleep(2600) // confetti has fallen and faded
await shot('06-package-ready.png')

await browser.close()
