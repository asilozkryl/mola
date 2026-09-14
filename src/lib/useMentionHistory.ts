import {
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import {
  MentionHistory,
  type TextSelection,
} from "../../shared/mention-history";

const selection = (input: HTMLTextAreaElement): TextSelection => ({
  start: input.selectionStart,
  end: input.selectionEnd,
});

/** Shared by the composer and message editing, including native mobile undo. */
export function useMentionHistory(
  content: string,
  onRestore: (content: string) => void,
  scope: string,
  disabled = false,
) {
  const state = useRef({ scope, history: new MentionHistory(content) });
  const pendingRestore = useRef<
    (TextSelection & { input: HTMLTextAreaElement }) | null
  >(null);
  const { history } = state.current;
  // Remote drafts, completed sends and a new editing session begin a new history.
  if (state.current.scope !== scope || history.current.content !== content) {
    state.current.scope = scope;
    history.reset(content);
    pendingRestore.current = null;
  }

  useLayoutEffect(() => {
    const pending = pendingRestore.current;
    pendingRestore.current = null;
    if (!pending) return;
    const { input, start, end } = pending;
    if (!input.isConnected || input.ownerDocument.activeElement !== input)
      return;
    // Restore with the controlled text commit, before another key moves the caret.
    input.setSelectionRange(start, end);
  });

  function restore(input: HTMLTextAreaElement, redo: boolean) {
    if (disabled) return;
    const entry = history.restore(redo);
    if (!entry) return;
    const { start, end } = entry;
    pendingRestore.current = { input, start, end };
    onRestore(entry.content);
  }

  return {
    capture(input: HTMLTextAreaElement) {
      history.select(selection(input));
    },
    record(next: string, nextSelection: TextSelection) {
      history.record(next, nextSelection);
    },
    onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
      if (event.nativeEvent.isComposing) return false;
      history.select(selection(event.currentTarget));
      const key = event.key.toLowerCase();
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        !["z", "y"].includes(key)
      )
        return false;
      event.preventDefault();
      restore(event.currentTarget, key === "y" || event.shiftKey);
      return true;
    },
    onChange(event: ChangeEvent<HTMLTextAreaElement>) {
      const inputType = (event.nativeEvent as InputEvent).inputType;
      if (inputType !== "historyUndo" && inputType !== "historyRedo")
        return false;
      restore(event.currentTarget, inputType === "historyRedo");
      return true;
    },
  };
}
