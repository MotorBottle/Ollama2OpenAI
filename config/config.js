const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'config.json');
const API_KEYS_FILE = path.join(__dirname, '..', 'data', 'api_keys.json');
const MODELS_FILE = path.join(__dirname, '..', 'data', 'models.json');
const OVERRIDES_FILE = path.join(__dirname, '..', 'data', 'overrides.json');
const LOGS_FILE = path.join(__dirname, '..', 'data', 'logs.json');

class ConfigManager {
    constructor() {
        this.config = this.loadConfig();
        this.apiKeys = this.loadApiKeys();
        this.models = this.loadModels();
        this.overrides = this.loadOverrides();
        this.ensureDataDirectory();
    }

    ensureDataDirectory() {
        const dataDir = path.join(__dirname, '..', 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
    }

    // Configuration management
    getDefaultConfig() {
        return {
            ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
            adminUsername: process.env.ADMIN_USERNAME || 'admin',
            adminPasswordHash: bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin', 10),
            serverPort: parseInt(process.env.PORT) || 3000,
            sessionSecret: process.env.SESSION_SECRET || ('ollama2openai-secret-' + Date.now()),
            rateLimit: {
                windowMs: 15 * 60 * 1000, // 15 minutes
                max: parseInt(process.env.RATE_LIMIT_MAX) || 1000
            }
        };
    }

    loadConfig() {
        let config = this.getDefaultConfig();
        let savedConfig = {};
        
        // Load saved config if it exists
        try {
            if (fs.existsSync(CONFIG_FILE)) {
                const data = fs.readFileSync(CONFIG_FILE, 'utf8');
                savedConfig = JSON.parse(data);
                config = { ...config, ...savedConfig };
            }
        } catch (error) {
            console.error('Error loading config:', error.message);
        }
        
        // Environment variables override only if not explicitly saved via web interface
        if (process.env.OLLAMA_URL && !savedConfig.ollamaUrl) {
            config.ollamaUrl = process.env.OLLAMA_URL;
        }
        if (process.env.ADMIN_USERNAME && !savedConfig.adminUsername) {
            config.adminUsername = process.env.ADMIN_USERNAME;
        }
        if (process.env.ADMIN_PASSWORD && !savedConfig.adminPasswordHash) {
            config.adminPasswordHash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);
        }
        if (process.env.PORT) {
            config.serverPort = parseInt(process.env.PORT);
        }
        if (process.env.SESSION_SECRET) {
            config.sessionSecret = process.env.SESSION_SECRET;
        }
        if (process.env.RATE_LIMIT_MAX) {
            config.rateLimit.max = parseInt(process.env.RATE_LIMIT_MAX);
        }
        
        return config;
    }

    saveConfig() {
        try {
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
            return true;
        } catch (error) {
            console.error('Error saving config:', error.message);
            return false;
        }
    }

    updateConfig(updates) {
        this.config = { ...this.config, ...updates };
        return this.saveConfig();
    }

