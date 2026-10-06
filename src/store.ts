import { fmtDate, setI18nLang, tr } from './i18n'
import { BuildError } from './lib/build'
import { findExpiry, isRealDate, pickPairs, suggest, type Suggestion } from './lib/match'
import { formatSize, hashBytes, inspectPdf, isImageBytes, isPdfBytes } from './lib/pdf'
import type { Lang, RejectReason, Rejected, Requirement, Result, Seal, Status, Tender, Toast, UFile } from './types'

export const MAX_FILES = 30
export const MAX_BYTES = 50 * 1024 * 1024

interface Snap {
  matches: Record<string, string>
  expiry: Record<string, string>
}

export interface State {
  lang: Lang
  tender: Tender | null
  reqs: Requirement[]
  files: UFile[]
  /** requirement id -> file id */
  matches: Record<string, string>
  /** file id -> expiry date (YYYY-MM-DD). The date belongs to the file, so it follows the file. */
  expiry: Record<string, string>
  /** file ids whose date was read from the file and not yet touched by the user */
  autoDate: Record<string, boolean>
  rejected: Rejected[]
  withIndex: boolean
  seal: Seal | null
  busy: { label: 'reading' | 'building' | 'thinking'; done: number; total: number } | null
  toast: Toast | null
  result: Result | null
  stale: boolean
  past: Snap[]
  booted: boolean
}

function startLang(): Lang {
  try {
    const saved = localStorage.getItem('tpb-lang')
    if (saved === 'bn' || saved === 'en') return saved
  } catch {
    /* storage can be blocked */
  }
  return navigator.language?.toLowerCase().startsWith('bn') ? 'bn' : 'en'
}

const fresh = (): State => ({
  lang: startLang(),
  tender: null,
  reqs: [],
  files: [],
  matches: {},
  expiry: {},
  autoDate: {},
  rejected: [],
  withIndex: true,
  seal: null,
  busy: null,
  toast: null,
  result: null,
  stale: false,
  past: [],
  booted: false,
})

export let S: State = fresh()
setI18nLang(S.lang)

const subs = new Set<() => void>()
export const subscribe = (fn: () => void) => {
  subs.add(fn)
  return () => {
    subs.delete(fn)
  }
}

function set(patch: Partial<State>, save = true) {
  S = { ...S, ...patch }
  subs.forEach((f) => f())
  if (save) scheduleSave()
}

