// Optional AI help with the user's own Anthropic API key.
// The request goes straight from this browser to Anthropic; there is no server in between.
import type Anthropic from '@anthropic-ai/sdk'
import type { Requirement, Tender, UFile } from '../types'
import { pageJpeg } from './preview'

export interface AiPick {
  file_number: number
  /** id of the required document, or "" when the file fits none */
  requirement_id: string
  /** YYYY-MM-DD, or "" when the file shows no expiry date */
  expiry_date: string
}

export type AiErrorKind = 'key' | 'limit' | 'refused' | 'network' | 'other'
export class AiError extends Error {
  constructor(public kind: AiErrorKind) {
    super(kind)
  }
}

const SYSTEM = `You help office staff in Bangladesh prepare a tender submission package.
You receive the list of documents a tender requires and the files the bidder has collected.
For every file, decide which required document it is. File names are often unhelpful or misleading
(for example "scan_0042.pdf" or a number prefix that does not match the tender order), so judge by
the content: the text of the first pages, or the picture when the file is a scan with no text.
A file that fits no required document gets an empty requirement_id. Several files may fit the same
required document (an old and a renewed licence); report each of them honestly, the app picks one.
When a file states the date until which it is valid, return it as YYYY-MM-DD in expiry_date.
An issue date or a signing date is not an expiry date; return an empty string when no expiry date is written.`

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

export async function askAi(apiKey: string, tender: Tender, reqs: Requirement[], files: UFile[]): Promise<AiPick[]> {
  const { default: AnthropicSdk } = await import('@anthropic-ai/sdk')
  // The key belongs to the person using the app and never leaves their browser, so browser use is intended here.
  const client = new AnthropicSdk({ apiKey, dangerouslyAllowBrowser: true })

  const content: Anthropic.ContentBlockParam[] = []
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const text = (f.text ?? '').trim()
    content.push({
      type: 'text',
      text: `File ${i + 1}: "${f.name}" (${f.pages} page${f.pages === 1 ? '' : 's'})\n${
        text ? `Text from its first pages:\n${text}` : 'No text could be read from this file. It is a scan; its first page follows as a picture.'
      }`,
    })
    if (!text) {
      const jpeg = await pageJpeg(f.bytes)
      if (jpeg) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg } })
    }
  }
  content.push({
    type: 'text',
    text: `Tender: ${tender.title} (${tender.tender_id}). Submission deadline: ${tender.submission_deadline}.

Required documents:
${reqs.map((r) => `- id "${r.id}": ${r.title_en}${r.title_bn && r.title_bn !== r.title_en ? ` / ${r.title_bn}` : ''}${r.has_expiry ? ' (has an expiry date)' : ''}`).join('\n')}

Return one entry for each of the ${files.length} files above.`,
  })

  const params = {
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    system: SYSTEM,
    // Sorting documents into a known list is routine work, so low effort keeps it quick and cheap.
    output_config: { effort: 'low' as const, format: { type: 'json_schema' as const, schema: SCHEMA } },
    messages: [{ role: 'user' as const, content }],
  }

  let res: { stop_reason: string | null; content: Array<{ type: string; text?: string }> }
  try {
    try {
      // If a safety check declines the request, Anthropic re-runs it on its recommended fallback model.
      res = await client.beta.messages.create({
        ...params,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      })
    } catch (e) {
      // Accounts without the fallback beta reject the extra field; the plain request still works.
      if (!(e instanceof AnthropicSdk.BadRequestError)) throw e
      res = await client.messages.create(params)
    }
  } catch (e) {
    if (e instanceof AnthropicSdk.AuthenticationError || e instanceof AnthropicSdk.PermissionDeniedError) throw new AiError('key')
    if (e instanceof AnthropicSdk.RateLimitError) throw new AiError('limit')
    if (e instanceof AnthropicSdk.APIConnectionError) throw new AiError('network')
    if (e instanceof AnthropicSdk.APIError) throw new AiError(e.status && e.status >= 500 ? 'network' : 'other')
    throw new AiError('other')
  }

  if (res.stop_reason === 'refusal') throw new AiError('refused')
  const block = res.content.find((b) => b.type === 'text')
  try {
    const parsed = JSON.parse(block?.text ?? '') as { files?: AiPick[] }
    return Array.isArray(parsed.files) ? parsed.files : []
  } catch {
    // A cut-off answer is not valid JSON.
    throw new AiError('other')
  }
}
