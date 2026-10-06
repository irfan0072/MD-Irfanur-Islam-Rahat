// Checks the optional AI help in a real browser.
// The providers' answers are simulated here, so no key is needed and nothing is billed.
// What this can prove: what the app sends, to whom, with which key, and how it treats each kind of answer.
// What it cannot prove: that a real model accepts the request and answers well. That needs a real key.
// With LIVE=1 it also sends one request per provider with a made-up key to see the real "wrong key" answer.
// Usage: npm run build && npm run preview (other terminal), then: node scripts/ai-test.mjs
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

let failed = 0
let passed = 0
const check = (name, ok, extra = '') => {
  ok ? passed++ : failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra ? `  ->  ${extra}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const HOSTS = { google: 'generativelanguage.googleapis.com', openai: 'api.openai.com', anthropic: 'api.anthropic.com' }
const NAMES = { google: 'Google', openai: 'OpenAI', anthropic: 'Anthropic' }
const KEYS = { google: 'TEST-KEY-GOOGLE-1111', openai: 'TEST-KEY-OPENAI-2222', anthropic: 'TEST-KEY-ANTHROPIC-3333' }
const MODELS = [
  ['gemini-2.5-flash', 'google'],
  ['gpt-4o', 'openai'],
  ['claude-opus-5-5', 'anthropic'],
  ['gemini-3.8-flash', 'google'],
  ['claude-sonnet-5-5', 'anthropic'],
]

// The answer a model would give for the sample pack, plus three entries that must be ignored one by one.
const ANSWER = JSON.stringify({
  files: [
    { file_number: 1, requirement_id: 'R09', expiry_date: '' },
    { file_number: 2, requirement_id: 'R08', expiry_date: '' },
    { file_number: 3, requirement_id: 'R02', expiry_date: '' },
    { file_number: 4, requirement_id: 'R03', expiry_date: '' },
    { file_number: 5, requirement_id: 'R04', expiry_date: '2026-12-31' },
    { file_number: 6, requirement_id: 'R05', expiry_date: '' },
    { file_number: 7, requirement_id: 'R05', expiry_date: '' },
    { file_number: 8, requirement_id: 'R10', expiry_date: '' },
    { file_number: 9, requirement_id: 'R01', expiry_date: '2025-06-30' },
    { file_number: 10, requirement_id: 'R01', expiry_date: '2027-06-30' },
    { file_number: 99, requirement_id: 'R06', expiry_date: '' },
    { file_number: 'two', requirement_id: 'R07', expiry_date: '' },
    { file_number: 3, requirement_id: 'NO-SUCH-DOCUMENT', expiry_date: '2026-02-31' },
  ],
})

const wrap = {
  google: (text) => ({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] }),
  openai: (text) => ({ id: 'resp_test', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] }),
  anthropic: (text) => ({ id: 'msg_test', type: 'message', role: 'assistant', model: 'test', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }),
}
const ERRORS = {
  google: {
    key: [400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }],
    model: [404, { error: { code: 404, message: 'models/x is not found for API version v1beta, or is not supported for generateContent.', status: 'NOT_FOUND' } }],
    limit: [429, { error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED' } }],
    network: [500, { error: { code: 500, message: 'Internal error', status: 'INTERNAL' } }],
    refused: [200, { promptFeedback: { blockReason: 'SAFETY' } }],
  },
  openai: {
    key: [401, { error: { message: 'Incorrect API key provided.', type: 'invalid_request_error', code: 'invalid_api_key' } }],
    model: [404, { error: { message: 'The model `x` does not exist or you do not have access to it.', type: 'invalid_request_error', code: 'model_not_found' } }],
    limit: [429, { error: { message: 'Rate limit reached for requests.', type: 'requests', code: 'rate_limit_exceeded' } }],
    network: [500, { error: { message: 'The server had an error.', type: 'server_error' } }],
    refused: [200, { id: 'resp_test', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'I cannot help with that.' }] }] }],
  },
  anthropic: {
    key: [401, { type: 'error', error: { type: 'authentication_error', message: 'API key is invalid.' } }],
    model: [404, { type: 'error', error: { type: 'not_found_error', message: 'model: x' } }],
    limit: [429, { type: 'error', error: { type: 'rate_limit_error', message: 'Rate limited.' } }],
    network: [500, { type: 'error', error: { type: 'api_error', message: 'Internal server error.' } }],
    refused: [200, { id: 'msg_test', type: 'message', role: 'assistant', model: 'test', content: [], stop_reason: 'refusal', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } }],
  },
}
const WORDS = { key: 'was not accepted by', model: 'is not available for this API key', limit: 'reached its limit', network: 'Could not reach the AI service', refused: 'declined to read', bad: 'could not be read' }

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 1000 })

// Every request to an AI host is recorded and answered here; nothing reaches the real services.
let calls = []
let reply = null
let live = false
await page.setRequestInterception(true)
page.on('request', (r) => {
  const host = new URL(r.url()).host
  if (!Object.values(HOSTS).includes(host) || live) {
    if (Object.values(HOSTS).includes(host) && r.method() === 'POST') calls.push({ host, url: r.url(), headers: r.headers(), body: r.postData() ?? '' })
    return r.continue()
  }
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-expose-headers': '*' }
  if (r.method() === 'OPTIONS') return r.respond({ status: 204, headers: cors })
  calls.push({ host, url: r.url(), headers: r.headers(), body: r.postData() ?? '' })
  if (reply === 'abort') return r.abort('failed')
  return r.respond({ status: reply[0], headers: cors, contentType: 'application/json', body: JSON.stringify(reply[1]) })
})

await page.goto(URL_, { waitUntil: 'networkidle0' })
await page.$eval('[data-testid=sample]', (b) => b.click())
await page.waitForFunction(() => document.querySelectorAll('[data-testid=file-card]').length === 10, { timeout: 30000 })
await page.waitForFunction(() => document.querySelectorAll('[data-testid=file-card] img').length === 10, { timeout: 30000 })
await sleep(600)

const statuses = () => page.$$eval('article[data-testid^="req-"]', (els) => els.map((e) => `${e.dataset.testid.slice(4)}:${e.dataset.status}`).join(' '))
const matches = () => page.$$eval('[data-testid=file-card]', (els) => Object.fromEntries(els.map((e) => [e.dataset.name, e.querySelector('select').value])))
const toast = () => page.$eval('[data-testid=toast]', (e) => e.textContent).catch(() => '')
const closeToast = () => page.$eval('[data-testid=toast] button:last-child', (b) => b.click()).catch(() => {})
const pickModel = async (id) => {
  await page.select('[data-testid=ai-model]', id)
  await sleep(250)
}
const typeKey = (v) =>
  page.$eval('[data-testid=ai-key]', (el, val) => {
    el.value = val
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, v)
const ask = async (wait = 20000) => {
  await closeToast()
  await page.$eval('[data-testid=ai-ask]', (b) => b.click())
  await page.waitForSelector('[data-testid=toast]', { timeout: wait })
  await page.waitForFunction(() => !document.querySelector('[role=status][aria-live]'), { timeout: wait })
  await sleep(200)
  return toast()
}

// The user's own work that the AI must not touch: a hand-made match and a hand-typed date.
await page.select('[data-testid="file-card"][data-name="04_vat_certificate.pdf"] select', 'R02')
await page.select('[data-testid="file-card"][data-name="bank_solvency.pdf"] select', 'R04')
await sleep(300)
await page.$eval('[data-testid="date-R04"]', (el) => {
  el.value = '2026-11-11'
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
await sleep(300)
const before = await statuses()
const beforeMatches = JSON.stringify(await matches())

check('default model is Gemini 2.5 Flash, grouped as Standard; Claude sits under Advanced models', await page.$eval('[data-testid=ai-model]', (s) => s.value === 'gemini-2.5-flash' && [...s.querySelectorAll('optgroup')].map((g) => `${g.label}:${[...g.children].map((o) => o.value).join('+')}`).join(' | ') === 'Standard:gemini-2.5-flash+gpt-4o | Advanced models:gemini-3.8-flash+claude-sonnet-5-5+claude-opus-5-5'))
check('Ask AI is off until a key is typed', await page.$eval('[data-testid=ai-ask]', (b) => b.disabled))

// ---- switching models and typing keys sends nothing
for (const [id, provider] of MODELS) {
  await pickModel(id)
  await typeKey(KEYS[provider])
  await sleep(150)
}
const shown = []
for (const [id, provider] of MODELS) {
  await pickModel(id)
  shown.push(`${await page.$eval('[data-testid=ai-key-label]', (e) => e.textContent)}=${await page.$eval('[data-testid=ai-key]', (e) => e.value)}`)
  const target = await page.$eval('[data-testid=ai-target]', (e) => e.textContent)
  check(`${id}: the provider and model are named before sending`, !target.includes('{') && target.includes(`your ${NAMES[provider]} key`) && target.includes(await page.$eval('[data-testid=ai-model]', (s) => s.selectedOptions[0].textContent.split(' (')[0])), target)
}
check('choosing models and typing keys made no request to any AI service', calls.length === 0, String(calls.length))
check('each provider keeps its own key field', shown.join(' ; ') === MODELS.map(([, p]) => `${NAMES[p]} API key=${KEYS[p]}`).join(' ; '), shown.join(' ; '))
check('keys are in tab storage only, not in saved work', await page.evaluate(async (keys) => {
  const inTab = Object.keys(sessionStorage).filter((k) => k.startsWith('tpb-ai-key-')).length === 3
  const inLocal = JSON.stringify(Object.entries(localStorage))
  const saved = await new Promise((res) => {
    const open = indexedDB.open('tender-package-builder')
    open.onsuccess = () => {
      const rq = open.result.transaction('kv').objectStore('kv').get('state')
      rq.onsuccess = () => res(JSON.stringify(rq.result ?? {}))
    }
    open.onerror = () => res('')
  })
  return inTab && !keys.some((k) => inLocal.includes(k) || saved.includes(k))
}, Object.values(KEYS)))
await page.$eval('[data-testid=ai-box]', (e) => e.scrollIntoView({ block: 'center' }))
await sleep(400)
await pickModel('gemini-2.5-flash')
await page.screenshot({ path: path.join(root, 'screenshots/qa/13-ai-models.png') })

// ---- a good answer, per model
for (const [id, provider] of MODELS) {
  await pickModel(id)
  calls = []
  reply = [200, wrap[provider](ANSWER)]
  const msg = await ask()
  const c = calls[0] ?? { host: '', url: '', headers: {}, body: '' }
  const auth = provider === 'google' ? c.headers['x-goog-api-key'] : provider === 'openai' ? c.headers['authorization'] : c.headers['x-api-key']
  const whole = JSON.stringify(c.headers) + c.url + c.body
  const others = Object.entries(KEYS).filter(([p]) => p !== provider).map(([, k]) => k)
  check(`${id}: one request, to ${HOSTS[provider]}, naming this model`, calls.length === 1 && c.host === HOSTS[provider] && (c.url + c.body).includes(id), `${calls.length} ${c.host}`)
  check(`${id}: carries only the ${NAMES[provider]} key`, (auth ?? '').includes(KEYS[provider]) && !others.some((k) => whole.includes(k)) && !c.url.includes(KEYS[provider]))
  check(`${id}: sends file names, first-page text and the scan as a picture`, c.body.includes('scan_0042.pdf') && c.body.includes('TRADE LICENSE') && (c.body.includes('"inline_data"') || c.body.includes('data:image/jpeg;base64,') || c.body.includes('"media_type":"image/jpeg"')) && (c.body.match(/\/9j\//g) ?? []).length === 1)
  const st = await statuses()
  const m = await matches()
  const date = await page.$eval('[data-testid="date-R04"]', (e) => e.value)
  check(`${id}: answer applied (scan matched, valid license chosen, one copy used, bad entries ignored)`, st === 'R01:ok R02:ok R03:missing R04:ok R05:ok R06:not_provided R07:not_provided R08:ok R09:ok R10:ok' && m['scan_0042.pdf'] === 'R10' && m['trade_license_2026.pdf'] === 'R01' && m['trade_license_2025.pdf'] === '' && [m['experience_cert.pdf'], m['experience_cert (1).pdf']].filter(Boolean).join() === 'R05' && msg.includes('AI matched'), `${st} | ${msg}`)
  check(`${id}: hand-made match and hand-typed date left alone`, m['04_vat_certificate.pdf'] === 'R02' && m['03_tin_certificate.pdf'] === '' && date === '2026-11-11', `${m['04_vat_certificate.pdf']} ${date}`)
  await page.$eval('[data-testid=toast] button', (b) => b.click()) // Undo
  await sleep(300)
  check(`${id}: Undo puts everything back`, (await statuses()) === before && JSON.stringify(await matches()) === beforeMatches)
}

// ---- every kind of failure: clear message, nothing changed, no other provider or model tried
for (const [id, provider] of MODELS.slice(0, 3)) {
  await pickModel(id)
  const cases = { ...ERRORS[provider], bad: [200, wrap[provider]('Sure! Here are the matches: 1 is the trade license')], 'bad (cut off)': [200, wrap[provider]('{"files":[{"file_number":1,"requirement_id":"R0')], 'network (no connection)': 'abort' }
  for (const [name, r] of Object.entries(cases)) {
    const kind = name.split(' ')[0]
    calls = []
    reply = r
    const msg = await ask()
    const sameTarget = calls.length >= 1 && calls.length <= 2 && calls.every((c) => c.host === HOSTS[provider] && (c.url + c.body).includes(id))
    check(`${id}, ${name}: says "${WORDS[kind]}", changes nothing, tries no other service or model`, msg.includes(WORDS[kind]) && (kind !== 'key' || msg.includes(NAMES[provider])) && sameTarget && (await statuses()) === before && JSON.stringify(await matches()) === beforeMatches, `${msg} | calls ${calls.map((c) => c.host).join(',')}`)
  }
}

// ---- optional: the real services' answer to a made-up key (proves browser access and the wrong-key message; costs nothing)
if (process.env.LIVE === '1') {
  live = true
  for (const [id, provider] of MODELS.slice(0, 3)) {
    await pickModel(id)
    await typeKey('made-up-key-for-testing-0000')
    calls = []
    const msg = await ask(60000).catch(() => 'no answer')
    check(`LIVE ${id}: the real ${NAMES[provider]} service was reached from the browser and refused the made-up key with a clear message`, msg.includes('was not accepted by ' + NAMES[provider]) && calls.length === 1 && (await statuses()) === before, msg)
  }
  live = false
}

await browser.close()
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
