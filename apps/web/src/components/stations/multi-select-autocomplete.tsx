"use client";

import { useEffect, useMemo, useState } from "react";
import { getRuleOptions } from "../../lib/api";

interface MultiSelectAutocompleteProps {
  label: string;
  field: "genre" | "artist" | "album";
  values: string[];
  token: string;
  placeholder?: string;
  error?: string;
  onChange(nextValues: string[]): void;
}

function normalizeValue(value: string): string {
  return value.trim();
}

function unique(values: string[]) {
  return Array.from(new Set(values.map(normalizeValue).filter(Boolean)));
}

export function MultiSelectAutocomplete({
  label,
  field,
  values,
  token,
  placeholder,
  error,
  onChange
}: MultiSelectAutocompleteProps) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const selectedSet = useMemo(() => new Set(values.map((value) => value.toLowerCase())), [values]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const timeout = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await getRuleOptions(field, query, token);
        setOptions(response.options);
      } catch {
        setOptions([]);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [field, open, query, token]);

  function commitValue(value: string) {
    const normalized = normalizeValue(value);

    if (!normalized) {
      return;
    }

    if (selectedSet.has(normalized.toLowerCase())) {
      setQuery("");
      return;
    }

    onChange(unique([...values, normalized]));
    setQuery("");
  }

  function removeValue(value: string) {
    onChange(values.filter((item) => item !== value));
  }

  return (
    <label>
      {label}
      <div className="multi-select-root">
        <div className="multi-select-tags">
          {values.map((value) => (
            <span key={value} className="multi-select-tag">
              {value}
              <button type="button" onClick={() => removeValue(value)} aria-label={`Remove ${value}`}>
                ×
              </button>
            </span>
          ))}
        </div>

        <input
          value={query}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 150);
          }}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              commitValue(query);
            }
          }}
        />

        {open ? (
          <div className="multi-select-dropdown">
            {loading ? <p className="meta">Loading options...</p> : null}
            {!loading && options.length === 0 ? <p className="meta">No suggestions</p> : null}
            {!loading
              ? options
                  .filter((option) => !selectedSet.has(option.toLowerCase()))
                  .slice(0, 10)
                  .map((option) => (
                    <button
                      key={option}
                      type="button"
                      className="multi-select-option"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        commitValue(option);
                      }}
                    >
                      {option}
                    </button>
                  ))
              : null}
          </div>
        ) : null}
      </div>
      {error ? <p className="error">{error}</p> : null}
    </label>
  );
}
