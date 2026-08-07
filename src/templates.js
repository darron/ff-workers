/**
 * HTML Template functions
 */

import {
  classifySourceType,
  getRecordCredibility,
  getSourceTypeLabel
} from './source-classification.js';
import {
  CANADA_MAP_VIEWBOX,
  CANADA_POPULATION_REF_DATE,
  CANADA_PROVINCE_GEOGRAPHY
} from './canada-map-data.js';
import { renderWebMcpScript } from './webmcp.js';

const PROVINCE_COLOR_RAMP = ['#d9e8f8', '#b8d3ed', '#90b8e2', '#6294cd', '#3d73af', '#1b4f82'];
const MAP_METRIC_MODES = [
  { id: 'events_per_million', label: 'Events / 1M' },
  { id: 'events_total', label: 'Events' },
  { id: 'deaths_total', label: 'Deaths' }
];
const DEFAULT_MAP_METRIC_MODE = 'events_total';
const CANADA_GEO_BOUNDS = [[41.5, -141.5], [83.5, -52.0]];
const PROVINCE_GEO_VIEWPORTS = {
  AB: { bounds: [[48.8, -120.3], [60.2, -109.8]], maxZoom: 7 },
  BC: { bounds: [[48.2, -139.2], [60.2, -114.0]], maxZoom: 7 },
  MB: { bounds: [[48.9, -102.2], [60.1, -88.6]], maxZoom: 7 },
  NB: { bounds: [[44.2, -69.3], [48.2, -63.6]], maxZoom: 8 },
  NL: { bounds: [[46.4, -67.9], [60.4, -52.5]], maxZoom: 7 },
  NS: { bounds: [[43.3, -66.5], [47.2, -59.7]], maxZoom: 8 },
  NT: { bounds: [[59.4, -136.9], [78.9, -101.0]], maxZoom: 6 },
  NU: { bounds: [[51.5, -110.0], [83.5, -60.0]], maxZoom: 5 },
  ON: { bounds: [[41.7, -95.2], [56.9, -74.2]], maxZoom: 6 },
  PE: { bounds: [[45.9, -64.7], [47.2, -61.8]], maxZoom: 9 },
  QC: { bounds: [[44.8, -79.9], [62.6, -57.0]], maxZoom: 6 },
  SK: { bounds: [[49.0, -110.1], [60.1, -101.2]], maxZoom: 7 },
  YT: { bounds: [[59.8, -141.1], [69.8, -123.8]], maxZoom: 6 }
};

