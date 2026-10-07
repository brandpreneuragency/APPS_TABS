import diff3Merge from 'diff3'
import type { GithubDraft } from './types'

export interface TextMerge {
  clean: boolean
  text: string
  conflictCount: number
}

function splitLines(text: string): { lines: string[]; trailingNewline: boolean } {
  if (text.length === 0) return { lines: [], trailingNewline: false }
  const trailingNewline = text.endsWith('\n')
  const lines = text.split('\n')
  if (trailingNewline) lines.pop()
  return { lines, trailingNewline }
}

function joinLines(lines: string[], trailingNewline: boolean): string {
  if (lines.length === 0) return trailingNewline ? '\n' : ''
  return lines.join('\n') + (trailingNewline ? '\n' : '')
}

/**
 * Three-way textual merge via the diff3 package (Khanna/Kunal/Pierce).
 * This is not a custom merge. Callers must not treat a conflicted result as resolved.
 */
export function mergeTexts(base: string, mine: string, theirs: string): TextMerge {
  const baseLines = splitLines(base)
  const mineLines = splitLines(mine)
  const theirLines = splitLines(theirs)
  const regions = diff3Merge(mineLines.lines, baseLines.lines, theirLines.lines)
  const out: string[] = []
  let conflictCount = 0
  for (const region of regions) {
    if ('ok' in region) {
      out.push(...region.ok)
      continue
    }
    conflictCount += 1
    out.push('<<<<<<< mine', ...region.conflict.a, '=======', ...region.conflict.b, '>>>>>>> remote')
  }
  const trailing = mineLines.trailingNewline || theirLines.trailingNewline || baseLines.trailingNewline
  return { clean: conflictCount === 0, text: joinLines(out, trailing), conflictCount }
}

export function draftsShareBase(drafts: GithubDraft[]): boolean {
  const bases = new Set(drafts.map((draft) => draft.baseCommitSha))
  return bases.size <= 1
}
