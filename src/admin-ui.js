/**
 * Admin UI template functions
 */

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

export function renderLoginPage(error = null) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Login - Mass Murder Canada</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f5f5;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            padding: 20px;
        }
        .login-container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            max-width: 400px;
            width: 100%;
        }
        h1 {
            color: #c8102e;
            margin-bottom: 30px;
            text-align: center;
        }
        .error {
            background: #fee;
            color: #c33;
            padding: 12px;
            border-radius: 4px;
            margin-bottom: 20px;
            border-left: 4px solid #c33;
        }
        form {
            display: flex;
            flex-direction: column;
        }
        label {
            margin-bottom: 8px;
            color: #333;
            font-weight: 500;
        }
        input {
            padding: 12px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 16px;
            margin-bottom: 20px;
        }
        button {
            padding: 12px;
            background: #003366;
            color: white;
            border: none;
            border-radius: 4px;
            font-size: 16px;
            cursor: pointer;
            font-weight: 500;
        }
        button:hover {
            background: #004080;
        }
    </style>
</head>
<body>
    <div class="login-container">
        <h1>Admin Login</h1>
        ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
        <form method="POST" action="/admin/login">
            <label for="password">Password:</label>
            <input type="password" id="password" name="password" required autofocus>
            <button type="submit">Login</button>
        </form>
    </div>
