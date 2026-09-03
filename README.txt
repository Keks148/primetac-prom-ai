PrimeTac Prom Keywords Diagnostic v1.2
=========================================

ЭТО ДИАГНОСТИЧЕСКАЯ ВЕРСИЯ.
ОНА НИЧЕГО НЕ ЗАПИСЫВАЕТ В PROM.

Зачем:
предыдущая версия видит у всех 1611 товаров поле keywords,
но кабинет Prom продолжает показывать 90% и просит "Прописати ключові слова для пошуку".

Поэтому сначала точно определяем, где именно Prom хранит нужное поле.

Что проверяется у 3 товаров:
1. GET /products/list
2. GET /products/{id} с X-LANGUAGE=uk
3. GET /products/{id} с X-LANGUAGE=ru
4. GET /products/translation/{id}?lang=uk
5. GET /products/translation/{id}?lang=ru

На экране отдельно будут:
- keywords
- search_keywords
- searchKeywords
- translation keywords
- raw JSON перевода

Как установить:
1. Удали файлы текущей версии из GitHub.
2. Загрузи файлы из этого архива в корень репозитория.
3. Render:
   Build Command: npm install
   Start Command: npm start
4. Environment нужен только:
   PROM_TOKEN=твой существующий Prom token

WRITE_ENABLED не нужен, потому что эта версия только читает.

После Deploy:
1. Открой сайт.
2. Нажми "Проверить 3 товара".
3. Сделай один или несколько скриншотов результатов.
4. По результату уже делается финальная версия массового автозаполнения.

Можно также ввести конкретный Prom ID товара и нажать "Проверить ID".
Лучше взять товар, где в кабинете Prom явно видно 90% и подсказку про ключевые слова.
