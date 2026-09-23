PrimeTac BEZET Fetch Fix v1.2.1

Что внутри:
- src/config.js
- src/suppliers.js
- .env.example

Что изменено:
1. BEZET URL по умолчанию:
   https://www.bezet.com.ua/sync/prom-second
2. Таймаут по умолчанию 300000 мс.
3. 3 попытки загрузки через fetch.
4. Резервная попытка через Node http/https.
5. В Render-лог выводится точная причина ошибки:
   BEZET_FETCH_ATTEMPT_ERROR
   BEZET_FETCH_FALLBACK_ERROR
   BEZET_FETCH_ERROR
6. При успехе:
   BEZET_XML_OK

Важно:
Этот патч НЕ записывает товары в Prom.
Он только чинит/диагностирует загрузку XML поставщика.
