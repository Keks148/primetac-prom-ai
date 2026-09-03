PrimeTac Card Manager v1.7.1 MASS FIX

Исправлено:
- в интерфейсе реально добавлены кнопки:
  Исправить 25
  Исправить 100
  Исправить ВСЕ
  Стоп
- устранена ошибка:
  Cannot set properties of null (setting 'disabled')
- массовая логика v1.7 сохранена
- меняются только UA поисковые запросы
- после каждого товара Prom повторно проверяется

Render:
PROM_TOKEN=...
WRITE_ENABLED=true
MAX_PRODUCTS=5000
KEYWORD_MIN=5
SCAN_CONCURRENCY=5
FIX_CONCURRENCY=2
VERIFY_DELAY_MS=700
BATCH_SIZE=25

После Deploy:
1. Сканировать весь каталог
2. Убедиться, что видны 4 кнопки массовой обработки
3. Можно запустить 100 или ВСЕ
