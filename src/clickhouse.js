const ClickHouse = require('@apla/clickhouse');
const _ = require('lodash');

const {getEnv} = require('./utils');

const CH_HOST = getEnv('CH_HOST');
const CH_USER = getEnv('CH_USER');
const CH_PASSWORD = getEnv('CH_PASSWORD');
const CH_DATABASE = getEnv('CH_DATABASE');
const CH_TABLE = getEnv('CH_TABLE');

async function sendQueueToClickhouse(queue) {
    const clickhouse = new ClickHouse({
        host: `shard1.${CH_HOST}`,
        port: 8443,
        user: CH_USER,
        password: CH_PASSWORD,
        rejectUnauthorized: false,
        protocol: 'https:',
        dataObjects: true,
    });

    try {
        return await clickhouse.querying(queue);
    } catch (error) {
        console.error('CLICKHOUSE_QUERYING_ERROR', error);
        return null;
    }
}

async function getDataFromClickhouse(targetDate, timestampColumn = 'timestamp') {
    const date = targetDate.format('YYYY-MM-DD');

    const queue = `SELECT service, action, responseStatus, timestamp FROM ${CH_DATABASE}.${CH_TABLE} WHERE toDate(${timestampColumn}) = '${date}' ORDER BY ${timestampColumn} ASC`;
    const response = await sendQueueToClickhouse(queue);

    return _.get(response, 'data');
}

async function insertUptimeData(uptimeData) {
    if (!uptimeData || uptimeData.length === 0) {
        console.log('No uptime data to insert');
        return;
    }

    const values = uptimeData
        .map(
            (data) =>
                `('${data.date}', '${data.service}', '${data.action}', ${data.uptime_percentage}, ${data.total_minutes}, ${data.down_minutes})`,
        )
        .join(',');

    const queue = `
        INSERT INTO ${CH_DATABASE}.uptimeStats 
        (timestamp, service, action, uptimePercentage, totalMinutes, downMinutes) 
        VALUES ${values}
    `;

    return await sendQueueToClickhouse(queue);
}

module.exports = {
    getDataFromClickhouse,
    insertUptimeData,
};
