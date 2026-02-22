import { describe, expect, it } from "vitest";
import { buildDecadeBucketsFromYearCounts } from "../src/services/station-auto-generator";

describe("station auto-generator decade bucketing", () => {
  it("maps years into decade buckets and applies thresholds", () => {
    const buckets = buildDecadeBucketsFromYearCounts(
      [
        { year: 1981, count: 20 },
        { year: 1989, count: 11 },
        { year: 1994, count: 30 },
        { year: 2003, count: 9 },
        { year: 1895, count: 99 }, // invalid year, ignored
        { year: 2050, count: 99 } // future year, ignored
      ],
      25,
      2026
    );

    expect(buckets).toEqual([
      {
        decadeStart: 1980,
        label: "1980s",
        count: 31
      },
      {
        decadeStart: 1990,
        label: "1990s",
        count: 30
      }
    ]);
  });
});
