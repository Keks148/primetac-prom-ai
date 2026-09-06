PrimeTac AUTO v2.2 ROUTE FIX

Исправлено:
- Cannot GET /auto/run
- кнопка запуска работает через GET и POST
- кнопка Стоп работает через GET и POST
- /auto/run/ и /auto/stop/ тоже поддерживаются
- после запуска всегда возврат на главную страницу
- главная страница отдаётся без кеша, чтобы Android не показывал старую версию

После полной замены файлов и Clear build cache & deploy сверху должно быть:
PrimeTac AUTO v2.2 ROUTE FIX

Render Environment оставь как есть: PROM_TOKEN, WRITE_ENABLED=true и другие существующие переменные.
