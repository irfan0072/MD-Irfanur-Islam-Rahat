export type Lang = 'en' | 'bn'

export interface Tender {
  tender_id: string
  title: string
  procuring_entity: string
  bidder: string
  submission_deadline: string
}

export interface Requirement {
  id: string
  order: number
  title_en: string
  title_bn: string
  mandatory: boolean
  has_expiry: boolean
}

export interface UFile {
  id: string
  name: string
  size: number
  pages: number
  hash: string
  bytes: Uint8Array
  thumb?: string
  text?: string
  dateHint?: string
}

export type Status = 'missing' | 'need_date' | 'expired' | 'not_provided' | 'ok'

export type RejectReason = 'not_pdf' | 'locked' | 'damaged' | 'too_many' | 'too_big' | 'bad_json' | 'bad_deadline' | 'bad_fields'

export interface Rejected {
  id: string
  name: string
  reason: RejectReason
  image?: Uint8Array
}

export type SealPages = 'cover' | 'last' | 'all' | 'custom'
export type SealPos = 'br' | 'bc' | 'bl' | 'tr' | 'tl' | 'c'

export interface Seal {
  name: string
  bytes: Uint8Array
  url: string
  pages: SealPages
  custom: string
  pos: SealPos
  size: number
}

export interface Result {
  url: string
  name: string
  pages: number
  size: number
}

export interface Toast {
  id: number
  msg: string
  kind: 'ok' | 'bad' | 'info'
  undo?: boolean
}
