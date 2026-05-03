import { MongoClient, type Db } from "mongodb";

declare global {
  // eslint-disable-next-line no-var -- HMR singleton
  var __mongoClientPromise: Promise<MongoClient> | undefined;
}

/** Supports `MONGODB_URI` (documented) and `MONGO_URI` (common alternate). */
function getMongoUri(): string | null {
  const u =
    process.env.MONGODB_URI?.trim() ||
    process.env.MONGO_URI?.trim() ||
    "";
  return u.length ? u : null;
}

/** Supports `MONGODB_DB_NAME` and `MONGO_DB_NAME`. */
function getDbName(): string {
  const n =
    process.env.MONGODB_DB_NAME?.trim() ||
    process.env.MONGO_DB_NAME?.trim() ||
    "";
  return n || "nifty_trading";
}

export function isMongoConfigured(): boolean {
  return !!getMongoUri();
}

export async function getMongoDb(): Promise<Db> {
  const uri = getMongoUri();
  if (!uri) {
    throw new Error("MongoDB is not configured (set MONGODB_URI or MONGO_URI)");
  }

  try {
    if (!globalThis.__mongoClientPromise) {
      const client = new MongoClient(uri);
      globalThis.__mongoClientPromise = client.connect();
    }
    const client = await globalThis.__mongoClientPromise;
    return client.db(getDbName());
  } catch (err) {
    // A failed connect() stays rejected forever if we keep the same Promise — clear so the next request can retry.
    globalThis.__mongoClientPromise = undefined;
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`MongoDB connection failed: ${msg}`);
  }
}
