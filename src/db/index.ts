import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

neonConfig.webSocketConstructor = ws;

function connectionString(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set.");
  // The websocket driver does not use libpq channel binding; drop the hint so the handshake is plain TLS.
  const url = new URL(raw);
  url.searchParams.delete("channel_binding");
  return url.toString();
}

type Db = ReturnType<typeof create>;

function create() {
  const pool = new Pool({ connectionString: connectionString(), max: 5 });
  return drizzle(pool, { schema });
}

const g = globalThis as unknown as { __db?: Db };

/** Lazily created so importing this module never touches the network at build time. */
export function getDb(): Db {
  return (g.__db ??= create());
}

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };
