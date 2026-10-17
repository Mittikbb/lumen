# Аддоны Lumen

Аддон — это папка с `manifest.json` и скриптом на JavaScript. Он может добавить на остров
свою вкладку, ответы в поиск (Alt+Space), уведомления, строку активности в свёрнутом острове
и свои настройки.

Готовые примеры: [`examples/addons`](../examples/addons) — «Заметки», «Помидор» и «Без биндов в Доте».

## Установка

1. Настройки → **Аддоны** → **Открыть папку** (это `%APPDATA%\dev.lumen.app\addons`
   на Windows и `~/Library/Application Support/dev.lumen.app/addons` на macOS).
2. Положи туда папку аддона. Lumen увидит её через пару секунд, без перезапуска.
3. Включи аддон в настройках и подтверди разрешения.

Lumen следит за файлами аддона: стоит сохранить `main.js`, и аддон перезапустится сам.

## Безопасность

Каждый аддон работает в отдельном невидимом `<iframe sandbox="allow-scripts">`:

- у него нет доступа к Tauri, файлам, истории буфера, полке, Discord и настройкам Lumen;
- у него нет `localStorage`, cookies, сети (`fetch` заблокирован CSP) и вложенных фреймов;
- всё, что он может, — это `window.lumen`, и каждый вызов остров проверяет по разрешениям,
  которые дал пользователь;
- сеть — только HTTPS, только к хостам из манифеста и только через Lumen (без редиректов);
- если обновлённый аддон просит новые разрешения, он выключается до нового согласия.

Код аддона всё равно исполняется на твоём компьютере: ставь аддоны только от тех, кому доверяешь.

## manifest.json

```json
{
  "id": "notes",
  "name": "Заметки",
  "version": "1.0.0",
  "lumen": 1,
  "author": "Имя",
  "description": "Короткие заметки на острове и в поиске",
  "icon": "📝",
  "main": "main.js",
  "permissions": ["notify", "clipboard"],
  "network": [],
  "tab": { "label": "Заметки", "height": 290 },
  "search": true,
  "settings": []
}
```

| Поле | |
| --- | --- |
| `id` | Уникальный: латиница в нижнем регистре, цифры, `-`, `_`, `.` |
| `name` | До 40 символов |
| `version` | Любая строка, показывается в настройках |
| `lumen` | Версия API, сейчас `1` |
| `icon` | Эмодзи, буква или картинка из папки аддона (`icon.png`, `.svg`, …) |
| `main` | Скрипт, по умолчанию `main.js` |
| `permissions` | См. ниже |
| `network` | Хосты для `network`: `api.example.com` или `*.example.com` |
| `tab` | Своя вкладка: `label` до 16 символов, `height` 180–340 px |
| `search` | `true` — аддон отвечает в поиске |
| `settings` | Свои настройки, см. ниже |

### Разрешения

| | Что даёт |
| --- | --- |
| `notify` | `lumen.notify()` и `lumen.activity` |
| `clipboard` | `lumen.copy()` и `copy` в результатах поиска |
| `links` | `lumen.open()` и `open` в результатах поиска |
| `media` | `lumen.media.get()` и событие `media` |
| `network` | `lumen.fetch()` к хостам из `network` |
| `foreground` | `lumen.foreground.get()` и событие `foreground`: какая программа активна |
| `hotkeys` | `lumen.hotkeys.pause()`: отпустить сочетания клавиш Lumen |

Вкладка, поиск, хранилище и свои настройки разрешений не требуют.

### Настройки

Lumen рисует их под аддоном в разделе «Аддоны», а значения отдаёт в `lumen.settings`:

```json
"settings": [
  { "key": "confirm", "type": "toggle", "label": "Уведомлять", "default": true },
  { "key": "city", "type": "text", "label": "Город", "placeholder": "Казань" },
  { "key": "token", "type": "text", "label": "Токен", "secret": true },
  { "key": "limit", "type": "number", "label": "Сколько", "min": 10, "max": 200, "step": 10, "default": 50 },
  { "key": "units", "type": "select", "label": "Единицы", "default": "c",
    "options": [{ "value": "c", "label": "°C" }, { "value": "f", "label": "°F" }] }
]
```

У каждого поля может быть `hint` — подпись мелким шрифтом. `number` с `min` и `max` —
ползунок, без них — поле ввода.

## API: `window.lumen`

Скрипт аддона запускается сразу; `lumen.ready` — промис, после которого готовы `lumen.settings`.

```js
await lumen.ready;
lumen.id;        // "notes"
lumen.version;   // "1.0.0"
lumen.settings;  // { confirm: true, limit: 50 }
```

### События

