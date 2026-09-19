После Deploy проверьте заголовок: PrimeTac AUTO v3.4.6 STATUS FORCE.
AUTO_STATE_PATH оставьте /var/data/primetac-auto-state.json.

Если на диске остался lock от v3.4.5, новая версия восстановит его и сама перечитает status API.
Если старый импорт уже завершён SUCCESS без изменений, v3.4.6 покажет SUCCESS_NO_EFFECT и снимет lock.
После этого запустите «ПРОВЕРИТЬ И ИСПРАВИТЬ ВСЁ» один раз: новый импорт будет force_update=true только для group + attributes.
