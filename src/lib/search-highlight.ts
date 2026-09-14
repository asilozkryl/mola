export interface SearchHighlight {
  text: string;
  match: boolean;
}

const fold = (text: string) =>
  text.normalize("NFKC").toLocaleLowerCase("tr-TR");

/** Match the server's literal Turkish search without interpreting text as HTML. */
export function highlightSearchText(
  text: string,
  query: string,
): SearchHighlight[] {
  const needle = fold(query.trim());
  if (!needle) return [{ text, match: false }];
  const segments = new Intl.Segmenter("tr", {
    granularity: "grapheme",
  }).segment(text);
  let normalized = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (const { segment, index } of segments) {
    const value = fold(segment);
    normalized += value;
    for (let offset = 0; offset < value.length; offset++) {
      starts.push(index);
      ends.push(index + segment.length);
    }
  }
  const ranges: [number, number][] = [];
  let at = normalized.indexOf(needle);
  while (at !== -1) {
    const start = starts[at];
    const end = ends[at + needle.length - 1];
    const previous = ranges.at(-1);
    if (previous && start <= previous[1])
      previous[1] = Math.max(previous[1], end);
    else ranges.push([start, end]);
    at = normalized.indexOf(needle, at + needle.length);
  }
  const result: SearchHighlight[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor)
      result.push({ text: text.slice(cursor, start), match: false });
    result.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length)
    result.push({ text: text.slice(cursor), match: false });
  return result.length ? result : [{ text, match: false }];
}
