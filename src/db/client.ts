import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { join } from "node:path";
import { privateDirectory } from "../config/local.ts";
import { productionDatabase, readRuntimeConfig } from "../config/runtime.ts";

export type DatabaseTarget = "local" | "test" | "production";

// local/test: the owner-only Unix socket of the local profile (unchanged). production: TCP on the private
// network with SCRAM password auth from env, explicit pool and timeouts (S83). The profile and the target
// must agree, so a production process can never reach the local socket and vice versa.
export function connectDatabase(target: DatabaseTarget, access: "app" | "owner" = "app") {
  const { profile } = readRuntimeConfig(process.env);
  if (!["local", "test", "production"].includes(target) || !["app", "owner"].includes(access)) {
    throw new Error("Unknown isolated database target or access role.");
  }
  if ((target === "production") !== (profile === "production")) {
    throw new Error("The database target must match APP_ENV (production only with production).");
  }
  const endpoint = target === "production"
    ? productionDatabase(process.env, access)
    : { path: join(privateDirectory("pgsocket"), ".s.PGSQL.5432") };
  const sql = postgres({
    ...endpoint,
    database: `99ribu_${target}`,
    username: `99ribu_${target}_${access}`,
    max: 5,
    connect_timeout: 3,
    idle_timeout: 20,
    connection: {
      application_name: `99ribu-${target}-${access}`, statement_timeout: 10000,
      // A lock wait ends as retryable 55P03 instead of queueing behind a migration; a stuck transaction cannot pin locks.
      ...(target === "production" ? { lock_timeout: 5000, idle_in_transaction_session_timeout: 30000 } : {}),
    },
    onnotice: () => {},
  });
  return { sql, db: drizzle(sql) };
}
