PrimeTac Card Manager v1.8.1 Supplier Fix

Исправлено:
- зависание на «Сопоставляю товары…»
- вместо полного перебора фида используется быстрый индекс по словам
- прогресс сопоставления виден: обработано / всего
- добавлена одна кнопка «Загрузить + сопоставить»
- если фид загрузился, но товары не распознаны, показывается понятная ошибка
- улучшен разбор вложенных характеристик XML
- добавлен One size
- 7 товаров, которые Prom уже отказался принимать по UA keywords, не долбятся повторно в текущем запуске
- добавлена диагностика /api/suppliers/diagnostics

Важно:
Эта версия НЕ записывает характеристики поставщика в Prom. Она только находит и показывает их.
Сначала проверяем совпадения по нескольким товарам.

Render Environment оставить:
PROM_TOKEN=...
WRITE_ENABLED=true
BEZET_FEED_URL=https://www.bezet.com.ua/sync/prom-second
BEZET_SITE_URL=https://www.bezet.com.ua
MILITARIS_FEED_URL=https://militaris.com.ua/content/export/04658108dda3987543769e4a63b496ca.xml
MILITARIS_SITE_URL=https://militaris.com.ua
