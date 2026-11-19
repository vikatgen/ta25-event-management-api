import app from "./app.js";
import {env} from "./config/env.js";

const PORT = 3000;

const server = app.listen(env.PORT, (error) => {
	if (error) throw error;
});

let isShuttingDown = false;

async function shutdown(_signal: string) {
	if (isShuttingDown) return;

	isShuttingDown = true;

	setTimeout(() => process.exit(1), 8000).unref();

	await new Promise((resolve) => server.close(resolve));
	process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
