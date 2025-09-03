// Dashboard JavaScript functionality

document.addEventListener('DOMContentLoaded', function() {
    // Initialize dashboard
    loadOverview();
    
    // Navigation handling
    document.querySelectorAll('[data-section]').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const section = this.dataset.section;
            showSection(section);
            
            // Update active nav
            document.querySelectorAll('.nav-link').forEach(nav => nav.classList.remove('active'));
            this.classList.add('active');
        });
    });

    // Form handlers
    document.getElementById('settings-form').addEventListener('submit', saveSettings);
});

// Section management
function showSection(sectionName) {
    document.querySelectorAll('.content-section').forEach(section => {
        section.style.display = 'none';
    });
    
    const targetSection = document.getElementById(sectionName + '-section');
    if (targetSection) {
        targetSection.style.display = 'block';
        
        // Load section-specific data
        switch(sectionName) {
            case 'overview':
                loadOverview();
                break;
            case 'settings':
                loadSettings();
                break;
            case 'api-keys':
                loadApiKeys();
                break;
            case 'models':
                loadModels();
                break;
            case 'overrides':
                loadOverrides();
                break;
            case 'logs':
                loadLogs();
                break;
        }
    }
}

// API functions
async function apiCall(endpoint, options = {}) {
    try {
        const response = await fetch(endpoint, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });
        return await response.json();
    } catch (error) {
        console.error('API call failed:', error);
        showAlert('API call failed: ' + error.message, 'danger');
        return null;
    }
}

// Overview functions
async function loadOverview() {
    const stats = await apiCall('/admin/stats');
    if (stats) {
        document.getElementById('total-keys').textContent = stats.totalKeys || 0;
        document.getElementById('total-models').textContent = stats.totalModels || 0;
        document.getElementById('total-requests').textContent = stats.totalRequests || 0;
        document.getElementById('ollama-status').textContent = stats.ollamaStatus || 'Unknown';
    }
}

// Settings functions
async function loadSettings() {
    const settings = await apiCall('/admin/settings');
    if (settings) {
        document.getElementById('ollama-url').value = settings.ollamaUrl || '';
    }
}

async function saveSettings(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const settings = {
        ollamaUrl: formData.get('ollama-url'),
        adminPassword: formData.get('admin-password')
    };
    
    const result = await apiCall('/admin/settings', {
        method: 'POST',
        body: JSON.stringify(settings)
    });
    
    if (result && result.success) {
        showAlert('Settings saved successfully', 'success');
    }
}

