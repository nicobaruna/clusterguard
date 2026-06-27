// This is a utility for local development to simulate loading .env files.
// In a real production build, these variables would be replaced by a build tool (e.g., Vite, Webpack).
async function loadEnv() {
    try {
        if (typeof window === 'undefined') {
            return;
        }

        const response = await fetch('.env');
        if (!response.ok) {
            throw new Error('Could not load .env file. Make sure it exists in the root directory.');
        }
        const text = await response.text();
        const lines = text.split('\n');
        const env = {};
        for (const line of lines) {
            if (line.trim() === '' || line.startsWith('#')) {
                continue;
            }
            const [key, ...valueParts] = line.split('=');
            const value = valueParts.join('=').trim().replace(/^"|"$/g, ''); // Remove surrounding quotes
            if (key) {
                env[key.trim()] = value;
            }
        }
        window.env = { ...(window.env || {}), ...env };
        console.log('Environment variables loaded for local development.');
    } catch (error) {
        console.error('Failed to load environment variables:', error);
        // Provide fallback empty object to prevent errors on window.env access
        if (typeof window !== 'undefined') {
            window.env = { ...(window.env || {}) };
        }
    }
}

// We need to block and wait for this to complete before other scripts run.
// A better approach in a real app might be to chain promises or use top-level await in modules.
await loadEnv();