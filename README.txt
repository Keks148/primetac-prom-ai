PrimeTac Category Mapping v1.5.4

Сохраняет правила v1.5.3:
- BEZET сертификаты не добавляются;
- товары без фото не добавляются;
- MILITARIS: от 500 грн, без шлемов, плит, оружейных магазинов/боеприпасов,
  без Helikon-Tex, без обуви LOWA;
- одежда/обувь приоритетнее аксессуаров.

Новое:
- постоянная supplier category ID -> существующая группа Prom;
- точная категория поставщика используется первой;
- для широких/неизвестных категорий остается безопасный name-based fallback;
- товар без названия остается UNMAPPED;
- новые группы Prom не создаются;
- исчезнувший target group ID дает brokenTarget и должен блокировать импорт;
- READ_ONLY сохраняется.

Заменить/добавить:
- server.js
- src/suppliers.js
- src/catalog-filter.js
- src/group-mapper.js
- src/category-audit.js
- src/ui.js

После deploy смотрим [GROUP_MAPPING_AUDIT].
