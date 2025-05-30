const path = require('path');

// eslint-disable-next-line
const dotEnv = require('dotenv');

const dotEnvPath = path.resolve(__dirname, '../.env');
dotEnv.config({path: dotEnvPath});

const cron = require('node-cron');

const {calculateUptime} = require('./job');

// Запускаем расчет uptime каждый день в 1:00
cron.schedule('0 1 * * *', async () => {
    console.log('Starting scheduled uptime calculation...');
    try {
        await calculateUptime();
        console.log('Finished scheduled uptime calculation');
    } catch (error) {
        console.error('Error during uptime calculation:', error);
    }
});
