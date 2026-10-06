// Optional AI help with the user's own API key.
// The request goes straight from this browser to the one provider the user picked; there is no server in between,
// and no other provider or model is ever tried when a request fails.
import type Anthropic from '@anthropic-ai/sdk'
import type { Requirement, Tender, UFile } from '../types'
import { pageJpeg } from './preview'

export type Provider = 'google' | 'openai' | 'anthropic'

export interface AiModel {
  id: string
  provider: Provider
  label: string
  advanced?: boolean
}

export const PROVIDER_NAME: Record<Provider, string> = { google: 'Google', openai: 'OpenAI', anthropic: 'Anthropic' }

/** Model ids as published by each provider (checked against their documentation on 6 October 2026). */
export const AI_MODELS: AiModel[] = [
  { id: 'gemini-2.5-flash', provider: 'google', label: 'Gemini 2.5 Flash' },
  { id: 'gpt-4o', provider: 'openai', label: 'GPT-4o' },
  { id: 'gemini-3.8-flash', provider: 'google', label: 'Gemini 3.8 Flash', advanced: true },
  { id: 'claude-sonnet-5-5', provider: 'anthropic', label: 'Claude Sonnet 5.5', advanced: true },
  { id: 'claude-opus-5-5', provider: 'anthropic', label: 'Claude Opus 5.5', advanced: true },
]
export const DEFAULT_MODEL = 'gemini-2.5-flash'

export interface AiPick {
  file_number: number
  /** id of the required document, or "" when the file fits none */
  requirement_id: string
  /** YYYY-MM-DD, or "" when the file shows no expiry date */
  expiry_date: string
}

export type AiErrorKind = 'key' | 'model' | 'limit' | 'refused' | 'network' | 'timeout' | 'bad' | 'other'
export class AiError extends Error {
  constructor(public kind: AiErrorKind) {
    super(kind)
  }
}

/** A request that has not answered by then is cancelled, so the screen is never left waiting. */
const TIMEOUT_MS = 90_000

const SYSTEM = `You help office staff in Bangladesh prepare a tender submission package.
You receive the list of documents a tender requires and the files the bidder has collected.
For every file, decide which required document it is. File names are often unhelpful or misleading
(for example "scan_0042.pdf" or a number prefix that does not match the tender order), so judge by
the content: the text of the first pages, or the picture when the file is a scan with no text.
A file that fits no required document gets an empty requirement_id. Several files may fit the same
required document (an old and a renewed licence); report each of them honestly, the app picks one.
When a file states the date until which it is valid, return it as YYYY-MM-DD in expiry_date.
An issue date or a signing date is not an expiry date; return an empty string when no expiry date is written.
Answer with JSON only, in the form {"files":[{"file_number":1,"requirement_id":"...","expiry_date":"..."}]}.`

const SCHEMA = {
  type: 'object',
  properties: {
    files: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file_number: { type: 'integer' },
          requirement_id: { type: 'string' },
          expiry_date: { type: 'string' },
        },
        required: ['file_number', 'requirement_id', 'expiry_date'],
        additionalProperties: false,
      },
    },
  },
  required: ['files'],
  additionalProperties: false,
}

// Gemini describes the same shape with its own type names.
const GOOGLE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    files: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          file_number: { type: 'INTEGER' },
          requirement_id: { type: 'STRING' },
          expiry_date: { type: 'STRING' },
        },
        required: ['file_number', 'requirement_id', 'expiry_date'],
      },
    },
  },
  required: ['files'],
}

type Part = { text: string } | { jpeg: string }

/** What is sent: file names, page counts, the text already read from the first pages, and a picture of a scan's first page. */
async function describe(tender: Tender, reqs: Requirement[], files: UFile[]): Promise<Part[]> {
  const parts: Part[] = []
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const text = (f.text ?? '').trim()
    parts.push({
      text: `File ${i + 1}: "${f.name}" (${f.pages} page${f.pages === 1 ? '' : 's'})\n${
        text ? `Text from its first pages:\n${text}` : 'No text could be read from this file. It is a scan; its first page follows as a picture.'
      }`,
    })
    if (!text) {
      const jpeg = await pageJpeg(f.bytes)
      if (jpeg) parts.push({ jpeg })
    }
  }
  parts.push({
    text: `Tender: ${tender.title} (${tender.tender_id}). Submission deadline: ${tender.submission_deadline}.

Required documents:
${reqs.map((r) => `- id "${r.id}": ${r.title_en}${r.title_bn && r.title_bn !== r.title_en ? ` / ${r.title_bn}` : ''}${r.has_expiry ? ' (has an expiry date)' : ''}`).join('\n')}

Return one entry for each of the ${files.length} files above.`,
  })
  return parts
}

/** Turns a provider's error answer into one of the reasons the app can explain. */
function kindOf(status: number, body: unknown): AiErrorKind {
  const t = JSON.stringify(body ?? '').toLowerCase()
  if (status === 401 || /api key|api_key|authentication/.test(t)) return 'key'
  if (status === 429 || /quota|rate limit|resource_exhausted/.test(t)) return 'limit'
  if (status === 404 || (/model/.test(t) && /not found|not supported|does not exist|not available|no access|unsupported|permission/.test(t))) return 'model'
  if (status === 403) return 'key'
  if (status === 408 || status === 504) return 'timeout'
  if (status >= 500) return 'network'
  return 'other'
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: stop.signal })
  } catch {
    throw new AiError(stop.signal.aborted ? 'timeout' : 'network')
  } finally {
    clearTimeout(timer)
  }
  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    /* an answer that is not JSON is handled below */
  }
  if (!res.ok) throw new AiError(kindOf(res.status, json))
  if (!json) throw new AiError('bad')
  return json
}

