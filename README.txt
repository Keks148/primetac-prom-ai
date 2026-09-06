PrimeTac AUTO v2.4 AUTO WAIT

Главное исправление:
Prom разрешает только ограниченное число одновременных импортов.
Раньше HTTP 400 сразу завершал весь автомат ошибкой.

Теперь:
- если Prom отвечает HTTP 400 из-за уже активного импорта, программа НЕ падает;
- показывает WAITING_PREVIOUS_IMPORT;
- ждёт 45 секунд и повторяет попытку сама;
- может ждать до 45 минут (настраивается);
- после освобождения импорта продолжает с того же пакета;
- характеристики отправляются партиями;
- статус каждого принятого импорта проверяется до 30 минут;
- /auto/run и /auto/stop работают через GET и POST;
- цены, остатки, наличие и фото не меняются.

Обязательные Render Environment:
PROM_TOKEN=...
WRITE_ENABLED=true

Необязательные:
AUTO_ON_START=true
AUTO_INTERVAL_HOURS=6
AUTO_SEO_CONCURRENCY=5
AUTO_IMPORT_CHUNK=150
AUTO_IMPORT_LOCK_WAIT_SEC=45
AUTO_IMPORT_LOCK_MAX_MIN=45
AUTO_IMPORT_STATUS_MAX_MIN=30

Если на экране:
WAITING_PREVIOUS_IMPORT
ничего вручную делать не нужно. Программа сама повторит импорт.
