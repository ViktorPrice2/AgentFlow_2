// CJS WRAPPER: Этот файл является точкой входа для pkg (должен быть CJS).
// Его задача - загрузить основной код в режиме ES Module.

const path = require('path');
const fs = require('fs');

const ROOT_HINT = process.env.AGENTFLOW_ROOT;

const resolveBaseDir = () => {
    if (ROOT_HINT) {
        return path.resolve(ROOT_HINT);
    }
    if (process.pkg) {
        return path.dirname(process.execPath);
    }
    return path.resolve(__dirname, '..');
};

const BASE_DIR = resolveBaseDir();

try {
    process.chdir(BASE_DIR);
} catch (error) {
    console.warn('Could not change working directory:', error.message);
}

// 1. Загрузка dotenv (CommonJS-стиль)
try {
    const dotenv = require('dotenv');
    const envPath = path.join(BASE_DIR, '.env');
    if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
    }
} catch (e) {
    console.warn('Could not load dotenv:', e.message);
}

// 2. Динамический импорт основного ESM-кода (src/server.mjs)
// pkg знает, что 'src/server.mjs' находится внутри его snapshot.
// Динамический import() - единственный надежный способ.
(async () => {
    try {
        // Мы импортируем src/server.mjs (потому что он ESM)
        await import('./server.mjs');
    } catch (error) {
        console.error('Fatal Error during AgentFlow startup:', error);
        process.exit(1);
    }
})();
