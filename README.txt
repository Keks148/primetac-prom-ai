PrimeTac Hotfix v1.5.1

Причина:
v1.5.0 успешно стартовал, но несколько startup-аудитов подряд повторно скачивали и парсили два больших XML.
Render начал перезапускать instance до завершения GROUP_MAPPING_AUDIT.
Также старая главная страница ожидала поле samples.families и могла отдавать 500.

Исправлено:
- общий 15-минутный supplier snapshot/cache;
- одновременные запросы присоединяются к одному fetch вместо повторной загрузки;
- BEZET и MILITARIS получают корректный Referer;
- dashboard больше не падает на отсутствии samples.families;
- Group Mapping v1.5.0 сохранен;
- READ_ONLY сохранен;
- расписание 04/08/11/14/17/20/23 Kyiv сохранено.

Заменить в GitHub:
- server.js
- src/catalog-filter.js
- src/group-mapper.js
- src/suppliers.js
- src/ui.js

После deploy проверяем:
- [SUPPLIERS_SNAPSHOT_READY]
- [SUPPLIERS_CACHE_HIT] / [SUPPLIERS_CACHE_JOIN]
- [GROUP_MAPPING_AUDIT]
- отсутствие повторных restart
