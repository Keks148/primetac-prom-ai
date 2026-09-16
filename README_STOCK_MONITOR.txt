PrimeTac AUTO v3.4 STOCK MONITOR

ЧТО ДЕЛАЕТ STOCK MONITOR
- Каждые 4 часа загружает Prom + XML BEZET + Militaris.
- Сопоставляет товар для склада ТОЛЬКО по точному SKU/артикулу.
- Считывает quantity_in_stock / stock_quantity / quantity / stock, если поставщик их передаёт.
- Если точной цифры нет, но XML передаёт available=true/false, обновляет только наличие.
- НЕ меняет цену, название, описание, фото, ключи, группу и характеристики.
- Свежий XML обязателен для записи остатков конкретного поставщика.
- Если XML не загрузился и используется кеш, остатки этого поставщика НЕ перезаписываются.
- Если товар пропал из XML, он только попадает в отчёт. Автомат НЕ ставит его сразу "нет в наличии".
  Это защита от временно битого/неполного XML.
- Если за один запуск найдено больше STOCK_MAX_WRITES изменений, массовая запись блокируется,
  пока STOCK_ALLOW_MASS не включён.

ВАЖНЫЙ ПЕРВЫЙ ЗАПУСК
По умолчанию STOCK_WRITE_ENABLED=false.
Это режим предварительного просмотра.

1. Deploy.
2. Открой сайт.
3. Нажми "Проверить склад сейчас".
4. Посмотри:
   - Заканчиваются
   - Нет в наличии
   - План изменений
   - BEZET/Militaris должны быть "свежий XML"
5. Если цифры адекватные, в Render добавь:
   STOCK_WRITE_ENABLED=true
6. После следующего запуска Stock Monitor начнёт менять только наличие/остаток.

ТОЛЬКО ПОСЛЕ ЭТОГО отключай старый 4-часовой автоимпорт XML в самом Prom.

RENDER ENV
Обязательные:
PROM_TOKEN=...
WRITE_ENABLED=true

Stock Monitor:
STOCK_MONITOR_ENABLED=true
STOCK_WRITE_ENABLED=false     <- сначала false, после проверки true
STOCK_INTERVAL_HOURS=4
STOCK_LOW_THRESHOLD=3
STOCK_MAX_WRITES=250
STOCK_ALLOW_MASS=false
STOCK_BATCH_SIZE=40

Если в первый реальный запуск планируется >250 изменений и ты проверил, что это нормально:
STOCK_ALLOW_MASS=true
После первого выравнивания можно снова вернуть false.

XML:
BEZET_FEED_URL=https://www.bezet.com.ua/sync/prom-second
MILITARIS_FEED_URL=https://militaris.com.ua/content/export/04658108dda3987543769e4a63b496ca.xml

ПРИМЕЧАНИЕ
У BEZET раньше встречался HTTP 524. В таком случае Stock Monitor не выключит товары BEZET
и не запишет старые данные из кеша. Он просто покажет, что источник не свежий.

Страницы:
/
 /stock/state
 /stock/run
 /health
