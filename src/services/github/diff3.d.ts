declare module 'diff3' {
  export interface Diff3ConflictRegion {
    a: string[]
    aIndex: number
    o: string[]
    oIndex: number
    b: string[]
    bIndex: number
  }

  export type Diff3Region = { ok: string[] } | { conflict: Diff3ConflictRegion }

  /** Classic diff3 (Khanna/Kunal/Pierce). Default export is the merge function. */
  export default function diff3Merge(
    mine: readonly string[],
    base: readonly string[],
    theirs: readonly string[],
  ): Diff3Region[]
}
