# PrimeTac Prom AI

Первая безопасная версия интеграции Prom.ua + OpenAI.

## Что умеет
- Проверяет подключение к Prom API
- Загружает до 50 товаров из Prom
- Загружает заказы
- Считает ориентировочную закупку по условиям Militaris
- Делает AI-анализ карточки товара
- Ничего не меняет в Prom: только чтение

## Установка на Render
1. Распакуйте ZIP.
2. Создайте новый репозиторий GitHub и загрузите туда содержимое папки.
3. В Render создайте Web Service из этого репозитория.
4. Build Command: `npm install`
5. Start Command: `npm start`
6. В Environment добавьте:
   - `PROM_TOKEN` = ваш токен Prom.ua
   - `OPENAI_API_KEY` = ваш OpenAI API key
   - `OPENAI_MODEL` = `gpt-5.6-sol`
7. Deploy.
8. Откройте выданную Render ссылку.

## Важно
Не вставляйте токены в исходный код и не отправляйте их в чат.

Используется Prom API `https://my.prom.ua/api/v1`, в первой версии: `GET /products/list` и `GET /orders/list`, с заголовком `Authorization: Bearer <PROM_TOKEN>`.

## Следующий этап
После проверки чтения можно добавить редактирование цены после подтверждения, синхронизацию с XML Militaris, расчёт маржи и отчёт по слабым карточкам.
