PrimeTac Supplier Stats v1.3.0

Заменить:
- server.js

Что добавлено:
- точный подсчет BEZET;
- точный подсчет MILITARIS;
- общий подсчет доступных моделей;
- /api/catalog-stats
- /api/bezet-stats
- /api/militaris-stats
- лог [SUPPLIER_CATALOG_STATS]

Важно:
- режим READ_ONLY;
- в Prom ничего не записывает;
- одинаковые group_id разных поставщиков НЕ смешиваются;
- для общего каталога ключ семьи = supplier + groupId.
