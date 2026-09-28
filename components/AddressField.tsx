"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { AddressLevel, AddressSuggestion } from "@/lib/addressSuggest";

const DEBOUNCE_MS = 250;

/**
 * Text input with a dropdown of address suggestions (/api/address/suggest). Typing is always
 * allowed — a suggestion only fills the field in a form the CRM understands and narrows the next
 * field (street within the city, house on the street). Arrow keys + Enter pick, Esc closes.
 */
export function AddressField({
  label,
  level,
  value,
  context,
  placeholder,
  required = true,
  suggest = true,
  onChange,
  onSelect,
}: {
  label: string;
  level: AddressLevel;
  value: string;
  /** Query params narrowing the lookup: cityId, cityName, bbox, streetId, streetName. */
  context?: Record<string, string | undefined>;
  placeholder?: string;
  required?: boolean;
  /** Off until the previous field is picked from its list — typing still works. */
  suggest?: boolean;
  /** Plain typing — the previous suggestion no longer applies. */
  onChange: (text: string) => void;
  onSelect: (suggestion: AddressSuggestion) => void;
}) {
  const listId = useId();
  const [items, setItems] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // Only look up what the customer typed, not the text a pick just put into the field.
  const typed = useRef(false);
  const contextKey = JSON.stringify(context ?? {});

  useEffect(() => {
    if (!typed.current || !suggest) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      const params = new URLSearchParams({ level, q: value });
      for (const [k, v] of Object.entries(JSON.parse(contextKey) as Record<string, string | undefined>)) {
        if (v) params.set(k, v);
      }
      fetch(`/api/address/suggest?${params}`, { signal: controller.signal })
        .then((res) => res.json())
        .then((data: { suggestions?: AddressSuggestion[] }) => {
          setItems(data.suggestions ?? []);
          setActive(-1);
          setOpen(true);
        })
        .catch(() => {});
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [value, level, contextKey, suggest]);

  const pick = (s: AddressSuggestion) => {
    typed.current = false;
    setOpen(false);
    onSelect(s);
  };

  const showList = suggest && open && items.length > 0;

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-text">{label}</label>
      <input
        required={required}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        onChange={(e) => {
          typed.current = true;
          onChange(e.target.value);
        }}
        onFocus={() => items.length > 0 && typed.current && setOpen(true)}
        // Delay so a click on a suggestion lands before the list disappears.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!showList) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (i + 1) % items.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            pick(items[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="mt-1 w-full px-3 py-2 text-sm"
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-lg"
        >
          {items.map((s, i) => (
            <li
              key={`${s.value}|${s.hint ?? ""}|${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(s)}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-2 text-sm ${i === active ? "bg-accent-soft text-accent" : "text-text"}`}
            >
              <div>{s.withType}</div>
              {s.hint && <div className="text-xs text-muted">{s.hint}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
