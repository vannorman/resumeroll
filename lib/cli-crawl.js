require('dotenv').config();
const db = require('./db');
const { runCrawl } = require('./pipeline');

(async () => {
    await db.connect();
    const run = await runCrawl('cli');
    console.log(run.log.join('\n'));
    process.exit(run.status === 'error' ? 1 : 0);
})();
