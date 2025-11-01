/**
 * Migration script to move data from SQLite to Cloudflare D1
 * 
 * Usage:
 * 1. Make sure you have sqlite3 installed
 * 2. Update SQLITE_PATH to point to your ff.db file
 * 3. Run: npx wrangler d1 execute massmurdercanada --file=migrations/0001_initial.sql
 * 4. Run: node migrate-data.js
 * 5. Run: npx wrangler d1 execute massmurdercanada --file=migrations/0002_data.sql
 */

const { execSync } = require('child_process');
const fs = require('fs');

const SQLITE_PATH = '/Users/darron/src/ff/ff.db'; // Update this if needed
const DATABASE_NAME = 'massmurdercanada';

function escapeSQL(str) {
  if (!str) return 'NULL';
  return `'${String(str).replace(/'/g, "''").replace(/\\/g, '\\\\')}'`;
}

function migrateData() {
  console.log('Starting data migration from SQLite to D1...');

  // First, let's export records from SQLite
  console.log('Exporting records from SQLite...');
  const recordsOutput = execSync(`sqlite3 ${SQLITE_PATH} "SELECT id, date, name, city, province, licensed, victims, deaths, injuries, suicide, devices_used, firearms, possessed_legally, warnings, oic_impact, ai_summary FROM records;"`, { encoding: 'utf-8' });
  
  const records = recordsOutput.trim().split('\n').filter(line => line.trim()).map(line => {
    const parts = line.split('|');
    return {
      id: parts[0] || null,
      date: parts[1] || null,
      name: parts[2] || null,
      city: parts[3] || null,
      province: parts[4] || null,
      licensed: parts[5] === '1' ? 1 : (parts[5] === '0' ? 0 : null),
      victims: parseInt(parts[6]) || 0,
      deaths: parseInt(parts[7]) || 0,
      injuries: parseInt(parts[8]) || 0,
      suicide: parts[9] === '1' ? 1 : (parts[9] === '0' ? 0 : null),
      devices_used: parts[10] || null,
      firearms: parts[11] === '1' ? 1 : (parts[11] === '0' ? 0 : null),
      possessed_legally: parts[12] === '1' ? 1 : (parts[12] === '0' ? 0 : null),
      warnings: parts[13] || null,
      oic_impact: parts[14] === '1' ? 1 : (parts[14] === '0' ? 0 : null),
      ai_summary: parts[15] || null
    };
  });

  console.log(`Found ${records.length} records`);

  // Export news stories
  console.log('Exporting news stories from SQLite...');
  const storiesOutput = execSync(`sqlite3 ${SQLITE_PATH} "SELECT id, record_id, url, body_text, ai_summary FROM news_stories;"`, { encoding: 'utf-8' });
  
  const stories = storiesOutput.trim().split('\n').filter(line => line.trim()).map(line => {
    const parts = line.split('|');
    return {
      id: parts[0] || null,
      record_id: parts[1] || null,
      url: parts[2] || null,
      body_text: parts[3] || null,
      ai_summary: parts[4] || null
    };
  });

  console.log(`Found ${stories.length} news stories`);

  // Generate SQL insert statements
  console.log('Generating SQL insert statements...');
  
  const recordInserts = records.map(r => {
    const values = [
      r.id ? escapeSQL(r.id) : 'NULL',
      r.date ? escapeSQL(r.date) : 'NULL',
      r.name ? escapeSQL(r.name) : 'NULL',
      r.city ? escapeSQL(r.city) : 'NULL',
      r.province ? escapeSQL(r.province) : 'NULL',
      r.licensed !== null ? r.licensed : 'NULL',
      r.victims || 0,
      r.deaths || 0,
      r.injuries || 0,
      r.suicide !== null ? r.suicide : 'NULL',
      r.devices_used ? escapeSQL(r.devices_used) : 'NULL',
      r.firearms !== null ? r.firearms : 'NULL',
      r.possessed_legally !== null ? r.possessed_legally : 'NULL',
      r.warnings ? escapeSQL(r.warnings) : 'NULL',
      r.oic_impact !== null ? r.oic_impact : 'NULL',
      r.ai_summary ? escapeSQL(r.ai_summary) : 'NULL'
    ];
    
    return `INSERT INTO records (id, date, name, city, province, licensed, victims, deaths, injuries, suicide, devices_used, firearms, possessed_legally, warnings, oic_impact, ai_summary) VALUES (${values.join(', ')});`;
  }).join('\n');

  const storyInserts = stories.map(s => {
    const values = [
      s.id ? escapeSQL(s.id) : 'NULL',
      s.record_id ? escapeSQL(s.record_id) : 'NULL',
      s.url ? escapeSQL(s.url) : 'NULL',
      s.body_text ? escapeSQL(s.body_text) : 'NULL',
      s.ai_summary ? escapeSQL(s.ai_summary) : 'NULL'
    ];
    
    return `INSERT INTO news_stories (id, record_id, url, body_text, ai_summary) VALUES (${values.join(', ')});`;
  }).join('\n');

  // Write to SQL file
  const sqlContent = `-- Data migration from SQLite to D1\n-- Generated automatically\n\n-- Insert records\n${recordInserts}\n\n-- Insert news stories\n${storyInserts}\n`;
  
  fs.writeFileSync('migrations/0002_data.sql', sqlContent);
  
  console.log('SQL file created: migrations/0002_data.sql');
  console.log('\nTo import the data, run:');
  console.log(`npx wrangler d1 execute ${DATABASE_NAME} --file=migrations/0002_data.sql`);
}

migrateData();
