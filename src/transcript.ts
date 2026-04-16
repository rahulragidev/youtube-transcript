import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseVtt } from "./parse-vtt.js";

const YOUTUBE_URL_PATTERNS = [
	/(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
	/(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
	/(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
	/(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
	/(?:youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/,
	/(?:m\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
];

export function extractVideoId(url: string): string | null {
	for (const pattern of YOUTUBE_URL_PATTERNS) {
		const match = url.match(pattern);
		if (match?.[1]) return match[1];
	}
	return null;
}

export async function fetchTranscript(url: string): Promise<string> {
	const videoId = extractVideoId(url);

	if (!videoId) {
		throw new Error("Invalid YouTube URL.");
	}

	const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
	const tempDir = await mkdtemp(join(tmpdir(), "yt-transcript-"));

	try {
		await runYtDlp(videoUrl, tempDir);

		const files = await readdir(tempDir);
		const vttFile = files.find((f) => f.endsWith(".vtt"));

		if (!vttFile) {
			throw new Error("Could not extract transcript. The video may not have captions.");
		}

		const vttContent = await readFile(join(tempDir, vttFile), "utf-8");
		const text = parseVtt(vttContent);

		if (!text.trim()) {
			throw new Error("Could not extract transcript. The video may not have captions.");
		}

		return text;
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
}

function runYtDlp(videoUrl: string, outputDir: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = spawn("yt-dlp", [
			"--write-auto-subs",
			"--write-subs",
			"--sub-langs",
			"en",
			"--skip-download",
			"--sub-format",
			"vtt",
			"--no-warnings",
			"--output",
			join(outputDir, "%(id)s.%(ext)s"),
			videoUrl,
		]);

		const timeout = setTimeout(() => {
			proc.kill("SIGTERM");
			reject(new Error("yt-dlp timed out after 30 seconds."));
		}, 30_000);

		let stderr = "";

		proc.stderr.on("data", (data: Buffer) => {
			stderr += data.toString();
		});

		proc.on("close", (code) => {
			clearTimeout(timeout);
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`yt-dlp failed (exit ${code}): ${stderr.slice(0, 200)}`));
			}
		});

		proc.on("error", (err) => {
			clearTimeout(timeout);
			reject(new Error(`Failed to spawn yt-dlp: ${err.message}`));
		});
	});
}
