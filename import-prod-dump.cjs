/**
 * Script to import production database dump into D1
 */

const fs = require('fs');
const path = require('path');

const DUMP_FILE = 'database_dump.sql';
const OUTPUT_DIR = 'migrations/prod-data';
const BATCH_SIZE = 50;

function convertSQLForD1(content) {
  // Remove PRAGMA and transaction statements (D1 doesn't support them)
  let sql = content
    .replace(/PRAGMA[^;]*;/gi, '')
    .replace(/BEGIN TRANSACTION;/gi, '')
    .replace(/COMMIT;/gi, '')
    .replace(/ROLLBACK;/gi, '');
  
  // Remove brackets from column names FIRST (SQLite escaping)
  // Handle both CREATE TABLE and INSERT statements
  sql = sql.replace(/\[date\]/gi, 'date');
  sql = sql.replace(/\[name\]/gi, 'name');
  sql = sql.replace(/\[url\]/gi, 'url');
  
  // Convert VARCHAR to TEXT for D1 compatibility
  sql = sql.replace(/VARCHAR\((\d+)\)/gi, 'TEXT');
  
  // Convert BOOLEAN to INTEGER
  sql = sql.replace(/\bBOOLEAN\b/gi, 'INTEGER');
  
  // Convert DATE type to TEXT (but be careful not to replace column name)
  // Match DATE when it's a type, not part of a column name
  sql = sql.replace(/\bDATE\b(?=\s*,|\s*\))/gi, 'TEXT');
  
  // Remove uint64 type (use INTEGER)
  sql = sql.replace(/\buint64\b/gi, 'INTEGER');
  
  // Remove schema_migrations table and its inserts (not needed for D1)
  sql = sql.replace(/CREATE TABLE schema_migrations[^;]*;/gi, '');
  sql = sql.replace(/INSERT INTO schema_migrations[^;]*;/gi, '');
  
  // Remove litestream tables (not needed)
  sql = sql.replace(/CREATE TABLE _litestream[^;]*;/gi, '');
  
  return sql;
}

function splitIntoBatches(inserts, batchSize) {
  const batches = [];
  for (let i = 0; i < inserts.length; i += batchSize) {
    batches.push(inserts.slice(i, i + batchSize));
  }
  return batches;
}

function processDump() {
  console.log('Reading database dump...');
  const dumpContent = fs.readFileSync(DUMP_FILE, 'utf-8');
  
  console.log('Converting SQL for D1...');
  let sql = convertSQLForD1(dumpContent);
  
  // Split into CREATE TABLE statements and INSERT statements
  const createTableRegex = /CREATE TABLE[^;]+;/gi;
  const createTables = sql.match(createTableRegex) || [];
  
  const insertRegex = /INSERT INTO[^;]+;/gi;
  const inserts = sql.match(insertRegex) || [];
  
  console.log(`Found ${createTables.length} CREATE TABLE statements`);
  console.log(`Found ${inserts.length} INSERT statements`);
  
  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Write schema file
  const schemaFile = path.join(OUTPUT_DIR, '0001_schema.sql');
  let schemaContent = '-- Production database schema\n-- Converted from SQLite dump\n\n';
  schemaContent += createTables.join('\n\n');
  schemaContent += '\n\n-- Create indexes\n';
  schemaContent += 'CREATE INDEX IF NOT EXISTS idx_records_date ON records(date);\n';
  schemaContent += 'CREATE INDEX IF NOT EXISTS idx_news_stories_record_id ON news_stories(record_id);\n';
  fs.writeFileSync(schemaFile, schemaContent);
  console.log(`Created schema file: ${schemaFile}`);
  
  // Split INSERTs into batches
  const batches = splitIntoBatches(inserts, BATCH_SIZE);
  
  // Group inserts by table
  const recordsInserts = inserts.filter(ins => ins.includes('INSERT INTO records'));
  const storiesInserts = inserts.filter(ins => ins.includes('INSERT INTO news_stories'));
  
  console.log(`Records: ${recordsInserts.length} inserts`);
  console.log(`Stories: ${storiesInserts.length} inserts`);
  
  // Process records
  const recordBatches = splitIntoBatches(recordsInserts, BATCH_SIZE);
  recordBatches.forEach((batch, index) => {
    const filename = path.join(OUTPUT_DIR, `0002_records_${String(index + 1).padStart(3, '0')}.sql`);
    const content = `-- Records batch ${index + 1} of ${recordBatches.length}\n${batch.join('\n')}\n`;
    fs.writeFileSync(filename, content);
    console.log(`Created ${filename}`);
  });
  
  // Process stories
  const storyBatches = splitIntoBatches(storiesInserts, BATCH_SIZE);
  storyBatches.forEach((batch, index) => {
    const filename = path.join(OUTPUT_DIR, `0002_stories_${String(index + 1).padStart(3, '0')}.sql`);
    const content = `-- Stories batch ${index + 1} of ${storyBatches.length}\n${batch.join('\n')}\n`;
    fs.writeFileSync(filename, content);
    console.log(`Created ${filename}`);
  });
  
  console.log(`\nCreated ${recordBatches.length} record batch files and ${storyBatches.length} story batch files`);
  console.log('\nTo import:');
  console.log('1. Apply schema: npx wrangler d1 execute massmurdercanada-prod --file=migrations/prod-data/0001_schema.sql --remote');
  console.log('2. Import records and stories in order');
}

processDump();

