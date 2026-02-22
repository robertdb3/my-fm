import type { StationSystemType } from "@music-cable-box/shared";

const INTERNAL_SPACE_PATTERN = /\s+/g;

export const SYSTEM_TYPE_ORDER: Record<StationSystemType, number> = {
  GENRE: 0,
  DECADE: 1,
  ARTIST: 2
};

export function normalizeDisplayValue(input: string): string {
  return input.trim().replace(INTERNAL_SPACE_PATTERN, " ");
}

export function normalizeSortKey(input: string): string {
  return normalizeDisplayValue(input).toLocaleLowerCase("en-US");
}

export function toOptionalNormalizedDisplay(input: string | null | undefined): string | null {
  if (typeof input !== "string") {
    return null;
  }

  const normalized = normalizeDisplayValue(input);
  return normalized.length > 0 ? normalized : null;
}

export function systemTypeRank(type: StationSystemType | null): number {
  if (!type) {
    return Number.MAX_SAFE_INTEGER;
  }

  return SYSTEM_TYPE_ORDER[type] ?? Number.MAX_SAFE_INTEGER;
}

export function toDecadeStart(year: number, currentYear: number): number | null {
  if (!Number.isInteger(year) || year < 1900 || year > currentYear) {
    return null;
  }

  return Math.floor(year / 10) * 10;
}

export function toDecadeLabel(decadeStart: number): string {
  return `${decadeStart}s`;
}

const FM_MIN = 88.1;
const FM_MAX = 107.9;
const FM_STEP = 0.2;
const FM_SLOT_COUNT = Math.floor((FM_MAX - FM_MIN) / FM_STEP) + 1;

export function tunerFrequencyLabel(tunerIndex: number, totalStations: number): string {
  if (totalStations <= 1) {
    return FM_MIN.toFixed(1);
  }

  if (totalStations <= FM_SLOT_COUNT) {
    return (FM_MIN + tunerIndex * FM_STEP).toFixed(1);
  }

  const slotIndex = Math.round((tunerIndex / (totalStations - 1)) * (FM_SLOT_COUNT - 1));
  return (FM_MIN + slotIndex * FM_STEP).toFixed(1);
}
