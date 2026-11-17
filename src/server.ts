
import "dotenv/config";
import app from "./app";
import {
  connectToDatabase,
  closeDatabaseConnection,
} from "./config/database";

const PORT = Number(process.env.PORT) || 5000;

const startServer = async (): Promise<void> => {
  try {
    await connectToDatabase();

    const server = app.listen(PORT, () => {
      console.log(`PizzaHub server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
    });

    const shutdown = async (signal: string): Promise<void> => {
      console.log(`${signal} received. Shutting down...`);

      server.close(async () => {
        await closeDatabaseConnection();
        process.exit(0);
      });
    };

    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
  } catch (error) {
    console.error("Unable to start PizzaHub server:", error);
    await closeDatabaseConnection();
    process.exit(1);
  }
};

void startServer();
