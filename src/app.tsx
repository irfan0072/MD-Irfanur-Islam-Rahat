import type { ComponentChildren } from 'preact'
import { useEffect, useReducer, useRef, useState } from 'preact/hooks'
import { fmtDate, num, pagesLabel, tr, type Key } from './i18n'
import { Icon, Logo } from './icons'
import { Extras, PickerModal, PreviewModal, ResultModal } from './panels'
import {
  S, assign, autoMatch, blockers, boot, clearToast, copiesOf, copyConflict, dismissRejected, fileById, formatSize,
  generate, ingest, loadSample, openPairs, removeFile, reqOfFile, reqTitle, reset, sealFromBytes, sealIssue, setExpiry, setLang,
  statusOf, subscribe, undo,
} from './store'
import type { Lang, Requirement, Status, UFile } from './types'

const STATUS_ICON: Record<Status, string> = { ok: 'check', missing: 'alert', need_date: 'calendar', expired: 'clock', not_provided: 'minus' }

/** Reads dropped items, walking into folders. Entries must be taken before the first await. */
async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items].filter((i) => i.kind === 'file').map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[]
  if (!entries.length) return [...dt.files]
  const out: File[] = []
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (e.isFile) out.push(await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej)))
    else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader()
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
        if (!batch.length) break
        for (const b of batch) await walk(b)
      }
    }
  }
  for (const e of entries) await walk(e).catch(() => {})
  return out
}

const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files')

function pick(input: HTMLInputElement | null) {
  if (!input) return
  input.value = ''
  input.click()
}

export function focusReq(id: string) {
  const el = document.getElementById(`req-${id}`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.remove('flash')
  void el.offsetWidth
  el.classList.add('flash')
}

function switchLang(l: Lang) {
  if (l === S.lang) return
  const doc = document as Document & { startViewTransition?: (cb: () => Promise<void>) => unknown }
  if (doc.startViewTransition) doc.startViewTransition(() => new Promise<void>((r) => (setLang(l), setTimeout(r, 0))))
  else setLang(l)
}

export function App() {
  const [, bump] = useReducer((x: number) => x + 1, 0)
  const [picker, setPicker] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [showResult, setShowResult] = useState(false)
  const filesInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const depth = useRef(0)

  useEffect(() => subscribe(() => bump(0)), [])
  useEffect(() => {
    document.documentElement.lang = S.lang
    void boot()
  }, [])

  // Files can be dropped anywhere on the page.
  useEffect(() => {
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current++
      setDragging(true)
    }
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault()
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (!depth.current) setDragging(false)
    }
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setDragging(false)
      void ingest(await filesFromDrop(e.dataTransfer!))
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [])

  const resultUrl = S.result?.url
  useEffect(() => setShowResult(!!resultUrl), [resultUrl])

  // The start screen from index.html stays until saved work is back, so the empty landing page never flashes.
  const booted = S.booted
  useEffect(() => {
    if (booted) (window as Window & { __bootDone?: () => void }).__bootDone?.()
  }, [booted])

  const onPicked = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement
    if (input.files?.length) void ingest([...input.files])
  }
  const openFiles = () => pick(filesInput.current)
  const openFolder = () => pick(folderInput.current)
  const started = !!S.tender || S.files.length > 0 || S.rejected.length > 0

  return (
    <div class="min-h-dvh">
      <input ref={filesInput} type="file" multiple hidden onChange={onPicked} data-testid="file-input" />
      <input ref={folderInput} type="file" hidden onChange={onPicked} {...({ webkitdirectory: true } as object)} />
      <Header />
      <main data-bg class={`mx-auto max-w-6xl px-3 sm:px-5 ${S.tender ? 'pb-44' : 'pb-16'}`}>
        <Stepper />
        {!S.booted ? null : !started ? (
          <Landing openFiles={openFiles} openFolder={openFolder} dragging={dragging} />
        ) : (
          <div class="space-y-4 sm:space-y-5">
            {S.unsaved && (
              <div class="card a-rise flex items-start gap-3 border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-950" role="alert" data-testid="save-warning">
                <Icon n="alert" class="mt-0.5 size-5 text-amber-600" />
                <span>{tr('saveFailed')}</span>
              </div>
            )}
            {S.tender ? <TenderCard openFiles={openFiles} /> : <NeedList openFiles={openFiles} />}
            <RejectedPanel />
            <AutoBanner />
            <JumpBar />
            <div class="grid grid-cols-1 items-start gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
              {S.tender && (
                <section class="order-2 min-w-0 lg:order-1" aria-labelledby="req-h">
                  <SectionTitle id="req-h" n={3} title={tr('reqTitle')} meta={num(S.reqs.length)} />
                  <div class="space-y-3">
                    {S.reqs.map((r, i) => (
                      <ReqCard key={r.id} r={r} i={i} onPick={() => setPicker(r.id)} onView={setPreview} />
                    ))}
                  </div>
                </section>
              )}
              <section class={`order-1 min-w-0 lg:order-2 lg:sticky lg:top-20 ${S.tender ? '' : 'lg:col-span-2'}`} aria-labelledby="files-h">
                <SectionTitle id="files-h" n={2} title={tr('filesTitle')} meta={S.files.length ? num(S.files.length) : undefined} />
                <FilesPanel openFiles={openFiles} openFolder={openFolder} onView={setPreview} dragging={dragging} />
              </section>
            </div>
            {S.tender && <Extras />}
            {S.tender && <Finish onShow={() => setShowResult(true)} />}
          </div>
        )}
      </main>
      {S.tender && <BottomBar onShow={() => setShowResult(true)} />}
      {picker && <PickerModal reqId={picker} onClose={() => setPicker(null)} onView={setPreview} />}
      {preview && <PreviewModal fileId={preview} onClose={() => setPreview(null)} />}
      {showResult && S.result && <ResultModal onClose={() => setShowResult(false)} />}
      {dragging && started && (
        <div class="a-fade pointer-events-none fixed inset-0 z-50 grid place-items-center bg-teal-900/40 p-6 backdrop-blur-sm">
          <div class="a-pop rounded-3xl border-4 border-dashed border-white bg-teal-700 px-10 py-8 text-center text-white shadow-2xl">
            <Icon n="upload" class="cloud mx-auto size-14" />
            <div class="mt-3 text-2xl font-bold">{tr('dropNow')}</div>
          </div>
        </div>
      )}
      <Busy />
      <ToastView />
    </div>
  )
}

