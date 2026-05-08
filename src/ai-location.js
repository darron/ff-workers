import { classifySourceType } from './source-classification.js';

const DEFAULT_MODEL = '@cf/zai-org/glm-4.7-flash';
const DEFAULT_MIN_CONFIDENCE = 0.72;
const MAX_SOURCE_SNIPPETS = 18;
const MAX_SNIPPET_CHARS = 420;
const MAX_TOTAL_SOURCE_CHARS = 9000;
const DEFAULT_GEOCODE_PROVIDER = 'nominatim';
const DEFAULT_GEOCODE_BASE_URL = 'https://nominatim.openstreetmap.org';
const DEFAULT_GEOCODE_USER_AGENT = 'MassMurderCanadaBot/1.0 (+https://massmurdercanada.org)';
const CACHE_COUNTRY_CODE = 'CA';

const PROVINCE_NAME_BY_CODE = {
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  ON: 'Ontario',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon'
};

const CANADIAN_PROVINCE_CODES = new Set(Object.keys(PROVINCE_NAME_BY_CODE));
const CITY_LIKE_TYPES = new Set(['city', 'town', 'village', 'hamlet', 'municipality', 'locality']);

export function isAiLocationEnabled(env) {
  return String(env?.AI_LOCATION_ENABLED || 'true').toLowerCase() === 'true';
}

export function isGeocodingEnabled(env) {
  return String(env?.AI_LOCATION_GEOCODE_ENABLED || 'true').toLowerCase() === 'true';
}

