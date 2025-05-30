const {createClient} = require('@clickhouse/client');
const moment = require('moment');

const {getEnv} = require('./utils');

const CH_HOST = getEnv('CH_HOST');
const CH_USER = getEnv('CH_USER');
const CH_PASSWORD = getEnv('CH_PASSWORD');
const CH_DATABASE = getEnv('CH_DATABASE');
const CH_TABLE = getEnv('CH_TABLE');

const BATCH_SIZE = 1000;

function createClickhouseClient() {
    return createClient({
        url: `https://shard1.${CH_HOST}:8443`,
        username: CH_USER,
        password: CH_PASSWORD,
        database: CH_DATABASE,
    });
}

async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getDataFromClickhouse(targetDate, timestampColumn = 'timestamp') {
    const clickhouse = createClickhouseClient();
    const date = targetDate.format('YYYY-MM-DD');
    const resultRows = [];

    try {
        const query = `
            SELECT service, action, responseStatus, timestamp 
            FROM ${CH_DATABASE}.${CH_TABLE} 
            WHERE toDate(${timestampColumn}) = '${date}' 
            ORDER BY ${timestampColumn} ASC
        `;

        const resultSet = await clickhouse.query({
            query,
            format: 'JSONEachRow',
        });

        const stream = resultSet.stream();

        stream.on('data', (rows) => {
            rows.forEach((row) => {
                resultRows.push(row.json());
            });
        });

        await new Promise((resolve) => {
            stream.on('end', () => {
                resolve();
            });

            stream.on('error', (error) => {
                console.error('Failed to get data from stream', error);
                resolve();
            });
        });
        await clickhouse.close();
    } catch (error) {
        console.error('Failed to get data from clickhouse', error);
    }

    return resultRows;
}

async function insertBatchWithRetry(batch, batchNumber, maxRetries = 3) {
    const clickhouse = createClickhouseClient();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const values = batch.map((data) => {
                // Преобразуем Unix timestamp в дату для ClickHouse
                const formattedTimestamp = moment(data.timestamp).format('YYYY-MM-DD');

                return {
                    timestamp: formattedTimestamp,
                    service: data.service,
                    action: data.action,
                    uptimePercentage: data.uptimePercentage,
                    totalMinutes: data.totalMinutes,
                    downMinutes: data.downMinutes,
                };
            });

            await clickhouse.insert({
                table: `${CH_DATABASE}.uptimeStats`,
                values,
                format: 'JSONEachRow',
            });

            clickhouse.close();

            return true;
        } catch (error) {
            console.error(`Batch ${batchNumber}, attempt ${attempt} failed:`, error.message);

            if (attempt === maxRetries) {
                console.error(`Batch ${batchNumber} failed after ${maxRetries} attempts`);

                clickhouse.close();

                return false;
            }

            // Увеличиваем задержку с каждой попыткой
            const delay = attempt * 2000;
            console.log(`Retrying batch ${batchNumber} in ${delay}ms...`);
            await sleep(delay);
        }
    }

    clickhouse.close();

    return false;
}

async function insertUptimeData(uptimeData) {
    if (!uptimeData || uptimeData.length === 0) {
        console.log('No uptime data to insert');
        return;
    }

    // Разбиваем массив на куски по BATCH_SIZE элементов
    const batches = [];

    for (let i = 0; i < uptimeData.length; i += BATCH_SIZE) {
        batches.push(uptimeData.slice(i, i + BATCH_SIZE));
    }

    console.log(`Splitting data into ${batches.length} batches of ${BATCH_SIZE} records each`);

    let successfulBatches = 0;
    let failedBatches = 0;

    // Обрабатываем каждый батч с retry логикой
    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];

        console.log(`Processing batch ${i + 1}/${batches.length} (${batch.length} records)`);

        const success = await insertBatchWithRetry(batch, i + 1);

        if (success) {
            successfulBatches++;
            console.log(`Batch ${i + 1} inserted successfully`);
        } else {
            failedBatches++;
        }

        // Добавляем таймаут между запросами (кроме последнего батча)
        if (i < batches.length - 1) {
            await sleep(1000);
        }
    }

    console.log(
        `Batch insertion completed. Successful: ${successfulBatches}, Failed: ${failedBatches}`,
    );

    return;
}

module.exports = {
    getDataFromClickhouse,
    insertUptimeData,
};
