// End-to-end run in a real browser: loads the sample pack, checks every rule,
// saves its screenshots to screenshots/qa/ and writes the final package to output/.
// Usage: npm run build && npx vite preview --port 4173 & node scripts/e2e.mjs
import fs from 'node:fs'
import os from 'node:os'
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
const shots = path.join(root, 'screenshots', 'qa')
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
check('start screen leaves as soon as the app is ready', await page.evaluate(() => !document.getElementById('boot')))
await page.screenshot({ path: path.join(shots, '01-start.png') })

// ---- start screen: looks, Bangla, reduced motion, and the way out when the app cannot start
{
  const isApp = (u) => /\/assets\/index-[^/]+\.js$/.test(u)
  const stuck = await browser.newPage()
  await stuck.setViewport({ width: 1440, height: 900 })
  await stuck.setRequestInterception(true)
  // The app code never arrives on this page, so the start screen stays up.
  stuck.on('request', (r) => (isApp(r.url()) ? null : r.continue()))
  // A module script that never arrives also holds back DOMContentLoaded, so do not wait for the navigation.
  stuck.goto(URL_).catch(() => {})
  await stuck.waitForSelector('#boot', { timeout: 10000 })
  await sleep(700)
  check('start screen: announced as loading, no recovery shown at first', await stuck.evaluate(() => {
    const b = document.getElementById('boot')
    return b.getAttribute('role') === 'status' && b.getAttribute('aria-busy') === 'true' && document.getElementById('bl-label').textContent.includes('Opening') && document.getElementById('boot-help').hidden
  }))
  await stuck.screenshot({ path: path.join(shots, '00-start-screen.png') })
  await stuck.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  check('start screen: reduced motion stops every animation and shows the finished tick', await stuck.evaluate(() =>
    ['.bl-check', '.bl-mark svg', '.bl-bar i'].every((q) => getComputedStyle(document.querySelector(q)).animationName === 'none') && getComputedStyle(document.querySelector('.bl-check')).strokeDashoffset === '0px'))
  await stuck.emulateMediaFeatures([])
  await stuck.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  await sleep(300)
  await stuck.screenshot({ path: path.join(shots, '00-start-screen-phone.png') })
  await stuck.waitForSelector('#boot-help:not([hidden])', { timeout: 12000 })
  check('start screen: after 8 s without the app, Try again and Start fresh appear', await stuck.evaluate(() =>
    ['bl-retry', 'bl-fresh'].every((id) => document.getElementById(id).offsetParent !== null && document.getElementById(id).textContent.trim()) && document.getElementById('boot').getAttribute('aria-busy') === 'false'))
  await stuck.screenshot({ path: path.join(shots, '00-start-screen-recovery-phone.png') })
  await stuck.close()

  const failed = await browser.newPage()
  await failed.setViewport({ width: 1440, height: 900 })
  await failed.evaluateOnNewDocument(() => localStorage.setItem('tpb-lang', 'bn'))
  await failed.setRequestInterception(true)
  failed.on('request', (r) => (isApp(r.url()) ? r.abort() : r.continue()))
  await failed.goto(URL_, { waitUntil: 'domcontentloaded' })
  await failed.waitForSelector('#boot-help:not([hidden])', { timeout: 4000 }).catch(() => {})
  check('start screen: a failed start shows the way out at once, in Bangla', await failed.evaluate(() =>
    !document.getElementById('boot-help').hidden && document.getElementById('bl-label').textContent.includes('খোলা') && document.getElementById('bl-retry').textContent.includes('আবার') && document.documentElement.lang === 'bn'))
  await failed.screenshot({ path: path.join(shots, '00-start-screen-recovery-bangla.png') })
  await failed.close()
}

