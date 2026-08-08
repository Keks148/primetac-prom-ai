# PrimeTac Prom AI v6.1

Исправление v6.

## Что было
В `server.js` одна строка JavaScript была случайно разорвана переносом внутри `join("\n")`.
Из-за этого Node.js завершался с синтаксической ошибкой, а Render показывал:

`Exited with status 1 while running your code`

## Что исправлено
- синтаксис `server.js`;
- функциональность v6 сохранена:
  - AI-редактор названия;
  - улучшенное описание на основе данных Militaris;
  - исправление HTML;
  - поиск текущих конкурентов на Prom.ua;
  - расчёт рыночной цены с минимальной маржой;
  - запись цены/названия/описания обратно в Prom.

## Обновление
В GitHub достаточно заменить:
- `server.js`
- `public/index.html`

Можно также заменить README.

После Commit Render автоматически запустит новый Deploy.

Переменные Render остаются:
- PROM_TOKEN
- OPENAI_API_KEY
- OPENAI_MODEL
- OPENAI_WEB_MODEL
- WRITE_ENABLED
- WRITE_PIN
- SELF_PROM_DOMAIN (опционально)
