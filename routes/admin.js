const express = require('express');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const config = require('../config/config');

const router = express.Router();

// Middleware to check if user is authenticated
const requireAuth = (req, res, next) => {
    if (req.session.authenticated) {
        next();
    } else {
        res.redirect('/login');
    }
};

// Home page - redirect to dashboard if authenticated, otherwise show login
router.get('/', (req, res) => {
    if (req.session.authenticated) {
        res.redirect('/dashboard');
    } else {
        res.redirect('/login');
    }
});

// Login page
router.get('/login', (req, res) => {
    if (req.session.authenticated) {
        res.redirect('/dashboard');
    } else {
        res.render('login', { error: null });
    }
});

// Login POST
router.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    if (config.validateAdmin(username, password)) {
        req.session.authenticated = true;
        req.session.username = username;
        res.redirect('/dashboard');
    } else {
        res.render('login', { error: 'Invalid username or password' });
    }
});

// Dashboard (protected)
router.get('/dashboard', requireAuth, (req, res) => {
    res.render('dashboard');
});

// Logout
router.post('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// API endpoints for admin interface
// Stats endpoint
router.get('/admin/stats', requireAuth, async (req, res) => {
    try {
        const stats = await config.getStats();
        res.json(stats);
    } catch (error) {
        console.error('Error getting stats:', error);
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

// Settings endpoints
router.get('/admin/settings', requireAuth, (req, res) => {
    res.json({
        ollamaUrl: config.config.ollamaUrl,
        adminUsername: config.config.adminUsername
    });
});

router.post('/admin/settings', requireAuth, (req, res) => {
    const updates = {};
    if (req.body.ollamaUrl) updates.ollamaUrl = req.body.ollamaUrl;
    if (req.body.adminPassword) {
        config.updateAdminPassword(req.body.adminPassword);
    }
    
    const success = config.updateConfig(updates);
    res.json({ success });
});

// API Keys endpoints
router.get('/admin/api-keys', requireAuth, (req, res) => {
    res.json(config.apiKeys);
});

router.post('/admin/api-keys', requireAuth, (req, res) => {
    const apiKey = 'sk-' + uuidv4().replace(/-/g, '');
    const newKey = config.addApiKey({
        name: req.body.name,
        key: apiKey,
        allowedModels: req.body.allowedModels
    });
    
    res.json({ success: true, key: apiKey, keyData: newKey });
});

router.delete('/admin/api-keys/:keyId', requireAuth, (req, res) => {
    const success = config.removeApiKey(req.params.keyId);
    res.json({ success });
});

// Models endpoints
router.get('/admin/models', requireAuth, (req, res) => {
    res.json(config.models);
});

router.post('/admin/models/refresh', requireAuth, async (req, res) => {
    try {
        const response = await axios.get(`${config.config.ollamaUrl}/api/tags`);
        const success = config.updateModels(response.data.models || []);
        res.json({ success, models: config.models });
    } catch (error) {
        console.error('Error refreshing models:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.patch('/admin/models/:modelId', requireAuth, (req, res) => {
    const success = config.updateModel(req.params.modelId, req.body);
    res.json({ success });
});

// Parameter Overrides endpoints
router.get('/admin/overrides', requireAuth, (req, res) => {
    res.json(config.overrides);
});

router.post('/admin/overrides', requireAuth, (req, res) => {
    const success = config.updateOverrides(req.body);
    res.json({ success });
});

// Logs endpoints
router.get('/admin/logs', requireAuth, (req, res) => {
    const logs = config.getLogs(req.query);
    res.json(logs);
});

module.exports = router;