import { useRef, type ChangeEvent, type KeyboardEvent } from "react";
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
  const { history } = state.current;
  // Remote drafts, completed sends and a new editing session begin a new history.
  if (state.current.scope !== scope || history.current.content !== content) {
    state.current.scope = scope;
    history.reset(content);
  }

  function restore(input: HTMLTextAreaElement, redo: boolean) {
    if (disabled) return;
    const entry = history.restore(redo);
    if (!entry) return;
    const { start, end } = entry;
    onRestore(entry.content);
    requestAnimationFrame(() => {
      if (!input.isConnected) return;
      input.setSelectionRange(start, end);
    });
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
