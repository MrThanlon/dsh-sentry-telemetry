/**
 * Zero-dependency Source Map v3 (Regular + Indexed Combo Sections) decoder
 * and Sentry StackFrame / Span context-line enricher for Host and Web Client.
 */

import type { Event, StackFrame } from '@sentry/core'

export interface RawRegularSourceMap {
  version: number
  file?: string
  sourceRoot?: string
  sources: string[]
  sourcesContent?: (string | null)[]
  names?: string[]
  mappings: string
}

export interface RawIndexedSourceMap {
  version: number
  sections: Array<{
    offset: { line: number; column: number }
    map: RawRegularSourceMap
  }>
}

export type RawSourceMap = RawRegularSourceMap | RawIndexedSourceMap

/** [genCol0, sourceIdx, origLine0, origCol0, nameIdx] */
type DecodedSegment = readonly [number, number, number, number, number]

interface CompiledSection {
  readonly offsetLine: number
  readonly offsetColumn: number
  readonly map: CompiledRegularMap
}

export interface CompiledSourceMap {
  lookup(line1Based: number, column1Based: number): ResolvedOriginalPosition | undefined
}

export interface ResolvedOriginalPosition {
  readonly source: string
  readonly line: number
  readonly column: number
  readonly name?: string
  readonly preContext?: string[]
  readonly contextLine?: string
  readonly postContext?: string[]
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_TABLE = new Int8Array(128).fill(-1)
for (let i = 0; i < BASE64_CHARS.length; i++) {
  BASE64_TABLE[BASE64_CHARS.charCodeAt(i)] = i
}

function decodeVlqLine(line: string, state: [number, number, number, number]): DecodedSegment[] {
  const segments: DecodedSegment[] = []
  let genCol = 0
  let i = 0
  const len = line.length

  while (i < len) {
    if (line.charCodeAt(i) === 44 /* ',' */) {
      i++
      continue
    }
    const fields: number[] = []
    while (i < len && line.charCodeAt(i) !== 44 /* ',' */) {
      let value = 0
      let shift = 0
      let continuation = true
      while (continuation && i < len) {
        const code = line.charCodeAt(i++)
        const digit = code < 128 ? BASE64_TABLE[code]! : -1
        if (digit < 0) break
        continuation = (digit & 32) !== 0
        value += (digit & 31) << shift
        shift += 5
      }
      const isNegative = (value & 1) === 1
      const shifted = value >> 1
      fields.push(isNegative ? -shifted : shifted)
    }

    if (fields.length >= 4) {
      genCol += fields[0]!
      state[0] += fields[1]!
      state[1] += fields[2]!
      state[2] += fields[3]!
      let nameIdx = -1
      if (fields.length >= 5) {
        state[3] += fields[4]!
        nameIdx = state[3]
      }
      segments.push([genCol, state[0], state[1], state[2], nameIdx])
    } else if (fields.length === 1) {
      genCol += fields[0]!
    }
  }
  return segments
}

class CompiledRegularMap implements CompiledSourceMap {
  private readonly lines: DecodedSegment[][]
  private readonly sources: readonly string[]
  private readonly sourceRoot: string
  private readonly names: readonly string[]
  private readonly sourceLinesCache = new Map<number, readonly string[]>()
  private readonly sourcesContent: readonly (string | null)[]

  constructor(raw: RawRegularSourceMap) {
    this.sources = raw.sources ?? []
    this.sourceRoot = typeof raw.sourceRoot === 'string' ? raw.sourceRoot : ''
    this.names = raw.names ?? []
    this.sourcesContent = raw.sourcesContent ?? []

    const rawLines = (raw.mappings ?? '').split(';')
    const state: [number, number, number, number] = [0, 0, 0, 0]
    this.lines = rawLines.map(line => (line.length === 0 ? [] : decodeVlqLine(line, state)))
  }

  private getSourceLines(sourceIdx: number): readonly string[] | undefined {
    const cached = this.sourceLinesCache.get(sourceIdx)
    if (cached !== undefined) return cached
    const content = this.sourcesContent[sourceIdx]
    if (typeof content !== 'string' || content.length === 0) return undefined
    const split = content.split(/\r?\n/)
    this.sourceLinesCache.set(sourceIdx, split)
    return split
  }

  lookup(line1Based: number, column1Based: number): ResolvedOriginalPosition | undefined {
    const lineIdx = line1Based - 1
    if (lineIdx < 0 || lineIdx >= this.lines.length) return undefined
    const segments = this.lines[lineIdx]
    if (!segments || segments.length === 0) return undefined

    const targetCol = Math.max(0, column1Based - 1)
    let low = 0
    let high = segments.length - 1
    let matched = segments[0]!

    while (low <= high) {
      const mid = (low + high) >> 1
      const candidate = segments[mid]!
      if (candidate[0] <= targetCol) {
        matched = candidate
        low = mid + 1
      } else {
        high = mid - 1
      }
    }

    const [, sourceIdx, origLine0, origCol0, nameIdx] = matched
    const rawSource = this.sources[sourceIdx]
    if (rawSource === undefined) return undefined

    const fullSource = this.sourceRoot
      ? `${this.sourceRoot.replace(/\/+$/, '')}/${rawSource.replace(/^\/+/, '')}`
      : rawSource
    const origLine1 = origLine0 + 1
    const origCol1 = origCol0 + 1
    const name = nameIdx >= 0 ? this.names[nameIdx] : undefined

    const sourceLines = this.getSourceLines(sourceIdx)
    const context = sourceLines !== undefined ? extractContextFromLines(sourceLines, origLine1) : undefined

    return {
      source: cleanSourcePath(fullSource),
      line: origLine1,
      column: origCol1,
      ...(name !== undefined ? { name } : {}),
      ...(context !== undefined ? context : {}),
    }
  }
}

class CompiledIndexedMap implements CompiledSourceMap {
  private readonly sections: readonly CompiledSection[]