// -------------------------------------------------------------------- header

function Header() {
  const started = !!S.tender || S.files.length > 0
  return (
    <header data-bg class="glass sticky top-0 z-30 border-b border-slate-200/70">
      <div class="mx-auto flex max-w-6xl items-center gap-2 px-3 py-2 sm:gap-3 sm:px-5">
        <Logo />
        <div class="min-w-0 flex-1">
          <h1 class="truncate text-[15px] leading-tight font-bold text-slate-900 sm:text-lg">{tr('app')}</h1>
          <div class="hidden items-center gap-1 text-xs font-medium text-teal-700 sm:flex">
            <Icon n="lock" class="size-3.5" />
            {tr('private')}
          </div>
        </div>
        {S.past.length > 0 && (
          <button class="btn btn-ghost btn-sm a-pop" onClick={undo} aria-label={tr('undo')} title={tr('undo')}>
            <Icon n="undo" />
            <span class="hidden md:inline">{tr('undo')}</span>
          </button>
        )}
        {started && (
          <button
            class="btn btn-ghost btn-sm"
            aria-label={tr('startOver')}
            title={tr('startOver')}
            onClick={() => confirm(tr('startOverAsk')) && void reset()}
          >
            <Icon n="refresh" />
            <span class="hidden md:inline">{tr('startOver')}</span>
          </button>
        )}
        <div class="relative grid shrink-0 grid-cols-2 rounded-2xl bg-slate-200/70 p-1 text-sm font-semibold" role="group" aria-label="Language / ভাষা">
          <span
            class="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-xl bg-white shadow-sm transition-transform duration-300 ease-out"
            style={{ transform: S.lang === 'bn' ? 'translateX(100%)' : 'none' }}
          />
          {(['en', 'bn'] as Lang[]).map((l) => (
            <button
              key={l}
              class={`relative z-10 min-h-9 rounded-xl px-2.5 transition-colors sm:px-3.5 ${S.lang === l ? 'text-teal-800' : 'text-slate-500'}`}
              aria-pressed={S.lang === l}
              onClick={() => switchLang(l)}
              data-testid={`lang-${l}`}
            >
              {l === 'en' ? 'English' : 'বাংলা'}
            </button>
          ))}
        </div>
      </div>
    </header>
  )
}

function Stepper() {
  const steps = [!!S.tender, S.files.length > 0, !!S.tender && blockers().length === 0, !!S.result]
  const current = steps.findIndex((d) => !d)
  return (
    <ol class="mx-auto my-4 flex max-w-3xl items-start sm:my-6" aria-label="Steps">
      {steps.map((done, i) => (
        <li key={i} class="relative flex flex-1 flex-col items-center gap-1.5 text-center">
          {i > 0 && (
            <span class="absolute top-[17px] right-1/2 -z-10 h-1 w-full overflow-hidden rounded bg-slate-200">
              <span class="block h-full origin-left bg-teal-500 transition-transform duration-700" style={{ transform: `scaleX(${steps[i - 1] ? 1 : 0})` }} />
            </span>
          )}
          <span
            class={`grid size-9 place-items-center rounded-full text-sm font-bold ring-4 ring-[#f5f8f8] transition-all duration-300 ${
              done ? 'bg-teal-600 text-white' : i === current ? 'scale-110 bg-white text-teal-700 shadow-md outline-2 outline-teal-500' : 'bg-slate-200 text-slate-500'
            }`}
          >
            {done ? <Icon n="check" class="a-pop size-5" /> : num(i + 1)}
          </span>
          <span class={`px-1 text-[11px] leading-tight font-semibold sm:text-sm ${done || i === current ? 'text-slate-800' : 'text-slate-400'}`}>
            {tr(`s${i + 1}` as Key)}
          </span>
        </li>
      ))}
    </ol>
  )
}

