import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { Thumb } from './app'
import { num, pagesLabel, tr, type Key } from './i18n'
import { Icon } from './icons'
import { renderAll } from './lib/preview'
import {
  S, assign, copiesOf, copyConflict, exportCsv, fileById, formatSize, generate, openPairs, reqOfFile, reqTitle,
  sealFromBytes, setOption, setSeal,
} from './store'
import type { SealPages, SealPos } from './types'

function Modal({ onClose, children, wide, label, z = 'z-40' }: { onClose: () => void; children: ComponentChildren; wide?: boolean; label: string; z?: string }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', key)
      document.body.style.overflow = prev
    }
  }, [])
  return (
    <div
      class={`a-fade fixed inset-0 ${z} flex items-end justify-center bg-slate-900/55 backdrop-blur-sm sm:items-center sm:p-5`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <div class={`a-sheet flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl ${wide ? 'sm:max-w-4xl' : 'sm:max-w-xl'}`}>
        {children}
      </div>
    </div>
  )
}

function ModalHead({ title, sub, onClose }: { title: string; sub?: string; onClose: () => void }) {
  return (
    <div class="flex items-start gap-3 border-b border-slate-200 p-4 sm:p-5">
      <div class="min-w-0 flex-1">
        {sub && <div class="text-sm font-semibold text-slate-500">{sub}</div>}
        <div class="text-lg leading-snug font-bold break-words text-slate-900">{title}</div>
      </div>
      <button class="btn btn-ghost btn-sm px-2" onClick={onClose} aria-label={tr('close')} data-testid="modal-close">
        <Icon n="x" class="size-6" />
      </button>
    </div>
  )
}

// -------------------------------------------------------------------- picker

export function PickerModal({ reqId, onClose, onView }: { reqId: string; onClose: () => void; onView: (id: string) => void }) {
  const r = S.reqs.find((x) => x.id === reqId)
  if (!r) return null
  const current = S.matches[reqId]
  const sug = openPairs().find((p) => p.reqId === reqId)?.fileId
  const rank = (id: string) => (id === current ? 0 : id === sug ? 1 : reqOfFile(id) ? 3 : 2)
  const files = [...S.files].sort((a, b) => rank(a.id) - rank(b.id))
  return (
    <Modal onClose={onClose} label={tr('pickTitle')}>
      <ModalHead sub={tr('pickTitle')} title={reqTitle(r)} onClose={onClose} />
      <div class="overflow-y-auto p-3 sm:p-4" data-testid="picker">
        {!files.length && <p class="p-6 text-center font-semibold text-slate-500">{tr('pickEmpty')}</p>}
        <ul class="space-y-2">
          {files.map((f) => {
            const used = reqOfFile(f.id)
            const clash = copyConflict(f, reqId)
            const isCur = f.id === current
            return (
              <li key={f.id} class="flex items-stretch gap-2">
                <button
                  class={`flex min-w-0 flex-1 items-center gap-3 rounded-2xl border-2 p-2.5 text-left transition ${
                    isCur ? 'border-teal-500 bg-teal-50' : clash ? 'border-slate-200 bg-slate-50 opacity-60' : 'border-slate-200 bg-white hover:border-teal-400 hover:bg-teal-50/50'
                  }`}
                  disabled={!!clash}
                  onClick={() => assign(reqId, f.id) && onClose()}
                  data-testid="picker-item"
                  data-name={f.name}
                >
                  <Thumb f={f} w="w-12" />
                  <span class="min-w-0 flex-1">
                    <span class="block font-semibold break-all text-slate-900">{f.name}</span>
                    <span class="block text-xs text-slate-500">{pagesLabel(f.pages)} · {formatSize(f.size)}</span>
                    {f.id === sug && !isCur && (
                      <span class="pill mt-1 bg-teal-100 text-teal-800"><Icon n="spark" class="size-3.5" />{tr('suggested')}</span>
                    )}
                    {clash ? (
                      <span class="mt-1 block text-xs font-semibold text-amber-800">{tr('pickDup', { d: reqTitle(clash.req) })}</span>
                    ) : used && !isCur ? (
                      <span class="mt-1 block text-xs font-medium text-slate-600">{tr('pickMove', { d: reqTitle(used) })}</span>
                    ) : copiesOf(f).length ? (
                      <span class="pill mt-1 bg-amber-200 text-amber-950"><Icon n="copy" class="size-3.5" />{tr('dup')}</span>
                    ) : null}
                  </span>
                  {isCur && <span class="grid size-7 shrink-0 place-items-center rounded-full bg-teal-600 text-white"><Icon n="check" class="size-4" /></span>}
                </button>
                <button class="btn btn-line btn-sm h-auto px-2.5" onClick={() => onView(f.id)} aria-label={`${tr('view')}: ${f.name}`} title={tr('view')}>
                  <Icon n="eye" />
                </button>
              </li>
            )
          })}
        </ul>
      </div>
      {current && (
        <div class="border-t border-slate-200 p-3">
          <button class="btn btn-line w-full text-rose-700" onClick={() => (assign(reqId, null), onClose())}>
            <Icon n="x" />
            {tr('unmatch')}
          </button>
        </div>
      )}
    </Modal>
  )
}

