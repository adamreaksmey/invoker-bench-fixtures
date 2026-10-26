CREATE TABLE accounts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX accounts_user_id_idx ON accounts(user_id);

CREATE TABLE transactions (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, account_id) REFERENCES accounts(user_id, id) ON DELETE CASCADE
);

CREATE INDEX transactions_user_account_idx ON transactions(user_id, account_id);