// ---- requirements.json must carry a real deadline and a tender ID (nothing is opened otherwise)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tpb-e2e-'))
const baseList = JSON.parse(fs.readFileSync(path.join(pack, 'requirements.json'), 'utf8'))
const variant = (name, change) => {
  const j = JSON.parse(JSON.stringify(baseList))
  change(j.tender)
  const f = path.join(tmp, name)
  fs.writeFileSync(f, JSON.stringify(j))
  return f
}
const fileInput = () => page.$('[data-testid=file-input]')
const settle = async () => {
  await sleep(150)
  await page.waitForFunction(() => !document.querySelector('[role=status][aria-live]'), { timeout: 30000 })
  await sleep(150)
}
const badLists = [
  ['impossible day 2026-02-31', (t) => (t.submission_deadline = '2026-02-31'), 'not a real date'],
  ['29 February in a non-leap year', (t) => (t.submission_deadline = '2026-02-29'), 'not a real date'],
  ['month 13', (t) => (t.submission_deadline = '2026-13-01'), 'not a real date'],
  ['31 April', (t) => (t.submission_deadline = '2026-04-31'), 'not a real date'],
  ['missing deadline', (t) => delete t.submission_deadline, 'not a real date'],
  ['missing tender ID', (t) => delete t.tender_id, 'no tender ID'],
]
for (let i = 0; i < badLists.length; i++) {
  const [label, change, words] = badLists[i]
  await (await fileInput()).uploadFile(variant(`bad-${i}.json`, change))
  await settle()
  const opened = await page.$('[data-testid=tender-card]')
  const msg = await page.$eval('[data-testid=rejected]', (e) => e.textContent).catch(() => '')
  check(`list refused: ${label}`, !opened && msg.includes(`bad-${i}.json`) && msg.includes(words), msg.slice(-90))
}
await (await fileInput()).uploadFile(variant('leap-ok.json', (t) => (t.submission_deadline = '2028-02-29')))
await page.waitForSelector('[data-testid=tender-card]', { timeout: 10000 })
check('list accepted: real leap day 2028-02-29', await page.$eval('[data-testid=tender-card]', (e) => e.textContent.includes('29 February 2028')))
await page.$eval('[data-testid=rejected] button', (b) => b.click())
await sleep(200)

const inDialog = () => page.evaluate(() => {
  const d = [...document.querySelectorAll('[role=dialog]')].pop()
  return !!d && d.contains(document.activeElement)
})
/** Visible buttons, links and switches that a screen reader would announce with no name. */
const unnamed = () => page.evaluate(() =>
  [...document.querySelectorAll('button, a[href], [role=switch]')]
    .filter((b) => b.offsetParent !== null && !(b.getAttribute('aria-label') || b.textContent.trim()))
    .map((b) => b.outerHTML.slice(0, 90)))

