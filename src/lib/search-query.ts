export interface SearchFilters {
  channelId: string;
  userId: string;
  from: string;
  until: string;
  hasFiles: boolean;
  fileType: string;
}

export const EMPTY_SEARCH_FILTERS: SearchFilters = {
  channelId: "",
  userId: "",
  from: "",
  until: "",
  hasFiles: false,
  fileType: "",
};

interface SearchContext {
  channels: { id: string; name: string }[];
  members: { id: string; name: string }[];
  selfId: string;
  now?: Date;
}

interface SearchQuery {
  text: string;
  filters: Partial<SearchFilters>;
  tokens: {
    key: keyof SearchFilters;
    label: string;
    start: number;
    end: number;
  }[];
  error: string;
}

type Operator =
  "channel" | "sender" | "date" | "after" | "before" | "file" | "has";

const operators = new Map<string, Operator>([
  ["kanal", "channel"],
  ["in", "channel"],
  ["kimden", "sender"],
  ["gonderen", "sender"],
  ["from", "sender"],
  ["tarih", "date"],
  ["sonra", "after"],
  ["once", "before"],
  ["dosya", "file"],
  ["has", "has"],
]);
const fileTypes = new Map([
  ["var", ""],
  ["pdf", "pdf"],
  ["gorsel", "image"],
  ["video", "video"],
  ["ses", "audio"],
  ["docx", "docx"],
  ["xlsx", "xlsx"],
  ["pptx", "pptx"],
  ["zip", "zip"],
]);

function fold(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i");
}

/** Quoted free text is scanned as one term so its operators stay literal. */
function termEnd(raw: string, start: number) {
  let quoted = false;
  let cursor = start;
  for (; cursor < raw.length; cursor += 1) {
    const char = raw[cursor];
    if (quoted && char === "\\" && cursor + 1 < raw.length) {
      cursor += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && /\s/u.test(char)) {
      break;
    }
  }
  return cursor;
}

function filterValue(raw: string): { value: string; error: string } {
  if (!raw)
    return {
      value: "",
      error: "Filtrenin iki noktasından sonra bir değer yaz.",
    };
  if (!raw.startsWith('"')) {
    return raw.includes('"')
      ? { value: "", error: "Birden çok sözcüklü değeri çift tırnak içine al." }
      : { value: raw, error: "" };
  }
  let value = "";
  for (let cursor = 1; cursor < raw.length; cursor += 1) {
    const char = raw[cursor];
    if (char === '"') {
      if (cursor !== raw.length - 1)
        return {
          value: "",
          error: "Tırnaklı filtreden sonra bir boşluk bırak.",
        };
      return value.trim()
        ? { value, error: "" }
        : { value: "", error: "Tırnakların içine bir filtre değeri yaz." };
    }
    if (char === "\\" && ['"', "\\"].includes(raw[cursor + 1])) {
      value += raw[++cursor];
    } else {
      value += char;
    }
  }
  return { value: "", error: "Filtrenin kapanış çift tırnağını ekle." };
}

function localDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  return year > 0 &&
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : null;
}