// API Keys functions
async function loadApiKeys() {
    const keys = await apiCall('/admin/api-keys');
    if (keys) {
        const tbody = document.querySelector('#api-keys-table tbody');
        tbody.innerHTML = keys.map(key => `
            <tr>
                <td>${key.name}</td>
                <td>
                    <div class="d-flex align-items-center">
                        <code class="me-2">${key.key.substring(0, 8)}...</code>
                        <button class="btn btn-sm btn-outline-secondary" onclick="copyApiKey('${key.key}')" title="Copy full API key">
                            <i class="fas fa-copy"></i>
                        </button>
                    </div>
                </td>
                <td>${key.allowedModels.join(', ')}</td>
                <td>${key.usageCount || 0}</td>
                <td>${new Date(key.created).toLocaleDateString()}</td>
                <td>
                    <button class="btn btn-sm btn-danger" onclick="deleteApiKey('${key.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }
}

async function addApiKey() {
    const name = document.getElementById('key-name').value;
    const allowedModels = document.getElementById('allowed-models').value;
    
    if (!name) {
        showAlert('Please enter a key name', 'warning');
        return;
    }
    
    const result = await apiCall('/admin/api-keys', {
        method: 'POST',
        body: JSON.stringify({
            name,
            allowedModels: allowedModels.split(',').map(m => m.trim())
        })
    });
    
    if (result && result.success) {
        // Show the full API key in a modal for copying
        showApiKeyCreated(result.key);
        document.getElementById('key-name').value = '';
        document.getElementById('allowed-models').value = '*';
        bootstrap.Modal.getInstance(document.getElementById('addKeyModal')).hide();
        loadApiKeys();
    }
}

async function deleteApiKey(keyId) {
    if (!confirm('Are you sure you want to delete this API key?')) return;
    
    const result = await apiCall(`/admin/api-keys/${keyId}`, {
        method: 'DELETE'
    });
    
    if (result && result.success) {
        showAlert('API key deleted', 'success');
        loadApiKeys();
    }
}

async function copyApiKey(apiKey) {
    try {
        await navigator.clipboard.writeText(apiKey);
        showAlert('API key copied to clipboard!', 'success');
    } catch (err) {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = apiKey;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showAlert('API key copied to clipboard!', 'success');
    }
}

function showApiKeyCreated(apiKey) {
    // Create a modal dynamically to show the new API key
    const modalHtml = `
        <div class="modal fade" id="newApiKeyModal" tabindex="-1" aria-labelledby="newApiKeyModalLabel" aria-hidden="true">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="newApiKeyModalLabel">
                            <i class="fas fa-key text-success"></i> API Key Created Successfully
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="alert alert-warning">
                            <i class="fas fa-exclamation-triangle"></i>
                            <strong>Important:</strong> This is the only time you'll see the full API key. Make sure to copy and save it now.
                        </div>
                        <div class="form-group">
                            <label class="form-label"><strong>Your API Key:</strong></label>
                            <div class="input-group">
                                <input type="text" class="form-control font-monospace" id="newApiKeyValue" value="${apiKey}" readonly>
                                <button class="btn btn-outline-secondary" type="button" onclick="copyNewApiKey()">
                                    <i class="fas fa-copy"></i> Copy
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-primary" data-bs-dismiss="modal">I've saved the key</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Remove existing modal if present
    const existingModal = document.getElementById('newApiKeyModal');
    if (existingModal) {
        existingModal.remove();
    }
    
    // Add modal to body
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Show the modal
    const modal = new bootstrap.Modal(document.getElementById('newApiKeyModal'));
    modal.show();
    
    // Auto-remove modal after it's hidden
    document.getElementById('newApiKeyModal').addEventListener('hidden.bs.modal', function() {
        this.remove();
    });
}

function copyNewApiKey() {
    const apiKeyValue = document.getElementById('newApiKeyValue').value;
    copyApiKey(apiKeyValue);
}

// Models functions
async function loadModels() {
    const models = await apiCall('/admin/models');
    if (models) {
        const tbody = document.querySelector('#models-table tbody');
        tbody.innerHTML = models.map(model => `
            <tr>
                <td>${model.originalName}</td>
                <td>
                    <input type="text" class="form-control form-control-sm" 
                           value="${model.displayName}" 
                           onchange="updateModelName('${model.id}', this.value)">
                </td>
                <td>
                    <input type="checkbox" class="form-check-input" 
                           ${model.enabled ? 'checked' : ''} 
                           onchange="toggleModel('${model.id}', this.checked)">
                </td>
                <td>
                    <button class="btn btn-sm btn-secondary" onclick="editModel('${model.id}')">
                        <i class="fas fa-edit"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }
}

async function refreshModels() {
    const result = await apiCall('/admin/models/refresh', { method: 'POST' });
    if (result && result.success) {
        showAlert('Models refreshed from Ollama', 'success');
        loadModels();
    }
}

async function updateModelName(modelId, newName) {
    await apiCall(`/admin/models/${modelId}`, {
        method: 'PATCH',
        body: JSON.stringify({ displayName: newName })
    });
}

async function toggleModel(modelId, enabled) {
    await apiCall(`/admin/models/${modelId}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled })
    });
}

// Parameter Overrides functions
async function loadOverrides() {
    const overrides = await apiCall('/admin/overrides');
    if (overrides) {
        document.getElementById('overrides-json').value = JSON.stringify(overrides, null, 2);
    }
}

async function saveOverrides() {
    try {
        const overridesText = document.getElementById('overrides-json').value;
        const overrides = JSON.parse(overridesText);
        
        const result = await apiCall('/admin/overrides', {
            method: 'POST',
            body: JSON.stringify(overrides)
        });
        
        if (result && result.success) {
            showAlert('Parameter overrides saved', 'success');
        }
    } catch (error) {
        showAlert('Invalid JSON format', 'danger');
    }
}

// Logs functions
async function loadLogs() {
    const logs = await apiCall('/admin/logs');
    if (logs) {
        const tbody = document.querySelector('#logs-table tbody');
        tbody.innerHTML = logs.map(log => `
            <tr>
                <td>${new Date(log.timestamp).toLocaleString()}</td>
                <td>${log.apiKeyName}</td>
                <td>${log.model}</td>
                <td>${log.tokens || 'N/A'}</td>
                <td>${log.responseTime || 'N/A'}ms</td>
                <td>
                    <span class="badge bg-${log.status === 'success' ? 'success' : 'danger'}">
                        ${log.status}
                    </span>
                </td>
            </tr>
        `).join('');
    }
}

async function filterLogs() {
    const filters = {
        apiKey: document.getElementById('log-filter-key').value,
        model: document.getElementById('log-filter-model').value,
        date: document.getElementById('log-filter-date').value
    };
    
    const logs = await apiCall('/admin/logs?' + new URLSearchParams(filters));
    // Update table with filtered results
}

// Utility functions
function showAlert(message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    const container = document.querySelector('.main-content');
    container.insertBefore(alertDiv, container.firstChild);
    
    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.remove();
        }
    }, 5000);
}