// ------------------------------------------------------------------- preview

export function PreviewModal({ fileId, onClose }: { fileId: string; onClose: () => void }) {
  const f = fileById(fileId)
  const host = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!f || !host.current) return
    return renderAll(f.bytes, host.current, () => setLoading(false))
  }, [fileId])
  if (!f) return null
  const used = reqOfFile(f.id)
  return (
    <Modal onClose={onClose} wide label={f.name} z="z-50">
      <ModalHead title={f.name} sub={`${pagesLabel(f.pages)}${used ? ` · ${tr('usedFor')}: ${reqTitle(used)}` : ''}`} onClose={onClose} />
      <div class="overflow-y-auto bg-slate-100 p-3 sm:p-5">
        {loading && <div class="grid place-items-center p-10 font-semibold text-slate-500"><div class="a-spin mb-3 size-9 rounded-full border-4 border-teal-100 border-t-teal-600" />{tr('loadingPreview')}…</div>}
        <div ref={host} class="mx-auto max-w-3xl" />
      </div>
    </Modal>
  )
}

// -------------------------------------------------------------------- result

const CONFETTI = ['#0d9488', '#f59e0b', '#10b981', '#f43f5e', '#6366f1', '#14b8a6']

export function ResultModal({ onClose }: { onClose: () => void }) {
  const r = S.result!
  return (
    <Modal onClose={onClose} label={tr('doneTitle')}>
      <div class="relative overflow-hidden p-6 text-center sm:p-8" data-testid="result">
        <div class="confetti pointer-events-none absolute inset-x-0 top-0 h-0" aria-hidden="true">
          {Array.from({ length: 22 }, (_, i) => (
            <i key={i} style={{ left: `${4 + i * 4.3}%`, background: CONFETTI[i % CONFETTI.length], animationDelay: `${(i % 7) * 90}ms` }} />
          ))}
        </div>
        <div class="a-pop mx-auto grid size-20 place-items-center rounded-full bg-emerald-500 shadow-[0_12px_30px_-10px_rgb(16_185_129/.8)]">
          <svg class="size-11" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path class="check-path" d="M5 12.5l4.500 4.500L19 7.500" />
          </svg>
        </div>
        <h2 class="mt-4 text-2xl font-extrabold text-slate-900">{tr('doneTitle')}</h2>
        <p class="mt-1 font-mono text-sm font-semibold break-all text-teal-800" data-testid="result-name">{r.name}</p>
        <p class="mt-1 text-sm text-slate-500" data-testid="result-meta">{tr('doneSub', { p: num(r.pages), s: formatSize(r.size) })}</p>
        <a class="btn btn-primary a-glow mt-6 min-h-14 w-full text-lg" href={r.url} download={r.name} data-testid="download">
          <Icon n="download" class="size-6" />
          {tr('download')}
        </a>
        <div class="mt-2.5 grid grid-cols-2 gap-2.5">
          <a class="btn btn-line" href={r.url} target="_blank" rel="noopener">
            <Icon n="eye" />
            {tr('openPdf')}
          </a>
          <button class="btn btn-line" onClick={() => void generate()}>
            <Icon n="refresh" />
            {tr('again')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// -------------------------------------------------------------------- extras

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} class={`relative h-8 w-14 shrink-0 rounded-full transition-colors duration-300 ${on ? 'bg-teal-600' : 'bg-slate-300'}`}>
      <span class={`absolute top-1 left-1 size-6 rounded-full bg-white shadow transition-transform duration-300 ${on ? 'translate-x-6' : ''}`} />
    </button>
  )
}

const field = 'min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-[15px] font-semibold text-slate-800 outline-none transition focus:border-teal-500'

