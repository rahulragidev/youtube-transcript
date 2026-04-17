import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_HOSTNAMES = [
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "m.youtube.com",
];

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const SHORTS_RE = /^\/shorts\/([a-zA-Z0-9_-]{11})/;

// ---------------------------------------------------------------------------
// yt-dlp binary resolution (cached)
// ---------------------------------------------------------------------------

let cachedYtDlpPath: string | null = null;

async function resolveYtDlp(): Promise<string> {
  if (cachedYtDlpPath) return cachedYtDlpPath;

  const localPath = resolve(process.cwd(), "yt-dlp");

  try {
    await access(localPath);
    cachedYtDlpPath = localPath;
    return cachedYtDlpPath;
  } catch {
    // not found locally, fall back to system PATH
  }

  cachedYtDlpPath = "yt-dlp";
  return cachedYtDlpPath;
}

// ---------------------------------------------------------------------------
// Cookie file resolution (cached)
// Supports: ./cookies.txt file OR YT_COOKIES_BASE64 env var
// ---------------------------------------------------------------------------

const COOKIE_FILE_PATH = resolve(process.cwd(), "cookies.txt");
let cachedCookiePath: string | null | undefined = undefined;

async function resolveCookies(): Promise<string | null> {
  if (cachedCookiePath !== undefined) return cachedCookiePath;

  if (existsSync(COOKIE_FILE_PATH)) {
    cachedCookiePath = COOKIE_FILE_PATH;
    return cachedCookiePath;
  }

  const b64 = process.env.YT_COOKIES_BASE64;
  if (b64) {
    const decoded = Buffer.from(b64, "base64").toString("utf-8");
    const tmpCookies = join(tmpdir(), "yt-cookies.txt");
    await writeFile(tmpCookies, decoded, "utf-8");
    cachedCookiePath = tmpCookies;
    return cachedCookiePath;
  }

  cachedCookiePath = null;
  return null;
}

// ---------------------------------------------------------------------------
// yt-dlp availability check (15 s timeout)
// ---------------------------------------------------------------------------