  constructor(raw: RawIndexedSourceMap) {
    this.sections = (raw.sections ?? [])
      .filter(s => s && s.offset && s.map && typeof s.map.mappings === 'string')
      .map(s => ({
        offsetLine: s.offset.line,
        offsetColumn: s.offset.column,
        map: new CompiledRegularMap(s.map),
      }))
  }

  lookup(line1Based: number, column1Based: number): ResolvedOriginalPosition | undefined {
    const line0 = line1Based - 1
    const col0 = Math.max(0, column1Based - 1)
    let chosen: CompiledSection | undefined
    for (const section of this.sections) {
      if (
        section.offsetLine < line0
        || (section.offsetLine === line0 && section.offsetColumn <= col0)
      ) {
        chosen = section
      } else {
        break
      }
    }
    if (chosen === undefined) return undefined
    const relLine1 = line0 - chosen.offsetLine + 1
    const relCol1 = line0 === chosen.offsetLine ? col0 - chosen.offsetColumn + 1 : col0 + 1
    return chosen.map.lookup(relLine1, relCol1)
  }
}

/** Compile either a regular SourceMap v3 or an Indexed SourceMap v3 object. */
export function compileSourceMap(raw: unknown): CompiledSourceMap | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const candidate = raw as Record<string, unknown>
  if (candidate.version !== 3) return undefined
  if (Array.isArray(candidate.sections)) {
    return new CompiledIndexedMap(candidate as unknown as RawIndexedSourceMap)
  }
  if (typeof candidate.mappings === 'string' && Array.isArray(candidate.sources)) {
    return new CompiledRegularMap(candidate as unknown as RawRegularSourceMap)
  }
  return undefined
}

/** Extract 5 pre_context lines, 1 context_line, and 5 post_context lines around a 1-based line number. */
export function extractContextFromLines(
  lines: readonly string[],
  line1Based: number,
  contextCount = 5,
): { preContext: string[]; contextLine: string; postContext: string[] } | undefined {
  const idx = line1Based - 1
  if (idx < 0 || idx >= lines.length) return undefined
  const start = Math.max(0, idx - contextCount)
  const end = Math.min(lines.length, idx + contextCount + 1)
  return {
    preContext: lines.slice(start, idx).map(l => l.slice(0, 300)),
    contextLine: (lines[idx] ?? '').slice(0, 300),
    postContext: lines.slice(idx + 1, end).map(l => l.slice(0, 300)),
  }
}

/** Normalize relative `../` source paths into readable repository/package-relative paths. */
export function cleanSourcePath(rawPath: string): string {
  let normalized = rawPath.replace(/\\/g, '/')
  normalized = normalized.replace(/^file:\/\/\/?/i, '')
  const packagesIdx = normalized.indexOf('/packages/')
  if (packagesIdx >= 0) return normalized.slice(packagesIdx + 1)
  const vendorIdx = normalized.indexOf('/vendor/')
  if (vendorIdx >= 0) return normalized.slice(vendorIdx + 1)
  const appsIdx = normalized.indexOf('/apps/')
  if (appsIdx >= 0) return normalized.slice(appsIdx + 1)
  while (normalized.startsWith('../') || normalized.startsWith('./')) {
    normalized = normalized.replace(/^\.\.?\//, '')
  }
  return normalized
}

/** Determine whether a resolved source path belongs to user/application code vs third-party libraries. */
export function isAppFrame(path: string): boolean {
  const lower = path.toLowerCase()
  if (lower.includes('node_modules') || lower.includes('@sentry/') || lower.startsWith('node:')) {
    return false
  }
  return true
}

/** Apply a ResolvedOriginalPosition to a Sentry StackFrame in place. */
export function applyResolvedToFrame(frame: StackFrame, resolved: ResolvedOriginalPosition): void {
  if (frame.filename && !frame.abs_path) {
    frame.abs_path = frame.filename
  }
  frame.filename = resolved.source
  frame.lineno = resolved.line
  frame.colno = resolved.column
  if (resolved.name && (!frame.function || frame.function === '?' || frame.function === '<anonymous>')) {
    frame.function = resolved.name
  }
  if (resolved.contextLine !== undefined) {
    frame.pre_context = resolved.preContext ?? []
    frame.context_line = resolved.contextLine
    frame.post_context = resolved.postContext ?? []
  }
  frame.in_app = isAppFrame(resolved.source)
}

/** Collect all StackFrames from a Sentry Event. */
export function collectEventFrames(event: Event): StackFrame[] {
  const frames: StackFrame[] = []
  for (const ex of event.exception?.values ?? []) {
    for (const frame of ex.stacktrace?.frames ?? []) {
      frames.push(frame)
    }
  }
  return frames
}
