PrimeTac AUTO v3.0 GROUP MANAGER

Одна автоматическая система:
1. Загружает товары Prom.
2. Загружает ОБА поставщика: BEZET + Militaris.
3. Сопоставляет товары.
4. Дополняет UA-поисковые запросы и слабые описания.
5. Раскладывает товары по фиксированному красивому дереву PrimeTac.
6. Импортирует group + attributes, не меняя цену, остаток и фото товара.
7. Проверяет старые группы и показывает пустые лишние группы.
8. Выбирает фото-кандидат для обложки каждой группы.
9. Повторяет всё автоматически каждые 4 часа.

Дерево хранится в groups.json и содержит меньше 50 групп/подгрупп.
Категории BEZET/Militaris один в один НЕ копируются.

Важно про удаление и фото групп:
По состоянию на документацию Public API Prom доступны GET /groups/list и переводы групп,
но нет опубликованного DELETE группы и метода загрузки изображения группы.
Поэтому v3 автоматически ПЕРЕНОСИТ товары из старых групп и перестаёт их использовать.
Старые пустые группы выводятся в /groups/cleanup для разового удаления в кабинете Prom.
Фото-кандидаты выводятся в /groups/covers для разовой установки.

Render Environment:
PROM_TOKEN=...
WRITE_ENABLED=true

Необязательно:
AUTO_ON_START=true
AUTO_INTERVAL_HOURS=4
AUTO_IMPORT_CHUNK=120
AUTO_IMPORT_LOCK_WAIT_SEC=45
AUTO_IMPORT_LOCK_MAX_MIN=45
AUTO_IMPORT_STATUS_MAX_MIN=30
SUPPLIER_FEED_ATTEMPTS=4
SUPPLIER_FEED_TIMEOUT_MS=90000
SUPPLIER_FEED_RETRY_SEC=8

Страницы:
/
 /groups/plan
 /groups/covers
 /groups/cleanup
 /auto/state
 /auto/last-import.xml

Цены, остатки, наличие и фотографии товаров не меняются.