function SectionTitle({ id, n, title, meta }: { id: string; n: number; title: string; meta?: string }) {
  return (
    <div class="mb-2.5 flex items-center gap-2.5 px-1">
      <span class="grid size-7 place-items-center rounded-full bg-teal-700 text-sm font-bold text-white">{num(n)}</span>
      <h2 id={id} class="scroll-mt-24 text-lg font-bold text-slate-900">{title}</h2>
      {meta && <span class="rounded-full bg-slate-200/80 px-2 py-0.5 text-xs font-bold text-slate-600">{meta}</span>}
    </div>
  )
}

// ------------------------------------------------------------------- landing

function DropZone({ openFiles, openFolder, dragging, big }: { openFiles: () => void; openFolder: () => void; dragging: boolean; big?: boolean }) {
  return (
    <div class={`drop ${dragging ? 'on' : ''} ${big ? 'px-5 py-10 sm:py-14' : 'px-4 py-6'}`} data-testid="dropzone">
      <div class={`cloud mx-auto grid place-items-center rounded-full bg-teal-100 text-teal-700 ${big ? 'size-20' : 'size-14'}`}>
        <Icon n="upload" class={big ? 'size-10' : 'size-7'} />
      </div>
      <div class={`mt-4 font-bold text-slate-900 ${big ? 'text-2xl sm:text-3xl' : 'text-lg'}`}>{big ? tr('dropTitle') : tr('dropPdf')}</div>
      {big && <p class="mx-auto mt-2 max-w-md text-[15px] text-slate-600">{tr('dropSub')}</p>}
      <div class="mt-5 flex flex-wrap justify-center gap-2.5">
        <button class={`btn btn-primary ${big ? 'min-h-13 px-7 text-lg' : ''}`} onClick={openFiles} data-testid="choose-files">
          <Icon n="file" />
          {big ? tr('chooseFiles') : tr('addMore')}
        </button>
        <button class={`btn btn-line ${big ? 'min-h-13 px-6 text-lg' : ''}`} onClick={openFolder}>
          <Icon n="folder" />
          {tr('chooseFolder')}
        </button>
      </div>
      {!big && <p class="mt-3 text-xs text-slate-500">{tr('limit')}</p>}
    </div>
  )
}

