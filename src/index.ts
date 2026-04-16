import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { extractVideoId, fetchTranscript } from "./transcript.js";

const API_KEY = process.env.YOUTUBE_TRANSCRIPT_API_KEY;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "*";
const PORT = Number(process.env.PORT) || 3004;

const app = new Hono()
	.use(logger())
	.get("/health", (c) => c.text("OK"));

const api = new Hono()
	.use(
		cors({
			origin: ALLOWED_ORIGIN,
			allowMethods: ["GET", "OPTIONS"],
			allowHeaders: ["Authorization"],
			exposeHeaders: ["Content-Length"],
			maxAge: 600,
		}),
	)
	.use(async (c, next) => {
		if (!API_KEY) return next();

		const auth = c.req.header("Authorization");
		if (auth !== `Bearer ${API_KEY}`) {
			return c.json({ error: "Unauthorized" }, 401);
		}
		return next();
	})
	.get("/transcript", async (c) => {
		const url = c.req.query("url");

		if (!url) {
			return c.json({ error: "Missing 'url' query parameter." }, 400);
		}

		const videoId = extractVideoId(url);
		if (!videoId) {
			return c.json({ error: "Invalid YouTube URL." }, 400);
		}

		try {
			const transcript = await fetchTranscript(url);
			return c.json({ transcript });
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			return c.json({ error: message }, 422);
		}
	});

app.route("/api", api);

const server = Bun.serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" });
console.log(`YouTube Transcript API running on port ${server.port}`);

process.on("SIGTERM", () => {
	server.stop();
	process.exit(0);
});
