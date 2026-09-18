// Cleans up the uploads folder. Usage: node deploy/cleanup-uploads.mjs <scan|delete> [days]
//  - "unused":  uploaded models older than <days> that were never part of an order
//  - "orphans": files in uploads/ that no database row points to any more
// Prints one line of JSON so the menu can show and confirm the numbers.
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const mode = process.argv[2] ?? "scan";
const days = Number(process.argv[3] ?? 30);
const uploadsDir = path.join(process.cwd(), "uploads");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const cutoff = new Date(Date.now() - days * 86_400_000);
const unusedRows = (
  await client.query(
    `select f.id, f."storageKey"
       from "UploadedFile" f
      where f."createdAt" < $1
        and not exists (select 1 from "OrderItem" o where o."fileId" = f.id)`,
    [cutoff],
  )
).rows;

const referenced = new Set(
  (
    await client.query(
      `select "storageKey" as k from "UploadedFile"
       union select "storageKey" from "ShowcaseItem"
       union select "imageKey" from "Material" where "imageKey" is not null`,
    )
  ).rows.map((r) => r.k),
);

async function sizeOf(name) {
  try {
    return (await fs.stat(path.join(uploadsDir, name))).size;
  } catch {
    return 0;
  }
}

let onDisk = [];
try {
  onDisk = (await fs.readdir(uploadsDir)).filter((n) => n !== ".gitkeep");
} catch {
  // no uploads folder yet
}
// Files younger than an hour may belong to an upload that is still being saved.
const orphanNames = [];
for (const name of onDisk) {
  if (referenced.has(name)) continue;
  try {
    const { mtimeMs } = await fs.stat(path.join(uploadsDir, name));
    if (Date.now() - mtimeMs > 3_600_000) orphanNames.push(name);
  } catch {
    // vanished meanwhile
  }
}

async function totalBytes(names) {
  let sum = 0;
  for (const n of names) sum += await sizeOf(n);
  return sum;
}

const result = {
  days,
  unused: { count: unusedRows.length, bytes: await totalBytes(unusedRows.map((r) => r.storageKey)) },
  orphans: { count: orphanNames.length, bytes: await totalBytes(orphanNames) },
};

if (mode === "delete") {
  for (const row of unusedRows) {
    await fs.rm(path.join(uploadsDir, row.storageKey), { force: true });
    await client.query(`delete from "UploadedFile" where id = $1`, [row.id]);
  }
  for (const name of orphanNames) await fs.rm(path.join(uploadsDir, name), { force: true });
  result.deleted = true;
}

await client.end();
console.log(JSON.stringify(result));
