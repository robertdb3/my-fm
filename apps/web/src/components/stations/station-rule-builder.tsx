"use client";

import type { StationRules } from "@music-cable-box/shared";
import { validateStationRules } from "@music-cable-box/shared";
import { MultiSelectAutocomplete } from "./multi-select-autocomplete";

export interface StationRuleDraft {
  includeGenres: string[];
  excludeGenres: string[];
  includeArtists: string[];
  excludeArtists: string[];
  includeAlbums: string[];
  excludeAlbums: string[];
  yearMin: string;
  yearMax: string;
  durationMinSec: string;
  durationMaxSec: string;
  recentlyAddedEnabled: boolean;
  recentlyAddedDays: string;
  avoidRepeatHours: string;
  artistSeparation: string;
}

export function createDefaultStationRuleDraft(): StationRuleDraft {
  return {
    includeGenres: [],
    excludeGenres: [],
    includeArtists: [],
    excludeArtists: [],
    includeAlbums: [],
    excludeAlbums: [],
    yearMin: "",
    yearMax: "",
    durationMinSec: "",
    durationMaxSec: "",
    recentlyAddedEnabled: false,
    recentlyAddedDays: "",
    avoidRepeatHours: "24",
    artistSeparation: "3"
  };
}

export function stationRulesToDraft(rules: StationRules): StationRuleDraft {
  return {
    includeGenres: [...rules.includeGenres],
    excludeGenres: [...rules.excludeGenres],
    includeArtists: [...rules.includeArtists],
    excludeArtists: [...rules.excludeArtists],
    includeAlbums: [...rules.includeAlbums],
    excludeAlbums: [...rules.excludeAlbums],
    yearMin: rules.yearRange?.min?.toString() ?? "",
    yearMax: rules.yearRange?.max?.toString() ?? "",
    durationMinSec: rules.durationRange?.minSec?.toString() ?? "",
    durationMaxSec: rules.durationRange?.maxSec?.toString() ?? "",
    recentlyAddedEnabled: rules.recentlyAddedDays !== undefined,
    recentlyAddedDays: rules.recentlyAddedDays?.toString() ?? "",
    avoidRepeatHours: rules.avoidRepeatHours.toString(),
    artistSeparation: rules.artistSeparation.toString()
  };
}

function parseOptionalInt(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.floor(parsed);
}

export function draftToRulesInput(draft: StationRuleDraft): unknown {
  const yearMin = parseOptionalInt(draft.yearMin);
  const yearMax = parseOptionalInt(draft.yearMax);
  const durationMinSec = parseOptionalInt(draft.durationMinSec);
  const durationMaxSec = parseOptionalInt(draft.durationMaxSec);

  const rules: Record<string, unknown> = {
    includeGenres: draft.includeGenres,
    excludeGenres: draft.excludeGenres,
    includeArtists: draft.includeArtists,
    excludeArtists: draft.excludeArtists,
    includeAlbums: draft.includeAlbums,
    excludeAlbums: draft.excludeAlbums,
    avoidRepeatHours: parseOptionalInt(draft.avoidRepeatHours),
    artistSeparation: parseOptionalInt(draft.artistSeparation)
  };

  if (yearMin !== undefined || yearMax !== undefined) {
    rules.yearRange = {
      ...(yearMin !== undefined ? { min: yearMin } : {}),
      ...(yearMax !== undefined ? { max: yearMax } : {})
    };
  }

  if (durationMinSec !== undefined || durationMaxSec !== undefined) {
    rules.durationRange = {
      ...(durationMinSec !== undefined ? { minSec: durationMinSec } : {}),
      ...(durationMaxSec !== undefined ? { maxSec: durationMaxSec } : {})
    };
  }

  if (draft.recentlyAddedEnabled) {
    rules.recentlyAddedDays = parseOptionalInt(draft.recentlyAddedDays) ?? 0;
  }

  return rules;
}

export function validateRuleDraft(draft: StationRuleDraft): {
  rules: StationRules | null;
  errors: Record<string, string>;
} {
  const parsed = validateStationRules(draftToRulesInput(draft));

  if (parsed.success) {
    return {
      rules: parsed.data,
      errors: {}
    };
  }

  const errors: Record<string, string> = {};

  for (const issue of parsed.error.issues) {
    const key = issue.path.join(".") || "rules";
    if (!errors[key]) {
      errors[key] = issue.message;
    }
  }

  return {
    rules: null,
    errors
  };
}

interface StationRuleBuilderProps {
  token: string;
  draft: StationRuleDraft;
  errors: Record<string, string>;
  onChange(nextDraft: StationRuleDraft): void;
}

