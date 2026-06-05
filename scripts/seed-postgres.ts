import { Pool } from "pg";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://traceforge:traceforge@localhost:15432/traceforge";

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString: databaseUrl
  });

  try {
    await pool.query(
      `
        INSERT INTO transactions (
          id,
          user_id,
          amount,
          currency,
          description,
          status,
          payment_status,
          payment_reference
        )
        VALUES
          (
            '11111111-1111-4111-8111-111111111111',
            'seed-user',
            19.99,
            'USD',
            'Seed transaction',
            'approved',
            'approved',
            'pay_seed_1'
          )
        ON CONFLICT (id) DO NOTHING
      `
    );
    console.log("seeded postgres");
  } finally {
    await pool.end();
  }
}

void main();
