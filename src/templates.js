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

const CANADA_PROVINCE_CODE_SET = new Set(CANADA_PROVINCE_GEOGRAPHY.map((province) => province.code));
const PROVINCE_COLOR_RAMP = ['#d9e8f8', '#b8d3ed', '#90b8e2', '#6294cd', '#3d73af', '#1b4f82'];
const MAP_METRIC_MODES = [
  { id: 'events_per_million', label: 'Events / 1M' },
  { id: 'events_total', label: 'Events' },
  { id: 'deaths_total', label: 'Deaths' }
];
const DEFAULT_MAP_METRIC_MODE = 'events_total';

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
  const provinceMap = buildProvinceMapData(records, currentPath);
  const safeProvinceDataJson = serializeForInlineScript(provinceMap.byCode);

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mass Murder 🇨🇦 | Province Map</title>
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
            flex: 1;
            overflow-y: auto;
            padding-right: 6px;
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
                height: 480px;
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
    <script>
        const provinceData = ${safeProvinceDataJson};
        const metricModes = ${serializeForInlineScript(MAP_METRIC_MODES)};
        const defaultMetricMode = '${DEFAULT_MAP_METRIC_MODE}';
        const defaultProvinceCode = '${provinceMap.defaultProvinceCode}';
        const populationRefDate = '${CANADA_POPULATION_REF_DATE}';
        const provinceDetailPanel = document.getElementById('province-detail');
        const mapProvinceLinks = Array.from(document.querySelectorAll('a.province-link[data-province-code]'));
        const listProvinceLinks = Array.from(document.querySelectorAll('[data-province-list][data-province-code]'));
        const metricButtons = Array.from(document.querySelectorAll('[data-metric-mode]'));
        const legendLow = document.getElementById('province-legend-low');
        const legendHigh = document.getElementById('province-legend-high');
        let activeMetricMode = defaultMetricMode;
        let currentProvinceCode = defaultProvinceCode;

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

        function getMetricLabel(mode) {
            const modeConfig = metricModes.find((item) => item.id === mode);
            return modeConfig ? modeConfig.label : 'Events / 1M';
        }

        function getMetricSuffix(mode) {
            return mode === 'events_per_million' ? '/1M' : '';
        }

        function formatMetric(value, mode) {
            const numeric = Number(value || 0);
            if (mode === 'events_per_million') {
                if (numeric >= 10) return numeric.toFixed(2);
                if (numeric >= 1) return numeric.toFixed(3);
                return numeric.toFixed(4);
            }
            return formatInt(numeric);
        }

        function getMetricValue(province, mode) {
            if (!province) return 0;
            if (mode === 'events_total') return Number(province.events) || 0;
            if (mode === 'deaths_total') return Number(province.deaths) || 0;
            return Number(province.eventsPerMillion) || 0;
        }

        function getMetricExtents(mode) {
            let max = 0;
            let minPositive = Number.POSITIVE_INFINITY;
            Object.values(provinceData).forEach((province) => {
                const metricValue = getMetricValue(province, mode);
                if (metricValue > max) max = metricValue;
                if (metricValue > 0 && metricValue < minPositive) minPositive = metricValue;
            });
            return {
                max,
                minPositive: Number.isFinite(minPositive) ? minPositive : 0
            };
        }

        function getFillColor(metricValue, maxMetricValue) {
            if (metricValue <= 0 || maxMetricValue <= 0) return '#e8eef6';
            const colorRamp = ${serializeForInlineScript(PROVINCE_COLOR_RAMP)};
            const ratio = metricValue / maxMetricValue;
            const rampIndex = Math.max(0, Math.min(
                colorRamp.length - 1,
                Math.ceil(ratio * colorRamp.length) - 1
            ));
            return colorRamp[rampIndex];
        }

        function getLabelColor(metricValue, maxMetricValue) {
            if (metricValue <= 0 || maxMetricValue <= 0) return '#41556e';
            return (metricValue / maxMetricValue) >= 0.5 ? '#ffffff' : '#1d3d63';
        }

        function buildProvinceTitle(province, mode) {
            const metricValue = getMetricValue(province, mode);
            const metricLabel = getMetricLabel(mode);
            return province.name + ': ' +
                (Number(province.events) || 0) + ' events, ' +
                (Number(province.deaths) || 0) + ' deaths, ' +
                (Number(province.victims) || 0) + ' victims (' +
                metricLabel + ': ' + formatMetric(metricValue, mode) + getMetricSuffix(mode) + ')';
        }

        function applyMetricMode(mode) {
            activeMetricMode = mode;
            const metricExtents = getMetricExtents(mode);
            const maxMetricValue = Number(metricExtents.max) || 0;

            mapProvinceLinks.forEach((link) => {
                const code = link.getAttribute('data-province-code');
                const province = provinceData[code];
                if (!province) return;
                const metricValue = getMetricValue(province, mode);
                const shape = link.querySelector('.province-shape');
                const label = link.querySelector('.province-label');
                const title = link.querySelector('title');
                if (shape) {
                    shape.setAttribute('fill', getFillColor(metricValue, maxMetricValue));
                }
                if (label) {
                    label.setAttribute('fill', getLabelColor(metricValue, maxMetricValue));
                }
                if (title) {
                    title.textContent = buildProvinceTitle(province, mode);
                }
            });

            metricButtons.forEach((button) => {
                const modeId = button.getAttribute('data-metric-mode');
                button.classList.toggle('active', modeId === mode);
            });

            if (legendLow) {
                const lowText = metricExtents.max > 0 ? formatMetric(metricExtents.minPositive, mode) : '0';
                legendLow.textContent = 'Low (' + lowText + getMetricSuffix(mode) + ')';
            }
            if (legendHigh) {
                legendHigh.textContent = 'High (' + formatMetric(metricExtents.max, mode) + getMetricSuffix(mode) + ')';
            }

            renderProvinceDetail(currentProvinceCode);
        }

        function renderProvinceDetail(code) {
            if (!provinceDetailPanel) return;

            const province = provinceData[code] || provinceData[defaultProvinceCode];
            if (!province) return;
            currentProvinceCode = province.code;

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
            const activeMetricValue = getMetricValue(province, activeMetricMode);
            const activeMetricLabel = getMetricLabel(activeMetricMode);

            provinceDetailPanel.innerHTML =
                '<h3>' + escapeText(province.name) + ' (' + escapeText(province.code) + ')</h3>' +
                '<div class="province-detail-meta">' +
                    '<div class="province-detail-metric"><strong>' + (Number(province.events) || 0) + '</strong><span>Events</span></div>' +
                    '<div class="province-detail-metric"><strong>' + formatMetric(activeMetricValue, activeMetricMode) + '</strong><span>' + escapeText(activeMetricLabel) + '</span></div>' +
                    '<div class="province-detail-metric"><strong>' + (Number(province.deaths) || 0) + '</strong><span>Deaths</span></div>' +
                    '<div class="province-detail-metric"><strong>' + (Number(province.victims) || 0) + '</strong><span>Victims</span></div>' +
                '</div>' +
                '<p class="province-population-note">Population estimate: ' + formatInt(population) + ' (' + populationRefDate + ')</p>' +
                '<div class="province-detail-body">' +
                    '<h4>Recent events</h4>' +
                    recordsHtml +
                '</div>' +
                '<p class="province-detail-link"><a href="' + provinceHref + '">Open all events for ' + escapeText(province.code) + '</a></p>';

            setActiveProvince(province.code);
        }

        if (provinceDetailPanel && mapProvinceLinks.length > 0) {
            applyMetricMode(defaultMetricMode);

            const interactiveLinks = mapProvinceLinks.concat(listProvinceLinks);
            interactiveLinks.forEach((link) => {
                const code = link.getAttribute('data-province-code');
                if (!code) return;
                link.addEventListener('mouseenter', () => renderProvinceDetail(code));
                link.addEventListener('focus', () => renderProvinceDetail(code));
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
                mapSvg.addEventListener('mouseleave', () => renderProvinceDetail(defaultProvinceCode));
            }
        }
    </script>
</body>
</html>`;
}

function buildProvinceMapData(records, currentPath = '/') {
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
      records: []
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
    province.records.push({
      id: String(record.id || ''),
      year: formatDateYear(record.date),
      name: String(record.name || ''),
      city: String(record.city || ''),
      victims,
      deaths,
      sortDate
    });
  }

  for (const province of Object.values(byCode)) {
    province.records.sort((a, b) => {
      if (b.sortDate !== a.sortDate) return b.sortDate - a.sortDate;
      if (b.deaths !== a.deaths) return b.deaths - a.deaths;
      return b.victims - a.victims;
    });
    province.records = province.records.slice(0, 5).map(({ sortDate, ...record }) => record);
    province.eventsPerMillion = province.population > 0
      ? (province.events / province.population) * 1000000
      : 0;
  }

  const metricExtents = getMetricExtents(byCode);
  let topProvinceCode = CANADA_PROVINCE_GEOGRAPHY[0]?.code || 'ON';

  if (!byCode[topProvinceCode]) {
    topProvinceCode = CANADA_PROVINCE_GEOGRAPHY[0].code;
  }

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

  const activeProvinceCode = getActiveProvinceFromPath(currentPath);
  const defaultProvinceCode = activeProvinceCode || topProvinceCode;

  return {
    byCode,
    metricExtents,
    unmappedCount,
    activeProvinceCode,
    defaultProvinceCode
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
                ${renderProvinceDetailPanel(defaultProvince)}
            </aside>
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

function getActiveProvinceFromPath(currentPath = '') {
  const pathMatch = currentPath.match(/^\/records\/provinces\/([^/]+)/i);
  if (!pathMatch) {
    return null;
  }

  const provinceCode = String(pathMatch[1] || '').toUpperCase();
  if (!CANADA_PROVINCE_CODE_SET.has(provinceCode)) {
    return null;
  }

  return provinceCode;
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