let uidN = 0
const uid = () => `${Date.now().toString(36)}${(uidN++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

// ---------------------------------------------------------------- selectors

export const fileById = (id?: string) => (id ? S.files.find((f) => f.id === id) : undefined)
export const reqTitle = (r: Requirement) => (S.lang === 'bn' ? r.title_bn || r.title_en : r.title_en || r.title_bn)
export const reqOfFile = (fileId: string) => S.reqs.find((r) => S.matches[r.id] === fileId)

/** Section 5 of the problem statement: exactly one status per required document. */
export function statusOf(r: Requirement): Status {
  const f = fileById(S.matches[r.id])
  if (!f) return r.mandatory ? 'missing' : 'not_provided'
  if (r.has_expiry) {
    const d = S.expiry[f.id]
    if (!d) return 'need_date'
    // Same day as the deadline is still valid; only an earlier date is expired.
    if (d < (S.tender?.submission_deadline ?? '')) return 'expired'
  }
  return 'ok'
}

export const isBlocking = (s: Status) => s === 'missing' || s === 'need_date' || s === 'expired'
export const blockers = () => S.reqs.filter((r) => isBlocking(statusOf(r)))

/** Other uploaded files with exactly the same content. */
export function copiesOf(f: UFile): UFile[] {
  return S.files.filter((o) => o.id !== f.id && o.hash === f.hash)
}

/** The document that already uses a copy of this file, if any. */
export function copyConflict(f: UFile, forReq: string): { other: UFile; req: Requirement } | null {
  for (const r of S.reqs) {
    if (r.id === forReq) continue
    const o = fileById(S.matches[r.id])
    if (o && o.id !== f.id && o.hash === f.hash) return { other: o, req: r }
  }
  return null
}

let sugKey: unknown[] = []
let sugVal: Suggestion[] = []
export function suggestions(): Suggestion[] {
  if (sugKey[0] !== S.reqs || sugKey[1] !== S.files) {
    sugKey = [S.reqs, S.files]
    sugVal = S.tender ? suggest(S.reqs, S.files, S.tender.submission_deadline) : []
  }
  return sugVal
}
/** Best free suggestion for each unmatched document. */
export function openPairs(): Suggestion[] {
  return pickPairs(suggestions(), S.files, S.matches)
}

// ------------------------------------------------------------------ actions

export function toast(msg: string, kind: Toast['kind'] = 'info', undo = false) {
  set({ toast: { id: Date.now() + Math.random(), msg, kind, undo } }, false)
}
export const clearToast = () => set({ toast: null }, false)

export function setLang(lang: Lang) {
  setI18nLang(lang)
  document.documentElement.lang = lang
  try {
    localStorage.setItem('tpb-lang', lang)
  } catch {
    /* ignore */
  }
  set({ lang })
}

/** Any change makes an already built package out of date. */
function dropResult(): Partial<State> {
  if (!S.result) return {}
  URL.revokeObjectURL(S.result.url)
  return { result: null, stale: true }
}

function change(patch: Partial<State>, undoable = true) {
  const past = undoable ? [...S.past.slice(-40), { matches: S.matches, expiry: S.expiry }] : S.past
  set({ ...dropResult(), ...patch, past })
}

export function undo() {
  const last = S.past[S.past.length - 1]
  if (!last) return
  // Matches to files that were removed in the meantime are dropped.
  const alive = new Set(S.files.map((f) => f.id))
  const matches: Record<string, string> = {}
  for (const k in last.matches) if (alive.has(last.matches[k])) matches[k] = last.matches[k]
  set({ ...dropResult(), matches, expiry: last.expiry, past: S.past.slice(0, -1), toast: null })
}

export function assign(reqId: string, fileId: string | null): boolean {
  const matches = { ...S.matches }
  if (!fileId) {
    if (!matches[reqId]) return true
    delete matches[reqId]
    change({ matches })
    return true
  }
  const f = fileById(fileId)
  const req = S.reqs.find((r) => r.id === reqId)
  if (!f || !req) return false
  if (matches[reqId] === fileId) return true
  const clash = copyConflict(f, reqId)
  if (clash) {
    toast(tr('dupBlocked', { a: f.name, f: clash.other.name, d: reqTitle(clash.req) }), 'bad')
    return false
  }
  // One file goes to at most one document: taking it here frees it elsewhere.
  for (const k in matches) if (matches[k] === fileId) delete matches[k]
  matches[reqId] = fileId
  change({ matches })
  return true
}

export function setExpiry(fileId: string, date: string, auto = false) {
  const expiry = { ...S.expiry }
  const autoDate = { ...S.autoDate }
  if (date) expiry[fileId] = date
  else delete expiry[fileId]
  if (auto) autoDate[fileId] = true
  else delete autoDate[fileId]
  change({ expiry, autoDate })
}

export function removeFile(id: string) {
  const matches = { ...S.matches }
  for (const k in matches) if (matches[k] === id) delete matches[k]
  const expiry = { ...S.expiry }
  delete expiry[id]
  kvDel(`file:${id}`)
  change({ files: S.files.filter((f) => f.id !== id), matches, expiry })
}

export function dismissRejected(id?: string) {
  set({ rejected: id ? S.rejected.filter((r) => r.id !== id) : [] }, false)
}

export function autoMatch() {
  const pairs = openPairs()
  if (!pairs.length) {
    toast(tr('autoNone'), 'info')
    return
  }
  const matches = { ...S.matches }
  const expiry = { ...S.expiry }
  const autoDate = { ...S.autoDate }
  for (const p of pairs) {
    matches[p.reqId] = p.fileId
    const r = S.reqs.find((x) => x.id === p.reqId)
    const f = fileById(p.fileId)
    if (r?.has_expiry && f?.dateHint && !expiry[f.id]) {
      expiry[f.id] = f.dateHint
      autoDate[f.id] = true
    }
  }
  change({ matches, expiry, autoDate })
  toast(tr('autoDone', { n: pairs.length }), 'ok', true)
}

export function setOption(patch: Partial<Pick<State, 'withIndex'>>) {
  change(patch, false)
}

export function setSeal(seal: Seal | null) {
  if (S.seal && S.seal.url !== seal?.url) URL.revokeObjectURL(S.seal.url)
  if (!seal) kvDel('seal')
  change({ seal }, false)
}

export function sealFromBytes(name: string, bytes: Uint8Array): boolean {
  if (!isImageBytes(bytes)) {
    toast(tr('sealBad'), 'bad')
    return false
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]))
  setSeal({ name, bytes, url, pages: S.seal?.pages ?? 'cover', custom: S.seal?.custom ?? '', pos: S.seal?.pos ?? 'br', size: S.seal?.size ?? 0.2 })
  return true
}

export async function reset() {
  if (S.result) URL.revokeObjectURL(S.result.url)
  if (S.seal) URL.revokeObjectURL(S.seal.url)
  const lang = S.lang
  await kvClear()
  savedFiles.clear()
  S = { ...fresh(), lang, booted: true }
  subs.forEach((f) => f())
}

// ------------------------------------------------------------------- intake

const asBool = (v: unknown) => v === true || v === 1 || (typeof v === 'string' && /^(true|yes|1)$/i.test(v.trim()))

/** Why a tender list was refused, so the message can say what to fix. */
export class ListError extends Error {
  constructor(public reason: 'bad_deadline' | 'bad_fields') {
    super(reason)
  }
}

/**
 * The deadline should be YYYY-MM-DD; a time part or a day-first date is still understood.
 * Returns null when it is missing or names a day that does not exist.
 */
function toIsoDate(v: string): string | null {
  const s = v.trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (!m) {
    const d = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/.exec(s)
    if (d) m = [d[0], d[3], d[2], d[1]] as unknown as RegExpExecArray
  }
  if (!m) return null
  const out = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return isRealDate(out) ? out : null
}

/** Reads requirements.json. Throws when the file does not have the expected shape. */
export function parseRequirements(text: string): { tender: Tender; reqs: Requirement[] } {
  const j = JSON.parse(text.replace(/^﻿/, ''))
  const t = j?.tender
  const list = j?.requirements
  if (!t || typeof t !== 'object' || !Array.isArray(list) || !list.length) throw new Error('shape')
  const seen = new Set<string>()
  const reqs: Requirement[] = list.map((r: Record<string, unknown>, i: number) => {
    let id = String(r?.id ?? `R${String(i + 1).padStart(2, '0')}`)
    while (seen.has(id)) id += '_'
    seen.add(id)
    const order = Number(r?.order)
    const en = String(r?.title_en ?? r?.title ?? r?.title_bn ?? id)
    return {
      id,
      order: Number.isFinite(order) ? order : i + 1,
      title_en: en,
      title_bn: String(r?.title_bn ?? en),
      mandatory: asBool(r?.mandatory),
      has_expiry: asBool(r?.has_expiry),
    }
  })
  // Stable sort keeps the file order for equal numbers.
  reqs.sort((a, b) => a.order - b.order)
  // Every status and the footer depend on these two, so a list without them is refused as a whole.
  const tenderId = String(t.tender_id ?? '').trim()
  if (!tenderId) throw new ListError('bad_fields')
  const deadline = toIsoDate(String(t.submission_deadline ?? ''))
  if (!deadline) throw new ListError('bad_deadline')
  return {
    tender: {
      tender_id: tenderId,
      title: String(t.title ?? ''),
      procuring_entity: String(t.procuring_entity ?? ''),
      bidder: String(t.bidder ?? ''),
      submission_deadline: deadline,
    },
    reqs,
  }
}

function reject(name: string, reason: RejectReason, image?: Uint8Array) {
  set({ rejected: [...S.rejected, { id: uid(), name, reason, image }] }, false)
}

interface Raw {
  name: string
  bytes: Uint8Array
}

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p
const isJunk = (p: string) => /(^|[\\/])(\.|__MACOSX)/.test(p) || /(^|[\\/])(readme\.txt|thumbs\.db|desktop\.ini)$/i.test(p)
const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04

/** One entry point for everything the user drops: tender list, PDFs, ZIP files, anything else. */
export async function ingest(list: (File | Raw)[]) {
  const queue: Raw[] = []
  for (const f of list) {
    const name = f instanceof File ? f.webkitRelativePath || f.name : f.name
    if (isJunk(name)) continue
    const bytes = f instanceof File ? new Uint8Array(await f.arrayBuffer()) : f.bytes
    if (isZip(bytes) && /\.zip$/i.test(name)) {
      try {
        const { unzipSync } = await import('fflate')
        const entries = unzipSync(bytes)
        for (const path in entries) {
          if (path.endsWith('/') || isJunk(path) || !entries[path].length) continue
          queue.push({ name: baseName(path), bytes: entries[path] })
        }
      } catch {
        reject(baseName(name), 'damaged')
      }
      continue
    }
    queue.push({ name: baseName(name), bytes })
  }
  if (!queue.length) return

  // The tender list goes first so the documents can be compared with it straight away.
  queue.sort((a, b) => Number(/\.json$/i.test(b.name)) - Number(/\.json$/i.test(a.name)))
  let added = 0
  let listed = 0
  set({ busy: { label: 'reading', done: 0, total: queue.length } }, false)
  for (let i = 0; i < queue.length; i++) {
    const { name, bytes } = queue[i]
    const looksJson = /\.json$/i.test(name) || (bytes[0] === 0x7b && !isPdfBytes(bytes))
    if (looksJson) {
      try {
        const { tender, reqs } = parseRequirements(new TextDecoder().decode(bytes))
        const ids = new Set(reqs.map((r) => r.id))
        const matches: Record<string, string> = {}
        if (S.tender?.tender_id === tender.tender_id) for (const k in S.matches) if (ids.has(k)) matches[k] = S.matches[k]
        change({ tender, reqs, matches }, false)
        listed = reqs.length
      } catch (e) {
        // Nothing was changed above, so the project that was open stays as it was.
        reject(name, e instanceof ListError ? e.reason : 'bad_json')
      }
    } else if (!isPdfBytes(bytes)) {
      reject(name, 'not_pdf', isImageBytes(bytes) ? bytes : undefined)
    } else if (S.files.length >= MAX_FILES) {
      reject(name, 'too_many')
    } else if (S.files.reduce((a, f) => a + f.size, 0) + bytes.length > MAX_BYTES) {
      reject(name, 'too_big')
    } else {
      const info = await inspectPdf(bytes)
      if (!info.ok) reject(name, info.reason)
      else {
        const file: UFile = { id: uid(), name, size: bytes.length, pages: info.pages, hash: await hashBytes(bytes), bytes }
        change({ files: [...S.files, file] }, false)
        added++
      }
    }
    set({ busy: { label: 'reading', done: i + 1, total: queue.length } }, false)
    // Give the screen a chance to repaint between files.
    await new Promise((r) => setTimeout(r))
  }
  set({ busy: null }, false)
  if (added) toast(tr('added', { n: added }), 'ok')
  else if (listed) toast(tr('listLoaded', { n: listed }), 'ok')
  void peekAll()
}

let peeking = false
/** Fills in previews and date hints in the background. */
async function peekAll() {
  if (peeking) return
  peeking = true
  try {
    const { peek } = await import('./lib/preview')
    for (;;) {
      const f = S.files.find((x) => x.text === undefined)
      if (!f) break
      const p = await peek(f.bytes)
      const dateHint = findExpiry(p.text)
      set({ files: S.files.map((x) => (x.id === f.id ? { ...x, thumb: p.thumb, text: p.text, dateHint } : x)) })
    }
  } finally {
    peeking = false
  }
}

export async function loadSample() {
  const names = [
    '01_financial_proposal.pdf', '02_technical_proposal.pdf', '03_tin_certificate.pdf', '04_vat_certificate.pdf',
    'bank_solvency.pdf', 'company_logo.png', 'experience_cert (1).pdf', 'experience_cert.pdf', 'scan_0042.pdf',
    'trade_license_2025.pdf', 'trade_license_2026.pdf',
  ]
  set({ busy: { label: 'reading', done: 0, total: names.length + 1 } }, false)
  try {
    const get = async (path: string, name: string): Promise<Raw> => {
      const r = await fetch(path)
      if (!r.ok) throw new Error(path)
      return { name, bytes: new Uint8Array(await r.arrayBuffer()) }
    }
    const raws = await Promise.all([
      get('sample/requirements.json', 'requirements.json'),
      ...names.map((n) => get(`sample/documents/${encodeURIComponent(n)}`, n)),
    ])
    await ingest(raws)
  } catch {
    set({ busy: null }, false)
    toast(tr('buildErr'), 'bad')
  }
}

// ----------------------------------------------------------------- generate

export const packageName = () => `${(S.tender?.tender_id ?? 'Tender').replace(/[\\/:*?"<>|\s]+/g, '-')}_Package.pdf`

export async function generate() {
  if (!S.tender || blockers().length || S.busy) return
  set({ busy: { label: 'building', done: 0, total: 1 } }, false)
  try {
    const [{ buildPackage }, { renderText }] = await Promise.all([import('./lib/build'), import('./lib/textimg')])
    const items = S.reqs
      .filter((r) => fileById(S.matches[r.id]))
      .map((r) => {
        const f = fileById(S.matches[r.id])!
        return { order: r.order, title_en: r.title_en, title_bn: r.title_bn, fileName: f.name, bytes: f.bytes }
      })
    const res = await buildPackage({
      tender: S.tender,
      items,
      withIndex: S.withIndex,
      seal: S.seal,
      renderText,
      onProgress: (done, total) => set({ busy: { label: 'building', done, total } }, false),
    })
    const blob = new Blob([res.bytes as BlobPart], { type: 'application/pdf' })
    if (S.result) URL.revokeObjectURL(S.result.url)
    set({
      busy: null,
      stale: false,
      result: { url: URL.createObjectURL(blob), name: packageName(), pages: res.totalPages, size: blob.size },
    }, false)
  } catch (e) {
    set({ busy: null }, false)
    toast(e instanceof BuildError ? tr('buildFileErr', { f: e.fileName }) : tr('buildErr'), 'bad')
  }
}

// ------------------------------------------------------------------ AI help

/** Asks the AI to sort the files. Existing matches and typed dates are never overwritten. */
export async function aiAssist(apiKey: string) {
  if (!S.tender || !S.files.length || S.busy || !apiKey.trim()) return
  set({ busy: { label: 'thinking', done: 1, total: 3 } }, false)
  try {
    const { askAi } = await import('./lib/ai')
    const picks = await askAi(apiKey.trim(), S.tender, S.reqs, S.files)
    const matches = { ...S.matches }
    const expiry = { ...S.expiry }
    const autoDate = { ...S.autoDate }
    const usedHash = new Set(Object.values(matches).map((id) => fileById(id)?.hash))
    const deadline = S.tender.submission_deadline
    // When two files fit one document, the one that is still valid goes first.
    const rank = (d: string) => (!d ? 1 : d >= deadline ? 0 : 2)
    picks.sort((a, b) => rank(a.expiry_date) - rank(b.expiry_date))
    let n = 0
    let d = 0
    for (const p of picks) {
      const f = S.files[p.file_number - 1]
      if (!f) continue
      const r = S.reqs.find((x) => x.id === p.requirement_id)
      if (r && !matches[r.id] && !Object.values(matches).includes(f.id) && !usedHash.has(f.hash)) {
        matches[r.id] = f.id
        usedHash.add(f.hash)
        n++
      }
      const target = S.reqs.find((x) => matches[x.id] === f.id)
      if (target?.has_expiry && isRealDate(p.expiry_date) && !expiry[f.id]) {
        expiry[f.id] = p.expiry_date
        autoDate[f.id] = true
        d++
      }
    }
    set({ busy: null }, false)
    if (!n && !d) return toast(tr('aiNone'), 'info')
    change({ matches, expiry, autoDate })
    toast(tr('aiDone', { n, d }), 'ok', true)
  } catch (e) {
    set({ busy: null }, false)
    const kind = (e as { kind?: string })?.kind
    toast(tr((['key', 'limit', 'refused', 'network'].includes(kind ?? '') ? `ai_${kind}` : 'ai_other') as Parameters<typeof tr>[0]), 'bad')
  }
}

// ---------------------------------------------------------------- checklist

export function exportCsv() {
  if (!S.tender) return
  const head = [tr('c_order'), tr('c_doc'), tr('c_need'), tr('c_file'), tr('c_pages'), tr('c_expiry'), tr('c_status')]
  const rows = S.reqs.map((r) => {
    const f = fileById(S.matches[r.id])
    return [
      r.order,
      reqTitle(r),
      r.mandatory ? tr('yes') : tr('no'),
      f?.name ?? '',
      f?.pages ?? '',
      (f && r.has_expiry && S.expiry[f.id]) || '',
      tr(`st_${statusOf(r)}`),
    ]
  })
  const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`
  // The BOM lets Excel show Bangla text correctly.
  const csv = '﻿' + [head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = packageName().replace(/_Package\.pdf$/, '_Checklist.csv')
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

// -------------------------------------------------------------- persistence
// Work is kept in the browser's own storage (IndexedDB). Nothing is sent anywhere.

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open('tender-package-builder', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('kv')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
async function kv<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  try {
    const d = await db()
    return await new Promise<T | undefined>((res, rej) => {
      const tx = d.transaction('kv', mode)
      const rq = run(tx.objectStore('kv'))
      tx.oncomplete = () => res(rq ? rq.result : undefined)
      tx.onerror = () => rej(tx.error)
      tx.onabort = () => rej(tx.error)
    })
  } catch {
    return undefined
  }
}
const kvGet = <T,>(k: string) => kv<T>('readonly', (s) => s.get(k) as IDBRequest<T>)
const kvSet = (k: string, v: unknown) => kv('readwrite', (s) => void s.put(v, k))
const kvDel = (k: string) => kv('readwrite', (s) => void s.delete(k))
const kvClear = () => kv('readwrite', (s) => void s.clear())

const savedFiles = new Set<string>()
let saveTimer: ReturnType<typeof setTimeout> | undefined
function scheduleSave() {
  if (!S.booted) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(save, 350)
}

async function save() {
  for (const f of S.files) {
    if (savedFiles.has(f.id)) continue
    savedFiles.add(f.id)
    await kvSet(`file:${f.id}`, f.bytes)
  }
  if (S.seal) await kvSet('seal', S.seal.bytes)
  await kvSet('state', {
    tender: S.tender,
    reqs: S.reqs,
    files: S.files.map(({ bytes: _b, ...meta }) => meta),
    matches: S.matches,
    expiry: S.expiry,
    autoDate: S.autoDate,
    withIndex: S.withIndex,
    seal: S.seal ? { name: S.seal.name, pages: S.seal.pages, custom: S.seal.custom, pos: S.seal.pos, size: S.seal.size } : null,
  })
}

/** Restores the previous session, if there is one. */
export async function boot() {
  // Browser storage that never answers must not hold the start screen: after 5 s the app opens empty.
  let late = false
  const giveUp = setTimeout(() => {
    late = true
    set({ booted: true }, false)
  }, 5000)
  try {
    const st = await kvGet<Record<string, any>>('state')
    if (st && (st.tender || st.files?.length)) {
      const files: UFile[] = []
      for (const m of st.files ?? []) {
        const bytes = await kvGet<Uint8Array>(`file:${m.id}`)
        if (bytes) {
          files.push({ ...m, bytes })
          savedFiles.add(m.id)
        }
      }
      const alive = new Set(files.map((f) => f.id))
      const matches: Record<string, string> = {}
      for (const k in st.matches ?? {}) if (alive.has(st.matches[k])) matches[k] = st.matches[k]
      let seal: Seal | null = null
      const sealBytes = st.seal ? await kvGet<Uint8Array>('seal') : undefined
      if (st.seal && sealBytes) seal = { ...st.seal, bytes: sealBytes, url: URL.createObjectURL(new Blob([sealBytes as BlobPart])) }
      if (late) return
      set({
        tender: st.tender ?? null,
        reqs: st.reqs ?? [],
        files,
        matches,
        expiry: st.expiry ?? {},
        autoDate: st.autoDate ?? {},
        withIndex: st.withIndex ?? true,
        seal,
        booted: true,
      }, false)
      toast(tr('restored'), 'info')
      void peekAll()
      return
    }
  } catch {
    /* start clean */
  } finally {
    clearTimeout(giveUp)
  }
  if (!late) set({ booted: true }, false)
}

export { fmtDate, formatSize }