export function Extras() {
  const input = useRef<HTMLInputElement>(null)
  const seal = S.seal
  return (
    <section class="card a-rise divide-y divide-slate-100" aria-label={tr('extras')} data-testid="extras">
      <div class="flex items-center gap-2.5 p-4 sm:px-6">
        <Icon n="spark" class="size-5 text-teal-700" />
        <h2 class="text-lg font-bold text-slate-900">{tr('extras')}</h2>
      </div>

      <div class="flex items-center gap-4 p-4 sm:px-6">
        <span class="grid size-11 shrink-0 place-items-center rounded-2xl bg-teal-50 text-teal-700"><Icon n="list" /></span>
        <div class="min-w-0 flex-1">
          <div class="font-bold text-slate-900">{tr('optIndex')}</div>
          <div class="text-sm text-slate-600">{tr('optIndexSub')}</div>
        </div>
        <Switch on={S.withIndex} onChange={(v) => setOption({ withIndex: v })} label={tr('optIndex')} />
      </div>

      <div class="p-4 sm:px-6">
        <div class="flex items-center gap-4">
          <span class="grid size-11 shrink-0 place-items-center rounded-2xl bg-teal-50 text-teal-700"><Icon n="stamp" /></span>
          <div class="min-w-0 flex-1">
            <div class="font-bold text-slate-900">{tr('seal')}</div>
            <div class="text-sm text-slate-600">{tr('sealSub')}</div>
          </div>
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg"
            hidden
            data-testid="seal-input"
            onChange={async (e) => {
              const file = (e.currentTarget as HTMLInputElement).files?.[0]
              if (file) sealFromBytes(file.name, new Uint8Array(await file.arrayBuffer()))
            }}
          />
          {!seal && (
            <button class="btn btn-line shrink-0" onClick={() => input.current?.click()}>
              <Icon n="upload" />
              <span class="hidden sm:inline">{tr('sealAdd')}</span>
            </button>
          )}
        </div>
        {seal && (
          <div class="a-rise mt-4 grid gap-4 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200 sm:grid-cols-[auto_1fr]" data-testid="seal-box">
            <div class="flex items-center gap-3 sm:flex-col sm:items-start">
              <img src={seal.url} alt="" class="size-24 rounded-xl border border-slate-200 bg-white object-contain p-1" />
              <div class="flex flex-col gap-1.5">
                <button class="btn btn-line btn-sm" onClick={() => input.current?.click()}>{tr('change')}</button>
                <button class="btn btn-ghost btn-sm text-rose-700" onClick={() => setSeal(null)} data-testid="seal-remove">{tr('sealRemove')}</button>
              </div>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="block">
                <span class="mb-1 block text-sm font-semibold text-slate-700">{tr('sealPages')}</span>
                <select class={field} value={seal.pages} data-testid="seal-pages" onChange={(e) => setSeal({ ...seal, pages: (e.currentTarget as HTMLSelectElement).value as SealPages })}>
                  {(['cover', 'last', 'all', 'custom'] as SealPages[]).map((v) => (
                    <option key={v} value={v}>{tr(`seal_${v}` as Key)}</option>
                  ))}
                </select>
              </label>
              <label class="block">
                <span class="mb-1 block text-sm font-semibold text-slate-700">{tr('sealPos')}</span>
                <select class={field} value={seal.pos} onChange={(e) => setSeal({ ...seal, pos: (e.currentTarget as HTMLSelectElement).value as SealPos })}>
                  {(['br', 'bc', 'bl', 'tr', 'tl', 'c'] as SealPos[]).map((v) => (
                    <option key={v} value={v}>{tr(`pos_${v}` as Key)}</option>
                  ))}
                </select>
              </label>
              {seal.pages === 'custom' && (
                <label class="a-rise block sm:col-span-2">
                  <span class="mb-1 block text-sm font-semibold text-slate-700">{tr('seal_custom')}</span>
                  <input class={field} inputMode="numeric" placeholder={tr('sealCustomPh')} value={seal.custom} onInput={(e) => setSeal({ ...seal, custom: (e.currentTarget as HTMLInputElement).value })} />
                </label>
              )}
              <label class="block sm:col-span-2">
                <span class="mb-1 block text-sm font-semibold text-slate-700">{tr('sealSize')}</span>
                <input type="range" min="0.1" max="0.4" step="0.02" value={seal.size} class="w-full accent-teal-600" onInput={(e) => setSeal({ ...seal, size: +(e.currentTarget as HTMLInputElement).value })} />
              </label>
            </div>
          </div>
        )}
      </div>

      <div class="flex items-center gap-4 p-4 sm:px-6">
        <span class="grid size-11 shrink-0 place-items-center rounded-2xl bg-teal-50 text-teal-700"><Icon n="table" /></span>
        <div class="min-w-0 flex-1">
          <div class="font-bold text-slate-900">{tr('csv')}</div>
          <div class="text-sm text-slate-600">{tr('csvSub')}</div>
        </div>
        <button class="btn btn-line shrink-0" onClick={exportCsv} data-testid="csv">
          <Icon n="download" />
        </button>
      </div>
    </section>
  )
}
