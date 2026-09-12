PrimeTac AUTO v3.1 SINGLE IMPORT

Исправление зависания на 120/1606.

Почему v3.0 останавливался на 120:
- каталог делился на партии по 120;
- первая партия отправлялась в Prom;
- программа ждала завершения этой импорт-задачи;
- цифра 120/1606 уже была показана ДО фактического завершения импорта, поэтому выглядело как зависание.

В v3.1:
- больше НЕТ импорта партиями по 120;
- группы + характеристики всего каталога отправляются ОДНИМ YML импортом;
- Prom возвращает ID задачи;
- программа опрашивает GET /products/import/status/{id};
- на экране видно реальный статус: ACCEPTED / PROCESSING / SUCCESS и время ожидания;
- максимальное ожидание статуса по умолчанию 90 минут;
- после SUCCESS запускается аудит групп;
- каждые 4 часа процесс повторяется.

Не меняются:
- цена
- остаток
- наличие
- фото товара

Render:
PROM_TOKEN=...
WRITE_ENABLED=true

Необязательно:
AUTO_ON_START=true
AUTO_INTERVAL_HOURS=4
AUTO_IMPORT_STATUS_MAX_MIN=90
AUTO_IMPORT_LOCK_WAIT_SEC=45
AUTO_IMPORT_LOCK_MAX_MIN=45
SUPPLIER_FEED_ATTEMPTS=4
SUPPLIER_FEED_TIMEOUT_MS=90000
SUPPLIER_FEED_RETRY_SEC=8

AUTO_IMPORT_CHUNK больше не используется.
