PrimeTac AUTO v3.4.5 PERSIST LOCK

Установка как раньше:
1. Заменить файлы проекта файлами из этой папки.
2. Commit / Push в GitHub.
3. Render -> Manual Deploy -> Deploy latest commit.
4. После запуска на странице должно быть: v3.4.5 PERSIST LOCK.

ВАЖНО
- Не нажимать запуск повторно, пока отображается Persistent lock: ВКЛ.
- Новый импорт блокируется до подтверждения старого.
- В панели теперь видны import ID, время принятия, fingerprint и последняя ошибка status API.

Рекомендуемые Render Environment:
AUTO_ON_START=false
AUTO_IMPORT_STATUS_MAX_MIN=15
AUTO_BACKGROUND_WATCH_MAX_MIN=120
AUTO_STARTUP_SAFE_DELAY_MIN=30

Для максимальной защиты между Deploy:
- подключить Render Persistent Disk с mount path /var/data
- добавить Environment:
  AUTO_STATE_PATH=/var/data/primetac-auto-state.json

Без Persistent Disk lock всё равно защищает от дублей во время жизни текущего Render-инстанса, но Render может удалить локальный файл при полном Deploy/пересоздании инстанса.

Аварийное ручное снятие lock:
/auto/unlock?confirm=UNLOCK
Использовать только после ручной проверки, что в Prom точно нет незавершённого импорта.

Первый Deploy поверх v3.4.4:
после запуска v3.4.5 кнопка будет заблокирована примерно на 30 минут. Это нормально и специально сделано, чтобы текущая задача Prom от v3.4.4 не получила дубль.