```js
const off = lumen.on("settings", (settings) => {});  // пользователь поменял настройки аддона
lumen.on("media", (track) => {});      // сменился трек (нужно media)
lumen.on("foreground", (front) => {}); // сменилась активная программа (нужно foreground)
lumen.on("tab:show", () => {});        // вкладку аддона открыли
lumen.on("tab:hide", () => {});        // и закрыли
off();                                  // отписаться
```

### Вкладка

Аддон не рисует HTML сам: он отдаёт дерево из готовых частей, а остров рисует его в своём стиле.
Каждый `render` полностью заменяет вкладку.

```js
lumen.tab.render({
  type: "column", gap: 10,
  children: [
    { type: "text", style: "title", text: "Привет" },
    { type: "row", gap: 8, children: [
      { type: "stat", label: "Сегодня", value: "12" },
      { type: "stat", label: "Всего", value: "340" },
    ]},
    { type: "input", action: "add", placeholder: "Enter — добавить" },
    { type: "button", label: "Обновить", action: "refresh", style: "primary" },
  ],
});

lumen.tab.onAction((action, value) => {
  // action — из кнопки, строки списка или поля; value — их value (у поля — введённый текст)
});
```

| Часть | Поля |
| --- | --- |
| `column`, `row` | `children`, `gap` (0–32), `align` (`start`, `center`, `end`, `stretch`), `justify` (`start`, `center`, `end`, `between`), `grow`, `scroll` |
| `text` | `text`, `style` (`body`, `title`, `big`, `muted`, `mono`), `grow` |
| `button` | `label`, `action`, `value`, `style` (`normal`, `primary`, `ghost`), `icon` |
| `input` | `action`, `placeholder`, `value`, `clear` (`false` — не очищать после Enter) |
| `list` | `items: [{ id, title, subtitle, trailing, icon, action, value }]`, `empty` |
| `progress` | `value` (0–1), `label` |
| `stat` | `label`, `value` |
| `image` | `src` (файл из папки аддона или `data:image/…`), `width`, `height`, `radius` |
| `divider`, `spacer` | — |

Строка вместо объекта — это просто текст. `null` и `false` пропускаются, так что можно писать
`cond && { … }`. Непонятные части молча пропускаются.

### Поиск

```js
lumen.search.provide(async (query) => [
  { id: "1", title: "Результат", hint: "Подпись", icon: "⭐" },
  { id: "2", title: "Скопировать это", copy: "текст" },        // нужно clipboard
  { id: "3", title: "Открыть сайт", open: "https://example.com" }, // нужно links
]);

lumen.search.onSelect((id) => {
  // Enter на результате без copy/open
});
```

Провайдер вызывается, когда пользователь перестаёт печатать, и должен ответить за 1,5 секунды.
Показываются до 8 результатов от аддона, после программ.

### Остров

```js
lumen.notify("Готово", "Сборка прошла");          // короткое уведомление (не чаще раза в 2 с)
lumen.activity.show({                               // строка в свёрнутом острове, пока не скроешь
  icon: "🍅", title: "Работа", detail: "12:30", progress: 0.4,
});
lumen.activity.hide();
```

### Остальное

```js
await lumen.copy("текст");                          // clipboard
await lumen.open("https://example.com");            // links
const r = await lumen.fetch("https://api.example.com/v1", {   // network
  method: "POST", headers: { "Content-Type": "application/json" }, body: { a: 1 },
});
r.status; r.ok; r.headers["content-type"]; await r.json(); await r.text();

await lumen.storage.set("key", { any: "json" });    // до 1 МБ на аддон, переживает перезапуск
await lumen.storage.get("key", "по умолчанию");
await lumen.storage.remove("key");

await lumen.media.get();                            // { title, artist, app, playing } или null (media)

await lumen.foreground.get();                       // { app: "dota2", title: "Dota 2" } или null (foreground)
await lumen.hotkeys.pause();                        // сочетания Lumen перестают работать (hotkeys)
await lumen.hotkeys.resume();                       // и снова работают
```

`app` — имя файла программы без `.exe`, в нижнем регистре. Пока сам Lumen в фокусе
(например, печатаешь в острове), событие `foreground` не приходит. Сочетания возвращаются,
когда ни один аддон их не держит, в том числе если аддон выключили или он упал.

Ответы `fetch` — текст до 5 МБ. Ошибки (нет разрешения, хост не разрешён) приходят
как отклонённый промис.

## Отладка

Ошибка в манифесте видна в настройках под аддоном. Ошибки скрипта — в инструментах
разработчика острова (в `npm run tauri dev`: правый клик по острову → «Inspect»), фрейм
аддона называется его `id`.
