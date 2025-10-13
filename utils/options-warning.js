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

function warnUnknownOptions(options, sourceLabel, context = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
        return;
    }

    for (const key of Object.keys(options)) {
        if (knownOptionKeys.has(key)) {
            continue;
        }

        if (warnedKeys.has(key)) {
            continue;
        }
        warnedKeys.add(key);

        const parts = [
            '[Ollama2OpenAI] Warning:',
            `passing through unverified option '${key}'`
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

        parts.push(
            '— Ollama may ignore or reject this parameter. Please verify that it behaves as expected.'
        );

        console.warn(parts.join(' '));
    }
}

module.exports = {
    warnUnknownOptions
};
