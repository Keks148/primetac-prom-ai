PrimeTac AUTO v3.3 NO HANG

Исправляет зависание v3.2 после ACCEPTED.

Что было:
- Prom принимал единый импорт.
- GET /products/import/status/{id} не читался.
- автомат мог висеть на 4/5 до 90 минут.

Что теперь:
- после ACCEPTED status endpoint проверяется максимум ~75 секунд;
- после 3 ошибок status endpoint автомат перестает ждать;
- сам импорт НЕ отменяется: Prom продолжает его в фоне;
- автомат проверяет реальные group_id обычным products/list;
- затем идет на 5/5 и завершает цикл;
- результат снова проверяется на следующем автозапуске через 4 часа;
- добавлена ссылка «Проверить результат Prom».

Render:
PROM_TOKEN=...
WRITE_ENABLED=true
AUTO_INTERVAL_HOURS=4

Необязательно:
AUTO_STATUS_POLL_MAX_SEC=75
AUTO_STATUS_ERROR_LIMIT=3

Цены, остатки, наличие и фото товаров не меняются.
