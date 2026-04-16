import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import youtubeRoutes from "./routes/youtube.js";

const API_KEY = process.env.YOUTUBE_TRANSCRIPT_API_KEY;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "*";
const PORT = Number(process.env.PORT) || 3004;

const app = new OpenAPIHono();

app.use(logger());

app.get("/health", (c) => c.text("OK"));

// --- Auth + CORS for API routes ---
const api = new OpenAPIHono();

api.use(
	cors({
		origin: ALLOWED_ORIGIN,
		allowMethods: ["GET", "OPTIONS"],
		allowHeaders: ["Authorization"],
		exposeHeaders: ["Content-Length"],
		maxAge: 600,
	}),
);

api.use(async (c, next) => {
	if (!API_KEY) return next();

	const auth = c.req.header("Authorization");
	if (auth !== `Bearer ${API_KEY}`) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	return next();
});

api.route("/youtube", youtubeRoutes);

app.route("/api/v1", api);

// --- OpenAPI docs ---
app.doc("/openapi.json", {
	openapi: "3.1.0",
	info: { title: "YouTube Transcript API", version: "1.0.0" },
});

const server = Bun.serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" });
console.log(`YouTube Transcript API running on port ${server.port}`);

process.on("SIGTERM", () => {
	server.stop();
	process.exit(0);
});
