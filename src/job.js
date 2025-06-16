const _ = require('lodash');
const moment = require('moment');

const {getDataFromClickhouse, insertUptimeData} = require('./clickhouse');

async function calculateUptime(daysAgo = 1) {
    const targetDate = moment().subtract(daysAgo, 'days');

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

    // Для расчета uptime по сервису
    const serviceMinutesMap = {};

    for (const [serviceAction, records] of Object.entries(groupedData)) {
        const [service, action] = serviceAction.split(':');

        console.log(`Processing ${service}:${action} with ${records.length} records`);

        // Группируем записи по минутам
        const recordsByMinute = _.groupBy(records, (record) => {
            return moment(record.timestamp).format('YYYY-MM-DD HH:mm');
        });

        let totalMinutes = 0;
        let downMinutes = 0;

        // Инициализируем структуру для хранения данных по сервису, если её ещё нет
        if (!serviceMinutesMap[service]) {
            serviceMinutesMap[service] = {
                downMinutes: {}, // Минуты, в которых была недоступна хотя бы одна ручка
                totalMinutes: new Set(), // Все минуты, в которые был хотя бы один запрос
            };
        }

        // Анализируем каждую минуту
        for (const [minute, minuteRecords] of Object.entries(recordsByMinute)) {
            totalMinutes++;
            serviceMinutesMap[service].totalMinutes.add(minute);

            // Подсчитываем общее количество запросов и количество 5xx ошибок
            const totalRequests = minuteRecords.length;
            const errorRequests = minuteRecords.filter(
                (record) => record.responseStatus >= 500 && record.responseStatus < 600,
            ).length;

            // Вычисляем процент ошибок
            const errorPercentage = (errorRequests / totalRequests) * 100;

            // Если процент ошибок больше 5%, считаем минуту недоступной
            const isMinuteDown = errorPercentage > 5;
            if (isMinuteDown) {
                downMinutes++;
                // Отмечаем минуту как недоступную для сервиса
                serviceMinutesMap[service].downMinutes[minute] = false;
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

    // Рассчитываем uptime для каждого сервиса в целом
    for (const [service, data] of Object.entries(serviceMinutesMap)) {
        const totalMinutes = data.totalMinutes.size;
        const downMinutes = Object.keys(data.downMinutes).length;

        // Вычисляем uptime в процентах для сервиса
        const serviceUptimePercentage =
            totalMinutes > 0 ? ((totalMinutes - downMinutes) / totalMinutes) * 100 : 100;

        const serviceUptimeData = {
            timestamp: targetDate.valueOf(),
            service,
            action: '*', // Специальное значение для обозначения всего сервиса
            uptimePercentage: Math.round(serviceUptimePercentage * 100) / 100, // Округляем до 2 знаков
            totalMinutes: totalMinutes,
            downMinutes: downMinutes,
        };

        uptimeResults.push(serviceUptimeData);
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
