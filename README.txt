PrimeTac Card Manager v1.8 SUPPLIER ENRICH
=========================================

Добавлены два источника поставщиков:
1. BEZET
   Feed: https://www.bezet.com.ua/sync/prom-second
   Site: https://www.bezet.com.ua
2. Militaris
   Feed: https://militaris.com.ua/content/export/04658108dda3987543769e4a63b496ca.xml
   Site: https://militaris.com.ua

Что делает v1.8:
- сохраняет рабочую массовую запись UA keywords из v1.7.1;
- загружает оба XML-фида;
- строит индекс по SKU/артикулу и названию;
- сопоставляет товары Prom с BEZET/Militaris;
- по кнопке "Данные поставщика" дополнительно открывает страницу конкретного товара;
- показывает найденные у поставщика данные:
  производитель, тип, цвет, размеры, материал/состав, сезон, страну,
  назначение, особенности, мембрану, утеплитель, молнию, вес;
- ничего из этих характеристик в Prom пока НЕ записывает.

Почему страницы товара не загружаются массово:
чтобы не отправлять 1600+ запросов на сайты поставщиков за один запуск.
XML используется массово, а страница товара читается по выбранной карточке.

Порядок:
1. Deploy полной заменой файлов.
2. Сканировать каталог Prom.
3. Нажать "Обновить фиды".
4. После загрузки нажать "Сопоставить с Prom".
5. Открыть любой товар -> "Данные поставщика".
6. Проверить 5-10 карточек BEZET и Militaris.
7. Только после этого можно делать v1.9 TEST записи одной характеристики в Prom.

Render Environment:
PROM_TOKEN=...
WRITE_ENABLED=true
BEZET_FEED_URL=https://www.bezet.com.ua/sync/prom-second
BEZET_SITE_URL=https://www.bezet.com.ua
MILITARIS_FEED_URL=https://militaris.com.ua/content/export/04658108dda3987543769e4a63b496ca.xml
MILITARIS_SITE_URL=https://militaris.com.ua

Остальные переменные можно оставить из прошлой версии.
