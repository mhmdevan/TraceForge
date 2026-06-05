CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL,
  description text,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'declined', 'failed')),
  payment_status text NOT NULL CHECK (payment_status IN ('pending', 'approved', 'declined', 'failed')),
  payment_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_created_at
  ON transactions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS transaction_events (
  id uuid PRIMARY KEY,
  transaction_id uuid NOT NULL REFERENCES transactions (id),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transaction_events_transaction_id
  ON transaction_events (transaction_id);
