/**
 * Database helper functions for D1
 */

/**
 * Find a record by ID
 */
export async function findRecord(env, id) {
  if (!env.DB) {
    throw new Error('DB binding is not available in environment');
  }
  const record = await env.DB.prepare(
    `SELECT r.id, r.date, r.name, r.city, r.province, r.licensed, r.victims, 
            r.deaths, r.injuries, r.suicide, r.devices_used, r.firearms,
            r.possessed_legally, r.warnings, r.oic_impact, r.ai_summary
     FROM records r
     WHERE r.id = ?`
  ).bind(id).first();

  if (!record) {
    return null;
  }

  // Get associated news stories
  const newsStories = await env.DB.prepare(
    `SELECT * FROM news_stories WHERE record_id = ?`
  ).bind(id).all();

  return {
    ...record,
    newsStories: newsStories.results || []
  };
}

/**
 * Get all records, ordered by date descending
 */
export async function getAllRecords(env) {
  if (!env.DB) {
    throw new Error('DB binding is not available in environment');
  }
  const result = await env.DB.prepare(
    `SELECT r.id, r.date, r.name, r.city, r.province, r.licensed, r.victims, 
            r.deaths, r.injuries, r.suicide, r.devices_used, r.firearms,
            r.possessed_legally, r.warnings, r.oic_impact, r.ai_summary
     FROM records r
     ORDER BY r.date DESC`
  ).all();

  return result.results || [];
}

/**
 * Filter records by group
 */
export function filterRecordsByGroup(records, group) {
  switch (group) {
    case 'mass':
      return records.filter(r => r.victims > 3);
    case 'massfirearms':
      return records.filter(r => r.victims > 3 && r.firearms === 1);
    case 'massfirearmslicensed':
      return records.filter(r => r.victims > 3 && r.firearms === 1 && r.licensed === 1);
    case 'massother':
      return records.filter(r => r.victims > 3 && r.firearms !== 1);
    case 'oic':
      return records.filter(r => r.oic_impact === 1);
    case 'suicide':
      return records.filter(r => r.suicide === 1);
    default:
      return [];
  }
}

/**
 * Filter records by province
 */
export function filterRecordsByProvince(records, province) {
  const provinceUpper = province.toUpperCase();
  const validProvinces = ['BC', 'AB', 'ON', 'NT', 'YT', 'NB', 'NL', 'NS', 'PE', 'QC', 'MB', 'SK', 'NU', 'USA'];
  
  if (!validProvinces.includes(provinceUpper)) {
    return [];
  }
  
  return records.filter(r => r.province === provinceUpper);
}

/**
 * Helper to convert boolean/null values for display
 */
export function formatNullableBool(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return value === 1 ? 'Yes' : 'No';
}

