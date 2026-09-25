'use client';

import { X } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';

export interface ComboOption {
  value: string;
  label: string;
}

/**
 * A searchable dropdown: type to narrow, arrows to move, Enter to pick,
 * Escape to close. One value, or several with `multiple`.
 *
 * Built rather than borrowed from `<datalist>`, which cannot be styled, does
 * not say what a code means ("USD" without "US Dollar"), and accepts anything
 * typed — the one thing a field with a fixed set of answers must not do.
 */
function useCombo(options: ComboOption[], exclude: string[]) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter(
      (o) =>
        !exclude.includes(o.value) &&
        (!q || o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)),
    );
  }, [options, exclude, query]);

  return { query, setQuery, open, setOpen, active: Math.min(active, Math.max(matches.length - 1, 0)), setActive, matches };
}

function List({
  id,
  matches,
  active,
  onPick,
  empty,
}: {
  id: string;
  matches: ComboOption[];
  active: number;
  onPick: (o: ComboOption) => void;
  empty: string;
}) {
  return (
    <ul role="listbox" id={id} className="combo-list">
      {matches.length === 0 ? (
        <li className="combo-empty">{empty}</li>
      ) : (
        matches.map((o, i) => (
          <li
            key={o.value}
            id={`${id}-${i}`}
            role="option"
            aria-selected={i === active}
            className={i === active ? 'combo-option active' : 'combo-option'}
            // mousedown, not click: a click would blur the input first and
            // close the list before the pick lands.
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(o);
            }}
          >
            <span className="combo-value">{o.value}</span>
            {o.label !== o.value && <span className="combo-label">{o.label}</span>}
          </li>
        ))
      )}
    </ul>
  );
}

export function Combobox({
  label,
  options,
  value,
  onChange,
  placeholder,
  empty = 'No match',
}: {
  label: string;
  options: ComboOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  empty?: string;
}) {
  const listId = useId();
  const c = useCombo(options, []);
  const selected = options.find((o) => o.value === value);

  function pick(o: ComboOption | null) {
    onChange(o ? o.value : null);
    c.setQuery('');
    c.setOpen(false);
  }

  return (
    <div className="combo">
      <input
        className="cell"
        role="combobox"
        aria-label={label}
        aria-expanded={c.open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={c.open && c.matches.length ? `${listId}-${c.active}` : undefined}
        placeholder={placeholder}
        // Showing the pick while closed, the search while open.
        value={c.open ? c.query : selected ? `${selected.value}${selected.label !== selected.value ? ` — ${selected.label}` : ''}` : value ?? ''}
        onFocus={() => {
          c.setQuery('');
          c.setOpen(true);
        }}
        onBlur={() => c.setOpen(false)}
        onChange={(e) => {
          c.setQuery(e.target.value);
          c.setActive(0);
          c.setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            c.setOpen(true);
            c.setActive(Math.min(c.active + 1, c.matches.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            c.setActive(Math.max(c.active - 1, 0));
          } else if (e.key === 'Enter' && c.open) {
            e.preventDefault();
            if (c.matches[c.active]) pick(c.matches[c.active]);
          } else if (e.key === 'Escape') {
            c.setOpen(false);
          }
        }}
      />
      {value && !c.open && (
        <button type="button" className="combo-clear" aria-label={`Clear ${label}`} onClick={() => pick(null)}>
          <X size={13} aria-hidden />
        </button>
      )}
      {c.open && <List id={listId} matches={c.matches} active={c.active} onPick={pick} empty={empty} />}
    </div>
  );
}

export function MultiCombobox({
  label,
  options,
  value,
  onChange,
  placeholder,
  empty = 'No match',
}: {
  label: string;
  options: ComboOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  empty?: string;
}) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const c = useCombo(options, value);
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label;

  function add(o: ComboOption) {
    onChange([...value, o.value]);
    c.setQuery('');
    c.setActive(0);
  }

  return (
    <div className="combo combo-multi" onClick={() => input.current?.focus()}>
      {value.map((v) => (
        <span key={v} className="combo-chip">
          {v}
          {labelOf(v) && labelOf(v) !== v && <span className="combo-label">{labelOf(v)}</span>}
          <button
            type="button"
            aria-label={`Remove ${v}`}
            onClick={(e) => {
              e.stopPropagation();
              onChange(value.filter((x) => x !== v));
            }}
          >
            <X size={12} aria-hidden />
          </button>
        </span>
      ))}
      <input
        ref={input}
        className="combo-multi-input"
        role="combobox"
        aria-label={label}
        aria-expanded={c.open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={c.open && c.matches.length ? `${listId}-${c.active}` : undefined}
        placeholder={value.length ? '' : placeholder}
        value={c.query}
        onFocus={() => c.setOpen(true)}
        onBlur={() => c.setOpen(false)}
        onChange={(e) => {
          c.setQuery(e.target.value);
          c.setActive(0);
          c.setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            c.setActive(Math.min(c.active + 1, c.matches.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            c.setActive(Math.max(c.active - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (c.matches[c.active]) add(c.matches[c.active]);
          } else if (e.key === 'Backspace' && !c.query && value.length) {
            onChange(value.slice(0, -1));
          } else if (e.key === 'Escape') {
            c.setOpen(false);
          }
        }}
      />
      {c.open && <List id={listId} matches={c.matches} active={c.active} onPick={add} empty={empty} />}
    </div>
  );
}