</body>
</html>`;
}

export function renderAdminDashboard(records = [], stories = []) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Dashboard - Mass Murder Canada</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
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
        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 2px solid #eee;
        }
        h1 {
            color: #c8102e;
        }
        .nav-buttons {
            display: flex;
            gap: 10px;
        }
        .nav-buttons a, .nav-buttons button {
            padding: 10px 20px;
            background: #003366;
            color: white;
            text-decoration: none;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
        }
        .nav-buttons a:hover, .nav-buttons button:hover {
            background: #004080;
        }
        .nav-buttons button.secondary {
            background: #666;
        }
        .section {
            margin: 30px 0;
        }
        h2 {
            color: #003366;
            margin-bottom: 20px;
        }
        .action-bar {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
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
        tbody tr:hover {
            background: #f8f9fa;
        }
        .actions {
            display: flex;
            gap: 5px;
        }
        .btn {
            padding: 6px 12px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            text-decoration: none;
            display: inline-block;
        }
        .btn-edit {
            background: #ffc107;
            color: #000;
        }
        .btn-delete {
            background: #dc3545;
            color: white;
        }
        .btn:hover {
            opacity: 0.8;
        }
        .modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            overflow: auto;
        }
        .modal-content {
            background: white;
            margin: 50px auto;
            padding: 30px;
            border-radius: 8px;
            max-width: 800px;
            width: 90%;
            max-height: 90vh;
            overflow-y: auto;
        }
        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 2px solid #eee;
        }
        .close {
            font-size: 28px;
            font-weight: bold;
            cursor: pointer;
            color: #999;
        }
        .close:hover {
            color: #000;
        }
        .form-group {
            margin-bottom: 20px;
        }
        .form-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: 500;
            color: #333;
        }
        .form-group input,
        .form-group textarea,
        .form-group select {
            width: 100%;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
            font-family: inherit;
        }
        .form-group textarea {
            min-height: 100px;
            resize: vertical;
        }
        .form-group.checkbox {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .form-group.checkbox input {
            width: auto;
        }
        .form-actions {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
            margin-top: 20px;
        }
        .alert {
            padding: 12px;
            border-radius: 4px;
            margin-bottom: 20px;
        }
        .alert-success {
            background: #d4edda;
            color: #155724;
            border-left: 4px solid #28a745;
        }
        .alert-error {
            background: #f8d7da;
            color: #721c24;
            border-left: 4px solid #dc3545;
        }
        .news-story-item {
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 15px;
            margin-bottom: 10px;
            background: #f9f9f9;
        }
        .news-story-item-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        .news-story-item-header h4 {
            margin: 0;
            font-size: 14px;
            color: #333;
        }
        .news-story-item-header button {
            padding: 4px 8px;
            font-size: 12px;
        }
        .news-story-fields {
            display: grid;
            grid-template-columns: 1fr;
            gap: 10px;
        }
        .news-story-fields input {
            width: 100%;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>Admin Dashboard</h1>
            <div class="nav-buttons">
                <a href="/">View Site</a>
                <form method="POST" action="/admin/logout" style="display: inline;">
                    <button type="submit">Logout</button>
                </form>
            </div>
        </header>

        <div id="alert-container"></div>

        <div class="section">
            <h2>Records</h2>
            <div class="action-bar">
                <button class="btn btn-primary" onclick="openRecordModal()">Add New Record</button>
            </div>
            <table id="records-table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Date</th>
                        <th>Name</th>
                        <th>City</th>
                        <th>Province</th>
                        <th>Victims</th>
                        <th>Deaths</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${records.map(r => `
                    <tr>
                        <td>${escapeHtml(r.id || '')}</td>
                        <td>${escapeHtml(r.date || '')}</td>
                        <td>${escapeHtml(r.name || '')}</td>
                        <td>${escapeHtml(r.city || '')}</td>
                        <td>${escapeHtml(r.province || '')}</td>
                        <td>${r.victims || 0}</td>
                        <td>${r.deaths || 0}</td>
                        <td class="actions">
                            <button class="btn btn-edit" onclick="editRecord('${escapeHtml(r.id)}')">Edit</button>
                            <button class="btn btn-delete" onclick="deleteRecord('${escapeHtml(r.id)}')">Delete</button>
                        </td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <div class="section">
            <h2>News Stories</h2>
            <div class="action-bar">
                <button class="btn btn-primary" onclick="openStoryModal()">Add New Story</button>
            </div>
            <table id="stories-table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Record ID</th>
                        <th>URL</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${stories.map(s => `
                    <tr>
                        <td>${escapeHtml(s.id || '')}</td>
                        <td>${escapeHtml(s.record_id || '')}</td>
                        <td><a href="${escapeHtml(s.url || '#')}" target="_blank">${escapeHtml(s.url || '')}</a></td>
                        <td class="actions">
                            <button class="btn btn-edit" onclick="editStory('${escapeHtml(s.id)}')">Edit</button>
                            <button class="btn btn-delete" onclick="deleteStory('${escapeHtml(s.id)}')">Delete</button>
                        </td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    </div>

    <!-- Record Modal -->
    <div id="recordModal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h2 id="recordModalTitle">Add Record</h2>
                <span class="close" onclick="closeRecordModal()">&times;</span>
            </div>
            <form id="recordForm">
                <input type="hidden" id="recordId" name="id">
                <div class="form-group">
                    <label for="recordDate">Year *</label>
                    <input type="number" id="recordDate" name="date" min="1900" max="2100" step="1" placeholder="2024" required>
                </div>
                <div class="form-group">
                    <label for="recordName">Name</label>
                    <input type="text" id="recordName" name="name">
                </div>
                <div class="form-group">
                    <label for="recordCity">City</label>
                    <input type="text" id="recordCity" name="city">
                </div>
                <div class="form-group">
                    <label for="recordProvince">Province</label>
                    <input type="text" id="recordProvince" name="province">
                </div>
                <div class="form-group">
                    <label for="recordVictims">Victims</label>
                    <input type="number" id="recordVictims" name="victims">
                </div>
                <div class="form-group">
                    <label for="recordDeaths">Deaths</label>
                    <input type="number" id="recordDeaths" name="deaths">
                </div>
                <div class="form-group">
                    <label for="recordInjuries">Injuries</label>
                    <input type="number" id="recordInjuries" name="injuries">
                </div>
                <div class="form-group checkbox">
                    <input type="checkbox" id="recordLicensed" name="licensed">
                    <label for="recordLicensed">Licensed</label>
                </div>
                <div class="form-group checkbox">
                    <input type="checkbox" id="recordSuicide" name="suicide">
                    <label for="recordSuicide">Suicide</label>
                </div>
                <div class="form-group checkbox">
                    <input type="checkbox" id="recordFirearms" name="firearms">
                    <label for="recordFirearms">Firearms</label>
                </div>
                <div class="form-group checkbox">
                    <input type="checkbox" id="recordPossessedLegally" name="possessed_legally">
                    <label for="recordPossessedLegally">Possessed Legally</label>
                </div>
                <div class="form-group checkbox">
                    <input type="checkbox" id="recordOicImpact" name="oic_impact">
                    <label for="recordOicImpact">OIC Impact</label>
                </div>
                <div class="form-group">
                    <label for="recordDevicesUsed">Devices Used</label>
                    <textarea id="recordDevicesUsed" name="devices_used"></textarea>
                </div>
                <div class="form-group">
                    <label for="recordWarnings">Warnings</label>
                    <textarea id="recordWarnings" name="warnings"></textarea>
                </div>
                <div class="form-group">
                    <label for="recordAiSummary">AI Summary</label>
                    <textarea id="recordAiSummary" name="ai_summary"></textarea>
                </div>
                <div class="form-group">
                    <label>News Stories</label>
                    <div id="newsStoriesContainer">
                        <!-- News stories will be dynamically added here -->
                    </div>
                    <button type="button" class="btn" onclick="addNewsStory()" style="margin-top: 10px;">+ Add News Story</button>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn secondary" onclick="closeRecordModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save</button>
                </div>
            </form>
        </div>
    </div>

    <!-- Story Modal -->
    <div id="storyModal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h2 id="storyModalTitle">Add News Story</h2>
                <span class="close" onclick="closeStoryModal()">&times;</span>
            </div>
            <form id="storyForm">
                <input type="hidden" id="storyId" name="id">
                <div class="form-group">
                    <label for="storyRecordId">Record ID *</label>
                    <input type="text" id="storyRecordId" name="record_id" required>
                </div>
                <div class="form-group">
                    <label for="storyUrl">URL</label>
                    <input type="url" id="storyUrl" name="url">
                </div>
                <div class="form-group">
                    <label for="storyBodyText">Body Text</label>
                    <textarea id="storyBodyText" name="body_text"></textarea>
                </div>
                <div class="form-group">
                    <label for="storyAiSummary">AI Summary</label>
                    <textarea id="storyAiSummary" name="ai_summary"></textarea>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn secondary" onclick="closeStoryModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save</button>
                </div>
            </form>
        </div>
    </div>

    <script>
        // Load data on page load
        async function loadData() {
            try {
                const [recordsRes, storiesRes] = await Promise.all([
                    fetch('/admin/api/records'),
                    fetch('/admin/api/stories')
                ]);
                
                if (recordsRes.ok && storiesRes.ok) {
                    const records = await recordsRes.json();
                    const stories = await storiesRes.json();
                    updateTables(records, stories);
                }
            } catch (error) {
                showAlert('Error loading data: ' + error.message, 'error');
            }
        }

        function updateTables(records, stories) {
            // Update records table
            const recordsBody = document.querySelector('#records-table tbody');
            recordsBody.innerHTML = records.map(r => \`
                <tr>
                    <td>\${escapeHtml(r.id || '')}</td>
                    <td>\${escapeHtml(r.date || '')}</td>
                    <td>\${escapeHtml(r.name || '')}</td>
                    <td>\${escapeHtml(r.city || '')}</td>
                    <td>\${escapeHtml(r.province || '')}</td>
                    <td>\${r.victims || 0}</td>
                    <td>\${r.deaths || 0}</td>
                    <td class="actions">
                        <button class="btn btn-edit" onclick="editRecord('\${escapeHtml(r.id)}')">Edit</button>
                        <button class="btn btn-delete" onclick="deleteRecord('\${escapeHtml(r.id)}')">Delete</button>
                    </td>
                </tr>
            \`).join('');
            
            // Update stories table
            const storiesBody = document.querySelector('#stories-table tbody');
            storiesBody.innerHTML = stories.map(s => \`
                <tr>
                    <td>\${escapeHtml(s.id || '')}</td>
                    <td>\${escapeHtml(s.record_id || '')}</td>
                    <td><a href="\${escapeHtml(s.url || '#')}" target="_blank">\${escapeHtml(s.url || '')}</a></td>
                    <td class="actions">
                        <button class="btn btn-edit" onclick="editStory('\${escapeHtml(s.id)}')">Edit</button>
                        <button class="btn btn-delete" onclick="deleteStory('\${escapeHtml(s.id)}')">Delete</button>
                    </td>
                </tr>
            \`).join('');
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

        function showAlert(message, type = 'success') {
            const container = document.getElementById('alert-container');
            container.innerHTML = \`<div class="alert alert-\${type}">\${escapeHtml(message)}</div>\`;
            setTimeout(() => {
                container.innerHTML = '';
            }, 5000);
        }

        // Record modal functions
        function openRecordModal(recordId = null) {
            const modal = document.getElementById('recordModal');
            const form = document.getElementById('recordForm');
            const title = document.getElementById('recordModalTitle');
            
            if (recordId) {
                title.textContent = 'Edit Record';
                // Load record data
                fetch(\`/admin/api/records/\${recordId}\`)
                    .then(r => r.json())
                    .then(record => {
                        document.getElementById('recordId').value = record.id || '';
                        // Extract year from date if it's a full date, otherwise use as-is
                        const dateValue = record.date || '';
                        const yearMatch = dateValue.match(/^(\d{4})/);
                        document.getElementById('recordDate').value = yearMatch ? yearMatch[1] : dateValue;
                        document.getElementById('recordName').value = record.name || '';
                        document.getElementById('recordCity').value = record.city || '';
                        document.getElementById('recordProvince').value = record.province || '';
                        document.getElementById('recordVictims').value = record.victims || '';
                        document.getElementById('recordDeaths').value = record.deaths || '';
                        document.getElementById('recordInjuries').value = record.injuries || '';
                        document.getElementById('recordLicensed').checked = record.licensed === 1;
                        document.getElementById('recordSuicide').checked = record.suicide === 1;
                        document.getElementById('recordFirearms').checked = record.firearms === 1;
                        document.getElementById('recordPossessedLegally').checked = record.possessed_legally === 1;
                        document.getElementById('recordOicImpact').checked = record.oic_impact === 1;
                        document.getElementById('recordDevicesUsed').value = record.devices_used || '';
                        document.getElementById('recordWarnings').value = record.warnings || '';
                        document.getElementById('recordAiSummary').value = record.ai_summary || '';
                        
                        // Load news stories
                        const container = document.getElementById('newsStoriesContainer');
                        container.innerHTML = '';
                        if (record.newsStories && record.newsStories.length > 0) {
                            record.newsStories.forEach((story, index) => {
                                addNewsStoryItem(story.id, story.url || '', story.body_text || '', story.ai_summary || '', index);
                            });
                        }
                    })
                    .catch(err => {
                        showAlert('Error loading record: ' + err.message, 'error');
                    });
            } else {
                title.textContent = 'Add Record';
                form.reset();
                // Generate UUID v4
                document.getElementById('recordId').value = crypto.randomUUID();
                // Clear news stories
                document.getElementById('newsStoriesContainer').innerHTML = '';
            }
            
            modal.style.display = 'block';
        }

        function closeRecordModal() {
            document.getElementById('recordModal').style.display = 'none';
        }

        document.getElementById('recordForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData.entries());
            
            // Convert checkbox values
            data.licensed = document.getElementById('recordLicensed').checked;
            data.suicide = document.getElementById('recordSuicide').checked;
            data.firearms = document.getElementById('recordFirearms').checked;
            data.possessed_legally = document.getElementById('recordPossessedLegally').checked;
            data.oic_impact = document.getElementById('recordOicImpact').checked;
            
            // Convert numeric fields
            if (data.victims) data.victims = parseInt(data.victims);
            if (data.deaths) data.deaths = parseInt(data.deaths);
            if (data.injuries) data.injuries = parseInt(data.injuries);
            
            // Convert year to date string (format: YYYY, padded to 4 digits)
            if (data.date) {
                const yearStr = String(data.date).trim();
                // Extract first 4 digits if it's a longer string, or pad if it's shorter
                if (yearStr.length >= 4) {
                    data.date = yearStr.substring(0, 4);
                } else {
                    // Pad with zeros if somehow less than 4 digits (shouldn't happen with min/max)
                    data.date = yearStr.padStart(4, '0');
                }
            }
            
            // Collect news stories from form
            const stories = [];
            const storyItems = document.querySelectorAll('.news-story-item');
            if (storyItems.length > 100) {
                showAlert('Too many news stories (maximum 100)', 'error');
                return;
            }
            
            storyItems.forEach(item => {
                const storyId = item.querySelector('[data-story-id]')?.getAttribute('data-story-id') || crypto.randomUUID();
                const storyUrl = item.querySelector('[data-story-url]')?.value?.trim() || '';
                const storyBody = item.querySelector('[data-story-body]')?.value?.trim() || '';
                const storySummary = item.querySelector('[data-story-summary]')?.value?.trim() || '';
                
                // Validate story ID format
                if (!/^[a-zA-Z0-9_-]+$/.test(storyId.replace(/-/g, ''))) {
                    return; // Skip invalid story IDs
                }
                
                // Validate URL if provided
                if (storyUrl) {
                    try {
                        new URL(storyUrl); // Validate URL format
                        stories.push({
                            id: storyId,
                            url: storyUrl,
                            body_text: storyBody,
                            ai_summary: storySummary
                        });
                    } catch {
                        // Skip invalid URLs
                        showAlert('Invalid URL format for one or more news stories', 'error');
                    }
                }
            });
            data.newsStories = stories;
            
            const recordId = data.id;
            const isEdit = recordId && await fetch(\`/admin/api/records/\${recordId}\`).then(r => r.ok);
            
            try {
                const url = isEdit ? \`/admin/api/records/\${recordId}\` : '/admin/api/records';
                const method = isEdit ? 'PUT' : 'POST';
                
                const response = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                
                const result = await response.json();
                
                if (response.ok) {
                    showAlert(isEdit ? 'Record updated successfully' : 'Record created successfully');
                    closeRecordModal();
                    loadData();
                } else {
                    showAlert('Error: ' + (result.error || 'Unknown error'), 'error');
                }
            } catch (error) {
                showAlert('Error: ' + error.message, 'error');
            }
        });

        async function editRecord(id) {
            openRecordModal(id);
        }

        async function deleteRecord(id) {
            if (!confirm('Are you sure you want to delete this record? This will also delete all associated news stories.')) {
                return;
            }
            
            try {
                const response = await fetch(\`/admin/api/records/\${id}\`, {
                    method: 'DELETE'
                });
                
                const result = await response.json();
                
                if (response.ok) {
                    showAlert('Record deleted successfully');
                    loadData();
                } else {
                    showAlert('Error: ' + (result.error || 'Unknown error'), 'error');
                }
            } catch (error) {
                showAlert('Error: ' + error.message, 'error');
            }
        }

        // Story modal functions
        function openStoryModal(storyId = null) {
            const modal = document.getElementById('storyModal');
            const form = document.getElementById('storyForm');
            const title = document.getElementById('storyModalTitle');
            
            if (storyId) {
                title.textContent = 'Edit Story';
                fetch(\`/admin/api/stories/\${storyId}\`)
                    .then(r => r.json())
                    .then(story => {
                        document.getElementById('storyId').value = story.id || '';
                        document.getElementById('storyRecordId').value = story.record_id || '';
                        document.getElementById('storyUrl').value = story.url || '';
                        document.getElementById('storyBodyText').value = story.body_text || '';
                        document.getElementById('storyAiSummary').value = story.ai_summary || '';
                    })
                    .catch(err => {
                        showAlert('Error loading story: ' + err.message, 'error');
                    });
            } else {
                title.textContent = 'Add News Story';
                form.reset();
                document.getElementById('storyId').value = 'story_' + Date.now();
            }
            
            modal.style.display = 'block';
        }

        function closeStoryModal() {
            document.getElementById('storyModal').style.display = 'none';
        }

        document.getElementById('storyForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData.entries());
            
            const storyId = data.id;
            const isEdit = storyId && await fetch(\`/admin/api/stories/\${storyId}\`).then(r => r.ok);
            
            try {
                const url = isEdit ? \`/admin/api/stories/\${storyId}\` : '/admin/api/stories';
                const method = isEdit ? 'PUT' : 'POST';
                
                const response = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                
                const result = await response.json();
                
                if (response.ok) {
                    showAlert(isEdit ? 'Story updated successfully' : 'Story created successfully');
                    closeStoryModal();
                    loadData();
                } else {
                    showAlert('Error: ' + (result.error || 'Unknown error'), 'error');
                }
            } catch (error) {
                showAlert('Error: ' + error.message, 'error');
            }
        });

        // News story management in record form
        function addNewsStory() {
            const container = document.getElementById('newsStoriesContainer');
            const index = container.children.length;
            addNewsStoryItem('', '', '', '', index);
        }

        function addNewsStoryItem(storyId, url, bodyText, aiSummary, index) {
            const container = document.getElementById('newsStoriesContainer');
            // Limit number of stories to prevent DoS
            if (container.children.length >= 100) {
                showAlert('Maximum of 100 news stories allowed', 'error');
                return;
            }
            
            // Validate/generate story ID
            let storyIdValue = storyId || crypto.randomUUID();
            // Validate UUID format (basic check)
            if (!/^[a-zA-Z0-9_-]+$/.test(storyIdValue.replace(/-/g, ''))) {
                storyIdValue = crypto.randomUUID(); // Regenerate if invalid
            }
            
            const item = document.createElement('div');
            item.className = 'news-story-item';
            // Use textContent for the header to prevent XSS
            const header = document.createElement('div');
            header.className = 'news-story-item-header';
            header.innerHTML = \`
                <h4>News Story \${index + 1}</h4>
                <button type="button" class="btn btn-delete" onclick="removeNewsStory(this)">Remove</button>
            \`;
            
            const fields = document.createElement('div');
            fields.className = 'news-story-fields';
            
            const hiddenId = document.createElement('input');
            hiddenId.type = 'hidden';
            hiddenId.setAttribute('data-story-id', storyIdValue);
            
            const urlInput = document.createElement('input');
            urlInput.type = 'url';
            urlInput.setAttribute('data-story-url', '');
            urlInput.placeholder = 'News Story URL *';
            urlInput.required = true;
            urlInput.value = url; // Browser handles escaping for input.value
            urlInput.style.cssText = 'width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;';
            
            const bodyTextarea = document.createElement('textarea');
            bodyTextarea.setAttribute('data-story-body', '');
            bodyTextarea.placeholder = 'Body Text (optional)';
            bodyTextarea.textContent = bodyText; // textContent safely escapes
            bodyTextarea.style.cssText = 'width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; min-height: 60px; font-family: inherit; resize: vertical;';
            
            const summaryTextarea = document.createElement('textarea');
            summaryTextarea.setAttribute('data-story-summary', '');
            summaryTextarea.placeholder = 'AI Summary (optional)';
            summaryTextarea.textContent = aiSummary; // textContent safely escapes
            summaryTextarea.style.cssText = 'width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; min-height: 60px; font-family: inherit; resize: vertical;';
            
            fields.appendChild(hiddenId);
            fields.appendChild(urlInput);
            fields.appendChild(bodyTextarea);
            fields.appendChild(summaryTextarea);
            
            item.appendChild(header);
            item.appendChild(fields);
            container.appendChild(item);
        }

        function removeNewsStory(button) {
            button.closest('.news-story-item').remove();
            // Renumber remaining stories
            const container = document.getElementById('newsStoriesContainer');
            const items = container.querySelectorAll('.news-story-item');
            items.forEach((item, index) => {
                const header = item.querySelector('h4');
                if (header) {
                    header.textContent = \`News Story \${index + 1}\`;
                }
            });
        }

        async function editStory(id) {
            openStoryModal(id);
        }

        async function deleteStory(id) {
            if (!confirm('Are you sure you want to delete this story?')) {
                return;
            }
            
            try {
                const response = await fetch(\`/admin/api/stories/\${id}\`, {
                    method: 'DELETE'
                });
                
                const result = await response.json();
                
                if (response.ok) {
                    showAlert('Story deleted successfully');
                    loadData();
                } else {
                    showAlert('Error: ' + (result.error || 'Unknown error'), 'error');
                }
            } catch (error) {
                showAlert('Error: ' + error.message, 'error');
            }
        }

        // Close modals when clicking outside
        window.onclick = function(event) {
            const recordModal = document.getElementById('recordModal');
            const storyModal = document.getElementById('storyModal');
            if (event.target === recordModal) {
                closeRecordModal();
            }
            if (event.target === storyModal) {
                closeStoryModal();
            }
        }

        // Load data on page load
        loadData();
    </script>
</body>
</html>`;
}

