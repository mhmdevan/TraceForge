import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://traceforge:traceforge@localhost:15432/traceforge";
const migrationsDir = join(process.cwd(), "infra", "postgres");

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString: databaseUrl
  });

  try {
    const files = (await readdir(migrationsDir))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const sql = await readFile(join(migrationsDir, file), "utf8");
      await pool.query(sql);
      console.log(`applied ${file}`);
    }
  } finally {
    await pool.end();
  }
}

void main();