/** Bytes of the package behind the Download button. */
const grab = async () => Buffer.from(await page.evaluate(async () => {
  const u = new Uint8Array(await (await fetch(document.querySelector('[data-testid=download]').href)).arrayBuffer())
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}), 'base64')
/** Reads a CSV file the strict way: quoted fields may hold commas, quotes and line breaks. */
const parseCsv = (text) => {
  const rows = [[]]
  let cell = ''
  let quoted = false
  const t = text.replace(/^\uFEFF/, '')
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

// keyboard only: picker, nested preview, focus trap, Escape, focus return
await page.focus('[data-testid="pick-R02"]')
await page.keyboard.press('Enter')
await page.waitForSelector('[data-testid=picker]')
await sleep(350)
check('dialog: focus moves inside on open', await inDialog())
check('dialog: background switched off', await page.evaluate(() => document.querySelector('main').inert && document.querySelector('header').inert))
let stays = true
for (let i = 0; i < 28; i++) {
  await page.keyboard.down('Shift')
  await page.keyboard.press('Tab')
  await page.keyboard.up('Shift')
  if (!(await inDialog())) stays = false
}
for (let i = 0; i < 28; i++) {
  await page.keyboard.press('Tab')
  if (!(await inDialog())) stays = false
}
check('dialog: Tab and Shift+Tab never leave it', stays)
await page.focus('[data-testid=picker] button[aria-label^="View"]')
await page.keyboard.press('Enter')
await page.waitForFunction(() => document.querySelectorAll('[role=dialog]').length === 2)
await sleep(350)
check('nested preview: focus inside it, picker switched off', await page.evaluate(() => {
  const d = document.querySelectorAll('[role=dialog]')
  return d[1].contains(document.activeElement) && d[0].inert
}))
check('dialog names carry the document and file name', await page.evaluate(() => {
  const d = document.querySelectorAll('[role=dialog]')
  return d[0].getAttribute('aria-label').includes('TIN Certificate') && d[1].getAttribute('aria-label').includes('.pdf')
}))
let trapped = true
for (let i = 0; i < 6; i++) {
  await page.keyboard.press('Tab')
  if (!(await inDialog())) trapped = false
}
check('nested preview: Tab stays in the preview', trapped)
await page.keyboard.press('Escape')
await sleep(350)
check('nested preview: Escape closes only the preview, focus back on its button', await page.evaluate(() => {
  const d = document.querySelectorAll('[role=dialog]')
  return d.length === 1 && !d[0].inert && d[0].contains(document.activeElement) && (document.activeElement.getAttribute('aria-label') || '').startsWith('View')
}))
await page.screenshot({ path: path.join(shots, '03-choose-file.png') })
await page.keyboard.press('Escape')
await sleep(350)
check('dialog: Escape closes it, focus back on the opening button', await page.evaluate(() =>
  !document.querySelector('[role=dialog]') && document.activeElement?.dataset.testid === 'pick-R02' && !document.querySelector('main').inert))

// 4.3 manual matching through the picker dialog
await page.keyboard.press('Enter')
await page.waitForSelector('[data-testid=picker]')
await sleep(300)
await page.focus('[data-testid="picker-item"][data-name="03_tin_certificate.pdf"]')
await page.keyboard.press('Enter')
await sleep(400)
st = await statuses()
check('4.3 match through dialog (keyboard)', st.R02 === 'ok', st.R02)
check('dialog: after a choice focus lands on the Change button of that document', await page.evaluate(() => document.activeElement?.dataset.testid === 'change-R02'))
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
// a bad list must not disturb the open project
await (await fileInput()).uploadFile(variant('bad-late.json', (t) => (t.submission_deadline = '2026-02-31')))
await settle()
const kept = await statuses()
check('bad list leaves the open project untouched', JSON.stringify(kept) === JSON.stringify(st) && (await page.$eval('[data-testid=tender-card]', (e) => e.textContent.includes('T-2026-0417') && e.textContent.includes('20 October 2026'))))
await page.$eval('[data-testid=rejected] button', (b) => b.click())
await sleep(200)
const sum = await page.$eval('[data-testid=summary]', (e) => e.textContent)
check('summary is honest about optional documents', sum === '8 included · 2 optional skipped · 0 problems', sum)
check('every visible control has a name (English, desktop)', (await unnamed()).length === 0, (await unnamed()).join(' | '))
await page.evaluate(() => window.scrollTo(0, 0))
await sleep(500)
await page.screenshot({ path: path.join(shots, '05-statuses-all-ok.png') })
await page.screenshot({ path: path.join(shots, '06-statuses-full-page.png'), fullPage: true })

await page.$eval('[data-testid=extras]', (e) => e.scrollIntoView({ block: 'start' }))
await sleep(500)
await page.screenshot({ path: path.join(shots, '06b-more-options.png') })
check('AI help is off until a key is typed', await page.$eval('[data-testid=ai-box] button', (b) => b.disabled))

// 4.9 Bangla
await tap('[data-testid=lang-bn]')
await sleep(900)
const bnTitle = await page.$eval('[data-testid=req-R01] h3', (e) => e.textContent)
check('4.9 Bangla titles from title_bn', bnTitle === 'ট্রেড লাইসেন্স', bnTitle)
check('every visible control has a name (Bangla, desktop)', (await unnamed()).length === 0, (await unnamed()).join(' | '))
await page.focus('[data-testid="change-R01"]')
await page.keyboard.press('Enter')
await page.waitForSelector('[data-testid=picker]')
await sleep(300)
check('Bangla: dialog named in Bangla and holds focus', (await inDialog()) && (await page.$eval('[role=dialog]', (d) => d.getAttribute('aria-label').includes('ট্রেড লাইসেন্স'))))
await page.keyboard.press('Escape')
await sleep(300)
check('Bangla: focus back on the opening button', await page.evaluate(() => document.activeElement?.dataset.testid === 'change-R01'))
await page.evaluate(() => window.scrollTo(0, 0))
await sleep(300)
await page.screenshot({ path: path.join(shots, '07-bangla.png') })
await page.screenshot({ path: path.join(shots, '08-bangla-full-page.png'), fullPage: true })
await tap('[data-testid=lang-en]')
await sleep(500)

// bonus: seal. A damaged picture is refused, the page list is checked, and a bad list blocks the package.
const sealInput = () => page.$('[data-testid=seal-input]')
const brokenPng = path.join(tmp, 'broken-seal.png')
fs.writeFileSync(brokenPng, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('this is not picture data at all')]))
const toastText = () => page.$eval('[data-testid=toast]', (e) => e.textContent).catch(() => '')
await (await sealInput()).uploadFile(brokenPng)
await sleep(700)
check('seal: damaged picture refused with its own message, no seal created', !(await page.$('[data-testid=seal-box]')) && (await toastText()).includes('damaged') && (await toastText()).includes('broken-seal.png'), await toastText())
await (await sealInput()).uploadFile(path.join(pack, 'documents/company_logo.png'))
await page.waitForSelector('[data-testid=seal-box]')
const goodSeal = await page.$eval('[data-testid=seal-box] img', (i) => i.src)
await (await sealInput()).uploadFile(brokenPng)
await sleep(700)
check('seal: a damaged replacement keeps the earlier good seal', (await page.$eval('[data-testid=seal-box] img', (i) => i.src)) === goodSeal && (await toastText()).includes('damaged'))
await page.$eval('[data-testid=toast] button:last-child', (b) => b.click()).catch(() => {})
await page.select('[data-testid=seal-pages]', 'custom')
await page.waitForSelector('[data-testid=seal-custom]')
const typePages = async (v) => {
  await page.$eval('[data-testid=seal-custom]', (el, val) => {
    el.value = val
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, v)
  await sleep(200)
  return {
    issue: await page.$eval('[data-testid=seal-issue]', (e) => e.textContent).catch(() => ''),
    ok: await page.$eval('[data-testid=seal-pages-ok]', (e) => e.textContent).catch(() => ''),
    blocked: await genDisabled(),
  }
}
for (const [value, words] of [['', 'Type the page numbers'], ['0', 'Page 0 does not exist'], ['99', 'pages 1 to 17'], ['abc', 'is not a page number'], ['0,999,abc', 'does not exist'], ['1-', 'is not a page number']]) {
  const r = await typePages(value)
  check(`seal pages "${value}": refused with a reason and the package is blocked`, r.issue.includes(words) && r.blocked && !r.ok, JSON.stringify(r))
}
check('seal pages: the reason is also shown next to the Make package button', (await page.$eval('[data-testid=seal-blocks]', (e) => e.textContent)).includes('is not a page number'))
let r = await typePages('১, ৩-৫')
check('seal pages "১, ৩-৫" (Bangla digits) = 1, 3, 4, 5', r.ok === 'Seal pages (4): 1, 3, 4, 5' && !r.blocked, JSON.stringify(r))
r = await typePages('1 - 3')
check('seal pages "1 - 3" = 1, 2, 3', r.ok === 'Seal pages (3): 1, 2, 3' && !r.blocked, JSON.stringify(r))
await page.$eval('[data-testid=generate]', (b) => b.click())
await page.waitForSelector('[data-testid=download]', { timeout: 60000 })
const sealedBytes = await grab()
const sealedSize = sealedBytes.length
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
check('index start pages match where the documents really begin', ['1 Trade License', '3', '2 TIN Certificate', '4', '5 Experience Certificate', '7', '6 Technical Proposal', '9', '8 Signed Declaration', '17'].every((w) => texts[1].includes(w)), texts[1].slice(0, 260))
const imageCounts = async (bytes) => {
  const d = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise
  const out = []
  for (let i = 1; i <= d.numPages; i++) out.push((await (await d.getPage(i)).getOperatorList()).fnArray.filter((f) => f === pdfjs.OPS.paintImageXObject).length)
  return out
}
const plain = await imageCounts(pdfBytes)
const stamped = await imageCounts(sealedBytes)
const sealedPages = stamped.map((n, i) => (n > plain[i] ? i + 1 : 0)).filter(Boolean)
check('seal with the page list "1 - 3" is on pages 1, 2 and 3 and nowhere else', sealedPages.join() === '1,2,3', sealedPages.join())

// success dialog: visible way back, then real downloads into a folder
check('success dialog has a visible Back to checklist button', await page.$eval('[data-testid=result-close]', (b) => b.offsetParent !== null && b.textContent.trim() === 'Back to checklist'))
await tap('[data-testid=result-close]')
await sleep(350)
check('success dialog closes with its button', !(await page.$('[data-testid=result]')))
const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'tpb-dl-'))
const cdp = await browser.target().createCDPSession()
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl })
const waitFile = async (n) => {
  for (let i = 0; i < 60; i++) {
    if (fs.existsSync(path.join(dl, n)) && !fs.readdirSync(dl).some((f) => f.endsWith('.crdownload'))) return true
    await sleep(250)
  }
  return false
}
await tap('[data-testid=show-result]')
await page.waitForSelector('[data-testid=download]')
await tap('[data-testid=download]')
const gotPdf = await waitFile(name)
check('4.8 PDF download completes with the exact name and the same bytes', gotPdf && Buffer.compare(fs.readFileSync(path.join(dl, name)), pdfBytes) === 0, fs.readdirSync(dl).join(', '))
await page.keyboard.press('Escape')
await sleep(300)
await tap('[data-testid=csv]')
const csvFile = path.join(dl, 'T-2026-0417_Checklist.csv')
const gotCsv = await waitFile('T-2026-0417_Checklist.csv')
const csv = gotCsv ? fs.readFileSync(csvFile, 'utf8') : ''
const en = parseCsv(csv)
check('checklist (English): downloaded, UTF-8 mark, 7 columns, 10 rows', gotCsv && csv.charCodeAt(0) === 0xfeff && en.length === 11 && en.every((row) => row.length === 7) && en[0].join('|') === 'No.|Document|Required|File name|Pages|Expiry date|Status', en[0].join('|'))
check('checklist (English): files, pages, dates and statuses match the screen', en[1].join('|') === '1|Trade License|Yes|trade_license_2026.pdf|1|2027-06-30|OK' && en[4].join('|') === '4|Bank Solvency Certificate|Yes|bank_solvency.pdf|1|2026-12-31|OK' && en[6].join('|') === '6|Audited Financial Statement|No||||Not provided' && en[8].join('|') === '8|Technical Proposal|Yes|02_technical_proposal.pdf|6||OK', en.slice(1).map((x) => x.join('|')).join(' // '))
fs.rmSync(csvFile)
await tap('[data-testid=lang-bn]')
await sleep(700)
await tap('[data-testid=csv]')
const gotBn = await waitFile('T-2026-0417_Checklist.csv')
const bn = parseCsv(gotBn ? fs.readFileSync(csvFile, 'utf8') : '')
check('checklist (Bangla): headers, titles and statuses in Bangla, same data', gotBn && bn.length === 11 && bn[0].join('|') === 'ক্রম|নথি|আবশ্যক|ফাইলের নাম|পৃষ্ঠা|মেয়াদ শেষের তারিখ|অবস্থা' && bn[1].join('|') === '1|ট্রেড লাইসেন্স|হ্যাঁ|trade_license_2026.pdf|1|2027-06-30|ঠিক আছে' && bn[7].join('|') === '7|প্রস্তুতকারকের অনুমোদনপত্র|না||||দেওয়া হয়নি', bn.slice(0, 2).map((x) => x.join('|')).join(' // '))
await tap('[data-testid=lang-en]')
await sleep(500)

