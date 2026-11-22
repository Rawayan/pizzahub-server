
import { Db, MongoClient } from "mongodb";
import { setServers } from "node:dns";
import { createDatabaseIndexes } from "./database-indexes";

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "pizzahub";

if (!MONGODB_URI) {
  throw new Error("MONGODB_URI is missing from the environment variables");
}

let client: MongoClient | null = null;
let database: Db | null = null;

export const connectToDatabase = async (): Promise<Db> => {
  if (database) return database;

  try {
    // Only override DNS when explicitly configured.
    // Otherwise, use the environment's default DNS resolver.
    const configuredDnsServers = process.env.DNS_SERVERS;

    if (configuredDnsServers) {
      const dnsServers = configuredDnsServers
        .split(",")
        .map((server) => server.trim())
        .filter(Boolean);

      if (dnsServers.length > 0) {
        setServers(dnsServers);
        console.log("Using configured DNS servers:", dnsServers);
      }
    }

    client = new MongoClient(MONGODB_URI);

    await client.connect();

    database = client.db(DB_NAME);

    await database.command({ ping: 1 });

    console.log(`MongoDB connected successfully: ${DB_NAME}`);

    await createDatabaseIndexes(database);

    return database;
  } catch (error) {
    console.error("MongoDB connection failed:", error);

    if (client) {
      await client.close().catch(() => undefined);
    }

    client = null;
    database = null;

    throw error;
  }
};

export const getDatabase = (): Db => {
  if (!database) {
    throw new Error(
      "Database is not connected. Call connectToDatabase() first."
    );
  }

  return database;
};

export const closeDatabaseConnection = async (): Promise<void> => {
  if (client) {
    await client.close();
    client = null;
    database = null;

    console.log("MongoDB connection closed");
  }
};
