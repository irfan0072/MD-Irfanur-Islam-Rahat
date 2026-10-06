import type { Requirement, UFile } from '../types'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function iso(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCMonth() !== m - 1) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** First date written in a short piece of text, in the formats common on certificates. */
function firstDate(s: string): string | null {
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return iso(+m[1], +m[2], +m[3])
  m = s.match(/(\d{1,2})(?:st|nd|rd|th)?[\s,.-]+([A-Za-z]{3,9})[\s,.-]+(\d{4})/)
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase())
    if (mi >= 0) return iso(+m[3], mi + 1, +m[1])
  }
  m = s.match(/([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/)
  if (m) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase())
    if (mi >= 0) return iso(+m[3], mi + 1, +m[2])
  }
  // Day first, as written in Bangladesh.
  m = s.match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/)
  if (m) return iso(+m[3], +m[2], +m[1])
  return null
}

/** Looks for a date that follows wording such as "valid until" or "expiry date". Only a hint for the user. */
export function findExpiry(text: string): string | undefined {
  const re = /(valid\s*(?:un)?till?|valid\s*up\s*to|valid\s*through|expiry(?:\s*date)?|expiration(?:\s*date)?|expires?(?:\s*on)?|date\s*of\s*expiry|মেয়াদ)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const d = firstDate(text.slice(m.index + m[0].length, m.index + m[0].length + 70))
    if (d) return d
  }
  return undefined
}

const STOP = new Set(['of', 'the', 'and', 'for', 'a', 'an', 's', 'pdf', 'doc', 'file', 'copy', 'scan', 'final', 'new'])
const ALIAS: Record<string, string> = {
  licence: 'license', cert: 'certificate', certificates: 'certificate', tech: 'technical', fin: 'financial',
  exp: 'experience', authorisation: 'authorization', auth: 'authorization', reg: 'registration',
  declaration: 'declaration', decl: 'declaration', statement: 'statement', stmt: 'statement',
  solvent: 'solvency', audit: 'audited', manufacturer: 'manufacturer', mfr: 'manufacturer',
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/\.pdf$/, '')
    .replace(/'s\b/g, '')
    .split(/[^a-z]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => ALIAS[w] ?? w)
}

export interface Suggestion {
  reqId: string
  fileId: string
  score: number
}

/**
 * Scores every file against every document by the words in the file name
 * and by the document title appearing inside the PDF text.
 */
export function suggest(reqs: Requirement[], files: UFile[], deadline: string): Suggestion[] {
  // Words shared by many titles ("certificate") say little, so they count less.
  const df = new Map<string, number>()
  const reqTokens = reqs.map((r) => {
    const t = [...new Set(tokens(r.title_en))]
    t.forEach((w) => df.set(w, (df.get(w) ?? 0) + 1))
    return t
  })
  const weight = (w: string) => 1 / (df.get(w) ?? 1)

  const all: Suggestion[] = []
  reqs.forEach((r, i) => {
    const rt = reqTokens[i]
    if (!rt.length) return
    const max = rt.reduce((a, w) => a + weight(w), 0)
    for (const f of files) {
      const ft = new Set(tokens(f.name))
      let nameScore = 0
      for (const w of rt) if (ft.has(w)) nameScore += weight(w)
      nameScore /= max
      let textScore = 0
      if (f.text) {
        const head = f.text.toLowerCase().slice(0, 700)
        const phrase = r.title_en.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
        if (phrase && head.replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').includes(phrase)) textScore = 1
        else {
          // Not the exact title: count how many of its telling words appear near the top of the page.
          const tt = new Set(tokens(head))
          let hit = 0
          for (const w of rt) if (tt.has(w)) hit += weight(w)
          textScore = (hit / max) * 0.75
        }
      }
      let score = Math.max(nameScore, textScore * 0.9) + Math.min(nameScore, textScore) * 0.3
      if (score < 0.45) continue
      // When two files fit one document, prefer the one that is still valid.
      if (r.has_expiry && f.dateHint) score += f.dateHint >= deadline ? 0.2 : -0.2
      all.push({ reqId: r.id, fileId: f.id, score })
    }
  })
  return all.sort((a, b) => b.score - a.score)
}

/** Picks the best one-to-one pairs. Copies of an already chosen file are skipped. */
export function pickPairs(sugs: Suggestion[], files: UFile[], taken: Record<string, string>): Suggestion[] {
  const usedReq = new Set(Object.keys(taken))
  const usedFile = new Set(Object.values(taken))
  const hashOf = new Map(files.map((f) => [f.id, f.hash]))
  const usedHash = new Set([...usedFile].map((id) => hashOf.get(id)))
  const out: Suggestion[] = []
  for (const s of sugs) {
    const h = hashOf.get(s.fileId)
    if (usedReq.has(s.reqId) || usedFile.has(s.fileId) || usedHash.has(h)) continue
    usedReq.add(s.reqId)
    usedFile.add(s.fileId)
    usedHash.add(h)
    out.push(s)
  }
  return out
}