export async function enrichRecordLocation(env, recordId, options = {}) {
  if (!env?.DB) {
    throw new Error('DB binding missing');
  }

  const force = options.force === true;
  const geocode = options.geocode !== false;
  const minConfidence = getMinConfidence(env, options.minConfidence);

  const record = await env.DB.prepare(
    `SELECT id, date, name, city, province,
            city_verified, city_confidence, city_verification_source, city_verification_notes,
            location_lat, location_lon, location_source, location_confidence, location_updated_at
     FROM records
     WHERE id = ?`
  ).bind(recordId).first();

  if (!record) {
    return {
      ok: false,
      status: 'not_found',
      recordId
    };
  }

  const verifiedCity = normalizeCityName(record.city_verified);
  const hasVerifiedCity = verifiedCity.length > 0;
  const hasCoordinates = isFiniteNumber(record.location_lat) && isFiniteNumber(record.location_lon);

  // Skip only when fully enriched (verified city + coordinates), regardless of geocode mode.
  if (!force && hasVerifiedCity && hasCoordinates) {
    return {
      ok: true,
      status: 'skipped_already_enriched',
      recordId
    };
  }

  const storiesResult = await env.DB.prepare(
    `SELECT id, url, ai_summary, body_text
     FROM news_stories
     WHERE record_id = ?
     ORDER BY id`
  ).bind(recordId).all();
  const stories = storiesResult.results || [];

  const cityVerification = await verifyCityFromSources(env, record, stories);
  const recordCity = normalizeCityName(record.city);
  const existingCityConfidence = Number(record.city_confidence);

  let selectedCity = '';
  let selectedCityConfidence = 0;
  let selectedCitySource = '';
  let selectedCityNotes = cityVerification.reasoning || normalizeText(record.city_verification_notes || '');

  if (cityVerification.city && cityVerification.confidence >= minConfidence) {
    selectedCity = cityVerification.city;
    selectedCityConfidence = cityVerification.confidence;
    selectedCitySource = 'ai_sources';
  } else if (verifiedCity) {
    selectedCity = verifiedCity;
    selectedCityConfidence = Math.max(
      cityVerification.confidence || 0,
      Number.isFinite(existingCityConfidence) ? existingCityConfidence : 0,
      0.55
    );
    selectedCitySource = normalizeText(record.city_verification_source || '') || 'existing_verified';
  } else if (recordCity) {
    selectedCity = recordCity;
    selectedCityConfidence = Math.max(cityVerification.confidence || 0, 0.55);
    selectedCitySource = 'record_city';
  } else if (cityVerification.city && cityVerification.confidence >= 0.45) {
    selectedCity = cityVerification.city;
    selectedCityConfidence = cityVerification.confidence;
    selectedCitySource = 'ai_low_confidence';
  } else {
    selectedCitySource = 'unknown';
    if (!selectedCityNotes) {
      selectedCityNotes = 'No reliable city extracted from source content.';
    }
  }

  const provinceCode = normalizeProvinceCode(record.province);
  let geocodeResult = null;

  if (geocode && selectedCity && isGeocodingEnabled(env) && CANADIAN_PROVINCE_CODES.has(provinceCode)) {
    geocodeResult = await geocodeCity(env, selectedCity, provinceCode);
  }

  const nowIso = new Date().toISOString();
  const geocodeSucceeded = geocodeResult?.status === 'ok';

  const finalLat = geocodeSucceeded ? geocodeResult.latitude : record.location_lat;
  const finalLon = geocodeSucceeded ? geocodeResult.longitude : record.location_lon;
  const finalLocationSource = geocodeSucceeded ? geocodeResult.provider : record.location_source;
  const finalLocationConfidence = geocodeSucceeded ? geocodeResult.confidence : record.location_confidence;
  const finalLocationUpdatedAt = geocodeSucceeded ? nowIso : record.location_updated_at;

  if (geocodeResult?.status && geocodeResult.status !== 'ok') {
    const geocodeNote = `Geocode status: ${geocodeResult.status}`;
    selectedCityNotes = selectedCityNotes
      ? `${selectedCityNotes} ${geocodeNote}`.trim()
      : geocodeNote;
  }

  await env.DB.prepare(
    `UPDATE records
     SET city_verified = ?,
         city_confidence = ?,
         city_verification_source = ?,
         city_verification_notes = ?,
         location_lat = ?,
         location_lon = ?,
         location_source = ?,
         location_confidence = ?,
         location_updated_at = ?,
         location_last_checked_at = ?
     WHERE id = ?`
  ).bind(
    selectedCity || null,
    selectedCity ? clamp(selectedCityConfidence, 0, 1) : null,
    selectedCitySource || null,
    selectedCityNotes ? selectedCityNotes.slice(0, 500) : null,
    isFiniteNumber(finalLat) ? Number(finalLat) : null,
    isFiniteNumber(finalLon) ? Number(finalLon) : null,
    finalLocationSource || null,
    isFiniteNumber(finalLocationConfidence) ? clamp(Number(finalLocationConfidence), 0, 1) : null,
    finalLocationUpdatedAt || null,
    nowIso,
    recordId
  ).run();

  return {
    ok: true,
    status: 'updated',
    recordId,
    cityVerified: selectedCity || null,
    cityConfidence: selectedCity ? clamp(selectedCityConfidence, 0, 1) : null,
    citySource: selectedCitySource || null,
    geocodeStatus: geocodeResult?.status || 'not_attempted',
    latitude: isFiniteNumber(finalLat) ? Number(finalLat) : null,
    longitude: isFiniteNumber(finalLon) ? Number(finalLon) : null
  };
}

function getMinConfidence(env, override) {
  const overrideNumber = Number(override);
  if (Number.isFinite(overrideNumber)) {
    return clamp(overrideNumber, 0, 1);
  }

  const envNumber = Number(env?.AI_LOCATION_MIN_CONFIDENCE);
  if (Number.isFinite(envNumber)) {
    return clamp(envNumber, 0, 1);
  }

  return DEFAULT_MIN_CONFIDENCE;
}

