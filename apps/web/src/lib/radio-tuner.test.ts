import { describe, expect, it } from "vitest";
import { clampTunerIndex, RADIO_TUNE_DEBOUNCE_MS, stepTunerIndex } from "./radio-tuner";

describe("radio tuner helpers", () => {
  it("clamps tuner index safely", () => {
    expect(clampTunerIndex(-4, 10)).toBe(0);
    expect(clampTunerIndex(3, 10)).toBe(3);
    expect(clampTunerIndex(40, 10)).toBe(9);
  });

  it("wraps tuner steps around the station list", () => {
    expect(stepTunerIndex(0, -1, 5)).toBe(4);
    expect(stepTunerIndex(4, 1, 5)).toBe(0);
    expect(stepTunerIndex(2, 2, 5)).toBe(4);
  });

  it("uses the expected debounce delay for drag tuning", () => {
    expect(RADIO_TUNE_DEBOUNCE_MS).toBe(250);
  });
});
