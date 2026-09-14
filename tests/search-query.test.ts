import assert from "node:assert/strict";
import test from "node:test";
import { parseSearchQuery } from "../src/lib/search-query";

const context = {
  channels: [
    { id: "general", name: "genel" },
    { id: "design", name: "Ürün Tasarımı" },
    { id: "quoted", name: 'Ekip "A" \\ Arşiv' },
  ],
  members: [
    { id: "self", name: "Çağrı Işık" },
    { id: "deniz", name: "Deniz Kaya" },
    { id: "ismail", name: "İsmail Çelik" },
  ],
  selfId: "self",
  now: new Date(2026, 8, 14, 0, 30),
};

test("channel and sender operators resolve Turkish names without changing literal text", () => {
  const parsed = parseSearchQuery(
    '  karar  notu KANAL:"#URUN TASARIMI" GÖNDEREN:"İSMAİL ÇELİK"  ',
    context,
  );
  assert.equal(parsed.error, "");
  assert.equal(parsed.text, "karar  notu");
  assert.deepEqual(parsed.filters, { channelId: "design", userId: "ismail" });
  assert.deepEqual(
    parsed.tokens.map((token) => token.key),
    ["channelId", "userId"],
  );
  for (const name of ["ben", "me", '"Cagri Isik"']) {
    assert.equal(
      parseSearchQuery(`kimden:${name}`, context).filters.userId,
      "self",
    );
  }
  assert.equal(
    parseSearchQuery("in:#genel", context).filters.channelId,
    "general",
  );
  assert.equal(
    parseSearchQuery('from:"Deniz Kaya"', context).filters.userId,
    "deniz",
  );
});

test("quoted filters decode escaped quotes and backslashes and expose exact removal spans", () => {
  const raw = String.raw`önce kanal:"Ekip \"A\" \\ Arşiv" sonra`;
  const parsed = parseSearchQuery(raw, context);
  assert.equal(parsed.error, "");
  assert.equal(parsed.filters.channelId, "quoted");
  assert.equal(parsed.text, "önce sonra");
  assert.equal(parsed.tokens.length, 1);
  const [token] = parsed.tokens;
  assert.equal(
    raw.slice(token.start, token.end),
    String.raw`kanal:"Ekip \"A\" \\ Arşiv"`,
  );
  assert.ok(token.label.includes('Ekip "A" \\ Arşiv'));
  const withoutToken = raw.slice(0, token.start) + raw.slice(token.end);
  assert.deepEqual(parseSearchQuery(withoutToken, context).filters, {});
});

test("unknown operators, URLs, free quotes and SQL-like text remain literal", () => {
  for (const raw of [
    "https://example.invalid/?in:genel&from:ben dosyalar:pdf",
    'etiket:"kimden:ben kanal:genel"',
    '"kanal:genel" \\path\\file.pdf %_*?',
    "' OR 1=1; DROP TABLE messages; --",
    'rapor "iki  kelime" bitiş',
  ]) {
    const parsed = parseSearchQuery(raw, context);
    assert.equal(parsed.text, raw);
    assert.equal(parsed.error, "");
    assert.deepEqual(parsed.filters, {});
    assert.deepEqual(parsed.tokens, []);
  }
});

test("invalid or unfinished recognized operators return errors and remain visible", () => {
  for (const raw of [
    "kanal:",
    "kimden:",
    'kimden:""',
    'kimden:"Deniz Kaya',
    'kimden:"Deniz Kaya"fazla',
    "kanal:bilinmeyen",
    'kimden:"Tanımsız Üye"',
    "kanal:genel;DROP",
    "dosya:exe",
    "has:image",
    "tarih:",
  ]) {
    const parsed = parseSearchQuery(raw, context);
    assert.ok(parsed.error, raw);
    assert.equal(parsed.text, raw);
    assert.deepEqual(parsed.filters, {}, raw);
    assert.deepEqual(parsed.tokens, [], raw);
  }
});

