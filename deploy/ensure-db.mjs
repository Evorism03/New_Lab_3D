// Makes sure the database named in DATABASE_URL exists (creating it if the server is reachable
// but the database is not), so setup works right after a fresh PostgreSQL install.
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(2);
}

const target = new URL(url);
const dbName = decodeURIComponent(target.pathname.replace(/^\//, ""));

async function tryConnect(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  return client;
}

try {
  const client = await tryConnect(url);
  await client.end();
  console.log(`Database "${dbName}" is reachable.`);
} catch (err) {
  if (err.code !== "3D000") {
    console.error(`Cannot connect to PostgreSQL: ${err.message}`);
    process.exit(1);
  }
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = await tryConnect(admin.toString());
  await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
  await client.end();
  console.log(`Created database "${dbName}".`);
}
