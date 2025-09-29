const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config/config');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware setup
app.use(morgan('combined', {
    stream: fs.createWriteStream(path.join(__dirname, 'logs', 'access.log'), { flags: 'a' })
}));
app.use(morgan('dev'));

// CORS configuration
app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        // Allow any origin for development, but you can restrict this in production
        return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization']
}));

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'ollama2openai-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Routes
const adminRoutes = require('./routes/admin');
const apiRoutes = require('./routes/api');
const anthropicRoutes = require('./routes/anthropic');

// Admin interface routes
app.use('/', adminRoutes);

// OpenAI compatible API routes
app.use('/v1', apiRoutes);

// Anthropic compatible API routes
app.use('/anthropic/v1', anthropicRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
    console.log(`Ollama2OpenAI gateway server running on port ${PORT}`);
    console.log(`Admin interface: http://localhost:${PORT}`);
    console.log(`OpenAI API endpoint: http://localhost:${PORT}/v1/chat/completions`);
    console.log('DEBUG: Server started, console.log is working');
    console.log('DEBUG: Current ollamaUrl from config:', config.config.ollamaUrl);
});

module.exports = app;
