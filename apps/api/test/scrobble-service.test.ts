import { describe, expect, it } from "vitest";
import { shouldSubmitScrobble } from "../src/services/scrobble-service";

describe("shouldSubmitScrobble", () => {
  it("does not submit when listen time is below minimum threshold", () => {
    expect(
      shouldSubmitScrobble({
        listenSeconds: 12,
        durationSec: 180
      })
    ).toBe(false);
  });

  it("submits when listened time crosses half-track requirement", () => {
    expect(
      shouldSubmitScrobble({
        listenSeconds: 101,
        durationSec: 200
      })
    ).toBe(true);
  });

  it("uses max required cap for long tracks", () => {
    expect(
      shouldSubmitScrobble({
        listenSeconds: 230,
        durationSec: 1200
      })
    ).toBe(false);

    expect(
      shouldSubmitScrobble({
        listenSeconds: 241,
        durationSec: 1200
      })
    ).toBe(true);
  });

  it("falls back to minimum requirement when duration is unknown", () => {
    expect(
      shouldSubmitScrobble({
        listenSeconds: 29,
        durationSec: null
      })
    ).toBe(false);

    expect(
      shouldSubmitScrobble({
        listenSeconds: 30,
        durationSec: null
      })
    ).toBe(true);
  });
});