export function StationRuleBuilder({ token, draft, errors, onChange }: StationRuleBuilderProps) {
  const update = <K extends keyof StationRuleDraft>(key: K, value: StationRuleDraft[K]) => {
    onChange({
      ...draft,
      [key]: value
    });
  };

  return (
    <div style={{ display: "grid", gap: "0.8rem" }}>
      <MultiSelectAutocomplete
        label="Include genres"
        field="genre"
        token={token}
        values={draft.includeGenres}
        onChange={(values) => update("includeGenres", values)}
        error={errors.includeGenres}
        placeholder="Search genres"
      />

      <MultiSelectAutocomplete
        label="Exclude genres"
        field="genre"
        token={token}
        values={draft.excludeGenres}
        onChange={(values) => update("excludeGenres", values)}
        error={errors.excludeGenres}
        placeholder="Search genres"
      />

      <MultiSelectAutocomplete
        label="Include artists"
        field="artist"
        token={token}
        values={draft.includeArtists}
        onChange={(values) => update("includeArtists", values)}
        error={errors.includeArtists}
        placeholder="Search artists"
      />

      <MultiSelectAutocomplete
        label="Exclude artists"
        field="artist"
        token={token}
        values={draft.excludeArtists}
        onChange={(values) => update("excludeArtists", values)}
        error={errors.excludeArtists}
        placeholder="Search artists"
      />

      <MultiSelectAutocomplete
        label="Include albums"
        field="album"
        token={token}
        values={draft.includeAlbums}
        onChange={(values) => update("includeAlbums", values)}
        error={errors.includeAlbums}
        placeholder="Search albums"
      />

      <MultiSelectAutocomplete
        label="Exclude albums"
        field="album"
        token={token}
        values={draft.excludeAlbums}
        onChange={(values) => update("excludeAlbums", values)}
        error={errors.excludeAlbums}
        placeholder="Search albums"
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
        <label>
          Year min
          <input
            type="number"
            value={draft.yearMin}
            onChange={(event) => update("yearMin", event.target.value)}
          />
          {errors["yearRange.min"] ? <p className="error">{errors["yearRange.min"]}</p> : null}
        </label>

        <label>
          Year max
          <input
            type="number"
            value={draft.yearMax}
            onChange={(event) => update("yearMax", event.target.value)}
          />
          {errors["yearRange.max"] ? <p className="error">{errors["yearRange.max"]}</p> : null}
        </label>
      </div>

      {errors.yearRange ? <p className="error">{errors.yearRange}</p> : null}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
        <label>
          Duration min (sec)
          <input
            type="number"
            value={draft.durationMinSec}
            onChange={(event) => update("durationMinSec", event.target.value)}
          />
          {errors["durationRange.minSec"] ? (
            <p className="error">{errors["durationRange.minSec"]}</p>
          ) : null}
        </label>

        <label>
          Duration max (sec)
          <input
            type="number"
            value={draft.durationMaxSec}
            onChange={(event) => update("durationMaxSec", event.target.value)}
          />
          {errors["durationRange.maxSec"] ? (
            <p className="error">{errors["durationRange.maxSec"]}</p>
          ) : null}
        </label>
      </div>

      {errors.durationRange ? <p className="error">{errors.durationRange}</p> : null}

      <label>
        <input
          type="checkbox"
          checked={draft.recentlyAddedEnabled}
          onChange={(event) => update("recentlyAddedEnabled", event.target.checked)}
          style={{ width: "auto", marginRight: "0.5rem" }}
        />
        Recently added only
      </label>

      {draft.recentlyAddedEnabled ? (
        <label>
          Recently added in last N days
          <input
            type="number"
            value={draft.recentlyAddedDays}
            onChange={(event) => update("recentlyAddedDays", event.target.value)}
          />
          {errors.recentlyAddedDays ? <p className="error">{errors.recentlyAddedDays}</p> : null}
        </label>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
        <label>
          Avoid repeat hours
          <input
            type="number"
            value={draft.avoidRepeatHours}
            onChange={(event) => update("avoidRepeatHours", event.target.value)}
          />
          {errors.avoidRepeatHours ? <p className="error">{errors.avoidRepeatHours}</p> : null}
        </label>

        <label>
          Artist separation (tracks)
          <input
            type="number"
            value={draft.artistSeparation}
            onChange={(event) => update("artistSeparation", event.target.value)}
          />
          {errors.artistSeparation ? <p className="error">{errors.artistSeparation}</p> : null}
        </label>
      </div>

      {errors.rules ? <p className="error">{errors.rules}</p> : null}
    </div>
  );
}
