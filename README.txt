PrimeTac AUTO v2.3 IMPORT DIAG

Что исправлено:
- вместо [object Object] теперь показывает реальный ответ Prom и HTTP-код;
- ответ Prom сохраняется в /auto/state и раскрывается прямо на главной;
- ошибка импорта логируется с status/data/raw;
- YML импорта характеристик теперь содержит обязательные name, categoryId и description;
- в YML добавляются текущие цена/артикул из Prom, но updated_fields остается только ["attributes"], поэтому программа не должна менять цену, остатки, фото или описание;
- сохранены исправления маршрутов /auto/run и /auto/stop из v2.2.

Установка на Render:
1. Полностью замени package.json, README.txt и server.js файлами из этого архива.
2. Environment оставь как есть: PROM_TOKEN, WRITE_ENABLED=true и остальные существующие переменные.
3. Сделай Clear build cache & deploy.
4. На странице должно быть: PrimeTac AUTO v2.3 IMPORT DIAG.
5. Нажми «ПРОВЕРИТЬ И ИСПРАВИТЬ ВСЁ».

Если импорт снова не пройдет, на странице теперь появятся HTTP-код и блок «Ответ Prom» вместо бесполезного [object Object].