export function renderHomePage(records, currentPath = '/') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mass Murder 🇨🇦</title>
    <link rel="stylesheet" href="/css/app.css">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f5f5f5;
            padding: 20px;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #c8102e;
            margin-bottom: 20px;
            font-size: 2.5em;
        }
        .note {
            background: #fff3cd;
            border-left: 4px solid #ffc107;
            padding: 12px;
            margin-bottom: 20px;
            border-radius: 4px;
        }
        .nav-buttons {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 2px solid #eee;
        }
        .nav-buttons a {
            display: inline-block;
            padding: 10px 20px;
            background: #003366;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            transition: background 0.3s;
            font-weight: 500;
        }
        .nav-buttons a:hover {
            background: #004080;
        }
        .nav-buttons a.active {
            background: #c8102e;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
        }
        thead {
            background: #003366;
            color: white;
        }
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        th {
            font-weight: 600;
            cursor: pointer;
            user-select: none;
        }
        th:hover {
            background: #004080;
        }
        tbody tr:hover {
            background: #f8f9fa;
        }
        tbody tr:nth-child(even) {
            background: #fafafa;
        }
        a {
            color: #003366;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 2px solid #eee;
            text-align: center;
            color: #666;
            font-size: 0.9em;
        }
        footer a {
            color: #003366;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Mass Murder 🇨🇦</h1>
        <div class="note">
            NOTE: Mass killings are defined as 4+ victim deaths.
        </div>
        ${renderNavButtons(currentPath)}
        <h2>Events: ${records.length}</h2>
        <table id="records-table">
            <thead>
                <tr>
                    <th onclick="sortTable(0)">Date ↑↓</th>
                    <th onclick="sortTable(1)">Name ↑↓</th>
                    <th onclick="sortTable(2)">City ↑↓</th>
                    <th onclick="sortTable(3)">Province ↑↓</th>
                    <th onclick="sortTable(4)">Licensed ↑↓</th>
                    <th onclick="sortTable(5)">Victims ↑↓</th>
                    <th onclick="sortTable(6)">Deaths ↑↓</th>
                    <th onclick="sortTable(7)">Injuries ↑↓</th>
                    <th onclick="sortTable(8)">Suicide ↑↓</th>
                    <th onclick="sortTable(9)">Firearms ↑↓</th>
                    <th onclick="sortTable(10)">OIC Impact ↑↓</th>
                </tr>
            </thead>
            <tbody>
                ${records.map(record => `
                <tr>
                    <td>${formatDateYear(record.date)}</td>
                    <td><a href="/records/${encodeURIComponent(record.id)}">${escapeHtml(record.name || '')}</a></td>
                    <td>${escapeHtml(record.city || '')}</td>
                    <td><a href="/records/provinces/${encodeURIComponent((record.province || '').toLowerCase())}">${escapeHtml(record.province || '')}</a></td>
                    <td>${formatNullableBool(record.licensed)}</td>
                    <td>${record.victims || 0}</td>
                    <td>${record.deaths || 0}</td>
                    <td>${record.injuries || 0}</td>
                    <td>${formatNullableBool(record.suicide)}</td>
                    <td>${formatNullableBool(record.firearms)}</td>
                    <td>${formatNullableBool(record.oic_impact)}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>
        ${renderFooter()}
    </div>
    <script>
        function sortTable(column) {
            const table = document.getElementById('records-table');
            let switching = true;
            let shouldSwitch;
            let switchCount = 0;
            let direction = 'asc';
            
            // Check if column contains numbers (column 0 is Date/year, columns 5, 6, 7 are Victims, Deaths, Injuries)
            const numericColumns = [0, 5, 6, 7];
            const isNumeric = numericColumns.includes(column);
            
            while (switching) {
                switching = false;
                const rows = table.rows;
                let rowToSwitch = null;
                
                for (let i = 1; i < rows.length - 1; i++) {
                    shouldSwitch = false;
                    const x = rows[i].getElementsByTagName('TD')[column];
                    const y = rows[i + 1].getElementsByTagName('TD')[column];
                    
                    if (!x || !y) continue;
                    
                    let comparison = 0;
                    
                    if (isNumeric) {
                        const xNum = parseInt(x.textContent.trim()) || 0;
                        const yNum = parseInt(y.textContent.trim()) || 0;
                        comparison = xNum - yNum;
                    } else {
                        const xText = x.textContent.trim().toLowerCase();
                        const yText = y.textContent.trim().toLowerCase();
                        if (xText > yText) comparison = 1;
                        else if (xText < yText) comparison = -1;
                    }
                    
                    if (direction === 'asc') {
                        if (comparison > 0) {
                            shouldSwitch = true;
                            rowToSwitch = i;
                            break;
                        }
                    } else {
                        if (comparison < 0) {
                            shouldSwitch = true;
                            rowToSwitch = i;
                            break;
                        }
                    }
                }
                
                if (shouldSwitch && rowToSwitch !== null) {
                    rows[rowToSwitch].parentNode.insertBefore(rows[rowToSwitch + 1], rows[rowToSwitch]);
                    switching = true;
                    switchCount++;
                } else {
                    if (switchCount === 0 && direction === 'asc') {
                        direction = 'desc';
                        switching = true;
                    }
                }
            }
        }
    </script>
</body>
</html>`;
}

export function renderCanadaMapPage(records, currentPath = '/map/canada') {
  const provinceMap = buildProvinceMapData(records);
  const clientProvinceData = {};
  for (const [code, province] of Object.entries(provinceMap.byCode)) {
    const { path, labelX, labelY, ...rest } = province;
    clientProvinceData[code] = rest;
  }
  const safeProvinceDataJson = serializeForInlineScript(clientProvinceData);

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mass Murder 🇨🇦 | Province Map</title>
    <link rel="stylesheet" href="/css/app.css">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f5f5f5;
            padding: 20px;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #c8102e;
            margin-bottom: 20px;
            font-size: 2.4em;
        }
        h1 a {
            color: #c8102e;
            text-decoration: none;
        }
        h1 a:hover {
            text-decoration: underline;
        }
        .note {
            background: #fff3cd;
            border-left: 4px solid #ffc107;
            padding: 12px;
            margin-bottom: 20px;
            border-radius: 4px;
        }
        .nav-buttons {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 2px solid #eee;
        }
        .nav-buttons a {
            display: inline-block;
            padding: 10px 20px;
            background: #003366;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            transition: background 0.3s;
            font-weight: 500;
        }
        .nav-buttons a:hover {
            background: #004080;
        }
        .nav-buttons a.active {
            background: #c8102e;
        }
        .province-map-section {
            padding: 20px;
            border: 1px solid #d9e5f2;
            border-radius: 10px;
            background: linear-gradient(180deg, #f9fbfe 0%, #f2f7fc 100%);
        }
        .province-map-title {
            color: #003366;
            margin: 0;
            font-size: 1.6em;
        }
        .province-map-subtitle {
            color: #44576d;
            margin: 8px 0 16px 0;
            font-size: 0.95em;
        }
        .province-metric-toggle {
            display: inline-flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-bottom: 14px;
        }
        .metric-toggle-btn {
            border: 1px solid #b7cade;
            background: #ffffff;
            color: #1d466e;
            border-radius: 999px;
            font-size: 0.85em;
            font-weight: 600;
            padding: 7px 12px;
            cursor: pointer;
            transition: all 0.15s ease;
        }
        .metric-toggle-btn:hover {
            border-color: #7fa3c8;
            background: #f2f7fc;
        }
        .metric-toggle-btn.active {
            background: #1b4f82;
            border-color: #1b4f82;
            color: #fff;
        }
        .province-map-grid {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 360px;
            gap: 18px;
            align-items: start;
        }
        .province-map-canvas {
            background: #fff;
            border: 1px solid #d6e2ef;
            border-radius: 10px;
            padding: 8px;
        }
        .province-map-canvas-grid {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 78px;
            gap: 8px;
            align-items: stretch;
        }
        .province-map-svg-wrap {
            min-width: 0;
        }
        .province-map-canvas svg {
            width: 100%;
            height: auto;
            display: block;
        }
        .province-shape {
            stroke: #f8f9fb;
            stroke-width: 1.25;
            vector-effect: non-scaling-stroke;
            transition: stroke 0.15s ease, opacity 0.15s ease;
        }
        .province-link:hover .province-shape,
        .province-link:focus .province-shape {
            stroke: #003366;
            stroke-width: 2.1;
        }
        .province-shape.province-active {
            stroke: #c8102e;
            stroke-width: 2.3;
        }
        .province-label {
            pointer-events: none;
            font-size: 13px;
            font-weight: 700;
            text-anchor: middle;
            dominant-baseline: middle;
            user-select: none;
        }
        .province-quicklist {
            border-left: 1px solid #e2eaf3;
            padding-left: 8px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            max-height: 100%;
            overflow-y: auto;
        }
        .province-list-item {
            display: flex;
            align-items: center;
            justify-content: center;
            border: 1px solid #d7e3f0;
            border-radius: 6px;
            padding: 3px 4px;
            background: #fff;
            color: #1b3f63;
            text-decoration: none;
            line-height: 1;
            min-height: 24px;
        }
        .province-list-item:hover,
        .province-list-item:focus {
            border-color: #7ea3c8;
            background: #f0f6fc;
            text-decoration: none;
        }
        .province-list-item.active {
            border-color: #c8102e;
            box-shadow: inset 0 0 0 1px rgba(200,16,46,0.3);
            background: #fff6f7;
        }
        .province-list-code {
            font-size: 0.78em;
            font-weight: 700;
            color: #1f4f7a;
            text-align: center;
            letter-spacing: 0.02em;
        }
        .province-legend {
            margin-top: 10px;
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 0.85em;
            color: #44576d;
        }
        .province-legend-ramp {
            display: grid;
            grid-template-columns: repeat(6, minmax(0, 1fr));
            width: 170px;
            border: 1px solid #c8d7e8;
            border-radius: 999px;
            overflow: hidden;
        }
        .province-legend-ramp span {
            display: block;
            height: 10px;
        }
        .province-detail {
            background: #fff;
            border: 1px solid #d6e2ef;
            border-radius: 10px;
            padding: 14px;
            height: 520px;
            display: flex;
            flex-direction: column;
        }
        .province-detail-content {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            padding-right: 6px;
        }
        .province-detail h3 {
            color: #003366;
            margin: 0;
            font-size: 1.2em;
            line-height: 1.25;
        }
        .province-detail-meta {
            margin-top: 10px;
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 8px;
        }
        .province-detail-metric {
            background: #f4f8fc;
            border-radius: 6px;
            padding: 8px;
            border: 1px solid #e2ebf5;
        }
        .province-detail-metric strong {
            display: block;
            color: #003366;
            font-size: 1.05em;
            line-height: 1.2;
        }
        .province-detail-metric span {
            color: #56667b;
            font-size: 0.8em;
        }
        .province-detail-body {
            margin-top: 10px;
        }
        .province-detail h4 {
            margin: 0 0 8px 0;
            color: #003366;
            font-size: 0.95em;
        }
        .province-detail-list {
            margin: 0;
            padding-left: 18px;
            font-size: 0.9em;
        }
        .province-detail-list li {
            margin-bottom: 8px;
        }
        .province-detail-list li span {
            display: block;
            color: #556476;
            font-size: 0.9em;
        }
        .province-detail-empty {
            margin-top: 2px;
            color: #556476;
            font-size: 0.9em;
        }
        .province-detail-link {
            margin-top: 12px;
            font-size: 0.9em;
            font-weight: 600;
        }
        .province-population-note {
            margin-top: 8px;
            color: #556476;
            font-size: 0.8em;
        }
        .province-map-unmapped {
            margin-top: 8px;
            color: #556476;
            font-size: 0.85em;
        }
        .province-zoom-shell {
            margin-top: 14px;
            background: #fff;
            border: 1px solid #d6e2ef;
            border-radius: 10px;
            padding: 12px;
        }
        .province-zoom-header {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            gap: 8px;
            margin-bottom: 8px;
        }
        .province-zoom-title {
            color: #003366;
            font-size: 1.02em;
            font-weight: 700;
            margin: 0;
        }
        .province-zoom-caption {
            color: #556476;
            font-size: 0.82em;
        }
        .province-zoom-map {
            height: 560px;
            border: 1px solid #d6e2ef;
            border-radius: 8px;
            overflow: hidden;
            background: #f1f6fb;
        }
        .province-zoom-map .leaflet-control-attribution {
            font-size: 10px;
        }
        .province-zoom-status {
            margin-top: 6px;
            min-height: 1.2em;
            color: #556476;
            font-size: 0.78em;
        }
        a {
            color: #003366;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 2px solid #eee;
            text-align: center;
            color: #666;
            font-size: 0.9em;
        }
        footer a {
            color: #003366;
        }
        @media (max-width: 1120px) {
            .province-map-grid {
                grid-template-columns: 1fr;
            }
            .province-map-canvas-grid {
                grid-template-columns: minmax(0, 1fr);
            }
            .province-quicklist {
                border-left: none;
                border-top: 1px solid #e2eaf3;
                padding-left: 0;
                padding-top: 10px;
                display: grid;
                grid-template-columns: repeat(5, minmax(0, 1fr));
            }
            .province-detail {
                height: 500px;
            }
            .province-zoom-map {
                height: 460px;
            }
        }
        @media (max-width: 640px) {
            .province-quicklist {
                grid-template-columns: repeat(4, minmax(0, 1fr));
            }
            .province-detail-meta {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
            .province-label {
                font-size: 11px;
            }
            .province-zoom-map {
                height: 360px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1><a href="/">Mass Murder 🇨🇦</a></h1>
        <div class="note">
            NOTE: Mass killings are defined as 4+ victim deaths.
        </div>
        ${renderNavButtons(currentPath)}
        ${renderProvinceMapSection(provinceMap)}
        ${renderFooter()}
    </div>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
    <script>
        const provinceData = ${safeProvinceDataJson};
        const metricExtents = ${serializeForInlineScript(provinceMap.metricExtents)};
        const provinceGeoViewports = ${serializeForInlineScript(PROVINCE_GEO_VIEWPORTS)};
        const canadaGeoBounds = ${serializeForInlineScript(CANADA_GEO_BOUNDS)};
        const defaultMetricMode = '${DEFAULT_MAP_METRIC_MODE}';
        const defaultProvinceCode = '${provinceMap.defaultProvinceCode}';
        const populationRefDate = '${CANADA_POPULATION_REF_DATE}';
        const provinceDetailContent = document.getElementById('province-detail-content');
        const provinceZoomMapHost = document.getElementById('province-zoom-map');
        const provinceZoomStatus = document.getElementById('province-zoom-status');
        const provinceQuickList = document.querySelector('.province-quicklist');
        const mapProvinceLinks = Array.from(document.querySelectorAll('a.province-link[data-province-code]'));
        const listProvinceLinks = Array.from(document.querySelectorAll('[data-province-list][data-province-code]'));
        const metricButtons = Array.from(document.querySelectorAll('[data-metric-mode]'));
        const legendLow = document.getElementById('province-legend-low');
        const legendHigh = document.getElementById('province-legend-high');
        let activeMetricMode = defaultMetricMode;
        let currentProvinceCode = defaultProvinceCode;
        let selectedProvinceCode = defaultProvinceCode;
        let provinceGeoMap = null;
        let provinceGeoLayer = null;

        function escapeText(value) {
            if (value === null || value === undefined) return '';
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        function setActiveProvince(code) {
            mapProvinceLinks.forEach((link) => {
                const shape = link.querySelector('.province-shape');
                if (!shape) return;
                const linkCode = link.getAttribute('data-province-code');
                shape.classList.toggle('province-active', linkCode === code);
            });
            listProvinceLinks.forEach((link) => {
                const linkCode = link.getAttribute('data-province-code');
                link.classList.toggle('active', linkCode === code);
            });
        }

        function formatInt(value) {
            return Number(value || 0).toLocaleString('en-CA');
        }

        function applyMetricMode(mode) {
            activeMetricMode = mode;

            mapProvinceLinks.forEach((link) => {
                const code = link.getAttribute('data-province-code');
                const province = provinceData[code];
                if (!province || !province.metrics[mode]) return;
                const m = province.metrics[mode];
                const shape = link.querySelector('.province-shape');
                const label = link.querySelector('.province-label');
                const title = link.querySelector('title');
                if (shape) shape.setAttribute('fill', m.fill);
                if (label) label.setAttribute('fill', m.labelColor);
                if (title) title.textContent = m.title;
            });

            metricButtons.forEach((button) => {
                const modeId = button.getAttribute('data-metric-mode');
                button.classList.toggle('active', modeId === mode);
            });

            const ext = metricExtents[mode];
            if (ext && legendLow) {
                legendLow.textContent = 'Low (' + ext.formattedMin + ext.suffix + ')';
            }
            if (ext && legendHigh) {
                legendHigh.textContent = 'High (' + ext.formattedMax + ext.suffix + ')';
            }

            renderProvinceDetail(currentProvinceCode);
        }

        function renderProvinceDetail(code, persistSelection = false) {
            if (!provinceDetailContent) return;

            const province = provinceData[code] || provinceData[defaultProvinceCode];
            if (!province) return;
            currentProvinceCode = province.code;
            if (persistSelection) {
                selectedProvinceCode = province.code;
            }

            const records = Array.isArray(province.records) ? province.records : [];
            const recordsHtml = records.length > 0
                ? '<ul class="province-detail-list">' + records.map((record) => {
                    const recordHref = '/records/' + encodeURIComponent(record.id || '');
                    const name = escapeText(record.name || '');
                    const year = escapeText(record.year || '');
                    const city = escapeText(record.city || '');
                    const deaths = Number(record.deaths) || 0;
                    const victims = Number(record.victims) || 0;
                    return '<li><a href="' + recordHref + '">' + year + ' - ' + name + '</a><span>' + city + ' · deaths ' + deaths + ', victims ' + victims + '</span></li>';
                  }).join('') + '</ul>'
                : '<p class="province-detail-empty">No events in the current filter.</p>';

            const provinceHref = '/records/provinces/' + encodeURIComponent(String(province.code || '').toLowerCase());
            const population = Number(province.population) || 0;
            const m = province.metrics[activeMetricMode] || {};
            const mappedEvents = Number(province.mappedEvents) || 0;

            provinceDetailContent.innerHTML =
                '<h3>' + escapeText(province.name) + ' (' + escapeText(province.code) + ')</h3>' +
                '<div class="province-detail-meta">' +
                    '<div class="province-detail-metric"><strong>' + (Number(province.events) || 0) + '</strong><span>Events</span></div>' +
                    '<div class="province-detail-metric"><strong>' + (m.formatted || '0') + '</strong><span>' + escapeText(m.label || '') + '</span></div>' +
                    '<div class="province-detail-metric"><strong>' + (Number(province.deaths) || 0) + '</strong><span>Deaths</span></div>' +
                    '<div class="province-detail-metric"><strong>' + (Number(province.victims) || 0) + '</strong><span>Victims</span></div>' +
                '</div>' +
                '<p class="province-population-note">Population estimate: ' + formatInt(population) + ' (' + populationRefDate + ')</p>' +
                '<p class="province-population-note">Mapped coordinates: ' + mappedEvents + ' / ' + (Number(province.events) || 0) + ' events</p>' +
                '<div class="province-detail-body">' +
                    '<h4>Recent events</h4>' +
                    recordsHtml +
                '</div>' +
                '<p class="province-detail-link"><a href="' + provinceHref + '">Open all events for ' + escapeText(province.code) + '</a></p>';

            setActiveProvince(province.code);
            renderProvinceGeoMap(province);
        }

        function setProvinceZoomStatus(message) {
            if (!provinceZoomStatus) return;
            provinceZoomStatus.textContent = message || '';
        }

        function getProvinceViewport(code) {
            return provinceGeoViewports[String(code || '').toUpperCase()] || null;
        }

        function initProvinceGeoMap() {
            if (!provinceZoomMapHost) {
                return false;
            }
            if (provinceGeoMap) {
                return true;
            }
            if (!window.L) {
                setProvinceZoomStatus('Interactive map library failed to load.');
                return false;
            }

            provinceGeoMap = window.L.map(provinceZoomMapHost, {
                zoomControl: true,
                attributionControl: true,
                minZoom: 3,
                maxZoom: 11
            });
            window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 11,
                attribution: '&copy; OpenStreetMap contributors'
            }).addTo(provinceGeoMap);
            provinceGeoLayer = window.L.layerGroup().addTo(provinceGeoMap);

            const canadaBounds = window.L.latLngBounds(canadaGeoBounds);
            if (canadaBounds.isValid()) {
                provinceGeoMap.fitBounds(canadaBounds, {
                    padding: [18, 18],
                    animate: false
                });
            }

            return true;
        }

        function getMarkerRadius(point) {
            const deaths = Number(point?.deaths) || 0;
            if (deaths <= 0) return 5;
            return Math.max(5, Math.min(12, 4 + Math.sqrt(deaths) * 1.6));
        }

        function renderProvinceGeoMap(province) {
            if (!province || !initProvinceGeoMap() || !provinceGeoLayer || !window.L) {
                return;
            }

            provinceGeoMap.invalidateSize(false);
            provinceGeoLayer.clearLayers();

            const viewport = getProvinceViewport(province.code);
            const points = Array.isArray(province.mapRecords) ? province.mapRecords : [];

            if (viewport && Array.isArray(viewport.bounds)) {
                const provinceBounds = window.L.latLngBounds(viewport.bounds);
                if (provinceBounds.isValid()) {
                    provinceGeoMap.fitBounds(provinceBounds, {
                        padding: [18, 18],
                        maxZoom: Number(viewport.maxZoom) || 8
                    });
                }
            }

            if (points.length === 0) {
                setProvinceZoomStatus('No verified city coordinates in this province yet.');
                return;
            }

            points.forEach((point) => {
                const lat = Number(point?.lat);
                const lon = Number(point?.lon);
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

                const marker = window.L.circleMarker([lat, lon], {
                    radius: getMarkerRadius(point),
                    color: '#8f1930',
                    weight: 1.1,
                    fillColor: '#c8102e',
                    fillOpacity: 0.76
                });

                const recordUrl = '/records/' + encodeURIComponent(String(point.id || ''));
                const popupHtml =
                    '<strong>' + escapeText(point.year || '') + ' - ' + escapeText(point.name || '') + '</strong><br>' +
                    escapeText(point.city || '') + '<br>' +
                    'Deaths: ' + (Number(point.deaths) || 0) + ', Victims: ' + (Number(point.victims) || 0) + '<br>' +
                    '<a href="' + recordUrl + '">Open record</a>';

                marker.bindPopup(popupHtml);
                marker.addTo(provinceGeoLayer);
            });

            setProvinceZoomStatus(
                'Showing ' + points.length + ' event marker' + (points.length === 1 ? '' : 's') + '. Drag and zoom for detail.'
            );
        }

        if (provinceDetailContent && mapProvinceLinks.length > 0) {
            applyMetricMode(defaultMetricMode);

            const interactiveLinks = mapProvinceLinks.concat(listProvinceLinks);
            interactiveLinks.forEach((link) => {
                const code = link.getAttribute('data-province-code');
                if (!code) return;
                link.addEventListener('mouseenter', () => renderProvinceDetail(code, false));
                link.addEventListener('focus', () => renderProvinceDetail(code, false));
                link.addEventListener('click', (event) => {
                    event.preventDefault();
                    renderProvinceDetail(code, true);
                });
            });

            metricButtons.forEach((button) => {
                button.addEventListener('click', () => {
                    const mode = button.getAttribute('data-metric-mode');
                    if (!mode) return;
                    applyMetricMode(mode);
                });
            });

            const mapSvg = document.getElementById('canada-province-map');
            if (mapSvg) {
                mapSvg.addEventListener('mouseleave', () => renderProvinceDetail(selectedProvinceCode, false));
            }
            if (provinceQuickList) {
                provinceQuickList.addEventListener('mouseleave', () => renderProvinceDetail(selectedProvinceCode, false));
            }
        }
    </script>
</body>
</html>`;
}

export function buildProvinceMapData(records) {
  const byCode = {};
  let unmappedCount = 0;

  for (const province of CANADA_PROVINCE_GEOGRAPHY) {
    byCode[province.code] = {
      code: province.code,
      name: province.name,
      path: province.path,
      labelX: province.labelX,
      labelY: province.labelY,
      population: province.population,
      events: 0,
      eventsPerMillion: 0,
      victims: 0,
      deaths: 0,
      records: [],
      mappedEvents: 0,
      mapRecords: []
    };
  }

  for (const record of records) {
    const provinceCode = String(record.province || '').toUpperCase();
    const province = byCode[provinceCode];
    if (!province) {
      if (provinceCode) {
        unmappedCount += 1;
      }
      continue;
    }

    const victims = Number(record.victims) || 0;
    const deaths = Number(record.deaths) || 0;
    const parsedDate = new Date(record.date || '');
    const sortDate = Number.isFinite(parsedDate.getTime()) ? parsedDate.getTime() : 0;

    province.events += 1;
    province.victims += victims;
    province.deaths += deaths;
    const displayCity = String(record.city_verified || record.city || '');
    province.records.push({
      id: String(record.id || ''),
      year: formatDateYear(record.date),
      name: String(record.name || ''),
      city: displayCity,
      victims,
      deaths,
      sortDate
    });

    const latitude = toFiniteNumber(record.location_lat);
    const longitude = toFiniteNumber(record.location_lon);
    if (hasUsableCoordinate(latitude, longitude)) {
      province.mappedEvents += 1;
      province.mapRecords.push({
        id: String(record.id || ''),
        year: formatDateYear(record.date),
        name: String(record.name || ''),
        city: displayCity,
        victims,
        deaths,
        lat: Number(latitude.toFixed(6)),
        lon: Number(longitude.toFixed(6)),
        sortDate
      });
    }
  }

  for (const province of Object.values(byCode)) {
    province.records.sort((a, b) => {
      if (b.sortDate !== a.sortDate) return b.sortDate - a.sortDate;
      if (b.deaths !== a.deaths) return b.deaths - a.deaths;
      return b.victims - a.victims;
    });
    province.mapRecords.sort((a, b) => {
      if (b.sortDate !== a.sortDate) return b.sortDate - a.sortDate;
      if (b.deaths !== a.deaths) return b.deaths - a.deaths;
      return b.victims - a.victims;
    });
    province.records = province.records.slice(0, 5).map(({ sortDate, ...record }) => record);
    province.mapRecords = province.mapRecords.map(({ sortDate, ...record }) => record);
    province.eventsPerMillion = province.population > 0
      ? (province.events / province.population) * 1000000
      : 0;
  }

  const metricExtents = getMetricExtents(byCode);

  for (const mode of MAP_METRIC_MODES) {
    const ext = metricExtents[mode.id];
    ext.formattedMax = formatMetricValue(ext.max, mode.id);
    ext.formattedMin = ext.max > 0 ? formatMetricValue(ext.minPositive, mode.id) : '0';
    ext.suffix = formatLegendSuffix(mode.id);
  }

  for (const province of Object.values(byCode)) {
    province.metrics = {};
    for (const mode of MAP_METRIC_MODES) {
      const metricValue = getProvinceMetricValue(province, mode.id);
      const maxValue = metricExtents[mode.id].max;
      province.metrics[mode.id] = {
        value: metricValue,
        fill: getProvinceFillColor(metricValue, maxValue),
        labelColor: getProvinceLabelColor(metricValue, maxValue),
        formatted: formatMetricValue(metricValue, mode.id),
        label: getMetricLabel(mode.id),
        title: `${province.name}: ${province.events} events, ${province.deaths} deaths, ${province.victims} victims (${getMetricLabel(mode.id)}: ${formatMetricValue(metricValue, mode.id)}${formatLegendSuffix(mode.id)})`
      };
    }
  }

  let topProvinceCode = CANADA_PROVINCE_GEOGRAPHY[0]?.code || 'ON';

  for (const province of Object.values(byCode)) {
    const currentTop = byCode[topProvinceCode];
    if (
      getProvinceMetricValue(province, DEFAULT_MAP_METRIC_MODE) > getProvinceMetricValue(currentTop, DEFAULT_MAP_METRIC_MODE) ||
      (
        getProvinceMetricValue(province, DEFAULT_MAP_METRIC_MODE) === getProvinceMetricValue(currentTop, DEFAULT_MAP_METRIC_MODE) &&
        (
          province.events > currentTop.events ||
          (province.events === currentTop.events && province.deaths > currentTop.deaths)
        )
      )
    ) {
      topProvinceCode = province.code;
    }
  }

  return {
    byCode,
    metricExtents,
    unmappedCount,
    defaultProvinceCode: topProvinceCode
  };
}

function renderProvinceMapSection(provinceMap) {
  const defaultProvince = provinceMap.byCode[provinceMap.defaultProvinceCode];
  const metricExtent = provinceMap.metricExtents[DEFAULT_MAP_METRIC_MODE];
  const legendMin = metricExtent.max > 0 ? formatMetricValue(metricExtent.minPositive, DEFAULT_MAP_METRIC_MODE) : '0';
  const legendMax = formatMetricValue(metricExtent.max, DEFAULT_MAP_METRIC_MODE);

  return `
    <section class="province-map-section" aria-labelledby="province-map-title">
        <h2 id="province-map-title" class="province-map-title">Canada by Province</h2>
        <p class="province-map-subtitle">Color intensity follows the selected metric. Hover provinces to preview details. Click a province to open all matching events.</p>
        <div class="province-metric-toggle" role="group" aria-label="Map metric">
            ${MAP_METRIC_MODES.map((mode) => `
              <button type="button" class="metric-toggle-btn ${mode.id === DEFAULT_MAP_METRIC_MODE ? 'active' : ''}" data-metric-mode="${mode.id}">
                ${escapeHtml(mode.label)}
              </button>
            `).join('')}
        </div>
        <div class="province-map-grid">
            <div>
                <div class="province-map-canvas">
                    <div class="province-map-canvas-grid">
                        <div class="province-map-svg-wrap">
                            <svg id="canada-province-map" viewBox="0 0 ${CANADA_MAP_VIEWBOX.width} ${CANADA_MAP_VIEWBOX.height}" role="img" aria-label="Map of Canadian provinces by selected metric">
                                ${CANADA_PROVINCE_GEOGRAPHY.map((province) =>
                                  renderProvinceMapTile(
                                    province,
                                    provinceMap.byCode[province.code],
                                    metricExtent.max,
                                    DEFAULT_MAP_METRIC_MODE,
                                    province.code === provinceMap.defaultProvinceCode
                                  )
                                ).join('')}
                            </svg>
                        </div>
                        <div class="province-quicklist" aria-label="Province list">
                            ${renderProvinceQuickList(provinceMap)}
                        </div>
                    </div>
                </div>
                <div class="province-legend">
                    <span id="province-legend-low">Low (${legendMin}${formatLegendSuffix(DEFAULT_MAP_METRIC_MODE)})</span>
                    <span class="province-legend-ramp">
                        ${PROVINCE_COLOR_RAMP.map((color) => `<span style="background:${color};"></span>`).join('')}
                    </span>
                    <span id="province-legend-high">High (${legendMax}${formatLegendSuffix(DEFAULT_MAP_METRIC_MODE)})</span>
                </div>
                ${provinceMap.unmappedCount > 0
                  ? `<p class="province-map-unmapped">${provinceMap.unmappedCount} event(s) are outside mapped provinces (for example USA).</p>`
                  : ''}
            </div>
            <aside id="province-detail" class="province-detail">
                <div id="province-detail-content" class="province-detail-content">
                    ${renderProvinceDetailPanel(defaultProvince)}
                </div>
            </aside>
        </div>
        <div class="province-zoom-shell">
            <div class="province-zoom-header">
                <p class="province-zoom-title">City-Level Event Map</p>
                <span class="province-zoom-caption">Click a province above to lock selection</span>
            </div>
            <div id="province-zoom-map" class="province-zoom-map" aria-label="Zoomable province map showing event coordinates"></div>
            <p id="province-zoom-status" class="province-zoom-status"></p>
        </div>
    </section>
  `;
}

function renderProvinceMapTile(layout, provinceData, maxMetricValue, metricMode, isActive = false) {
  const metricValue = getProvinceMetricValue(provinceData, metricMode);
  const metricLabel = getMetricLabel(metricMode);
  const fill = getProvinceFillColor(metricValue, maxMetricValue);
  const labelColor = getProvinceLabelColor(metricValue, maxMetricValue);
  const title = `${provinceData.name}: ${provinceData.events} events, ${provinceData.deaths} deaths, ${provinceData.victims} victims (${metricLabel}: ${formatMetricValue(metricValue, metricMode)}${formatLegendSuffix(metricMode)})`;
  const href = `/records/provinces/${encodeURIComponent(layout.code.toLowerCase())}`;

  return `
    <a href="${href}" class="province-link" data-province-code="${layout.code}" aria-label="${escapeHtml(title)}">
        <title>${escapeHtml(title)}</title>
        <path class="province-shape${isActive ? ' province-active' : ''}" d="${layout.path}" fill="${fill}"></path>
        <text class="province-label" x="${layout.labelX}" y="${layout.labelY}" fill="${labelColor}">${layout.code}</text>
    </a>
  `;
}

function renderProvinceQuickList(provinceMap) {
  const sortedProvinces = Object.values(provinceMap.byCode).sort((a, b) => a.name.localeCompare(b.name));

  return sortedProvinces.map((province) => {
    const href = `/records/provinces/${encodeURIComponent(province.code.toLowerCase())}`;
    const isActive = province.code === provinceMap.defaultProvinceCode;
    return `
      <a href="${href}" class="province-list-item${isActive ? ' active' : ''}" data-province-code="${province.code}" data-province-list="1">
        <span class="province-list-code">${escapeHtml(province.code)}</span>
      </a>
    `;
  }).join('');
}

function renderProvinceDetailPanel(province) {
  if (!province) {
    return '<p class="province-detail-empty">Hover a province to view totals and recent event links.</p>';
  }
  const mapMetricValue = getProvinceMetricValue(province, DEFAULT_MAP_METRIC_MODE);

  const recentEventsMarkup = province.records.length > 0
    ? `<ul class="province-detail-list">
        ${province.records.map((record) => `
          <li>
            <a href="/records/${encodeURIComponent(record.id)}">${escapeHtml(record.year)} - ${escapeHtml(record.name)}</a>
            <span>${escapeHtml(record.city)} · deaths ${record.deaths}, victims ${record.victims}</span>
          </li>
        `).join('')}
      </ul>`
    : '<p class="province-detail-empty">No events in the current filter.</p>';

  return `
    <h3>${escapeHtml(province.name)} (${escapeHtml(province.code)})</h3>
    <div class="province-detail-meta">
        <div class="province-detail-metric"><strong>${province.events}</strong><span>Events</span></div>
        <div class="province-detail-metric"><strong>${formatMetricValue(mapMetricValue, DEFAULT_MAP_METRIC_MODE)}</strong><span>${escapeHtml(getMetricLabel(DEFAULT_MAP_METRIC_MODE))}</span></div>
        <div class="province-detail-metric"><strong>${province.deaths}</strong><span>Deaths</span></div>
        <div class="province-detail-metric"><strong>${province.victims}</strong><span>Victims</span></div>
    </div>
    <p class="province-population-note">Population estimate: ${formatNumber(province.population)} (${escapeHtml(CANADA_POPULATION_REF_DATE)})</p>
    <p class="province-population-note">Mapped coordinates: ${formatNumber(province.mappedEvents)} / ${formatNumber(province.events)} events</p>
    <div class="province-detail-body">
        <h4>Recent events</h4>
        ${recentEventsMarkup}
    </div>
    <p class="province-detail-link"><a href="/records/provinces/${encodeURIComponent(province.code.toLowerCase())}">Open all events for ${escapeHtml(province.code)}</a></p>
  `;
}

function getProvinceFillColor(metricValue, maxMetricValue) {
  if (metricValue <= 0 || maxMetricValue <= 0) {
    return '#e8eef6';
  }

  const ratio = metricValue / maxMetricValue;
  const rampIndex = Math.max(0, Math.min(
    PROVINCE_COLOR_RAMP.length - 1,
    Math.ceil(ratio * PROVINCE_COLOR_RAMP.length) - 1
  ));
  return PROVINCE_COLOR_RAMP[rampIndex];
}

function getProvinceLabelColor(metricValue, maxMetricValue) {
  if (metricValue <= 0 || maxMetricValue <= 0) {
    return '#41556e';
  }

  return (metricValue / maxMetricValue) >= 0.5 ? '#ffffff' : '#1d3d63';
}

function getProvinceMetricValue(province, metricMode) {
  switch (metricMode) {
    case 'events_total':
      return Number(province.events) || 0;
    case 'deaths_total':
      return Number(province.deaths) || 0;
    case 'events_per_million':
    default:
      return Number(province.eventsPerMillion) || 0;
  }
}

function getMetricLabel(metricMode) {
  switch (metricMode) {
    case 'events_total':
      return 'Events';
    case 'deaths_total':
      return 'Deaths';
    case 'events_per_million':
    default:
      return 'Events / 1M';
  }
}

function formatLegendSuffix(metricMode) {
  return metricMode === 'events_per_million' ? '/1M' : '';
}

function formatMetricValue(value, metricMode) {
  const numeric = Number(value) || 0;
  if (metricMode === 'events_per_million') {
    if (numeric >= 10) return numeric.toFixed(2);
    if (numeric >= 1) return numeric.toFixed(3);
    return numeric.toFixed(4);
  }
  return formatNumber(numeric);
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasUsableCoordinate(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return false;
  }
  if (Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001) {
    return false;
  }
  return (
    lat >= 40 &&
    lat <= 85 &&
    lon >= -145 &&
    lon <= -50
  );
}

function getMetricExtents(byCode) {
  const extents = {};
  for (const mode of MAP_METRIC_MODES) {
    let max = 0;
    let minPositive = Number.POSITIVE_INFINITY;
    for (const province of Object.values(byCode)) {
      const metricValue = getProvinceMetricValue(province, mode.id);
      if (metricValue > max) {
        max = metricValue;
      }
      if (metricValue > 0 && metricValue < minPositive) {
        minPositive = metricValue;
      }
    }
    extents[mode.id] = {
      max,
      minPositive: Number.isFinite(minPositive) ? minPositive : 0
    };
  }
  return extents;
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-CA').format(Number(value) || 0);
}

function serializeForInlineScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function renderRecordPage(record, currentPath = '/') {
  if (!record) {
    return '<html><body><h1>Record not found</h1></body></html>';
  }
  const newsStories = record.newsStories || [];
  const credibility = getRecordCredibility(newsStories);

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🇨🇦 Murders: ${escapeHtml(record.name || '')} in ${escapeHtml(record.city || '')} in ${formatDateYear(record.date)}</title>
    <link rel="stylesheet" href="/css/app.css">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f5f5f5;
            padding: 20px;
        }
        .container {
            max-width: 1000px;
            margin: 0 auto;
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #c8102e;
            margin-bottom: 20px;
        }
        h1 a {
            color: #c8102e;
            text-decoration: none;
        }
        h1 a:hover {
            text-decoration: underline;
        }
        h2 {
            color: #003366;
            margin: 30px 0 20px 0;
            font-size: 1.8em;
        }
        h3 {
            color: #003366;
            margin: 25px 0 15px 0;
            font-size: 1.3em;
        }
        .note {
            background: #fff3cd;
            border-left: 4px solid #ffc107;
            padding: 12px;
            margin-bottom: 20px;
            border-radius: 4px;
        }
        .nav-buttons {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 2px solid #eee;
        }
        .nav-buttons a {
            display: inline-block;
            padding: 10px 20px;
            background: #003366;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            transition: background 0.3s;
            font-weight: 500;
        }
        .nav-buttons a:hover {
            background: #004080;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
        }
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        th {
            background: #003366;
            color: white;
            font-weight: 600;
        }
        tbody tr:nth-child(even) {
            background: #fafafa;
        }
        p {
            margin: 15px 0;
            line-height: 1.8;
        }
        .news-story {
            margin: 20px 0;
            padding: 15px;
            background: #f8f9fa;
            border-left: 4px solid #003366;
            border-radius: 4px;
        }
        .news-story-meta {
            margin-top: 8px;
        }
        .source-badge {
            display: inline-block;
            padding: 2px 8px;
            font-size: 0.8em;
            font-weight: 600;
            border-radius: 999px;
            margin-right: 8px;
        }
        .source-news, .source-official {
            background: #d1ecf1;
            color: #0c5460;
        }
        .source-social {
            background: #f8d7da;
            color: #721c24;
        }
        .source-other {
            background: #e2e3e5;
            color: #383d41;
        }
        .news-story a {
            color: #003366;
            font-weight: 600;
            word-break: break-all;
        }
        .news-story-text {
            margin-top: 10px;
            color: #555;
        }
        .ai-summary-box {
            margin: 20px 0;
            padding: 16px;
            background: #eef6ff;
            border-left: 4px solid #0b5ed7;
            border-radius: 4px;
        }
        .ai-summary-box h4 {
            margin: 0 0 8px 0;
            color: #003366;
        }
        .ai-summary-text {
            color: #1f2937;
        }
        .ai-summary-text p {
            margin: 10px 0;
        }
        .ai-summary-text ul, .ai-summary-text ol {
            margin: 10px 0 10px 22px;
        }
        .ai-summary-text li {
            margin: 4px 0;
        }
        .ai-summary-text h4 {
            margin: 14px 0 8px 0;
            color: #0b3b73;
            font-size: 1em;
        }
        .credibility-note {
            margin: 18px 0;
            padding: 12px;
            border-left: 4px solid #6c757d;
            background: #f1f3f5;
            border-radius: 4px;
        }
        .credibility-note.alleged {
            border-left-color: #dc3545;
            background: #fff5f5;
        }
        a {
            color: #003366;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 2px solid #eee;
            text-align: center;
            color: #666;
            font-size: 0.9em;
        }
        footer a {
            color: #003366;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1><a href="/">Mass Murder 🇨🇦</a></h1>
        <div class="note">
            NOTE: Mass killings are defined as 4+ victim deaths.
        </div>
        ${renderNavButtons(currentPath)}
        <h2>${escapeHtml(record.name || '')} in ${escapeHtml(record.city || '')} in ${formatDateYear(record.date)}</h2>
        <table>
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Name</th>
                    <th>City</th>
                    <th>Province</th>
                    <th>Licensed</th>
                    <th>Victims</th>
                    <th>Deaths</th>
                    <th>Injuries</th>
                    <th>Suicide</th>
                    <th>Firearms</th>
                    <th>OIC Impact</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>${formatDateYear(record.date)}</td>
                    <td>${escapeHtml(record.name || '')}</td>
                    <td>${escapeHtml(record.city || '')}</td>
                    <td><a href="/records/provinces/${encodeURIComponent((record.province || '').toLowerCase())}">${escapeHtml(record.province || '')}</a></td>
                    <td>${formatNullableBool(record.licensed)}</td>
                    <td>${record.victims || 0}</td>
                    <td>${record.deaths || 0}</td>
                    <td>${record.injuries || 0}</td>
                    <td>${formatNullableBool(record.suicide)}</td>
                    <td>${formatNullableBool(record.firearms)}</td>
                    <td>${formatNullableBool(record.oic_impact)}</td>
                </tr>
            </tbody>
        </table>

        ${record.devices_used ? `<h3>Used</h3><p>${escapeHtml(record.devices_used)}</p>` : ''}
        
        ${record.warnings ? `<h3>Warnings</h3><p>${escapeHtml(record.warnings)}</p>` : ''}

        ${record.ai_summary ? `
        <h3>AI Synthesis</h3>
        <div class="ai-summary-box">
            <h4>Generated summary</h4>
            <div class="ai-summary-text">${renderMarkdown(record.ai_summary || '')}</div>
        </div>
        ` : ''}

        ${newsStories.length > 0 ? `
        <div class="credibility-note ${credibility.socialOnly ? 'alleged' : ''}">
            ${escapeHtml(formatCredibilitySummary(credibility))}
        </div>
        <h3>News Stories</h3>
        ${newsStories.map(story => `
        <div class="news-story">
            <div class="news-story-meta">
              ${renderSourceBadge(story.url)}
            </div>
            <div><a href="${escapeHtml(story.url || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(story.url || '')}</a></div>
            ${story.ai_summary ? `<div class="news-story-text ai-summary-text">${renderMarkdown(story.ai_summary || '')}</div>` : ''}
        </div>
        `).join('')}
        ` : ''}
        
        ${renderFooter()}
    </div>
</body>
</html>`;
}

function renderNavButtons(currentPath = '/') {
  const isActive = (href) => {
    // For home page, match exactly
    if (href === '/' && currentPath === '/') return true;
    
    // For group routes, match exactly (not with startsWith to avoid matching /mass with /massfirearms)
    if (href.startsWith('/records/group/')) {
      return currentPath === href || currentPath === href + '/';
    }
    
    // For other paths, use startsWith (shouldn't have conflicts)
    if (href !== '/' && currentPath.startsWith(href)) return true;
    return false;
  };
  
  return `
    <div class="nav-buttons">
        <a href="/" ${isActive('/') ? 'class="active"' : ''}>Home</a>
        <a href="/map/canada" ${isActive('/map/canada') ? 'class="active"' : ''}>Map</a>
        <a href="/records/group/mass" ${isActive('/records/group/mass') ? 'class="active"' : ''}>Mass Killings</a>
        <a href="/records/group/massother" ${isActive('/records/group/massother') ? 'class="active"' : ''}>Non Firearms Mass Killings</a>
        <a href="/records/group/massfirearms" ${isActive('/records/group/massfirearms') ? 'class="active"' : ''}>Firearms Mass Killings</a>
        <a href="/records/group/massfirearmslicensed" ${isActive('/records/group/massfirearmslicensed') ? 'class="active"' : ''}>Licensed Firearms Mass Killings</a>
        <a href="/records/group/oic" ${isActive('/records/group/oic') ? 'class="active"' : ''}>OIC Firearms</a>
        <a href="/records/group/suicide" ${isActive('/records/group/suicide') ? 'class="active"' : ''}>Suicide</a>
    </div>
  `;
}

function renderFooter() {
  return `
    <footer>
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;" />
        <p>Something missing or wrong? Please send an email to <a href="mailto:darron@massmurdercanada.org">darron@massmurdercanada.org</a></p>
        <p>Copyright &copy; ${new Date().getFullYear()} Mass Murder Canada</p>
        <p>Contact: <a href="mailto:darron@massmurdercanada.org">darron@massmurdercanada.org</a></p>
    </footer>
    ${renderWebMcpScript()}
  `;
}

function formatDate(dateString) {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return dateString;
  }
}

function formatDateYear(dateString) {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    return date.getFullYear().toString();
  } catch {
    // If parsing fails, try to extract year from string (e.g., "2023" from "2023-01-01")
    const yearMatch = dateString.match(/\b(19|20)\d{2}\b/);
    return yearMatch ? yearMatch[0] : dateString;
  }
}

function formatNullableBool(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return value === 1 ? 'Yes' : 'No';
}

function renderSourceBadge(url) {
  const sourceType = classifySourceType(url || '');
  const label = getSourceTypeLabel(sourceType);
  return `<span class="source-badge source-${escapeHtml(sourceType)}">${escapeHtml(label)}</span>`;
}

function formatCredibilitySummary(credibility) {
  if (credibility.socialOnly) {
    return `Status: Alleged (social-source-only). No independent news/official sources linked yet.`;
  }

  if (credibility.classification === 'corroborated') {
    return `Status: Corroborated across multiple credible sources. Credible: ${credibility.credible}, Social: ${credibility.social}, Other: ${credibility.other}.`;
  }

  if (credibility.classification === 'reported') {
    return `Status: Reported by at least one credible source. Credible: ${credibility.credible}, Social: ${credibility.social}, Other: ${credibility.other}.`;
  }

  return `Status: Unverified. Credible: ${credibility.credible}, Social: ${credibility.social}, Other: ${credibility.other}.`;
}

function renderMarkdown(markdownText) {
  const normalized = String(markdownText || '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return '';

  const lines = normalized.split('\n');
  const html = [];
  let paragraph = [];
  let inUl = false;
  let inOl = false;

  const closeLists = () => {
    if (inUl) {
      html.push('</ul>');
      inUl = false;
    }
    if (inOl) {
      html.push('</ol>');
      inOl = false;
    }
  };

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      html.push(`<p>${paragraph.join('<br>')}</p>`);
      paragraph = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      closeLists();
      continue;
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      closeLists();
      const level = Math.min(4, headingMatch[1].length);
      html.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    const ulMatch = line.match(/^[-*]\s+(.*)$/);
    if (ulMatch) {
      flushParagraph();
      if (inOl) {
        html.push('</ol>');
        inOl = false;
      }
      if (!inUl) {
        html.push('<ul>');
        inUl = true;
      }
      html.push(`<li>${renderInlineMarkdown(ulMatch[1])}</li>`);
      continue;
    }

    const olMatch = line.match(/^\d+\.\s+(.*)$/);
    if (olMatch) {
      flushParagraph();
      if (inUl) {
        html.push('</ul>');
        inUl = false;
      }
      if (!inOl) {
        html.push('<ol>');
        inOl = true;
      }
      html.push(`<li>${renderInlineMarkdown(olMatch[1])}</li>`);
      continue;
    }

    closeLists();
    paragraph.push(renderInlineMarkdown(line));
  }

  flushParagraph();
  closeLists();
  return html.join('\n');
}

function renderInlineMarkdown(text) {
  return escapeHtml(text || '')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}