async function askGoogle(model: string, key: string, parts: Part[]): Promise<string> {
  // The key travels in a header, not in the address, so it does not end up in browser history or logs.
  const json = (await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key }, {
    contents: [{ role: 'user', parts: [{ text: SYSTEM }, ...parts.map((p) => ('text' in p ? { text: p.text } : { inline_data: { mime_type: 'image/jpeg', data: p.jpeg } }))] }],
    generationConfig: { response_mime_type: 'application/json', response_schema: GOOGLE_SCHEMA },
  })) as { promptFeedback?: { blockReason?: string }; candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[] }
  if (json.promptFeedback?.blockReason) throw new AiError('refused')
  const first = json.candidates?.[0]
  if (['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'].includes(first?.finishReason ?? '')) throw new AiError('refused')
  return (first?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('')
}

async function askOpenAi(model: string, key: string, parts: Part[]): Promise<string> {
  const json = (await post('https://api.openai.com/v1/responses', { authorization: `Bearer ${key}` }, {
    model,
    // Not kept on OpenAI's side for later retrieval.
    store: false,
    input: [{ role: 'user', content: [{ type: 'input_text', text: SYSTEM }, ...parts.map((p) => ('text' in p ? { type: 'input_text', text: p.text } : { type: 'input_image', image_url: `data:image/jpeg;base64,${p.jpeg}`, detail: 'auto' }))] }],
    text: { format: { type: 'json_schema', name: 'file_matches', strict: true, schema: SCHEMA } },
  })) as { output?: { type?: string; content?: { type?: string; text?: string }[] }[] }
  let text = ''
  for (const item of json.output ?? []) {
    if (item.type !== 'message') continue
    for (const c of item.content ?? []) {
      if (c.type === 'refusal') throw new AiError('refused')
      if (c.type === 'output_text') text += c.text ?? ''
    }
  }
  return text
}

async function askAnthropic(model: string, key: string, parts: Part[]): Promise<string> {
  const { default: AnthropicSdk } = await import('@anthropic-ai/sdk')
  // The key belongs to the person using the app and never leaves their browser, so browser use is intended here.
  const client = new AnthropicSdk({ apiKey: key, dangerouslyAllowBrowser: true, timeout: TIMEOUT_MS, maxRetries: 1 })
  const content: Anthropic.ContentBlockParam[] = parts.map((p) =>
    'text' in p ? { type: 'text', text: p.text } : { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: p.jpeg } },
  )
  try {
    // Server-side fallback to another model is deliberately not requested: only the chosen model may answer.
    const res = await client.messages.create({
      model,
      max_tokens: 16000,
      system: SYSTEM,
      // Sorting documents into a known list is routine work, so low effort keeps it quick and cheap.
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content }],
    })
    if (res.stop_reason === 'refusal') throw new AiError('refused')
    return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  } catch (e) {
    if (e instanceof AiError) throw e
    if (e instanceof AnthropicSdk.AuthenticationError || e instanceof AnthropicSdk.PermissionDeniedError) throw new AiError('key')
    if (e instanceof AnthropicSdk.NotFoundError) throw new AiError('model')
    if (e instanceof AnthropicSdk.RateLimitError) throw new AiError('limit')
    if (e instanceof AnthropicSdk.APIConnectionTimeoutError) throw new AiError('timeout')
    if (e instanceof AnthropicSdk.APIConnectionError) throw new AiError('network')
    if (e instanceof AnthropicSdk.APIError) throw new AiError(kindOf(e.status ?? 0, e.message))
    throw new AiError('other')
  }
}

/** Reads the answer. An answer that is not the agreed JSON is refused; single unusable entries are dropped. */
function readPicks(text: string): AiPick[] {
  let data: unknown
  try {
    data = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''))
  } catch {
    throw new AiError('bad')
  }
  const list = (data as { files?: unknown })?.files
  if (!Array.isArray(list)) throw new AiError('bad')
  return list
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object' && Number.isInteger((p as Record<string, unknown>).file_number))
    .map((p) => ({
      file_number: p.file_number as number,
      requirement_id: typeof p.requirement_id === 'string' ? p.requirement_id : '',
      expiry_date: typeof p.expiry_date === 'string' ? p.expiry_date : '',
    }))
}

export async function askAi(modelId: string, apiKey: string, tender: Tender, reqs: Requirement[], files: UFile[]): Promise<AiPick[]> {
  const model = AI_MODELS.find((m) => m.id === modelId)
  if (!model) throw new AiError('model')
  const parts = await describe(tender, reqs, files)
  const text =
    model.provider === 'google' ? await askGoogle(model.id, apiKey, parts)
    : model.provider === 'openai' ? await askOpenAi(model.id, apiKey, parts)
    : await askAnthropic(model.id, apiKey, parts)
  return readPicks(text)
}
