export interface LrcLine {
  time: number;
  text: string;
}

/** Parses "[mm:ss.xx] text" lines (several timestamps per line allowed). */
export function parseLrc(src: string): LrcLine[] {
  const out: LrcLine[] = [];
  const tag = /\[(\d+):(\d+(?:\.\d+)?)\]/g;
  for (const raw of src.split(/\r?\n/)) {
    const times: number[] = [];
    let m: RegExpExecArray | null;
    tag.lastIndex = 0;
    let lastEnd = 0;
    while ((m = tag.exec(raw))) {
      times.push(parseInt(m[1], 10) * 60 + parseFloat(m[2]));
      lastEnd = tag.lastIndex;
    }
    if (!times.length) continue;
    const text = raw.slice(lastEnd).trim();
    for (const t of times) out.push({ time: t, text });
  }
  return out.sort((a, b) => a.time - b.time);
}

export function activeIndex(lines: LrcLine[], t: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= t + 0.15) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
