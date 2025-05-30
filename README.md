# ClickHouse Telemetry Uptime Calculator

Система для расчета uptime по каждой ручке сервиса на основе данных телеметрии из ClickHouse.

## Описание

Система анализирует данные телеметрии и рассчитывает uptime для каждой комбинации сервис:действие. Ручка считается недоступной, если в течение минуты количество запросов со статусом 5xx превышает 5% от общего количества запросов.

## Особенности

- Использует библиотеку `@clickhouse/client` для работы с ClickHouse
- Запуск каждый день в 1:00 по расписанию
- Анализ данных за предыдущий день
- Расчет uptime по дням
- Автоматическое создание таблицы для результатов
- Простая вставка новых записей
- Поддержка batch-вставки с retry-логикой
- Корректное управление соединениями с ClickHouse

## Структура проекта

```
src/
├── index.js        # Основной файл с cron-задачей
├── job.js          # Логика расчета uptime
├── clickhouse.js   # Работа с ClickHouse
└── utils.js        # Утилиты
```

## Настройка

1. Скопируйте `.env.example` в `.env` и заполните переменные окружения:

```bash
CH_HOST=your-clickhouse-host
CH_USER=your-username
CH_PASSWORD=your-password
CH_DATABASE=your-database
CH_TABLE=your-telemetry-table
```

2. Установите зависимости:

```bash
npm install
```

## Запуск

```bash
npm start
```

Система запустится и будет выполнять расчет uptime каждый день в 1:00.

## Формат входных данных

Система ожидает данные в следующем формате:

```json
{
  "service": "session-service",
  "action": "check",
  "responseStatus": 200,
  "timestamp": "2025-05-27 11:00:00"
}
```

## Формат выходных данных

Результаты сохраняются в таблицу `uptimeStats`:

```sql
CREATE TABLE uptimeStats (
    timestamp Date,
    service String,
    action String,
    uptimePercentage Float64,
    totalMinutes UInt32,
    downMinutes UInt32,
) ENGINE = MergeTree()
ORDER BY (timestamp, service, action)
```

## Логика расчета

1. Данные группируются по сервису и действию
2. Для каждой группы данные разбиваются по минутам
3. Для каждой минуты рассчитывается процент ошибок 5xx
4. Если процент ошибок > 5%, минута считается недоступной
5. Uptime = (общее количество минут - недоступные минуты) / общее количество минут * 100%

## Примеры запросов

Получить uptime за последние 7 дней:

```sql
SELECT 
    service,
    action,
    AVG(uptimePercentage) as avgUptime,
    SUM(totalMinutes) as totalMinutes,
    SUM(downMinutes) as totalDownMinutes
FROM uptimeStats 
WHERE timestamp >= today() - 7
GROUP BY service, action
ORDER BY avgUptime ASC
```

Получить детальную статистику по дням:

```sql
SELECT 
    date,
    service,
    action,
    uptimePercentage,
    totalMinutes,
    downMinutes
FROM uptimeStats 
WHERE service = 'your-service' AND action = 'your-action'
ORDER BY date DESC
LIMIT 30
