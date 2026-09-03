PrimeTac UA Keywords v1.4.1 FIX

Что было сломано:
v1.4 отправляла в PUT /products/translation:
  id: 3183183422

Но Prom вернул в JSON:
  "'product_id' and 'lang' are required fields"

То есть endpoint ждёт:
  product_id: 3183183422
  lang: "uk"

И ещё одна ошибка:
Prom ответил HTTP 200, но внутри JSON лежал error.
v1.4 ошибочно считала любой HTTP 200 успехом.

v1.4.1 исправляет оба момента:
1. id -> product_id
2. JSON error/errors теперь считается ошибкой даже при HTTP 200

Как проверить:
1. Полностью замени файлы текущей версии.
2. Render:
   Build Command: npm install
   Start Command: npm start
3. Environment:
   PROM_TOKEN=твой токен
4. Открой сайт.
5. Нажми "ТЕСТ: записать 1 товар".
6. Если после повторного GET Prom вернёт новые keywords, появится:
   ✅ ПОДТВЕРЖДЕНО

До подтверждения массовую запись не запускаем.
