PrimeTac Control Import v1.7.0

Что делает
----------
1. Формирует тестовый YML из 20 карточек:
   /feeds/prom-test.yml

2. Формирует полный YML текущего выбранного каталога:
   /feeds/prom-full.yml

3. Предпросмотр:
   /api/prom-feed-preview?mode=test
   /api/prom-feed-preview?mode=full

4. Контрольная выгрузка НЕ запускается сама по умолчанию.
   Для однократного запуска используется Render env:
   PROM_TEST_IMPORT_ON_START=true

5. Защита от повторного тестового импорта:
   /var/data/primetac-prom-import-state.json
   После успешного control test v1 повторный restart/deploy не запустит его снова.

6. Тестовый импорт использует официальный Prom API endpoint:
   POST /products/import_url
   и затем проверяет
   GET /products/import/status/{id}

7. Для теста:
   - mark_missing_product_as = none
   - существующие/отсутствующие товары не трогаются
   - только 20 выбранных карточек
   - разновидности имеют одинаковый group_id
   - используются существующие ID групп Prom
   - фото, описания UA/RU, keywords, характеристики, цена, наличие и остатки передаются в YML

8. После SUCCESS 20 тестовых карточек помечаются в enrichment-cache как published.
   Дальнейшие обычные обновления смогут работать в DYNAMIC_ONLY.

ВАЖНО
-----
Сразу после deploy оставляем:
PROM_TEST_IMPORT_ON_START=false

Сначала проверяем:
- /api/prom-feed-preview?mode=test
- /feeds/prom-test.yml
- что exportedFamilies = 20
- что группы существуют
- что XML валиден

Только затем включаем PROM_TEST_IMPORT_ON_START=true.
После успешного импорта переменную снова выключаем.

Файлы
-----
Залить архив целиком.
Новые:
- src/prom-feed.js
- src/prom-import.js

Изменены:
- server.js
- src/ui.js