function dateLabel(date: Date) {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

type ResolvedFilter =
  | { filters: Partial<SearchFilters>; key: keyof SearchFilters; label: string }
  | { error: string };

function resolveFilter(
  operator: Operator,
  value: string,
  context: SearchContext,
): ResolvedFilter {
  const folded = fold(value);
  if (operator === "channel" || operator === "sender") {
    const channel = operator === "channel";
    if (!channel && (folded === "ben" || folded === "me"))
      return {
        filters: { userId: context.selfId },
        key: "userId",
        label: "Kimden: Ben",
      };
    const name = channel ? folded.replace(/^#/, "") : folded;
    const matches = (channel ? context.channels : context.members).filter(
      (item) => fold(item.name) === name,
    );
    const kind = channel ? "kanal" : "kişi";
    if (!matches.length)
      return { error: `“${value}” adlı ${kind} bulunamadı. Tam adını kullan.` };
    if (matches.length > 1)
      return {
        error: `“${value}” birden fazla ${kind} ile eşleşiyor. Filtreyi kaldırıp listeden seç.`,
      };
    const item = matches[0];
    return channel
      ? {
          filters: { channelId: item.id },
          key: "channelId",
          label: `Kanal: #${item.name}`,
        }
      : {
          filters: { userId: item.id },
          key: "userId",
          label: `Kimden: ${item.name}`,
        };
  }
  if (operator === "file" || operator === "has") {
    const fileType =
      operator === "has"
        ? folded === "file" || folded === "files"
          ? ""
          : undefined
        : fileTypes.get(folded);
    if (fileType === undefined)
      return {
        error:
          "Dosya filtresi için var, pdf, görsel, video, ses, docx, xlsx, pptx veya zip kullan.",
      };
    return {
      filters: { hasFiles: true, fileType },
      key: fileType ? "fileType" : "hasFiles",
      label: fileType ? `Dosya: ${value}` : "Dosya: Var",
    };
  }
  if (operator === "date" && ["bugun", "dun", "son7gun"].includes(folded)) {
    const now = context.now || new Date();
    if (!Number.isFinite(now.getTime()))
      return {
        error:
          "Güncel tarih belirlenemedi. YYYY-MM-DD biçiminde bir tarih yaz.",
      };
    const end = new Date(now);
    end.setHours(0, 0, 0, 0);
    if (folded === "dun") end.setDate(end.getDate() - 1);
    const start = new Date(end);
    if (folded === "son7gun") start.setDate(start.getDate() - 6);
    return {
      filters: { from: dateLabel(start), until: dateLabel(end) },
      key: "from",
      label: `Tarih: ${value}`,
    };
  }
  if (!localDate(value))
    return {
      error:
        "Geçerli bir tarih yaz: YYYY-MM-DD. Tarih filtresinde bugün, dün veya son7gün de kullanabilirsin.",
    };
  if (operator === "after")
    return {
      filters: { from: value },
      key: "from",
      label: `Başlangıç: ${value}`,
    };
  if (operator === "before")
    return {
      filters: { until: value },
      key: "until",
      label: `Bitiş: ${value}`,
    };
  return {
    filters: { from: value, until: value },
    key: "from",
    label: `Tarih: ${value}`,
  };
}

/** Invalid filters remain in text; callers must not search while error is set. */
export function parseSearchQuery(
  raw: string,
  context: SearchContext,
): SearchQuery {
  const result: SearchQuery = { text: "", filters: {}, tokens: [], error: "" };
  const claimed = new Set<keyof SearchFilters>();
  const literal: string[] = [];
  let literalStart = 0;
  for (let cursor = 0; cursor < raw.length;) {
    if (/\s/u.test(raw[cursor])) {
      cursor += 1;
      continue;
    }
    const start = cursor;
    const end = termEnd(raw, start);
    cursor = end;
    const term = raw.slice(start, end);
    const match = /^([^:\s"]+):/u.exec(term);
    const operator = match && operators.get(fold(match[1]));
    if (!operator || !match) continue;
    const decoded = filterValue(term.slice(match[0].length));
    if (decoded.error) {
      result.error ||= decoded.error;
      continue;
    }
    const resolved = resolveFilter(operator, decoded.value, context);
    if ("error" in resolved) {
      result.error ||= resolved.error;
      continue;
    }
    const keys = Object.keys(resolved.filters) as (keyof SearchFilters)[];
    if (keys.some((key) => claimed.has(key))) {
      result.error ||=
        "Aynı filtreyi bir kez kullan. Tarih aralığı için sonra ve önce kullanabilirsin.";
      continue;
    }
    keys.forEach((key) => claimed.add(key));
    Object.assign(result.filters, resolved.filters);
    result.tokens.push({
      key: resolved.key,
      label: resolved.label,
      start,
      end,
    });
    literal.push(raw.slice(literalStart, start).trim());
    literalStart = end;
  }
  literal.push(raw.slice(literalStart).trim());
  result.text = literal.filter(Boolean).join(" ");
  if (
    result.filters.from &&
    result.filters.until &&
    result.filters.from > result.filters.until
  )
    result.error ||= "Bitiş tarihi başlangıç tarihinden önce olamaz.";
  if (result.text.length > 200)
    result.error ||= "Arama metni en fazla 200 karakter olabilir.";
  return result;
}
