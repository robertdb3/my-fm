import { describe, expect, it } from "vitest";
import { normalizeBaseUrl } from "../src/lib/subsonic";

describe("normalizeBaseUrl", () => {
  it("leaves a well-formed url alone", () => {
    expect(normalizeBaseUrl("https://navidrome.example.net")).toBe("https://navidrome.example.net");
  });

  it("strips trailing slashes", () => {
    expect(normalizeBaseUrl("https://navidrome.example.net/")).toBe("https://navidrome.example.net");
    expect(normalizeBaseUrl("https://navidrome.example.net///")).toBe("https://navidrome.example.net");
  });

  it("repairs a dropped slash after the scheme", () => {
    expect(normalizeBaseUrl("https:/navidrome.example.net")).toBe("https://navidrome.example.net");
    expect(normalizeBaseUrl("http:/localhost:4533")).toBe("http://localhost:4533");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeBaseUrl("  https://navidrome.example.net/  ")).toBe("https://navidrome.example.net");
  });

  it("keeps a path prefix intact", () => {
    expect(normalizeBaseUrl("https://example.net/music/")).toBe("https://example.net/music");
  });
});
