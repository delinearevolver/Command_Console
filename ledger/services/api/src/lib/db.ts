import { Pool, PoolConfig } from 'pg';

const maxConnections = Math.max(1, Number(process.env.PGPOOL_MAX ?? 4));

const config: PoolConfig = {
  max: maxConnections,        // Maximum number of clients per container
  idleTimeoutMillis: 30000,   // Close idle clients after 30 seconds
  connectionTimeoutMillis: 10000, // Return error after 10 seconds if all clients are busy
};

if (process.env.DATABASE_URL) {
  config.connectionString = process.env.DATABASE_URL;
}

if (process.env.PGHOST) config.host = process.env.PGHOST;
if (process.env.PGPORT) config.port = Number(process.env.PGPORT);
if (process.env.PGDATABASE) config.database = process.env.PGDATABASE;
if (process.env.PGUSER) config.user = process.env.PGUSER;
if (process.env.PGPASSWORD) config.password = process.env.PGPASSWORD;

if ((process.env.PGSSL ?? '').toLowerCase() === 'true' || (process.env.PGSSLMODE ?? '').toLowerCase() === 'require') {
  config.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(config);

pool.on('error', (err: Error) => {
  console.error('Unexpected PostgreSQL pool error', err);
});

export function getPool() {
  return pool;
}
