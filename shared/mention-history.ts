export interface TextSelection {
  start: number;
  end: number;
}

interface HistoryEntry extends TextSelection {
  content: string;
}

/** Store serialized text, so undo restores targets even when labels are identical. */
export class MentionHistory {
  private entries: HistoryEntry[];
  private index = 0;

  constructor(content: string) {
    this.entries = [{ content, start: 0, end: 0 }];
  }

  get current() {
    return this.entries[this.index];
  }

  reset(content: string) {
    this.entries = [{ content, start: 0, end: 0 }];
    this.index = 0;
  }

  select(selection: TextSelection) {
    Object.assign(this.current, selection);
  }

  record(content: string, selection: TextSelection) {
    if (content === this.current.content) {
      this.select(selection);
      return;
    }
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push({ content, ...selection });
    if (this.entries.length > 100) this.entries.shift();
    this.index = this.entries.length - 1;
  }

  restore(redo = false) {
    const next = this.index + (redo ? 1 : -1);
    if (next < 0 || next >= this.entries.length) return null;
    this.index = next;
    return this.current;
  }
}
