import { structuredPatch } from "diff";

export interface StructuredHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface EditPatch {
  hunks: StructuredHunk[];
  additions: number;
  deletions: number;
}

export function buildEditPatch(label: string, before: string, after: string): EditPatch {
  const p = structuredPatch(label, label, before, after, "", "", { context: 2 });
  const hunks: StructuredHunk[] = p.hunks.map((h) => ({
    oldStart: h.oldStart,
    oldLines: h.oldLines,
    newStart: h.newStart,
    newLines: h.newLines,
    lines: [...h.lines],
  }));
  let additions = 0;
  let deletions = 0;
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.startsWith("+")) additions++;
      else if (l.startsWith("-")) deletions++;
    }
  }
  return { hunks, additions, deletions };
}
