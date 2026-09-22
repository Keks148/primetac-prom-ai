# PrimeTac Sync v1.0

Чистий старт нового синхронізатора PrimeTac.

## Поточний режим: READ ONLY

Ця версія нічого не змінює в Prom.ua.

Вона тільки читає:
- товари Prom.ua;
- групи Prom.ua;
- XML BEZET;
- XML Militaris;
- `group_id` сімей різновидів.

## Render

Build command:
`npm install`

Start command:
`npm start`

Health check:
`/health`

## Environment variables

Обов'язкові:
- `PROM_TOKEN`
- `BEZET_XML_URL`
- `MILITARIS_XML_URL`

Опційні:
- `PROM_API_BASE=https://my.prom.ua/api/v1`
- `SYNC_INTERVAL_HOURS=5`
- `AUTO_AUDIT=true`
- `HTTP_TIMEOUT_MS=60000`

## Безпека

- Немає запису в Prom.
- Немає YML-імпорту.
- Немає видалення/переміщення товарів.
- BEZET і Militaris ніколи не змішуються в одну сім'ю лише через однаковий `group_id`.
