PrimeTac Filter v1.5.3

Новые правила:
- Сертификаты BEZET не добавляются вообще.
  Проверка: categoryId=3 или название содержит сертификат/сертифікат.
- Любые товары без фото не добавляются вообще.
  Правило действует для BEZET и MILITARIS.
- BEZET по-прежнему не фильтруется по цене, бренду и обычным категориям.
- MILITARIS сохраняет прежние фильтры:
  от 500 грн, без шлемов, плит, магазинов/боеприпасов,
  без Helikon-Tex, без обуви LOWA,
  одежда/обувь в приоритете, аксессуары сокращаются первыми.
- READ_ONLY сохраняется.
- Category audit и group mapping сохраняются.

Заменить/добавить:
- server.js
- src/suppliers.js
- src/catalog-filter.js
- src/group-mapper.js
- src/category-audit.js
- src/ui.js

После deploy проверяем:
[FILTERED_CATALOG_STATS]
[SUPPLIER_CATEGORY_AUDIT]
[GROUP_MAPPING_AUDIT]
