function localDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : null;
}

/** Date inputs describe local calendar days, including days affected by DST. */
export function collectionDateRange(
  startDate: string,
  endDate: string,
): { startAt?: string; endBefore?: string; error: string } {
  const start = startDate ? localDate(startDate) : null;
  const end = endDate ? localDate(endDate) : null;
  if ((startDate && !start) || (endDate && !end))
    return { error: "Geçerli bir tarih seç." };
  if (start && end && start > end)
    return { error: "Bitiş tarihi başlangıç tarihinden önce olamaz." };
  if (end) end.setDate(end.getDate() + 1);
  return {
    ...(start ? { startAt: start.toISOString() } : {}),
    ...(end ? { endBefore: end.toISOString() } : {}),
    error: "",
  };
}
