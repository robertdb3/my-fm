import { describe, expect, it } from "vitest";
import { buildFfmpegPlan, buildStreamProxyUrl, defaultBitrateForMode } from "../src/services/stream-proxy";

describe("stream proxy ffmpeg profiles", () => {
  it("builds unmodified profile with minimal processing", () => {
    const plan = buildFfmpegPlan({
      sourceUrl: "https://navidrome.test/rest/stream.view?id=song-1",
      mode: "UNMODIFIED",
      format: "mp3"
    });

    expect(plan.contentType).toBe("audio/mpeg");
    expect(plan.bitrateKbps).toBe(defaultBitrateForMode("UNMODIFIED"));
    expect(plan.args.join(" ")).not.toContain("filter_complex");
    expect(plan.args.join(" ")).toContain("libmp3lame");
  });

  it("builds fm profile with band limiting, compression, and mixed noise", () => {
    const plan = buildFfmpegPlan({
      sourceUrl: "https://navidrome.test/rest/stream.view?id=song-2",
      mode: "FM",
      format: "mp3",
      bitrateKbps: 128
    });

    const args = plan.args.join(" ");
    expect(args).toContain("highpass=f=80");
    expect(args).toContain("lowpass=f=15000");
    expect(args).toContain("acompressor=");
    expect(args).toContain("anoisesrc=");
    expect(args).toContain("amix=");
  });

  it("builds am profile with mono narrow band and stronger coloration", () => {
    const plan = buildFfmpegPlan({
      sourceUrl: "https://navidrome.test/rest/stream.view?id=song-3",
      mode: "AM",
      format: "aac",
      bitrateKbps: 64
    });

    const args = plan.args.join(" ");
    expect(plan.contentType).toBe("audio/aac");
    expect(args).toContain("channel_layouts=mono");
    expect(args).toContain("highpass=f=300");
    expect(args).toContain("lowpass=f=3400");
    expect(args).toContain("aresample=8000");
    expect(args).toContain("anoisesrc=");
    expect(args).toContain("alimiter=limit=0.9");
  });

  it("applies trim filter when offset is provided", () => {
    const unmodifiedPlan = buildFfmpegPlan({
      sourceUrl: "https://navidrome.test/rest/stream.view?id=song-4",
      mode: "UNMODIFIED",
      format: "mp3",
      offsetSec: 27
    });

    expect(unmodifiedPlan.args.join(" ")).toContain("-af atrim=start=27,asetpts=PTS-STARTPTS");

    const fmPlan = buildFfmpegPlan({
      sourceUrl: "https://navidrome.test/rest/stream.view?id=song-5",
      mode: "FM",
      format: "mp3",
      offsetSec: 14
    });

    expect(fmPlan.args.join(" ")).toContain("[0:a]atrim=start=14,asetpts=PTS-STARTPTS,highpass=f=80");
  });
});

describe("stream proxy url builder", () => {
  it("builds a proxy url with mode and auth token", () => {
    const url = buildStreamProxyUrl({
      origin: "http://localhost:4000",
      navidromeSongId: "song-123",
      mode: "FM",
      accessToken: "jwt-token",
      offsetSec: 18
    });

    expect(url).toContain("/api/stream/song-123");
    expect(url).toContain("mode=FM");
    expect(url).toContain("offsetSec=18");
    expect(url).toContain("accessToken=jwt-token");
  });
});
