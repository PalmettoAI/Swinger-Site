'use strict';

const { Pool } = require('pg');
const config = require('../config');

if (!config.db.url) {
  console.warn(
    '[db] DATABASE_URL is not set. Attach a Postgres plugin (Railway) or set it in .env.'
  );
}

const pool = new Pool({
  connectionString: config.db.url,
  ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[db] unexpected idle client error', err);
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  /** Convenience: run a callback with a dedicated client (for transactions). */
  async withClient(fn) {
    const client = await pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  },
};
