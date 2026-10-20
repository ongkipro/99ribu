import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { join } from "node:path";
import { privateDirectory, readLocalConfig } from "../config/local.ts";

export function connectDatabase(target: "local" | "test", access: "app" | "owner" = "app") {
  readLocalConfig(process.env);
  if (!["local", "test"].includes(target) || !["app", "owner"].includes(access)) {
    throw new Error("Unknown isolated database target or access role.");
  }
  const sql = postgres({
    path: join(privateDirectory("pgsocket"), ".s.PGSQL.5432"),
    database: `99ribu_${target}`,
    username: `99ribu_${target}_${access}`,
    max: 5,
    connect_timeout: 3,
    idle_timeout: 20,
    connection: { application_name: `99ribu-${target}-${access}`, statement_timeout: 10000 },
    onnotice: () => {},
  });
  return { sql, db: drizzle(sql) };
}