function checkYtDlp(binPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let resolved = false;

    const proc = spawn(binPath, ["--version"], { stdio: "pipe" });

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill("SIGKILL");
        reject(new Error("yt-dlp availability check timed out (15 s)"));
      }
    }, 15_000);

    proc.on("close", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`yt-dlp --version exited with code ${code}`));
    });

    proc.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn yt-dlp: ${err.message}`));
    });
  });
}

// ---------------------------------------------------------------------------
// URL validation & video ID extraction
// ---------------------------------------------------------------------------

function extractVideoId(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }

  if (!ALLOWED_HOSTNAMES.includes(parsed.hostname)) {
    throw new Error(
      `Invalid YouTube hostname: ${parsed.hostname}`,
    );
  }

  // youtu.be/<id>
  if (parsed.hostname === "youtu.be") {
    const id = parsed.pathname.slice(1); // remove leading /
    if (VIDEO_ID_RE.test(id)) return id;
    throw new Error("Could not extract video ID from youtu.be URL");
  }

  // ?v=<id>
  const vParam = parsed.searchParams.get("v");
  if (vParam && VIDEO_ID_RE.test(vParam)) return vParam;

  // /shorts/<id>
  const shortsMatch = parsed.pathname.match(SHORTS_RE);
  if (shortsMatch?.[1]) return shortsMatch[1];

  // Fallback: last path segment if exactly 11 chars
  const segments = parsed.pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  if (last && VIDEO_ID_RE.test(last)) return last;

  throw new Error("Could not extract a valid video ID from the URL");
}

// ---------------------------------------------------------------------------
// VTT parsing
// ---------------------------------------------------------------------------

const VTT_HEADER_RE = /^(WEBVTT|Kind:|Language:)/;
const TIMESTAMP_RE = /^\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->/;
const TAG_INLINE_TS = /<\d{2}:\d{2}:\d{2}[.,]\d{3}>/g;
const TAG_C = /<\/?c>/g;
const TAG_ALIGN = /align:start position:\d+%/g;

function parseVtt(vtt: string): string {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const rawLine of vtt.split("\n")) {
    const trimmed = rawLine.trim();

    if (!trimmed) continue;
    if (VTT_HEADER_RE.test(trimmed)) continue;
    if (TIMESTAMP_RE.test(trimmed)) continue;

    const cleaned = trimmed
      .replace(TAG_INLINE_TS, "")
      .replace(TAG_C, "")
      .replace(TAG_ALIGN, "")
      .trim();

    if (!cleaned) continue;
    if (seen.has(cleaned)) continue;

    seen.add(cleaned);
    lines.push(cleaned);
  }

  return lines.join(" ");
}

// ---------------------------------------------------------------------------
// Subtitle download via yt-dlp (60 s timeout)
// ---------------------------------------------------------------------------

function downloadSubs(
  binPath: string,
  safeUrl: string,
  tempDir: string,
  cookiePath: string | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let resolved = false;

    const args = [
      "--skip-download",
      "--write-auto-sub",
      "--write-sub",
      "--sub-lang",
      "en,en-US,en-GB",
      "--sub-format",
      "vtt",
      "--js-runtimes",
      "bun",
      "-o",
      join(tempDir, "output"),
    ];

    if (cookiePath) {
      args.push("--cookies", cookiePath);
    }

    args.push(safeUrl);

    const proc = spawn(binPath, args);

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill("SIGKILL");
        reject(new Error("yt-dlp subtitle download timed out (60 s)"));
      }
    }, 60_000);

    let stderr = "";

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      if (code === 0) resolve();
      else
        reject(
          new Error(`yt-dlp failed (exit ${code}): ${stderr.slice(0, 300)}`),
        );
    });

    proc.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn yt-dlp: ${err.message}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Response sanitisation
// ---------------------------------------------------------------------------

function sanitize(text: string): string {
  return text
    .replace(/<[^>]*>?/g, "") // strip HTML tags
    .replace(/[^\x20-\x7E]/g, ""); // strip non-ASCII
}

// ---------------------------------------------------------------------------
// OpenAPI route definition
// ---------------------------------------------------------------------------

const transcriptRoute = createRoute({
  method: "get",
  path: "/transcript",
  request: {
    query: z.object({
      url: z
        .string()
        .url()
        .openapi({ description: "YouTube video URL", example: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            transcript: z.string(),
            videoId: z.string(),
          }),
        },
      },
      description: "Transcript extracted successfully",
    },
    400: {
      content: {
        "application/json": {
          schema: z.object({ error: z.string() }),
        },
      },
      description: "Invalid request (bad URL or video ID)",
    },
    422: {
      content: {
        "application/json": {
          schema: z.object({ error: z.string() }),
        },
      },
      description: "Could not extract transcript",
    },
    503: {
      content: {
        "application/json": {
          schema: z.object({ error: z.string() }),
        },
      },
      description: "yt-dlp binary not available",
    },
  },
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const youtubeRoutes = new OpenAPIHono();

youtubeRoutes.openapi(transcriptRoute, async (c) => {
  const { url } = c.req.valid("query");

  // --- Validate & extract video ID ---
  let videoId: string;
  try {
    videoId = extractVideoId(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid URL";
    return c.json({ error: msg }, 400);
  }

  // --- Resolve & check yt-dlp ---
  let binPath: string;
  try {
    binPath = await resolveYtDlp();
    await checkYtDlp(binPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "yt-dlp unavailable";
    return c.json({ error: msg }, 503);
  }

  // --- Resolve cookies ---
  const cookiePath = await resolveCookies();

  // --- Safe URL construction (NEVER pass raw user URL) ---
  const safeUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // --- Download & parse ---
  const tempDir = await mkdtemp(join(tmpdir(), "yt-transcript-"));

  try {
    await downloadSubs(binPath, safeUrl, tempDir, cookiePath);

    const files = await readdir(tempDir);
    const vttFile = files.find((f) => f.endsWith(".vtt"));

    if (!vttFile) {
      return c.json(
        { error: "No captions found for this video." },
        422,
      );
    }

    const vttContent = await readFile(join(tempDir, vttFile), "utf-8");
    const transcript = sanitize(parseVtt(vttContent));

    if (!transcript.trim()) {
      return c.json(
        { error: "Captions file was empty after parsing." },
        422,
      );
    }

    return c.json({ transcript, videoId }, 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return c.json({ error: msg }, 422);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

export default youtubeRoutes;
