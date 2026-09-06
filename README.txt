PrimeTac AUTO v2.5 STABLE

Исправлено:
- [object Object] заменён на нормальный текст ошибки;
- BEZET и Militaris теперь ОБА обязательны для полного запуска;
- если один фид не загрузился, программа автоматически повторяет попытки;
- частичная обработка только одного поставщика больше не запускается;
- на главной видно количество товаров BEZET и Militaris;
- вложенные HTTP 400 ошибки Prom распознаются;
- при занятом импорте программа ждёт и повторяет сама;
- цены, остатки, наличие и фото не меняются.

Render:
PROM_TOKEN=...
WRITE_ENABLED=true

Необязательные:
AUTO_ON_START=true
AUTO_INTERVAL_HOURS=6
AUTO_IMPORT_CHUNK=150
AUTO_IMPORT_LOCK_WAIT_SEC=45
AUTO_IMPORT_LOCK_MAX_MIN=45
AUTO_IMPORT_STATUS_MAX_MIN=30
SUPPLIER_FEED_ATTEMPTS=4
SUPPLIER_FEED_TIMEOUT_MS=90000
SUPPLIER_FEED_RETRY_SEC=8