async function verifyCityFromSources(env, record, stories) {
  const evidence = buildEvidencePayload(stories);
  if (!evidence) {
    return {
      city: '',
      confidence: 0,
      reasoning: 'No source text available for city verification.'
    };
  }

  if (!isAiLocationEnabled(env) || !env?.AI) {
    return {
      city: '',
      confidence: 0,
      reasoning: 'AI location verification disabled.'
    };
  }

  const provinceCode = normalizeProvinceCode(record.province);
  const provinceName = PROVINCE_NAME_BY_CODE[provinceCode] || provinceCode || 'Unknown';
  const currentCity = normalizeCityName(record.city);

  const prompt = [
    'Extract the most likely municipality where this incident occurred.',
    'Return strict JSON only with keys:',
    '{"city": string|null, "confidence": number, "reasoning": string}',
    'Rules:',
    '- city must be municipality/city/town only (no province/country in the value).',
    '- confidence must be between 0 and 1.',
    '- use only evidence from provided sources; do not speculate.',
    '- if uncertain, return city as null and confidence <= 0.4.',
    '',
    `Record name: ${normalizeText(record.name) || 'Unknown'}`,
    `Record year: ${extractYearOnly(record.date) || 'Unknown'}`,
    `Record province: ${provinceCode || 'Unknown'} (${provinceName})`,
    `Current city value: ${currentCity || 'None'}`,
    '',
    'Source excerpts:',
    evidence
  ].join('\n');

  const aiJson = await runAiJson(env, prompt, 320);
  if (!aiJson || typeof aiJson !== 'object') {
    return {
      city: '',
      confidence: 0,
      reasoning: 'AI output was empty or invalid JSON.'
    };
  }

  const city = normalizeCityName(aiJson.city);
  const confidence = clamp(Number(aiJson.confidence), 0, 1);
  const reasoning = normalizeText(aiJson.reasoning || '');

  if (!city) {
    return {
      city: '',
      confidence: Number.isFinite(confidence) ? confidence : 0,
      reasoning: reasoning || 'AI could not identify a reliable city.'
    };
  }

  if (!looksLikeCityName(city)) {
    return {
      city: '',
      confidence: 0,
      reasoning: `AI returned a non-city value: ${city}`
    };
  }

  return {
    city,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    reasoning
  };
}

function buildEvidencePayload(stories) {
  if (!Array.isArray(stories) || stories.length === 0) {
    return '';
  }

  const lines = [];
  let totalChars = 0;

  for (const story of stories) {
    if (lines.length >= MAX_SOURCE_SNIPPETS) break;

    const summary = normalizeText(story.ai_summary || '');
    const bodyText = normalizeText(story.body_text || '');
    const snippetBase = summary || bodyText;
    if (!snippetBase) continue;

    const sourceType = classifySourceType(story.url || '');
    const snippet = snippetBase.slice(0, MAX_SNIPPET_CHARS);
    const line = `- [${sourceType}] ${story.url || 'no-url'} :: ${snippet}`;

    if (totalChars + line.length > MAX_TOTAL_SOURCE_CHARS) break;

    lines.push(line);
    totalChars += line.length;
  }

  return lines.join('\n');
}

