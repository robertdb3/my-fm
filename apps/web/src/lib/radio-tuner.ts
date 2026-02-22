export const RADIO_TUNE_DEBOUNCE_MS = 250;
export const RADIO_SCAN_INTERVAL_MS = 2000;

export function clampTunerIndex(index: number, stationCount: number): number {
  if (stationCount <= 0) {
    return 0;
  }

  return Math.min(stationCount - 1, Math.max(0, index));
}

export function stepTunerIndex(currentIndex: number, delta: number, stationCount: number): number {
  if (stationCount <= 0) {
    return 0;
  }

  return (currentIndex + delta + stationCount) % stationCount;
}

export function nextScanStep(currentIndex: number, stationCount: number) {
  return {
    action: "PLAY_STATION" as const,
    nextIndex: stepTunerIndex(currentIndex, 1, stationCount)
  };
}