function Landing(p: { openFiles: () => void; openFolder: () => void; dragging: boolean }) {
  return (
    <div class="mx-auto max-w-3xl">
      <div class="a-rise px-2 text-center">
        <h2 class="text-3xl leading-tight font-extrabold tracking-tight text-slate-900 sm:text-5xl">{tr('heroTitle')}</h2>
        <p class="mx-auto mt-3 max-w-xl text-base text-slate-600 sm:text-lg">{tr('heroSub')}</p>
      </div>
      <div class="a-rise mt-6" style={{ animationDelay: '80ms' }}>
        <DropZone {...p} big />
        <div class="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm">
          <button class="btn btn-ghost btn-sm text-teal-700" onClick={() => void loadSample()} data-testid="sample">
            <Icon n="spark" />
            {tr('sample')}
          </button>
          <span class="inline-flex items-center gap-1 text-slate-500 sm:hidden">
            <Icon n="lock" class="size-4" />
            {tr('private')}
          </span>
        </div>
      </div>
      <ol class="mt-8 grid gap-3 sm:grid-cols-2">
        {[1, 2, 3, 4].map((n) => (
          <li key={n} class="card a-rise flex items-start gap-3.5 p-4" style={{ animationDelay: `${120 + n * 70}ms` }}>
            <span class="grid size-10 shrink-0 place-items-center rounded-2xl bg-teal-50 text-lg font-extrabold text-teal-700">{num(n)}</span>
            <div>
              <div class="font-bold text-slate-900">{tr(`how${n}t` as Key)}</div>
              <div class="text-sm text-slate-600">{tr(`how${n}d` as Key)}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function NeedList({ openFiles }: { openFiles: () => void }) {
  return (
    <div class="card a-rise flex flex-col items-start gap-3 border-amber-300 bg-amber-50 p-5 sm:flex-row sm:items-center">
      <span class="grid size-12 shrink-0 place-items-center rounded-2xl bg-amber-200 text-amber-900">
        <Icon n="list" class="size-6" />
      </span>
      <div class="flex-1">
        <div class="text-lg font-bold text-slate-900">{tr('needList')}</div>
        <p class="text-sm text-slate-700">{tr('needListSub')}</p>
      </div>
      <button class="btn btn-primary w-full sm:w-auto" onClick={openFiles}>
        <Icon n="file" />
        {tr('openList')}
      </button>
    </div>
  )
}

function TenderCard({ openFiles }: { openFiles: () => void }) {
  const t = S.tender!
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t.submission_deadline)
  let left: string | null = null
  let tone = 'bg-white/20 text-white'
  if (m) {
    const now = new Date()
    const days = Math.round((new Date(+m[1], +m[2] - 1, +m[3]).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 864e5)
    left = days > 0 ? tr('daysLeft', { n: days }) : days === 0 ? tr('today') : tr('passed')
    if (days <= 3) tone = 'bg-amber-300 text-amber-950'
  }
  return (
    <section class="card a-rise overflow-hidden" data-testid="tender-card">
      <div class="relative bg-gradient-to-br from-teal-800 via-teal-700 to-emerald-600 p-5 text-white sm:p-6">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-xs font-semibold tracking-wide text-teal-100">
              {tr('tenderId')} · <span class="font-mono text-sm [overflow-wrap:anywhere] text-white">{t.tender_id}</span>
            </div>
            <h2 class="mt-1 text-xl leading-snug font-bold [overflow-wrap:anywhere] sm:text-2xl">{t.title}</h2>
          </div>
          <button class="btn btn-sm shrink-0 bg-white/15 text-white hover:bg-white/25" onClick={openFiles}>
            {tr('changeList')}
          </button>
        </div>
      </div>
      <dl class="grid gap-x-6 gap-y-3 p-5 sm:grid-cols-3 sm:p-6">
        <div>
          <dt class="text-xs font-semibold text-slate-500">{tr('entity')}</dt>
          <dd class="font-semibold [overflow-wrap:anywhere] text-slate-900">{t.procuring_entity || '—'}</dd>
        </div>
        <div>
          <dt class="text-xs font-semibold text-slate-500">{tr('bidder')}</dt>
          <dd class="font-semibold [overflow-wrap:anywhere] text-slate-900">{t.bidder || '—'}</dd>
        </div>
        <div>
          <dt class="text-xs font-semibold text-slate-500">{tr('deadline')}</dt>
          <dd class="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
            {fmtDate(t.submission_deadline)}
            {left && <span class={`pill ${tone === 'bg-white/20 text-white' ? 'bg-teal-100 text-teal-800' : tone}`}>{left}</span>}
          </dd>
        </div>
      </dl>
    </section>
  )
}

// --------------------------------------------------------------- rejections

function RejectedPanel() {
  if (!S.rejected.length) return null
  return (
    <section class="card a-rise border-rose-200 bg-rose-50/70 p-4 sm:p-5" role="alert" data-testid="rejected">
      <div class="mb-2 flex items-center gap-2">
        <Icon n="alert" class="size-5 text-rose-600" />
        <h2 class="flex-1 font-bold text-rose-900">{tr('rejTitle')}</h2>
        <button class="btn btn-ghost btn-sm text-rose-800" onClick={() => dismissRejected()}>
          {tr('dismiss')}
        </button>
      </div>
      <ul class="space-y-2">
        {S.rejected.map((r) => (
          <li key={r.id} class="a-rise flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-white p-3 text-sm">
            <div class="min-w-0 flex-1 basis-56">
              <div class="font-semibold break-all text-slate-900">{r.name}</div>
              <div class="text-rose-800">{tr(`rej_${r.reason}` as Key)}</div>
            </div>
            {r.image && (
              <button
                class="btn btn-soft btn-sm"
                onClick={() => void sealFromBytes(r.name, r.image!).then((ok) => ok && dismissRejected(r.id))}
              >
                <Icon n="stamp" class="size-4" />
                {tr('useAsSeal')}
              </button>
            )}
            <button class="btn btn-ghost btn-sm px-2" aria-label={tr('dismiss')} onClick={() => dismissRejected(r.id)}>
              <Icon n="x" class="size-4" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** One line that says what will be in the package, what is left out and what still blocks it. */
function summaryText(): string {
  let a = 0
  let b = 0
  let c = 0
  for (const r of S.reqs) {
    const s = statusOf(r)
    if (s === 'ok') a++
    else if (s === 'not_provided') b++
    else c++
  }
  return tr('summary', { a, b, c })
}

/** On phones and tablets the file list sits above the documents, so these buttons jump past it. */
function JumpBar() {
  if (!S.tender || !S.files.length) return null
  const next = blockers()[0]
  return (
    <div class="flex flex-wrap gap-2 lg:hidden" data-testid="jump">
      <button class="btn btn-line flex-1" onClick={() => document.getElementById('req-h')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} data-testid="jump-docs">
        <Icon n="list" />
        {tr('reviewDocs')}
      </button>
      {next && (
        <button class="btn btn-primary flex-1" onClick={() => focusReq(next.id)} data-testid="jump-fix">
          <Icon n="arrow" />
          {tr('fixNext')}
        </button>
      )}
    </div>
  )
}

function AutoBanner() {
  if (!S.tender) return null
  const n = openPairs().length
  if (!n) return null
  return (
    <div class="card a-rise flex flex-col gap-3 border-teal-200 bg-gradient-to-r from-teal-50 to-emerald-50 p-4 sm:flex-row sm:items-center sm:p-5" data-testid="auto-banner">
      <span class="grid size-11 shrink-0 place-items-center rounded-2xl bg-teal-600 text-white">
        <Icon n="spark" class="size-6" />
      </span>
      <p class="flex-1 font-semibold text-slate-800">{tr('autoMatchSub', { n })}</p>
      <button class="btn btn-primary a-glow w-full sm:w-auto" onClick={autoMatch} data-testid="auto-match">
        <Icon n="spark" />
        {tr('autoMatch')}
      </button>
    </div>
  )
}

// ------------------------------------------------------------- requirements

export function StatusPill({ s }: { s: Status }) {
  return (
    <span key={s} class={`pill a-pop st-${s}`} data-status={s}>
      <Icon n={STATUS_ICON[s]} class="size-4" />
      {tr(`st_${s}` as Key)}
    </span>
  )
}

export function Thumb({ f, w = 'w-11', onClick }: { f: UFile; w?: string; onClick?: () => void }) {
  const inner = f.thumb ? <img src={f.thumb} alt="" loading="lazy" class="a-fade" /> : <span class={`block size-full ${f.text === undefined ? 'skel' : 'bg-slate-100'}`} />
  if (!onClick) return <span class={`thumb ${w}`}>{inner}</span>
  return (
    <button class={`thumb ${w} transition hover:ring-2 hover:ring-teal-400`} onClick={onClick} aria-label={`${tr('view')}: ${f.name}`} title={tr('view')}>
      {inner}
    </button>
  )
}

function ReqCard({ r, i, onPick, onView }: { r: Requirement; i: number; onPick: () => void; onView: (id: string) => void }) {
  const [over, setOver] = useState(false)
  const s = statusOf(r)
  const f = fileById(S.matches[r.id])
  const deadline = S.tender?.submission_deadline ?? ''
  const sug = !f ? openPairs().find((p) => p.reqId === r.id) : undefined
  const sugFile = fileById(sug?.fileId)
  const date = f ? S.expiry[f.id] ?? '' : ''
  const hint =
    s === 'missing' ? tr('hint_missing')
    : s === 'need_date' ? tr('hint_need_date')
    : s === 'expired' ? tr('hint_expired', { d: fmtDate(deadline) })
    : s === 'not_provided' ? tr('hint_not_provided')
    : r.has_expiry ? tr('hint_ok_date', { d: fmtDate(deadline) })
    : ''
  return (
    <article
      id={`req-${r.id}`}
      data-testid={`req-${r.id}`}
      data-status={s}
      class={`req card a-rise edge-${s} p-4 pl-5 sm:p-5 sm:pl-6 ${over ? 'over' : ''}`}
      style={{ animationDelay: `${Math.min(i, 12) * 45}ms` }}
      onDragOver={(e) => {
        if ([...(e.dataTransfer?.types ?? [])].includes('text/x-tpb-file')) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const id = e.dataTransfer?.getData('text/x-tpb-file')
        setOver(false)
        if (id) {
          e.preventDefault()
          assign(r.id, id)
        }
      }}
    >
      <div class="flex items-start gap-3">
        <span class="grid size-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-sm font-extrabold text-slate-700">{num(r.order)}</span>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
            <h3 class="min-w-0 text-[17px] leading-snug font-bold [overflow-wrap:anywhere] text-slate-900">{reqTitle(r)}</h3>
            <StatusPill s={s} />
          </div>
          <div class="mt-1 flex flex-wrap gap-1.5">
            <span class={`tag ${r.mandatory ? 'bg-teal-50 text-teal-800' : ''}`}>{r.mandatory ? tr('required') : tr('optional')}</span>
            {r.has_expiry && (
              <span class="tag">
                <Icon n="calendar" class="size-3.5" />
                {tr('hasExpiry')}
              </span>
            )}
          </div>
        </div>
      </div>

      <div class="mt-3 sm:pl-12">
        {f ? (
          <div class="a-pop flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-slate-50 p-2.5 ring-1 ring-slate-200">
            <Thumb f={f} onClick={() => onView(f.id)} />
            <div class="min-w-[8.5rem] flex-1">
              <div class="line-clamp-2 font-semibold break-all text-slate-900" title={f.name}>{f.name}</div>
              <div class="text-xs text-slate-500">{pagesLabel(f.pages)} · {formatSize(f.size)}</div>
            </div>
            {/* On narrow phones the two buttons drop to their own row so the file name keeps its width. */}
            <div class="ml-auto flex items-center gap-1">
              <button class="btn btn-line btn-sm" onClick={onPick} data-testid={`change-${r.id}`}>{tr('change')}</button>
              <button class="btn btn-ghost btn-sm px-2 text-rose-700" onClick={() => assign(r.id, null)} aria-label={tr('unmatch')} title={tr('unmatch')} data-testid={`unmatch-${r.id}`}>
                <Icon n="x" class="size-5" />
              </button>
            </div>
          </div>
        ) : (
          <div class="flex flex-wrap items-center gap-2">
            <button class={`btn ${r.mandatory ? 'btn-primary' : 'btn-line'}`} onClick={onPick} data-testid={`pick-${r.id}`}>
              <Icon n="link" />
              {tr('chooseFile')}
            </button>
            {sugFile && (
              <button class="btn btn-soft btn-sm a-pop max-w-full" onClick={() => assign(r.id, sugFile.id)} title={tr('use')}>
                <Icon n="spark" class="size-4" />
                <span class="truncate">{tr('suggested')}: {sugFile.name}</span>
              </button>
            )}
          </div>
        )}

        {f && r.has_expiry && (
          <div class="a-rise mt-3 flex flex-wrap items-end gap-x-3 gap-y-2">
            <label class="block">
              <span class="mb-1 block text-sm font-semibold text-slate-700">{tr('expiryLabel')}</span>
              <input
                type="date"
                class={`w-48 max-w-full rounded-xl border-2 bg-white px-3 text-base font-semibold text-slate-900 transition outline-none focus:border-teal-500 ${
                  s === 'need_date' ? 'border-amber-400' : s === 'expired' ? 'border-red-500' : 'border-slate-200'
                }`}
                value={date}
                data-testid={`date-${r.id}`}
                onInput={(e) => setExpiry(f.id, (e.currentTarget as HTMLInputElement).value)}
              />
            </label>
            {f.dateHint && f.dateHint !== date && (
              <button class="btn btn-soft btn-sm a-pop" onClick={() => setExpiry(f.id, f.dateHint!, true)} title={tr('foundDate')} data-testid={`usedate-${r.id}`}>
                <Icon n="spark" class="size-4" />
                {tr('foundDate')}: {tr('useDate', { d: fmtDate(f.dateHint) })}
              </button>
            )}
          </div>
        )}
        {hint && (
          <p class={`mt-2 text-sm ${s === 'ok' || s === 'not_provided' ? 'text-slate-500' : s === 'need_date' ? 'font-medium text-amber-800' : 'font-medium text-rose-700'}`}>
            {hint}
            {s === 'ok' && f && S.autoDate[f.id] && <span class="mt-0.5 block text-amber-700">{tr('autoDate')}</span>}
          </p>
        )}
      </div>
    </article>
  )
}

// -------------------------------------------------------------------- files

function FilesPanel(p: { openFiles: () => void; openFolder: () => void; onView: (id: string) => void; dragging: boolean }) {
  const [open, setOpen] = useState(false)
  const pages = S.files.reduce((a, f) => a + f.pages, 0)
  const size = S.files.reduce((a, f) => a + f.size, 0)
  // Below the two-column layout the list is folded once the documents are known, so statuses stay close.
  const folds = !!S.tender && S.files.length > 0
  return (
    <div class="space-y-3">
      <DropZone openFiles={p.openFiles} openFolder={p.openFolder} dragging={p.dragging} />
      {S.files.length > 0 && (
        <div class="flex flex-wrap items-center justify-between gap-2 px-1">
          <p class="text-sm font-medium text-slate-600" data-testid="files-meta">{tr('filesMeta', { n: S.files.length, p: num(pages), s: formatSize(size) })}</p>
          {folds && (
            <button class="btn btn-line btn-sm lg:hidden" aria-expanded={open} aria-controls="files-list" onClick={() => setOpen(!open)} data-testid="files-toggle">
              <Icon n="chevron" class={`size-4 transition-transform ${open ? '-rotate-90' : 'rotate-90'}`} />
              {open ? tr('hideFiles') : tr('showFiles', { n: S.files.length })}
            </button>
          )}
        </div>
      )}
      <ul id="files-list" class={`space-y-2.5 lg:max-h-[calc(100dvh-25rem)] lg:overflow-y-auto lg:pr-1 ${folds && !open ? 'hidden lg:block' : ''}`} data-testid="files">
        {S.files.map((f, i) => (
          <FileCard key={f.id} f={f} i={i} onView={p.onView} />
        ))}
      </ul>
      {S.files.length > 1 && S.tender && <p class="hidden px-1 text-xs text-slate-500 lg:block">{tr('dragHint')}</p>}
    </div>
  )
}

function FileCard({ f, i, onView }: { f: UFile; i: number; onView: (id: string) => void }) {
  const used = reqOfFile(f.id)
  const copies = copiesOf(f)
  return (
    <li
      class={`card a-rise flex gap-3 p-3 ${copies.length ? 'border-amber-300 bg-amber-50/60' : ''} ${used ? '' : 'cursor-grab'}`}
      style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
      draggable={!!S.tender}
      onDragStart={(e) => {
        e.dataTransfer?.setData('text/x-tpb-file', f.id)
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'link'
      }}
      data-testid="file-card"
      data-name={f.name}
      data-dup={copies.length ? '1' : '0'}
    >
      <Thumb f={f} w="w-14" onClick={() => onView(f.id)} />
      <div class="min-w-0 flex-1">
        <div class="flex items-start gap-2">
          <div class="min-w-0 flex-1">
            <div class="font-semibold break-all text-slate-900">{f.name}</div>
            <div class="text-xs text-slate-500" data-testid="file-pages">{pagesLabel(f.pages)} · {formatSize(f.size)}</div>
          </div>
          <button class="btn btn-ghost btn-sm -mt-1 -mr-1 px-2 text-slate-500 hover:text-rose-700" onClick={() => removeFile(f.id)} aria-label={`${tr('removeFile')}: ${f.name}`} title={tr('removeFile')} data-testid="remove-file">
            <Icon n="trash" class="size-5" />
          </button>
        </div>
        {copies.length > 0 && (
          <div class="mt-1.5 flex items-start gap-1.5 text-sm font-medium text-amber-900" data-testid="dup-note">
            <span class="pill a-pop bg-amber-400 text-amber-950">
              <Icon n="copy" class="size-3.5" />
              {tr('dup')}
            </span>
            <span class="min-w-0 break-all">{tr('dupOf', { f: copies.map((c) => c.name).join(', ') })}</span>
          </div>
        )}
        {S.tender && (
          <label class="mt-2 flex items-center gap-2">
            <span class={`grid size-6 shrink-0 place-items-center rounded-full transition ${used ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
              <Icon n={used ? 'check' : 'link'} class="size-3.5" />
            </span>
            <span class="sr-only">{tr('useFor')}</span>
            <select
              class={`min-h-10 w-full min-w-0 rounded-xl border bg-white px-2.5 text-sm font-semibold transition outline-none focus:border-teal-500 ${used ? 'border-emerald-300 text-slate-900' : 'border-slate-200 text-slate-500'}`}
              value={used?.id ?? ''}
              onChange={(e) => {
                const el = e.currentTarget as HTMLSelectElement
                const ok = el.value ? assign(el.value, f.id) : used ? assign(used.id, null) : true
                if (!ok) el.value = used?.id ?? ''
              }}
              data-testid="file-select"
            >
              <option value="">{used ? tr('none') : `${tr('notUsed')} — ${tr('useFor')}…`}</option>
              {S.reqs.map((r) => (
                <option key={r.id} value={r.id} disabled={!!copyConflict(f, r.id)}>
                  {num(r.order)}. {reqTitle(r)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </li>
  )
}

// ------------------------------------------------------------------- finish

function BlockerList({ compact }: { compact?: boolean }) {
  const list = blockers()
  return (
    <ul class={`space-y-1.5 ${compact ? 'max-h-52 overflow-y-auto' : ''}`} data-testid="blockers">
      {list.map((r) => {
        const s = statusOf(r)
        return (
          <li key={r.id} class="flex items-center gap-2 rounded-xl bg-white p-2 pl-3 text-sm ring-1 ring-slate-200">
            <span class="min-w-0 flex-1 truncate font-semibold text-slate-800">{num(r.order)}. {reqTitle(r)}</span>
            <StatusPill s={s} />
            <button class="btn btn-soft btn-sm" onClick={() => focusReq(r.id)}>
              {tr('fix')}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

const showSeal = () => document.querySelector('[data-testid=seal-box]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })

function GenerateButton({ onShow, big }: { onShow: () => void; big?: boolean }) {
  // A seal that cannot be placed as chosen blocks too: the package is never made silently without it.
  const blocked = blockers().length > 0 || !!sealIssue()
  if (S.result && !blocked) {
    return (
      <button class={`btn btn-primary a-glow ${big ? 'min-h-14 w-full px-8 text-lg sm:w-auto' : 'shrink-0'}`} onClick={onShow} data-testid={big ? 'show-result' : undefined}>
        <Icon n="download" />
        {tr('download')}
      </button>
    )
  }
  return (
    <button
      class={`btn btn-primary ${blocked ? '' : 'a-glow'} ${big ? 'min-h-14 w-full px-8 text-lg sm:w-auto' : 'shrink-0'}`}
      disabled={blocked || !!S.busy}
      aria-disabled={blocked}
      onClick={() => void generate()}
      data-testid={big ? 'generate' : 'generate-bar'}
    >
      <Icon n="spark" />
      {tr('generate')}
    </button>
  )
}

function Finish({ onShow }: { onShow: () => void }) {
  const n = blockers().length
  const seal = sealIssue()
  return (
    <section class={`card a-rise p-5 sm:p-6 ${n || seal ? '' : 'border-emerald-300 bg-gradient-to-br from-emerald-50 to-teal-50'}`} aria-labelledby="fin-h" data-testid="finish">
      <SectionTitle id="fin-h" n={4} title={tr('s4')} />
      {n > 0 ? (
        <>
          <p class="mb-2 font-semibold text-rose-800" data-testid="why-blocked">
            {n === 1 ? tr('blocked1') : tr('blocked', { n })}. {tr('blockedSub')}
          </p>
          <BlockerList />
        </>
      ) : seal ? (
        <div class="flex flex-wrap items-center gap-2 rounded-xl bg-white p-2 pl-3 text-sm ring-1 ring-slate-200" data-testid="seal-blocks">
          <span class="min-w-0 flex-1 font-semibold text-rose-800">{seal}</span>
          <button class="btn btn-soft btn-sm" onClick={showSeal}>{tr('fix')}</button>
        </div>
      ) : (
        <p class="flex items-center gap-2 text-lg font-bold text-emerald-800">
          <span class="a-pop grid size-8 place-items-center rounded-full bg-emerald-500 text-white">
            <Icon n="check" />
          </span>
          {tr('ready')}. <span class="font-medium text-slate-600">{S.stale && !S.result ? tr('stale') : tr('readySub')}</span>
        </p>
      )}
      <p class="mt-2 text-sm font-medium text-slate-600" data-testid="summary">{summaryText()}</p>
      <div class="mt-4">
        <GenerateButton onShow={onShow} big />
      </div>
    </section>
  )
}

function BottomBar({ onShow }: { onShow: () => void }) {
  const [open, setOpen] = useState(false)
  const total = S.reqs.length
  const bad = blockers().length
  const good = total - bad
  const seal = bad ? null : sealIssue()
  const C = 2 * Math.PI * 17
  useEffect(() => {
    if (!bad) setOpen(false)
  }, [bad])
  return (
    <div data-bg class="fixed inset-x-0 bottom-0 z-30">
      {open && bad > 0 && (
        <div class="a-sheet mx-auto mb-2 max-w-2xl px-3">
          <div class="card bg-slate-50 p-3 shadow-2xl">
            <div class="mb-2 flex items-center gap-2 px-1">
              <p class="flex-1 text-sm font-bold text-rose-800">{tr('blockedSub')}</p>
              <button class="btn btn-ghost btn-sm px-2" onClick={() => setOpen(false)} aria-label={tr('close')}>
                <Icon n="x" class="size-5" />
              </button>
            </div>
            <BlockerList compact />
          </div>
        </div>
      )}
      <div class="glass safe-b border-t border-slate-200 pt-2.5 shadow-[0_-10px_30px_-18px_rgb(15_23_42/.35)]">
        <div class="mx-auto flex max-w-6xl items-center gap-3 px-3 sm:px-5">
          <svg class="hidden size-12 shrink-0 -rotate-90 min-[360px]:block" viewBox="0 0 40 40" aria-hidden="true">
            <circle cx="20" cy="20" r="17" fill="none" stroke="#e2e8f0" stroke-width="5" />
            <circle
              class="ring-track" cx="20" cy="20" r="17" fill="none" stroke-width="5" stroke-linecap="round"
              stroke={bad || seal ? '#f59e0b' : '#10b981'} stroke-dasharray={C} stroke-dashoffset={C * (1 - (total ? good / total : 0))}
            />
          </svg>
          <button class="min-w-0 flex-1 text-left" onClick={() => (bad ? setOpen(!open) : seal && showSeal())} aria-expanded={open} disabled={!bad && !seal} data-testid="bar-status">
            <div class={`text-[15px] leading-tight font-bold sm:text-base ${bad || seal ? 'text-rose-800' : 'text-emerald-800'}`}>
              {bad ? (bad === 1 ? tr('blocked1') : tr('blocked', { n: bad })) : seal ? tr('sealBlocks') : tr('ready')}
              {bad > 0 && <Icon n="chevron" class={`ml-1 inline size-4 transition-transform ${open ? 'rotate-90' : '-rotate-90'}`} />}
            </div>
            <div class="hidden truncate text-xs font-medium text-slate-500 min-[420px]:block">{summaryText()}</div>
          </button>
          <GenerateButton onShow={onShow} />
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------ busy + toasts

function Busy() {
  if (!S.busy) return null
  const pct = S.busy.total ? Math.round((S.busy.done / S.busy.total) * 100) : 0
  // Files read and package steps can be counted; how long the AI takes cannot, so it gets no percentage.
  const counted = S.busy.label !== 'thinking'
  return (
    <div class="a-fade fixed inset-0 z-[60] grid place-items-center bg-slate-900/45 p-6 backdrop-blur-sm" role="status" aria-live="polite">
      <div class="a-sheet card w-full max-w-sm p-6 text-center">
        <div class="a-spin mx-auto size-12 rounded-full border-4 border-teal-100 border-t-teal-600" />
        <div class="mt-4 text-lg font-bold text-slate-900">{tr(S.busy.label)}</div>
        <div class="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100">
          {counted ? (
            <div class="h-full rounded-full bg-teal-600 transition-[width] duration-300" style={{ width: `${Math.max(6, pct)}%` }} />
          ) : (
            <div class="bar-run h-full w-2/5 rounded-full bg-teal-600" />
          )}
        </div>
        {counted && <div class="mt-1.5 text-sm font-semibold text-slate-500">{num(pct)}%</div>}
      </div>
    </div>
  )
}

function ToastView() {
  const t = S.toast
  useEffect(() => {
    if (!t) return
    const id = setTimeout(clearToast, t.kind === 'bad' ? 9000 : 5000)
    return () => clearTimeout(id)
  }, [t?.id])
  if (!t) return null
  const tone = t.kind === 'bad' ? 'bg-rose-700' : t.kind === 'ok' ? 'bg-emerald-700' : 'bg-slate-800'
  return (
    <div class={`pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-3 ${S.tender ? 'bottom-24' : 'bottom-6'}`}>
      <div key={t.id} class={`a-sheet pointer-events-auto flex max-w-lg items-center gap-3 rounded-2xl px-4 py-3 text-[15px] font-semibold text-white shadow-2xl ${tone}`} role={t.kind === 'bad' ? 'alert' : 'status'} data-testid="toast">
        <Icon n={t.kind === 'bad' ? 'alert' : t.kind === 'ok' ? 'check' : 'spark'} />
        <span class="min-w-0 flex-1 break-words">{t.msg}</span>
        {t.undo && S.past.length > 0 && (
          <button class="btn btn-sm bg-white/20 text-white hover:bg-white/30" onClick={undo}>
            {tr('undo')}
          </button>
        )}
        <button class="-mr-1 rounded-lg p-1 hover:bg-white/20" onClick={clearToast} aria-label={tr('close')}>
          <Icon n="x" class="size-4" />
        </button>
      </div>
    </div>
  )
}

export type { ComponentChildren }
