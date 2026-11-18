import app from './app.js';

const PORT = 3000;

const server = app.listen(PORT, (error) => {
    if (error) throw error;
    console.log(`Server started at http://localhost:${PORT}`);
});

let isShuttingDown = false;

async function shutdown(signal: string) {
    if (isShuttingDown) return;

    isShuttingDown = true;
    console.log(`${signal} received, shutting down...`);

    setTimeout(() => process.exit(1), 8000).unref();

    await new Promise((resolve) => server.close(resolve));
    process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);