// tablet and phones: no sideways scroll, statuses close to the top, every control named
for (const [w, h, mobile, shot] of [[768, 1024, false, '10-tablet'], [390, 844, true, '11-phone'], [320, 740, true, '12-small-phone']]) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile })
  // Watch the reload: the empty landing page must never be painted while saved work comes back.
  await page.evaluateOnNewDocument(() => {
    window.__landingSeen = false
    new MutationObserver(() => {
      const zone = document.querySelector('[data-testid=dropzone]')
      if (zone && !document.querySelector('[data-testid=tender-card]') && !document.getElementById('boot')?.isConnected) window.__landingSeen = true
    }).observe(document, { childList: true, subtree: true })
  })
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('[data-testid=tender-card]')
  check(`${w}px: reload with saved work shows no empty landing page and removes the start screen`, await page.evaluate(() => window.__landingSeen === false && !document.getElementById('boot')))
  await sleep(900)
  await page.$eval('[data-testid=toast] button:last-child', (b) => b.click()).catch(() => {})
  const m = await page.evaluate(() => ({
    wide: document.documentElement.scrollWidth - window.innerWidth,
    listHidden: document.querySelector('[data-testid=files]').offsetParent === null,
    toggle: !!document.querySelector('[data-testid=files-toggle]')?.offsetParent,
    jump: !!document.querySelector('[data-testid=jump-docs]')?.offsetParent,
    docsTop: Math.round(document.getElementById('req-h').getBoundingClientRect().top + window.scrollY),
    restored: [...document.querySelectorAll('article[data-testid^="req-"]')].filter((e) => e.dataset.status === 'ok').length,
  }))
  check(`${w}px: no sideways scroll`, m.wide <= 0, String(m.wide))
  check(`${w}px: file list folded, jump button and Show files visible, work restored after reload`, m.listHidden && m.toggle && m.jump && m.restored === 8, JSON.stringify(m))
  check(`${w}px: every visible control has a name`, (await unnamed()).length === 0, (await unnamed()).join(' | '))
  await page.screenshot({ path: path.join(shots, `${shot}.png`) })
  await tap('[data-testid=jump-docs]')
  await sleep(900)
  const top = await page.evaluate(() => Math.round(document.getElementById('req-h').getBoundingClientRect().top))
  check(`${w}px: one tap reaches the documents`, top >= 0 && top < h * 0.5, `heading at ${top}px, was ${m.docsTop}px down the page`)
  await page.screenshot({ path: path.join(shots, `${shot}-statuses.png`) })
  if (w === 390) {
    await tap('[data-testid=files-toggle]')
    await sleep(300)
    check('390px: Show files opens the full list', await page.evaluate(() => document.querySelectorAll('[data-testid=file-card]').length === 10 && document.querySelector('[data-testid=files]').offsetParent !== null))
  }
}
fs.rmSync(tmp, { recursive: true, force: true })
fs.rmSync(dl, { recursive: true, force: true })

check('no browser errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED')
process.exit(failed ? 1 : 0)
