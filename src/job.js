const _ = require('lodash');
const moment = require('moment');

const {getDataFromClickhouse, insertUptimeData} = require('./clickhouse');

async function calculateUptime() {
    const targetDate = moment().subtract(5, 'days');

    console.log(`Calculating uptime for date: ${targetDate.format('YYYY-MM-DD')}`);

    const clickhouseData = await getDataFromClickhouse(targetDate);

    if (!clickhouseData || clickhouseData.length === 0) {
        console.log('No data found for the target date');
        return;
    }

    console.log(`Processing ${clickhouseData.length} records`);

    // Фильтруем данные, исключая записи с пустыми service или action
    const filteredData = clickhouseData.filter(
        (item) =>
            item.service && item.service.trim() !== '' && item.action && item.action.trim() !== '',
    );

    console.log(
        `After filtering: ${filteredData.length} records (removed ${
            clickhouseData.length - filteredData.length
        } records with empty service or action)`,
    );

    // Группируем данные по сервису и действию
    const groupedData = _.groupBy(filteredData, (item) => `${item.service}:${item.action}`);

    const uptimeResults = [];

    for (const [serviceAction, records] of Object.entries(groupedData)) {
        const [service, action] = serviceAction.split(':');

        console.log(`Processing ${service}:${action} with ${records.length} records`);

        // Группируем записи по минутам
        const recordsByMinute = _.groupBy(records, (record) => {
            return moment(record.timestamp).format('YYYY-MM-DD HH:mm');
        });

        let totalMinutes = 0;
        let downMinutes = 0;

        // Анализируем каждую минуту
        for (const minuteRecords of Object.values(recordsByMinute)) {
            totalMinutes++;

            // Подсчитываем общее количество запросов и количество 5xx ошибок
            const totalRequests = minuteRecords.length;
            const errorRequests = minuteRecords.filter(
                (record) => record.responseStatus >= 500 && record.responseStatus < 600,
            ).length;

            // Вычисляем процент ошибок
            const errorPercentage = (errorRequests / totalRequests) * 100;

            // Если процент ошибок больше 5%, считаем минуту недоступной
            if (errorPercentage > 5) {
                downMinutes++;
            }
        }

        // Вычисляем uptime в процентах
        const uptimePercentage =
            totalMinutes > 0 ? ((totalMinutes - downMinutes) / totalMinutes) * 100 : 100;

        const uptimeData = {
            timestamp: targetDate.valueOf(),
            service,
            action,
            uptimePercentage: Math.round(uptimePercentage * 100) / 100, // Округляем до 2 знаков
            totalMinutes: totalMinutes,
            downMinutes: downMinutes,
        };

        uptimeResults.push(uptimeData);
    }

    // Записываем результаты в ClickHouse
    if (uptimeResults.length > 0) {
        console.log(`Inserting ${uptimeResults.length} uptime records into ClickHouse`);

        await insertUptimeData(uptimeResults);

        console.log('Uptime calculation completed successfully');
    } else {
        console.log('No uptime data to insert');
    }
}

module.exports = {
    calculateUptime,
};