test("ambiguous folded channel and member names never select an arbitrary result", () => {
  const ambiguous = {
    ...context,
    channels: [...context.channels, { id: "collision", name: "GENEL" }],
    members: [...context.members, { id: "other-deniz", name: "Deniz Kaya" }],
  };
  for (const raw of ["kanal:genel", 'kimden:"Deniz Kaya"']) {
    const parsed = parseSearchQuery(raw, ambiguous);
    assert.ok(parsed.error);
    assert.deepEqual(parsed.filters, {});
    assert.equal(parsed.text, raw);
  }
});

test("date shortcuts use inclusive local calendar bounds", () => {
  const cases = [
    ["bugün", "2026-09-14", "2026-09-14"],
    ["dün", "2026-09-13", "2026-09-13"],
    ["SON7GÜN", "2026-09-08", "2026-09-14"],
    ["2024-02-29", "2024-02-29", "2024-02-29"],
  ];
  for (const [value, from, until] of cases) {
    const parsed = parseSearchQuery(`tarih:${value}`, context);
    assert.equal(parsed.error, "");
    assert.deepEqual(parsed.filters, { from, until });
    assert.equal(parsed.tokens.length, 1);
  }
  assert.deepEqual(
    parseSearchQuery("sonra:2024-02-28 önce:2024-02-29", context).filters,
    { from: "2024-02-28", until: "2024-02-29" },
  );
  assert.deepEqual(parseSearchQuery("önce:2026-09-14", context).filters, {
    until: "2026-09-14",
  });
});

test("relative dates stay local across midnight and daylight-saving transitions", () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    const localContext = { ...context, now: new Date("2026-03-09T03:30:00Z") };
    assert.deepEqual(parseSearchQuery("tarih:bugün", localContext).filters, {
      from: "2026-03-08",
      until: "2026-03-08",
    });
    assert.deepEqual(parseSearchQuery("tarih:son7gün", localContext).filters, {
      from: "2026-03-02",
      until: "2026-03-08",
    });
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("invalid dates, reversed bounds and duplicate filter aliases cannot widen the query", () => {
  for (const raw of [
    "tarih:2026-02-29",
    "tarih:2024-02-30",
    "sonra:2026-13-01",
    "önce:2026-00-10",
    "sonra:2026-01-00",
    "tarih:2026-9-14",
    "sonra:2026-09-15 önce:2026-09-14",
    "kanal:genel in:genel",
    "kimden:ben from:me",
    "tarih:bugün sonra:2026-09-14",
    "önce:2026-09-14 tarih:bugün",
    "tarih:bugün tarih:dün",
    "dosya:var dosya:pdf",
    "has:file dosya:video",
  ]) {
    assert.ok(parseSearchQuery(raw, context).error, raw);
  }
});

test("file operators emit the canonical types and keep only literal search content", () => {
  for (const [value, fileType] of [
    ["pdf", "pdf"],
    ["GÖRSEL", "image"],
    ["video", "video"],
    ["ses", "audio"],
    ["docx", "docx"],
    ["xlsx", "xlsx"],
    ["pptx", "pptx"],
    ["zip", "zip"],
    ["var", ""],
  ]) {
    const parsed = parseSearchQuery(`rapor dosya:${value}`, context);
    assert.equal(parsed.error, "");
    assert.equal(parsed.text, "rapor");
    assert.deepEqual(parsed.filters, { hasFiles: true, fileType });
  }
  for (const value of ["file", "files"]) {
    assert.deepEqual(parseSearchQuery(`has:${value}`, context).filters, {
      hasFiles: true,
      fileType: "",
    });
  }
});

test("the 200-character limit applies to literal q without counting valid filter syntax", () => {
  const atLimit = parseSearchQuery(`${"x".repeat(200)} kanal:genel`, context);
  assert.equal(atLimit.error, "");
  assert.equal(atLimit.text.length, 200);
  const tooLong = parseSearchQuery("x".repeat(201), context);
  assert.ok(tooLong.error);
  assert.equal(
    tooLong.text.length,
    201,
    "the parser must not silently truncate",
  );
});
