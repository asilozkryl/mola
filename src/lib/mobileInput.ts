interface ComposerKey {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  repeat?: boolean;
}

export function shouldSendComposerKey(event: ComposerKey, coarse: boolean) {
  if (
    event.key !== "Enter" ||
    event.shiftKey ||
    event.altKey ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.repeat
  )
    return false;
  return !coarse || Boolean(event.ctrlKey || event.metaKey);
}
