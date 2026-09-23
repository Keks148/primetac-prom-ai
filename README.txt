PrimeTac Group Mapping Audit v1.5.0

Заменить/добавить в GitHub:
- server.js
- src/catalog-filter.js
- src/group-mapper.js

Что делает:
- READ_ONLY, ничего не пишет в Prom.
- Берет текущий финальный отбор BEZET + MILITARIS.
- Каждую карточку пытается положить ТОЛЬКО в существующую однозначную группу Prom.
- Не использует дублирующиеся старые группы "Демісезонні" и подобные.
- Если товар не удалось определить безопасно, он получает UNMAPPED.
- Если ID целевой группы исчез/сломался, это BROKEN TARGET.
- Реальную выгрузку нельзя включать, пока mapping audit не станет приемлемым.

После deploy смотреть Render:
[GROUP_MAPPING_AUDIT]

Endpoint:
GET /api/group-mapping-audit
