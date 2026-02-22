import { AudioModeSchema, type AudioMode } from "@music-cable-box/shared";

export type AudioOutputFormat = "mp3" | "aac";

const DEFAULT_BITRATE_BY_MODE: Record<AudioMode, number> = {
  UNMODIFIED: 192,
  FM: 128,
  AM: 64
};

function normalizeOffsetSec(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value ?? 0));
}

function normalizeBitrateKbps(mode: AudioMode, value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_BITRATE_BY_MODE[mode];
  }

  return Math.max(32, Math.min(320, Math.floor(value ?? DEFAULT_BITRATE_BY_MODE[mode])));
}

function normalizeFormat(value: string | undefined): AudioOutputFormat {
  return value === "aac" ? "aac" : "mp3";
}

export function parseAudioMode(input: unknown): AudioMode {
  return AudioModeSchema.parse(input);
}

export interface BuildStreamProxyUrlOptions {
  origin: string;
  navidromeSongId: string;
  mode: AudioMode;
  accessToken: string;
  offsetSec?: number;
  format?: AudioOutputFormat;
  bitrateKbps?: number;
}

export function buildStreamProxyUrl(options: BuildStreamProxyUrlOptions): string {
  const format = normalizeFormat(options.format);
  const bitrateKbps = normalizeBitrateKbps(options.mode, options.bitrateKbps);
  const offsetSec = normalizeOffsetSec(options.offsetSec);

  const url = new URL(`${options.origin}/api/stream/${encodeURIComponent(options.navidromeSongId)}`);
  url.searchParams.set("mode", options.mode);
  url.searchParams.set("format", format);
  url.searchParams.set("bitrateKbps", String(bitrateKbps));
  url.searchParams.set("accessToken", options.accessToken);

  if (offsetSec > 0) {
    url.searchParams.set("offsetSec", String(offsetSec));
  }

  return url.toString();
}

export interface FfmpegPlanInput {
  sourceUrl: string;
  mode: AudioMode;
  format?: string;
  bitrateKbps?: number;
}

export interface FfmpegPlan {
  command: string;
  args: string[];
  contentType: string;
  format: AudioOutputFormat;
  mode: AudioMode;
  bitrateKbps: number;
}

function codecArgs(format: AudioOutputFormat, bitrateKbps: number): string[] {
  if (format === "aac") {
    return ["-c:a", "aac", "-b:a", `${bitrateKbps}k`, "-f", "adts", "pipe:1"];
  }

  return ["-c:a", "libmp3lame", "-b:a", `${bitrateKbps}k`, "-f", "mp3", "pipe:1"];
}

export function buildFfmpegPlan(input: FfmpegPlanInput): FfmpegPlan {
  const mode = parseAudioMode(input.mode);
  const format = normalizeFormat(input.format);
  const bitrateKbps = normalizeBitrateKbps(mode, input.bitrateKbps);

  const args: string[] = ["-hide_banner", "-loglevel", "error", "-nostdin"];
  args.push("-i", input.sourceUrl, "-vn");

  if (mode === "FM") {
    args.push(
      "-f",
      "lavfi",
      "-i",
      "anoisesrc=color=white:amplitude=0.0025:sample_rate=44100",
      "-filter_complex",
      "[0:a]highpass=f=80,lowpass=f=15000,acompressor=threshold=-18dB:ratio=2:attack=20:release=220[prog];[1:a]aformat=channel_layouts=stereo,highpass=f=400,lowpass=f=12000,volume=0.05[noise];[prog][noise]amix=inputs=2:duration=first:weights=1|0.12:normalize=0,alimiter=limit=0.95[outa]",
      "-map",
      "[outa]",
      "-ac",
      "2"
    );
  } else if (mode === "AM") {
    args.push(
      "-f",
      "lavfi",
      "-i",
      "anoisesrc=color=white:amplitude=0.01:sample_rate=22050",
      "-filter_complex",
      "[0:a]aformat=channel_layouts=mono,highpass=f=300,lowpass=f=3400,acompressor=threshold=-26dB:ratio=4:attack=6:release=180,aresample=8000,aresample=22050,volume=1.2[prog];[1:a]aformat=channel_layouts=mono,highpass=f=200,lowpass=f=4000,volume=0.2[noise];[prog][noise]amix=inputs=2:duration=first:weights=1|0.35:normalize=0,alimiter=limit=0.9[outa]",
      "-map",
      "[outa]",
      "-ac",
      "1"
    );
  } else {
    args.push("-ac", "2");
  }

  args.push(...codecArgs(format, bitrateKbps));

  return {
    command: process.env.FFMPEG_PATH ?? "ffmpeg",
    args,
    contentType: format === "aac" ? "audio/aac" : "audio/mpeg",
    format,
    mode,
    bitrateKbps
  };
}

export function defaultBitrateForMode(mode: AudioMode): number {
  return DEFAULT_BITRATE_BY_MODE[mode];
}
