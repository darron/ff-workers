/**
 * Migration script to move data from SQLite to Cloudflare D1
 * 
 * Usage:
 * 1. Make sure you have sqlite3 installed
 * 2. Update SQLITE_PATH to point to your ff.db file
 * 3. Run: npx wrangler d1 execute massmurdercanada --file=migrations/0001_initial.sql
 * 4. Run: node migrate-data.cjs
 * 5. Run: npx wrangler d1 execute massmurdercanada --file=migrations/0002_data.sql
 */

const Database = require('better-sqlite3');
const fs = require('fs');

const SQLITE_PATH = '/Users/darron/src/ff/ff.db'; // Update this if needed
const DATABASE_NAME = 'massmurdercanada';

function escapeSQL(str) {
  if (str === null || str === undefined) return 'NULL';
  return `'${String(str).replace(/'/g, "''").replace(/\\/g, '\\\\')}'`;
}

function migrateData() {
  console.log('Starting data migration from SQLite to D1...');

  // Open SQLite database
  const db = new Database(SQLITE_PATH, { readonly: true });

  // First, let's export records from SQLite
  console.log('Exporting records from SQLite...');
  const records = db.prepare('SELECT id, date, name, city, province, licensed, victims, deaths, injuries, suicide, devices_used, firearms, possessed_legally, warnings, oic_impact, ai_summary FROM records').all();

  console.log(`Found ${records.length} records`);

  // Export news stories
  console.log('Exporting news stories from SQLite...');
  const stories = db.prepare('SELECT id, record_id, url, body_text, ai_summary FROM news_stories').all();

  console.log(`Found ${stories.length} news stories`);
  
  // Close database
  db.close();

  // Generate SQL insert statements in batches
  console.log('Generating SQL insert statements...');
  
  const RECORD_BATCH_SIZE = 10; // Insert 10 records per batch
  const STORY_BATCH_SIZE = 5; // Insert 5 stories per batch (some have very large body_text)
  
  // Process records in batches
  const recordBatches = [];
  for (let i = 0; i < records.length; i += RECORD_BATCH_SIZE) {
    const batch = records.slice(i, i + RECORD_BATCH_SIZE);
    const inserts = batch.map(r => {
      const values = [
        r.id ? escapeSQL(r.id) : 'NULL',
        r.date ? escapeSQL(r.date) : 'NULL',
        r.name ? escapeSQL(r.name) : 'NULL',
        r.city ? escapeSQL(r.city) : 'NULL',
        r.province ? escapeSQL(r.province) : 'NULL',
        r.licensed !== null && r.licensed !== undefined ? r.licensed : 'NULL',
        r.victims !== null && r.victims !== undefined ? (r.victims || 0) : 0,
        r.deaths !== null && r.deaths !== undefined ? (r.deaths || 0) : 0,
        r.injuries !== null && r.injuries !== undefined ? (r.injuries || 0) : 0,
        r.suicide !== null && r.suicide !== undefined ? r.suicide : 'NULL',
        r.devices_used ? escapeSQL(r.devices_used) : 'NULL',
        r.firearms !== null && r.firearms !== undefined ? r.firearms : 'NULL',
        r.possessed_legally !== null && r.possessed_legally !== undefined ? r.possessed_legally : 'NULL',
        r.warnings ? escapeSQL(r.warnings) : 'NULL',
        r.oic_impact !== null && r.oic_impact !== undefined ? r.oic_impact : 'NULL',
        r.ai_summary ? escapeSQL(r.ai_summary) : 'NULL'
      ];
      
      return `INSERT INTO records (id, date, name, city, province, licensed, victims, deaths, injuries, suicide, devices_used, firearms, possessed_legally, warnings, oic_impact, ai_summary) VALUES (${values.join(', ')});`;
    });
    recordBatches.push(inserts.join('\n'));
  }

  // Process stories in batches
  const storyBatches = [];
  for (let i = 0; i < stories.length; i += STORY_BATCH_SIZE) {
    const batch = stories.slice(i, i + STORY_BATCH_SIZE);
    const inserts = batch.map(s => {
      const values = [
        s.id ? escapeSQL(s.id) : 'NULL',
        s.record_id ? escapeSQL(s.record_id) : 'NULL',
        s.url ? escapeSQL(s.url) : 'NULL',
        s.body_text ? escapeSQL(s.body_text) : 'NULL',
        s.ai_summary ? escapeSQL(s.ai_summary) : 'NULL'
      ];
      
      return `INSERT INTO news_stories (id, record_id, url, body_text, ai_summary) VALUES (${values.join(', ')});`;
    });
    storyBatches.push(inserts.join('\n'));
  }

  // Write batches to separate files to avoid size limits
  const dataDir = 'migrations/data';
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  // Write record batches
  recordBatches.forEach((batch, index) => {
    const filename = `${dataDir}/0002_records_${String(index + 1).padStart(3, '0')}.sql`;
    fs.writeFileSync(filename, `-- Records batch ${index + 1} of ${recordBatches.length}\n${batch}\n`);
    console.log(`Created ${filename}`);
  });
  
  // Write story batches
  storyBatches.forEach((batch, index) => {
    const filename = `${dataDir}/0002_stories_${String(index + 1).padStart(3, '0')}.sql`;
    fs.writeFileSync(filename, `-- Stories batch ${index + 1} of ${storyBatches.length}\n${batch}\n`);
    console.log(`Created ${filename}`);
  });
  
  console.log(`\nCreated ${recordBatches.length} record batch files and ${storyBatches.length} story batch files in ${dataDir}/`);
  console.log('\nTo import the data, run each file sequentially:');
  console.log(`for file in migrations/data/*.sql; do npx wrangler d1 execute ${DATABASE_NAME} --file="$file" --remote; done`);
}

migrateData();