async function runAiJson(env, prompt, maxTokens = 320) {
  try {
    const model = env.AI_LOCATION_MODEL || env.AI_MODEL || DEFAULT_MODEL;
    const result = await env.AI.run(model, {
      messages: [
        {
          role: 'system',
          content: 'You are a strict data extraction assistant. Return valid JSON only.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      response_format: { type: 'json_object' },
      chat_template_kwargs: { enable_thinking: false },
      max_tokens: maxTokens,
      max_completion_tokens: maxTokens,
      temperature: 0.1
    });

    const text = extractAiText(result);
    if (!text) return null;
    return parseJsonObject(text);
  } catch (error) {
    console.error('AI location verification failed:', error);
    return null;
  }
}

function extractAiText(result) {
  if (!result) return '';
  if (typeof result === 'string') return result.trim();
  if (typeof result.response === 'string') return result.response.trim();
  if (Array.isArray(result.choices) && result.choices.length > 0) {
    const first = result.choices[0];
    if (typeof first?.message?.content === 'string') return first.message.content.trim();
    if (typeof first?.text === 'string') return first.text.trim();
  }

  if (Array.isArray(result.result) && result.result.length > 0) {
    const first = result.result[0];
    if (typeof first === 'string') return first.trim();
    if (typeof first?.response === 'string') return first.response.trim();
  }

  if (typeof result.output_text === 'string') return result.output_text.trim();

  if (Array.isArray(result.output) && result.output.length > 0) {
    const text = result.output
      .map((item) => {
        if (typeof item === 'string') return item;
        if (typeof item?.text === 'string') return item.text;
        if (typeof item?.content === 'string') return item.content;
        return '';
      })
      .join('\n')
      .trim();
    if (text) return text;
  }

  return '';
}

function parseJsonObject(rawText) {
  if (!rawText) return null;

  const stripped = String(rawText)
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  try {
    return JSON.parse(stripped);
  } catch {
    // Continue to object extraction fallback.
  }

  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

async function geocodeCity(env, city, provinceCode) {
  const cityKey = normalizeCacheKey(city);
  const provinceKey = normalizeProvinceCode(provinceCode);
  const nowIso = new Date().toISOString();

  const cached = await env.DB.prepare(
    `SELECT latitude, longitude, confidence, provider, provider_raw, status
     FROM city_geocode_cache
     WHERE city = ? AND province = ? AND country = ?`
  ).bind(cityKey, provinceKey, CACHE_COUNTRY_CODE).first();

  if (cached) {
    return {
      status: cached.status || 'unknown',
      latitude: cached.latitude,
      longitude: cached.longitude,
      confidence: Number(cached.confidence) || 0,
      provider: cached.provider || `${DEFAULT_GEOCODE_PROVIDER}:cache`,
      providerRaw: cached.provider_raw || ''
    };
  }

  const fetched = await fetchGeocodeCandidate(env, city, provinceKey);

  await env.DB.prepare(
    `INSERT INTO city_geocode_cache
      (city, province, country, latitude, longitude, confidence, provider, provider_raw, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(city, province, country) DO UPDATE SET
       latitude = excluded.latitude,
       longitude = excluded.longitude,
       confidence = excluded.confidence,
       provider = excluded.provider,
       provider_raw = excluded.provider_raw,
       status = excluded.status,
       updated_at = excluded.updated_at`
  ).bind(
    cityKey,
    provinceKey,
    CACHE_COUNTRY_CODE,
    isFiniteNumber(fetched.latitude) ? Number(fetched.latitude) : null,
    isFiniteNumber(fetched.longitude) ? Number(fetched.longitude) : null,
    isFiniteNumber(fetched.confidence) ? clamp(Number(fetched.confidence), 0, 1) : null,
    fetched.provider || DEFAULT_GEOCODE_PROVIDER,
    fetched.providerRaw ? String(fetched.providerRaw).slice(0, 600) : null,
    fetched.status || 'error',
    nowIso,
    nowIso
  ).run();

  return fetched;
}

async function fetchGeocodeCandidate(env, city, provinceCode) {
  const provinceName = PROVINCE_NAME_BY_CODE[provinceCode] || provinceCode;
  const providerBase = String(env?.AI_LOCATION_GEOCODE_BASE_URL || DEFAULT_GEOCODE_BASE_URL).replace(/\/+$/, '');
  const userAgent = String(env?.AI_LOCATION_GEOCODE_USER_AGENT || DEFAULT_GEOCODE_USER_AGENT);

  const searchUrl = new URL(`${providerBase}/search`);
  searchUrl.searchParams.set('format', 'jsonv2');
  searchUrl.searchParams.set('limit', '6');
  searchUrl.searchParams.set('addressdetails', '1');
  searchUrl.searchParams.set('q', `${city}, ${provinceName}, Canada`);

  try {
    const response = await fetch(searchUrl.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': userAgent
      }
    });

    if (!response.ok) {
      return {
        status: 'geocode_http_error',
        latitude: null,
        longitude: null,
        confidence: 0,
        provider: DEFAULT_GEOCODE_PROVIDER,
        providerRaw: `HTTP ${response.status}`
      };
    }

    const payload = await response.json();
    if (!Array.isArray(payload) || payload.length === 0) {
      return {
        status: 'no_match',
        latitude: null,
        longitude: null,
        confidence: 0,
        provider: DEFAULT_GEOCODE_PROVIDER,
        providerRaw: ''
      };
    }

    const best = pickBestGeocodeMatch(payload, city, provinceCode);
    if (!best) {
      return {
        status: 'no_match',
        latitude: null,
        longitude: null,
        confidence: 0,
        provider: DEFAULT_GEOCODE_PROVIDER,
        providerRaw: ''
      };
    }

    return {
      status: 'ok',
      latitude: Number(best.lat),
      longitude: Number(best.lon),
      confidence: clamp(best.confidence, 0, 1),
      provider: DEFAULT_GEOCODE_PROVIDER,
      providerRaw: best.display_name || ''
    };
  } catch (error) {
    console.error(`Geocode lookup failed for ${city}, ${provinceCode}:`, error);
    return {
      status: 'geocode_error',
      latitude: null,
      longitude: null,
      confidence: 0,
      provider: DEFAULT_GEOCODE_PROVIDER,
      providerRaw: String(error?.message || error || '').slice(0, 200)
    };
  }
}

function pickBestGeocodeMatch(candidates, city, provinceCode) {
  const cityNorm = normalizeComparable(city);
  const provinceNameNorm = normalizeComparable(PROVINCE_NAME_BY_CODE[provinceCode] || provinceCode);

  let best = null;
  for (const candidate of candidates) {
    const score = scoreGeocodeCandidate(candidate, cityNorm, provinceNameNorm);
    if (!isFiniteNumber(candidate?.lat) || !isFiniteNumber(candidate?.lon)) continue;

    if (!best || score > best.score) {
      best = {
        ...candidate,
        score,
        confidence: Math.min(1, Math.max(0, score / 9))
      };
    }
  }

  return best;
}

function scoreGeocodeCandidate(candidate, cityNorm, provinceNameNorm) {
  let score = 0;

  const countryCode = normalizeComparable(candidate?.address?.country_code || '');
  if (countryCode === 'ca') {
    score += 4;
  }

  const stateNorm = normalizeComparable(candidate?.address?.state || '');
  if (provinceNameNorm && stateNorm.includes(provinceNameNorm)) {
    score += 3;
  }

  const displayNorm = normalizeComparable(candidate?.display_name || '');
  if (provinceNameNorm && displayNorm.includes(provinceNameNorm)) {
    score += 1;
  }

  const candidateName = normalizeComparable(
    candidate?.address?.city ||
    candidate?.address?.town ||
    candidate?.address?.village ||
    candidate?.name ||
    ''
  );
  if (candidateName && cityNorm && candidateName === cityNorm) {
    score += 2;
  } else if (candidateName && cityNorm && candidateName.includes(cityNorm)) {
    score += 1;
  }

  const type = normalizeComparable(candidate?.type || '');
  if (CITY_LIKE_TYPES.has(type)) {
    score += 1;
  }

  const importance = Number(candidate?.importance);
  if (Number.isFinite(importance)) {
    score += Math.max(0, Math.min(1.5, importance * 2));
  }

  return score;
}

function extractYearOnly(rawDate) {
  const text = String(rawDate ?? '').trim();
  if (!text) {
    return '';
  }

  const match = text.match(/\b(1[5-9]\d{2}|20\d{2}|2100)\b/);
  return match ? match[1] : '';
}

function normalizeCityName(value) {
  const normalized = normalizeText(value);
  if (!normalized) return '';

  // Strip trailing province/country fragments if present.
  const withoutRegion = normalized
    .replace(/\s*,\s*(ab|bc|mb|nb|nl|ns|nt|nu|on|pe|qc|sk|yt|canada)\s*$/i, '')
    .replace(/\s*\((ab|bc|mb|nb|nl|ns|nt|nu|on|pe|qc|sk|yt|canada)\)\s*$/i, '')
    .trim();

  if (!withoutRegion || withoutRegion.length > 120) {
    return '';
  }

  return withoutRegion;
}

function normalizeProvinceCode(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeCacheKey(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeComparable(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function looksLikeCityName(value) {
  const city = normalizeText(value);
  if (!city) return false;
  if (city.length > 120) return false;
  if (/^\d+$/.test(city)) return false;
  if (/(province|canada|unknown|n\/a|null)/i.test(city)) return false;
  return true;
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function isFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num);
}