    // API Keys management
    loadApiKeys() {
        try {
            if (fs.existsSync(API_KEYS_FILE)) {
                const data = fs.readFileSync(API_KEYS_FILE, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('Error loading API keys:', error.message);
        }
        return [];
    }

    saveApiKeys() {
        try {
            fs.writeFileSync(API_KEYS_FILE, JSON.stringify(this.apiKeys, null, 2));
            return true;
        } catch (error) {
            console.error('Error saving API keys:', error.message);
            return false;
        }
    }

    addApiKey(keyData) {
        const newKey = {
            id: Date.now().toString(),
            name: keyData.name,
            key: keyData.key,
            allowedModels: keyData.allowedModels || ['*'],
            created: new Date().toISOString(),
            usageCount: 0,
            lastUsed: null
        };
        this.apiKeys.push(newKey);
        this.saveApiKeys();
        return newKey;
    }

    removeApiKey(keyId) {
        this.apiKeys = this.apiKeys.filter(key => key.id !== keyId);
        return this.saveApiKeys();
    }

    findApiKey(keyValue) {
        return this.apiKeys.find(key => key.key === keyValue);
    }

    updateApiKeyUsage(keyValue) {
        const key = this.findApiKey(keyValue);
        if (key) {
            key.usageCount++;
            key.lastUsed = new Date().toISOString();
            this.saveApiKeys();
        }
    }

    // Models management
    loadModels() {
        try {
            if (fs.existsSync(MODELS_FILE)) {
                const data = fs.readFileSync(MODELS_FILE, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('Error loading models:', error.message);
        }
        return [];
    }

    saveModels() {
        try {
            fs.writeFileSync(MODELS_FILE, JSON.stringify(this.models, null, 2));
            return true;
        } catch (error) {
            console.error('Error saving models:', error.message);
            return false;
        }
    }

    updateModels(modelsList) {
        this.models = modelsList.map(model => ({
            id: model.name || model.id,
            originalName: model.name,
            displayName: model.display_name || model.name,
            enabled: true,
            size: model.size || 0,
            modified: model.modified || new Date().toISOString()
        }));
        return this.saveModels();
    }

    getEnabledModels() {
        return this.models.filter(model => model.enabled);
    }

    updateModel(modelId, updates) {
        const modelIndex = this.models.findIndex(m => m.id === modelId);
        if (modelIndex !== -1) {
            this.models[modelIndex] = { ...this.models[modelIndex], ...updates };
            return this.saveModels();
        }
        return false;
    }

    // Parameter Overrides management
    loadOverrides() {
        try {
            if (fs.existsSync(OVERRIDES_FILE)) {
                const data = fs.readFileSync(OVERRIDES_FILE, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('Error loading overrides:', error.message);
        }
        return {};
    }

    saveOverrides() {
        try {
            fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(this.overrides, null, 2));
            return true;
        } catch (error) {
            console.error('Error saving overrides:', error.message);
            return false;
        }
    }

    updateOverrides(newOverrides) {
        this.overrides = newOverrides;
        return this.saveOverrides();
    }

    getModelOverrides(modelName) {
        // First check individual model parameter overrides (new integrated approach)
        const model = this.models.find(m => m.displayName === modelName || m.originalName === modelName);
        if (model && model.parameterOverrides) {
            return model.parameterOverrides;
        }
        
        // Fall back to global overrides (legacy support)
        return this.overrides[modelName] || {};
    }

    // Logging
    loadLogs() {
        try {
            if (fs.existsSync(LOGS_FILE)) {
                const data = fs.readFileSync(LOGS_FILE, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('Error loading logs:', error.message);
        }
        return [];
    }

    saveLogs(logs) {
        try {
            // Keep only last 10000 logs to prevent file from growing too large
            const recentLogs = logs.slice(-10000);
            fs.writeFileSync(LOGS_FILE, JSON.stringify(recentLogs, null, 2));
            return true;
        } catch (error) {
            console.error('Error saving logs:', error.message);
            return false;
        }
    }

    addLog(logEntry) {
        const logs = this.loadLogs();
        logs.push({
            ...logEntry,
            timestamp: new Date().toISOString(),
            id: Date.now().toString()
        });
        this.saveLogs(logs);
    }

    getLogs(filters = {}) {
        const logs = this.loadLogs();
        let filteredLogs = logs;

        if (filters.apiKey) {
            filteredLogs = filteredLogs.filter(log => log.apiKeyId === filters.apiKey);
        }
        if (filters.model) {
            filteredLogs = filteredLogs.filter(log => log.model === filters.model);
        }
        if (filters.date) {
            const filterDate = new Date(filters.date);
            filteredLogs = filteredLogs.filter(log => {
                const logDate = new Date(log.timestamp);
                return logDate.toDateString() === filterDate.toDateString();
            });
        }

        return filteredLogs.reverse(); // Most recent first
    }

    // Check Ollama connectivity
    async checkOllamaConnection() {
        try {
            const response = await fetch(`${this.config.ollamaUrl}/api/tags`, {
                method: 'GET',
                timeout: 5000
            });
            
            if (response.ok) {
                return 'Connected';
            } else {
                return `Error: HTTP ${response.status}`;
            }
        } catch (error) {
            if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
                return 'Disconnected';
            } else if (error.name === 'TimeoutError') {
                return 'Timeout';
            } else {
                return `Error: ${error.message}`;
            }
        }
    }

    // Stats
    async getStats() {
        const logs = this.loadLogs();
        const ollamaStatus = await this.checkOllamaConnection();
        
        return {
            totalKeys: this.apiKeys.length,
            totalModels: this.models.filter(m => m.enabled).length,
            totalRequests: logs.length,
            ollamaStatus: ollamaStatus
        };
    }

    // Authentication
    validateAdmin(username, password) {
        if (username === this.config.adminUsername) {
            return bcrypt.compareSync(password, this.config.adminPasswordHash);
        }
        return false;
    }

    updateAdminPassword(newPassword) {
        this.config.adminPasswordHash = bcrypt.hashSync(newPassword, 10);
        return this.saveConfig();
    }
}

module.exports = new ConfigManager();