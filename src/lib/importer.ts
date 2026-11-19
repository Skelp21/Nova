import { api } from "./api";
import { normKey } from "./format";
import type { ImportedPlaylist, Source, Track } from "./types";

/** Picks the search result that best matches title/artist/duration. */
function best(item: ImportedPlaylist["items"][number], found: Track[]): Track | null {
  const want = normKey(item.artist, item.title);
  const [wa, wt] = want.split("|");
  let top: Track | null = null;
  let topScore = -Infinity;
  for (const t of found) {
    if (t.unavailable) continue;
    const [ga, gt] = normKey(t.artist, t.title).split("|");
    let s = 0;
    if (gt === wt) s += 5;
    else if (gt.includes(wt) || wt.includes(gt)) s += 3;
    if (ga === wa) s += 4;
    else if (ga.includes(wa.split(" ")[0] ?? "") || wa.includes(ga.split(" ")[0] ?? "")) s += 2;
    if (item.duration && t.duration) s -= Math.min(4, Math.abs(item.duration - t.duration) / 6);
    if (/live|концерт|cover|karaoke|remix/i.test(t.title) && !/live|cover|karaoke|remix/i.test(item.title)) s -= 2;
    if (s > topScore) {
      topScore = s;
      top = t;
    }
  }
  return topScore >= 3 ? top : null;
}

export async function matchAll(
  pl: ImportedPlaylist,
  source: Source,
  onProgress: (done: number, total: number) => void,
  shouldStop: () => boolean,
): Promise<{ tracks: Track[]; missed: string[] }> {
  const results: (Track | null)[] = new Array(pl.items.length).fill(null);
  const missed: string[] = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < pl.items.length && !shouldStop()) {
      const i = next++;
      const item = pl.items[i];
      try {
        const found = await api.search(source, `${item.artist} ${item.title}`, 6);
        results[i] = best(item, found);
      } catch {
        results[i] = null;
      }
      if (!results[i]) missed.push(`${item.artist} — ${item.title}`);
      onProgress(++done, pl.items.length);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return { tracks: results.filter((t): t is Track => !!t), missed };
}
