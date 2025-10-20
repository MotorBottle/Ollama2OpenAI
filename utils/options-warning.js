const knownOptionKeys = new Set([
    // Core sampling controls
    'temperature',
    'top_p',
    'top_k',
    'typical_p',
    'min_p',
    'tfs_z',
    'cfg_scale',

    // Length / context controls
    'num_predict',
    'num_ctx',
    'seed',
    'stop',
    'stop_sequences',

    // Repetition / penalties
    'repeat_penalty',
    'repeat_last_n',
    'penalty_decay',
    'presence_penalty',
    'frequency_penalty',

    // Mirostat family
    'mirostat',
    'mirostat_eta',
    'mirostat_tau'
]);

const warnedKeys = new Set();

function processOptions(options, sourceLabel, context = {}, allowUnverified = true) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
        return { sanitized: null, unknownKeys: [] };
    }

    const sanitized = { ...options };
    const unknownKeys = [];

    for (const key of Object.keys(sanitized)) {
        if (knownOptionKeys.has(key)) {
            continue;
        }

        unknownKeys.push(key);
        logOptionWarning(key, sourceLabel, context, allowUnverified);

        if (!allowUnverified) {
            delete sanitized[key];
        }
    }

    return { sanitized, unknownKeys };
}

function logOptionWarning(key, sourceLabel, context, allowUnverified) {
    const warningKey = `${key}:${allowUnverified ? 'allow' : 'block'}`;
    if (warnedKeys.has(warningKey)) {
        return;
    }
    warnedKeys.add(warningKey);

    const parts = [
        '[Ollama2OpenAI]',
        allowUnverified ? 'Warning:' : 'Notice:',
        allowUnverified
            ? `passing through unverified option '${key}'`
            : `blocked unverified option '${key}'`
    ];

    if (sourceLabel) {
        parts.push(`from ${sourceLabel}`);
    }

    if (context.model) {
        parts.push(`for model '${context.model}'`);
    }

    if (context.route) {
        parts.push(`(${context.route})`);
    }

    if (allowUnverified) {
        parts.push('— Ollama may ignore or reject this parameter. Please verify that it behaves as expected.');
    } else {
        parts.push('— Enable "Allow unverified parameters" in the admin panel if you need to pass this through.');
    }

    console.warn(parts.join(' '));
}

module.exports = {
    processOptions
};
