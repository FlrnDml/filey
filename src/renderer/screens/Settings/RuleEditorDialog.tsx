import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '../../components';
import './RuleEditorDialog.css';

export interface RuleEditorDialogProps {
  /** Folder the rule files into; shown in the title. */
  folder: string;
  /** Current rule text. */
  value: string;
  /** Called with the edited text when the user chooses Save. */
  onSave(value: string): void;
  /** Called on Cancel and Escape; the edit is discarded. */
  onCancel(): void;
}

/**
 * Modal editor for a long folder rule: a large multi-line textarea instead of the one-line field.
 * Uses the native `<dialog>` (focus trap, inert background, Escape); mount it only while it is open.
 * The caller returns focus to the button that opened it.
 */
export function RuleEditorDialog({ folder, value, onSave, onCancel }: RuleEditorDialogProps) {
  const titleId = useId();
  const textId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(value);

  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) {
      // jsdom has no showModal; browsers always do.
      if (typeof node.showModal === 'function') node.showModal();
      else node.setAttribute('open', '');
    }
    textarea.current?.focus();
    textarea.current?.setSelectionRange(value.length, value.length);
  }, [value.length]);

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <dialog
      ref={dialog}
      className="rule-editor"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <form
        method="dialog"
        className="rule-editor__form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(text);
        }}
      >
        <h2 id={titleId} className="rule-editor__title">
          Edit rule: <span className="type-mono">{folder}</span>
        </h2>
        <label htmlFor={textId} className="rule-editor__label">
          What belongs in this folder, in plain words
        </label>
        <textarea
          id={textId}
          ref={textarea}
          className="rule-editor__text"
          value={text}
          rows={10}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="rule-editor__actions">
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="primary">
            Save
          </Button>
        </div>
      </form>
    </dialog>
  );
}
