import type { Message } from "../../shared/types";

export function shouldGroupMessage(
  previous: Message | undefined,
  current: Message,
): boolean {
  if (
    !previous ||
    previous.userId !== current.userId ||
    previous.channelId !== current.channelId ||
    previous.parentId !== current.parentId ||
    previous.pinned ||
    current.pinned
  ) {
    return false;
  }

  const previousDate = new Date(previous.createdAt);
  const currentDate = new Date(current.createdAt);
  const gap = currentDate.getTime() - previousDate.getTime();

  return (
    Number.isFinite(gap) &&
    gap >= 0 &&
    gap <= 5 * 60_000 &&
    previousDate.getFullYear() === currentDate.getFullYear() &&
    previousDate.getMonth() === currentDate.getMonth() &&
    previousDate.getDate() === currentDate.getDate()
  );
}
