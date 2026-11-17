
import app from "./app";

const PORT = Number(process.env.PORT) || 5000;

const server = app.listen(PORT, () => {
  console.log(`🍕 PizzaHub server running on port ${PORT}`);
  console.log(`Local API: http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

// Graceful shutdown.
const shutdown = (signal: string) => {
  console.log(`${signal} received. Shutting down server...`);

  server.close(() => {
    console.log("PizzaHub server closed.");
    process.exit(0);
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
