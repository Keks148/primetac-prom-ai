PrimeTac Editor v2.2.0 STABILITY

Что исправлено:
- быстрый цикл может снова работать каждые 30 минут, но он занимается главным образом
  повторным скрытием запрещённых товаров;
- ключи/описания/RU-переводы больше не гоняются каждые 30 минут;
- контентный проход выполняется не чаще чем раз в 240 минут
  (PROM_EDITOR_CONTENT_INTERVAL_MINUTES);
- в логах отдельно видны removalEdits и contentEdits;
- занятый импорт Prom больше не считается аварией enrichment;
- при сообщении Prom про одновременный импорт система пишет
  PROM_ENRICH_IMPORT_BUSY и спокойно повторяет попытку на следующем цикле;
- цена, SKU и остатки нужных товаров этим патчем не меняются.

Загрузить поверх текущих:
src/prom-editor.js
src/enrichment-import.js

После загрузки вернуть:
PROM_EDITOR_INTERVAL_MINUTES=30
PROM_EDITOR_CONTENT_INTERVAL_MINUTES=240
PROM_ENRICH_IMPORT_INTERVAL_MINUTES=60
