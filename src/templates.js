/**
 * HTML Template functions
 */

import {
  classifySourceType,
  getRecordCredibility,
  getSourceTypeLabel
} from './source-classification.js';

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
                    <td><a href="/records/${record.id}">${escapeHtml(record.name || '')}</a></td>
                    <td>${escapeHtml(record.city || '')}</td>
                    <td><a href="/records/provinces/${(record.province || '').toLowerCase()}">${escapeHtml(record.province || '')}</a></td>
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
                    <td><a href="/records/provinces/${(record.province || '').toLowerCase()}">${escapeHtml(record.province || '')}</a></td>
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
