'use strict';

const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

/**
 * Runs schema.sql. Idempotent (everything uses IF NOT EXISTS), so it's safe to
 * call on every boot — that's what makes a fresh Railway deploy "just work".
 */
async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('[db] schema ensured');
}

module.exports = { migrate };

// Allow `npm run migrate`
if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[db] migration failed:', err);
      process.exit(1);
    });
}
