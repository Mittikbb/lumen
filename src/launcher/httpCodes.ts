export const GITHUB_REPO_URL = "https://github.com/lackyhy/Protocol-list";

export interface HttpCodeInfo {
  kind: "http";
  code: number;
  phrase: string;
  nameRu: string;
  description: string;
  category: "1xx" | "2xx" | "3xx" | "4xx" | "5xx";
}

export interface ProtocolInfo {
  kind: "protocol";
  id: string;
  name: string;
  fullName: string;
  description: string;
  docUrl: string;
}

export interface GithubHelpItem {
  kind: "github-help";
  title: string;
  url: string;
  hint: string;
}

export type NetworkSearchResult = HttpCodeInfo | ProtocolInfo | GithubHelpItem;

export const HTTP_CODES: HttpCodeInfo[] = [
  // 1xx Informational
  {
    kind: "http",
    code: 100,
    phrase: "Continue",
    nameRu: "Продолжай",
    description: "Запрос принят, клиент должен продолжать отправку тела запроса.",
    category: "1xx",
  },
  {
    kind: "http",
    code: 101,
    phrase: "Switching Protocols",
    nameRu: "Переключение протоколов",
    description: "Сервер согласен переключить протокол (например, на WebSocket) согласно Upgrade.",
    category: "1xx",
  },
  {
    kind: "http",
    code: 102,
    phrase: "Processing",
    nameRu: "Идёт обработка",
    description: "WebDAV: запрос принят и обрабатывается, ответ пока не сформирован.",
    category: "1xx",
  },
  {
    kind: "http",
    code: 103,
    phrase: "Early Hints",
    nameRu: "Ранние подсказки",
    description: "Предварительные заголовки (Link) для ранней предзагрузки ресурсов браузером.",
    category: "1xx",
  },

  // 2xx Success
  {
    kind: "http",
    code: 200,
    phrase: "OK",
    nameRu: "Успешно",
    description: "Запрос успешно обработан сервером.",
    category: "2xx",
  },
  {
    kind: "http",
    code: 201,
    phrase: "Created",
    nameRu: "Создано",
    description: "Ресурс успешно создан в результате выполнения запроса.",
    category: "2xx",
  },
  {
    kind: "http",
    code: 202,
    phrase: "Accepted",
    nameRu: "Принято",
    description: "Запрос принят на обработку, но ещё не завершён (асинхронная задача).",
    category: "2xx",
  },
  {
    kind: "http",
    code: 203,
    phrase: "Non-Authoritative Information",
    nameRu: "Информация не от первоисточника",
    description: "Запрос успешен, но данные получены через трансформирующий прокси или кэш.",
    category: "2xx",
  },
  {
    kind: "http",
    code: 204,
    phrase: "No Content",
    nameRu: "Нет содержимого",
    description: "Запрос выполнен успешно, контент в теле ответа намеренно отсутствует.",
    category: "2xx",
  },
  {
    kind: "http",
    code: 205,
    phrase: "Reset Content",
    nameRu: "Сбросить содержимое",
    description: "Запрос выполнен, клиент должен сбросить представление документа (очистить форму).",
    category: "2xx",
  },
  {
    kind: "http",
    code: 206,
    phrase: "Partial Content",
    nameRu: "Частичное содержимое",
    description: "Сервер возвращает часть ресурса согласно диапазону заголовка Range (докачка, стриминг).",
    category: "2xx",
  },
  {
    kind: "http",
    code: 207,
    phrase: "Multi-Status",
    nameRu: "Многостатусный (WebDAV)",
    description: "Сообщение содержит несколько статусов для разных частей запроса.",
    category: "2xx",
  },
  {
    kind: "http",
    code: 208,
    phrase: "Already Reported",
    nameRu: "Уже сообщалось (WebDAV)",
    description: "Повторяющиеся зависимости уже были перечислены ранее в текущем ответе.",
    category: "2xx",
  },
  {
    kind: "http",
    code: 226,
    phrase: "IM Used",
    nameRu: "Использованы манипуляции",
    description: "Сервер выполнил GET-запрос и применил дельта-кодирование (RFC 3229).",
    category: "2xx",
  },

  // 3xx Redirection
  {
    kind: "http",
    code: 300,
    phrase: "Multiple Choices",
    nameRu: "Множество вариантов",
    description: "Доступно несколько вариантов ресурса (форматы, языки), сервер предлагает выбрать.",
    category: "3xx",
  },
  {
    kind: "http",
    code: 301,
    phrase: "Moved Permanently",
    nameRu: "Перемещено навсегда",
    description: "Ресурс перемещён навсегда на новый URL. Браузеры кэшируют этот редирект.",
    category: "3xx",
  },
  {
    kind: "http",
    code: 302,
    phrase: "Found",
    nameRu: "Найдено (Временное перенаправление)",
    description: "Временное перенаправление ресурса на другой URL.",
    category: "3xx",
  },
  {
    kind: "http",
    code: 303,
    phrase: "See Other",
    nameRu: "Смотри другое",
    description: "Ответ на запрос находится по другому адресу (всегда ведёт к GET).",
    category: "3xx",
  },
  {
    kind: "http",
    code: 304,
    phrase: "Not Modified",
    nameRu: "Не изменялось",
    description: "Ресурс не изменился с момента последнего обращения (кэш клиента актуален).",
    category: "3xx",
  },
  {
    kind: "http",
    code: 305,
    phrase: "Use Proxy",
    nameRu: "Используйте прокси",
    description: "Запрос к ресурсу должен осуществляться через указанный прокси-сервер.",
    category: "3xx",
  },
  {
    kind: "http",
    code: 307,
    phrase: "Temporary Redirect",
    nameRu: "Временное перенаправление",
    description: "Временное перенаправление с обязательным сохранением исходного метода запроса.",
    category: "3xx",
  },
  {
    kind: "http",
    code: 308,
    phrase: "Permanent Redirect",
    nameRu: "Постоянное перенаправление",
    description: "Постоянное перенаправление с обязательным сохранением исходного метода запроса.",
    category: "3xx",
  },

  // 4xx Client Error
  {
    kind: "http",
    code: 400,
    phrase: "Bad Request",
    nameRu: "Некорректный запрос",
    description: "Сервер не может обработать запрос из-за синтаксической ошибки клиента.",
    category: "4xx",
  },
  {
    kind: "http",
    code: 401,
    phrase: "Unauthorized",
    nameRu: "Не авторизован",
    description: "Для доступа к ресурсу требуется аутентификация (заголовок Authorization).",
    category: "4xx",
  },
  {
    kind: "http",
    code: 402,
    phrase: "Payment Required",
    nameRu: "Требуется оплата",
    description: "Зарезервировано для будущих систем цифровых платежей.",
    category: "4xx",
  },
  {
    kind: "http",
    code: 403,
    phrase: "Forbidden",
    nameRu: "Доступ запрещён",
    description: "Сервер понял запрос, но доступ запрещён из-за недостатка прав.",
    category: "4xx",
  },
  {
    kind: "http",
    code: 404,
    phrase: "Not Found",
    nameRu: "Ресурс не найден",
    description: "Сервер не может найти запрашиваемый ресурс по указанному адресу.",
    category: "4xx",
  },
  {
    kind: "http",
    code: 405,
    phrase: "Method Not Allowed",
    nameRu: "Метод не поддерживается",
    description: "Метод (GET, POST и т.д.) не поддерживается для данного URL.",
    category: "4xx",
  },
  {
    kind: "http",
    code: 406,
    phrase: "Not Acceptable",
    nameRu: "Неприемлемо",
    description: "Сервер не может выдать ответ в формате, указанном в заголовках Accept клиента.",
    category: "4xx",
  },
  {
    kind: "http",
    code: 407,
    phrase: "Proxy Authentication Required",
    nameRu: "Требуется аутентификация прокси",
    description: "Требуется аутентификация для промежуточного прокси-сервера.",
    category: "4xx",
  },
  {
    kind: "http",
    code: 408,
    phrase: "Request Timeout",
    nameRu: "Время ожидания истекло",
    description: "Сервер не дождался полного запроса от клиента в течение установленного времени.",
    category: "4xx",
  },
  {
    kind: "http",
    code: 409,
    phrase: "Conflict",
    nameRu: "Конфликт",
    description: "Запрос конфликтует с текущим состоянием сервера (например, параллельные правки).",
    category: "4xx",
  },
  {
    kind: "http",
    code: 410,
    phrase: "Gone",
    nameRu: "Ресурс удалён навсегда",
    description: "Ресурс был окончательно удалён с сервера и больше недоступен.",
    category: "4xx",
  },
  {
    kind: "http",
    code: 411,
    phrase: "Length Required",
    nameRu: "Требуется длина",
    description: "Для запроса требуется указать заголовок Content-Length.",
    category: "4xx",
  },
  {
    kind: "http",
    code: 412,
    phrase: "Precondition Failed",
    nameRu: "Условие не выполнено",
    description: "Не выполнено одно из условий, заданных в заголовках запроса (например, If-Match).",
    category: "4xx",
  },
  {
    kind: "http",
    code: 413,
    phrase: "Payload Too Large",
    nameRu: "Тело запроса слишком велико",
    description: "Тело запроса превышает лимит размера, установленный сервером.",
    category: "4xx",
  },
  {
    kind: "http",
    code: 414,
    phrase: "URI Too Long",
    nameRu: "URI слишком длинный",
    description: "Длина запрашиваемого URL превышает допустимый сервером предел.",
    category: "4xx",
  },
  {
    kind: "http",
    code: 415,
    phrase: "Unsupported Media Type",
    nameRu: "Неподдерживаемый медиа-тип",
    description: "Сервер не поддерживает формат данных (Content-Type), указанный в теле запроса.",
    category: "4xx",
  },
  {
    kind: "http",
    code: 416,
    phrase: "Range Not Satisfiable",
    nameRu: "Диапазон недостижим",
    description: "Запрошенный диапазон в заголовке Range не может быть выполнен (выходит за пределы файла).",
    category: "4xx",
  },
  {
    kind: "http",
    code: 417,
    phrase: "Expectation Failed",
    nameRu: "Ожидание не выполнено",
    description: "Сервер не может удовлетворить условию, указанному в заголовке Expect.",
    category: "4xx",
  },
  {
    kind: "http",
    code: 418,
    phrase: "I'm a teapot",
    nameRu: "Я — чайник (RFC 2324)",
    description: "Шуточный код: сервер — чайник и отказывается заваривать кофе.",
    category: "4xx",
  },
  {
    kind: "http",
    code: 421,
    phrase: "Misdirected Request",
    nameRu: "Неверно направленный запрос",
    description: "Запрос был отправлен на сервер, не способный дать ответ (проблема с конфигурацией).",
    category: "4xx",
  },
  {
    kind: "http",
    code: 422,
    phrase: "Unprocessable Entity",
    nameRu: "Необрабатываемый контент",
    description: "Запрос синтаксически корректен, но содержит семантические ошибки (невалидные поля).",
    category: "4xx",
  },
  {
    kind: "http",
    code: 423,
    phrase: "Locked",
    nameRu: "Ресурс заблокирован",
    description: "WebDAV: ресурс, к которому обращаются, заблокирован от изменений.",
    category: "4xx",
  },
  {
    kind: "http",
    code: 424,
    phrase: "Failed Dependency",
    nameRu: "Невыполненная зависимость",
    description: "WebDAV: запрос не выполнен из-за неудачи предыдущего связанного запроса.",
    category: "4xx",
  },
  {
    kind: "http",
    code: 425,
    phrase: "Too Early",
    nameRu: "Слишком рано",
    description: "Сервер не хочет рисковать обрабатывать запрос, который может быть повторён (replay-атака).",
    category: "4xx",
  },
  {
    kind: "http",
    code: 426,
    phrase: "Upgrade Required",
    nameRu: "Требуется обновление",
    description: "Сервер требует перехода на другой протокол (например, TLS/1.3).",
    category: "4xx",
  },
  {
    kind: "http",
    code: 428,
    phrase: "Precondition Required",
    nameRu: "Требуется условие",
    description: "Сервер требует, чтобы запрос был условным (например, с If-Match для защиты правок).",
    category: "4xx",
  },
  {
    kind: "http",
    code: 429,
    phrase: "Too Many Requests",
    nameRu: "Слишком много запросов",
    description: "Превышен лимит частоты обращений клиента к серверу (Rate Limit / Throttling).",
    category: "4xx",
  },
  {
    kind: "http",
    code: 431,
    phrase: "Request Header Fields Too Large",
    nameRu: "Заголовки запроса слишком велики",
    description: "Заголовки запроса слишком велики для обработки сервером.",
    category: "4xx",
  },
  {
    kind: "http",
    code: 450,
    phrase: "Blocked by Windows Parental Controls",
    nameRu: "Блокировка родительским контролем",
    description: "Доступ заблокирован родительским контролем Windows.",
    category: "4xx",
  },
  {
    kind: "http",
    code: 451,
    phrase: "Unavailable For Legal Reasons",
    nameRu: "Недоступно по закону",
    description: "Доступ к ресурсу закрыт по юридическим причинам (цензура, требования законов).",
    category: "4xx",
  },

  // 5xx Server Error
  {
    kind: "http",
    code: 500,
    phrase: "Internal Server Error",
    nameRu: "Внутренняя ошибка сервера",
    description: "Сервер столкнулся с неожиданной ошибкой и не смог выполнить запрос.",
    category: "5xx",
  },
  {
    kind: "http",
    code: 501,
    phrase: "Not Implemented",
    nameRu: "Не реализовано",
    description: "Сервер не поддерживает функциональность, необходимую для выполнения запроса.",
    category: "5xx",
  },
  {
    kind: "http",
    code: 502,
    phrase: "Bad Gateway",
    nameRu: "Ошибочный шлюз",
    description: "Сервер-шлюз или прокси получил недопустимый ответ от вышестоящего сервера.",
    category: "5xx",
  },
  {
    kind: "http",
    code: 503,
    phrase: "Service Unavailable",
    nameRu: "Сервис недоступен",
    description: "Сервер временно не готов обрабатывать запросы (перегружен или ведутся техработы).",
    category: "5xx",
  },
  {
    kind: "http",
    code: 504,
    phrase: "Gateway Timeout",
    nameRu: "Таймаут шлюза",
    description: "Сервер-шлюз не дождался своевременного ответа от вышестоящего сервера.",
    category: "5xx",
  },
  {
    kind: "http",
    code: 505,
    phrase: "HTTP Version Not Supported",
    nameRu: "Версия HTTP не поддерживается",
    description: "Сервер не поддерживает версию протокола HTTP, использованную в запросе.",
    category: "5xx",
  },
  {
    kind: "http",
    code: 506,
    phrase: "Variant Also Negotiates",
    nameRu: "Вариант тоже согласует",
    description: "Ошибка конфигурации: выбранный вариант ресурса сам инициирует согласование.",
    category: "5xx",
  },
  {
    kind: "http",
    code: 507,
    phrase: "Insufficient Storage",
    nameRu: "Недостаточно места",
    description: "WebDAV: не удалось выполнить запрос из-за нехватки дискового пространства на сервере.",
    category: "5xx",
  },
  {
    kind: "http",
    code: 508,
    phrase: "Loop Detected",
    nameRu: "Обнаружено зацикливание",
    description: "WebDAV: сервер обнаружил бесконечный цикл при обработке запроса.",
    category: "5xx",
  },
  {
    kind: "http",
    code: 509,
    phrase: "Bandwidth Limit Exceeded",
    nameRu: "Исчерпана пропускная способность",
    description: "Лимит передачи данных или пропускная способность сервера/хостинга исчерпаны.",
    category: "5xx",
  },
  {
    kind: "http",
    code: 510,
    phrase: "Not Extended",
    nameRu: "Не расширено",
    description: "Для доступа к ресурсу требуются дополнительные расширения HTTP-запроса.",
    category: "5xx",
  },
  {
    kind: "http",
    code: 511,
    phrase: "Network Authentication Required",
    nameRu: "Требуется сетевая аутентификация",
    description: "Клиент должен пройти авторизацию для получения доступа к сети (портал Wi-Fi).",
    category: "5xx",
  },
  {
    kind: "http",
    code: 520,
    phrase: "Unknown Error (Cloudflare)",
    nameRu: "Неизвестная ошибка прокси",
    description: "Исходный веб-сервер вернул неизвестный или пустой ответ прокси Cloudflare.",
    category: "5xx",
  },
  {
    kind: "http",
    code: 521,
    phrase: "Web Server Is Down (Cloudflare)",
    nameRu: "Сервер не отвечает",
    description: "Исходный веб-сервер отклонил входящее TCP-соединение от Cloudflare.",
    category: "5xx",
  },
  {
    kind: "http",
    code: 522,
    phrase: "Connection Timed Out (Cloudflare)",
    nameRu: "Таймаут подключения",
    description: "Cloudflare не смог установить TCP-соединение с исходным веб-сервером.",
    category: "5xx",
  },
  {
    kind: "http",
    code: 524,
    phrase: "A Timeout Occurred (Cloudflare)",
    nameRu: "Таймаут ответа сервера",
    description: "TCP-соединение установлено, но исходный сервер не ответил вовремя.",
    category: "5xx",
  },
  {
    kind: "http",
    code: 526,
    phrase: "Invalid SSL Certificate (Cloudflare)",
    nameRu: "Недействительный SSL-сертификат",
    description: "Cloudflare не смог проверить SSL/TLS сертификат исходного веб-сервера.",
    category: "5xx",
  },
  {
    kind: "http",
    code: 529,
    phrase: "Site is overloaded",
    nameRu: "Сайт перегружен",
    description: "Сервер временно перегружен запросами и просит повторить попытку позже.",
    category: "5xx",
  },
  {
    kind: "http",
    code: 530,
    phrase: "Site is frozen",
    nameRu: "Сайт заморожен",
    description: "Сайт заморожен хостингом или возникла ошибка DNS 1016 в Cloudflare.",
    category: "5xx",
  },
  {
    kind: "http",
    code: 598,
    phrase: "Network Read Timeout",
    nameRu: "Таймаут чтения сети",
    description: "Неформальный код прокси при истечении времени ожидания чтения ответа из сети.",
    category: "5xx",
  },
];

export const NETWORK_PROTOCOLS: ProtocolInfo[] = [
  {
    kind: "protocol",
    id: "ethernet",
    name: "Ethernet",
    fullName: "IEEE 802.3",
    description: "Основа большинства проводных сетей (LAN). Определяет формат кадров и доступ к среде передачи.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/Ethernet.md`,
  },
  {
    kind: "protocol",
    id: "wifi",
    name: "Wi-Fi",
    fullName: "IEEE 802.11",
    description: "Набор стандартов для беспроводных локальных сетей (WLAN).",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/Wi-Fi.md`,
  },
  {
    kind: "protocol",
    id: "ppp",
    name: "PPP",
    fullName: "Point-to-Point Protocol",
    description: "Протокол для прямого соединения между двумя узлами (dial-up, DSL).",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/PPP.md`,
  },
  {
    kind: "protocol",
    id: "arp",
    name: "ARP",
    fullName: "Address Resolution Protocol",
    description: "Преобразование IP-адреса (сетевой уровень) в физический MAC-адрес (канальный уровень).",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/ARP.md`,
  },
  {
    kind: "protocol",
    id: "icmp",
    name: "ICMP",
    fullName: "Internet Control Message Protocol",
    description: "Передача служебных и диагностических сообщений сети (утилита ping, ошибки маршрутизации).",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/ICMP.md`,
  },
  {
    kind: "protocol",
    id: "tcp",
    name: "TCP",
    fullName: "Transmission Control Protocol",
    description: "Надёжный транспортный протокол с установлением соединения, гарантией доставки и порядка пакетов.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/TCP.md`,
  },
  {
    kind: "protocol",
    id: "udp",
    name: "UDP",
    fullName: "User Datagram Protocol",
    description: "Быстрый датаграммный протокол без гарантий доставки для стриминга, онлайн-игр и DNS.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/UDP.md`,
  },
  {
    kind: "protocol",
    id: "sctp",
    name: "SCTP",
    fullName: "Stream Control Transmission Protocol",
    description: "Сочетает черты TCP и UDP, обеспечивает надёжную доставку с мультиплексированием потоков.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/SCTP.md`,
  },
  {
    kind: "protocol",
    id: "http",
    name: "HTTP",
    fullName: "HyperText Transfer Protocol",
    description: "Фундаментальный протокол прикладного уровня передачи данных в WWW (веб-страницы, REST API).",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/HTTP.md`,
  },
  {
    kind: "protocol",
    id: "https",
    name: "HTTPS",
    fullName: "Hypertext Transfer Protocol Secure",
    description: "Безопасная версия HTTP с криптографическим шифрованием трафика через TLS/SSL.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/HTTPS.md`,
  },
  {
    kind: "protocol",
    id: "ftp",
    name: "FTP",
    fullName: "File Transfer Protocol",
    description: "Сетевой протокол передачи файлов между клиентом и сервером (порты 20/21).",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/FTP.md`,
  },
  {
    kind: "protocol",
    id: "sftp",
    name: "SFTP",
    fullName: "SSH File Transfer Protocol",
    description: "Безопасный протокол передачи файлов и управления файловой системой поверх сессии SSH.",
    docUrl: `${GITHUB_REPO_URL}`,
  },
  {
    kind: "protocol",
    id: "ssh",
    name: "SSH",
    fullName: "Secure Shell",
    description: "Защищённый протокол удалённого управления операционной системой и туннелирования TCP.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/SSH.md`,
  },
  {
    kind: "protocol",
    id: "telnet",
    name: "Telnet",
    fullName: "Teletype Network",
    description: "Текстовый терминальный протокол удалённого доступа без шифрования (порт 23).",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/Telnet.md`,
  },
  {
    kind: "protocol",
    id: "dns",
    name: "DNS",
    fullName: "Domain Name System",
    description: "Распределённая система преобразования доменных имён (google.com) в IP-адреса.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/DNS.md`,
  },
  {
    kind: "protocol",
    id: "dhcp",
    name: "DHCP",
    fullName: "Dynamic Host Configuration Protocol",
    description: "Автоматическое назначение сетевых параметров (IP-адрес, маска подсети, шлюз, DNS).",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/DHCP.md`,
  },
  {
    kind: "protocol",
    id: "ldap",
    name: "LDAP",
    fullName: "Lightweight Directory Access Protocol",
    description: "Доступ и управление службами сетевых каталогов пользователей и ресурсов.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/LDAP.md`,
  },
  {
    kind: "protocol",
    id: "snmp",
    name: "SNMP",
    fullName: "Simple Network Management Protocol",
    description: "Протокол мониторинга и управления сетевыми устройствами (роутеры, свитчи, серверы).",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/SNMP.md`,
  },
  {
    kind: "protocol",
    id: "sip",
    name: "SIP",
    fullName: "Session Initiation Protocol",
    description: "Сигнализация для установления, изменения и завершения сеансов VoIP и видеоконференций.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/SIP.md`,
  },
  {
    kind: "protocol",
    id: "rtp",
    name: "RTP",
    fullName: "Real-time Transport Protocol",
    description: "Доставка потоковых мультимедиа-данных (аудио/видео) в реальном времени поверх UDP.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/RTP.md`,
  },
  {
    kind: "protocol",
    id: "rtsp",
    name: "RTSP",
    fullName: "Real Time Streaming Protocol",
    description: "Сетевой протокол управления потоковыми медиасерверами (команды play, pause, record).",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/RTSP.md`,
  },
  {
    kind: "protocol",
    id: "nfs",
    name: "NFS",
    fullName: "Network File System",
    description: "Сетевой доступ к файлам и монтирование удалённых каталогов в UNIX/Linux-системах.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/NFS.md`,
  },
  {
    kind: "protocol",
    id: "smb",
    name: "SMB/CIFS",
    fullName: "Server Message Block",
    description: "Общий сетевой доступ к файлам, принтерам и пайпам в операционных системах Windows.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/SMB-CIFS.md`,
  },
  {
    kind: "protocol",
    id: "websocket",
    name: "WebSocket",
    fullName: "WebSocket Protocol",
    description: "Постоянное полнодуплексное соединение поверх одного TCP-сокета для чатов и интерактивных приложений.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/WebSocket.md`,
  },
  {
    kind: "protocol",
    id: "mqtt",
    name: "MQTT",
    fullName: "Message Queuing Telemetry Transport",
    description: "Компактный протокол сообщений pub/sub для интернета вещей (IoT) и каналов с низкой пропускной способностью.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/MQTT.md`,
  },
  {
    kind: "protocol",
    id: "ip",
    name: "IP",
    fullName: "Internet Protocol",
    description: "Главный протокол сетевого уровня: адресация хостов (IPv4, IPv6) и маршрутизация дейтаграмм.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/IP.md`,
  },
  {
    kind: "protocol",
    id: "bgp",
    name: "BGP",
    fullName: "Border Gateway Protocol",
    description: "Протокол динамической маршрутизации между автономными системами провайдеров интернета.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/BGP.md`,
  },
  {
    kind: "protocol",
    id: "ospf",
    name: "OSPF",
    fullName: "Open Shortest Path First",
    description: "Протокол динамической маршрутизации внутри автономной системы по алгоритму Дейкстры.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/OSPF.md`,
  },
  {
    kind: "protocol",
    id: "rip",
    name: "RIP",
    fullName: "Routing Information Protocol",
    description: "Классический протокол дистанционно-векторной маршрутизации для небольших локальных сетей.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/RIP.md`,
  },
  {
    kind: "protocol",
    id: "tls",
    name: "TLS/SSL",
    fullName: "Transport Layer Security",
    description: "Криптографические протоколы защищённой передачи данных поверх транспортного уровня.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/TLS-SSL.md`,
  },
  {
    kind: "protocol",
    id: "ipsec",
    name: "IPsec",
    fullName: "Internet Protocol Security",
    description: "Набор криптографических протоколов для защиты IP-пакетов и построения VPN-туннелей.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/IPsec.md`,
  },
  {
    kind: "protocol",
    id: "wireguard",
    name: "WireGuard",
    fullName: "WireGuard VPN",
    description: "Современный скоростной протокол VPN, работающий на уровне ядра ОС с современной криптографией.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/WireGuard.md`,
  },
  {
    kind: "protocol",
    id: "openvpn",
    name: "OpenVPN",
    fullName: "OpenVPN",
    description: "Популярный кроссплатформенный VPN с открытым исходным кодом на базе протокола TLS.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/OpenVPN.md`,
  },
  {
    kind: "protocol",
    id: "wpa",
    name: "WPA2/WPA3",
    fullName: "Wi-Fi Protected Access",
    description: "Протоколы безопасности и шифрования трафика для беспроводных сетей Wi-Fi.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/WPA2-WPA3.md`,
  },
  {
    kind: "protocol",
    id: "ntp",
    name: "NTP",
    fullName: "Network Time Protocol",
    description: "Протокол высокоточной синхронизации системного времени компьютеров в сети.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/NTP.md`,
  },
  {
    kind: "protocol",
    id: "quic",
    name: "QUIC",
    fullName: "Quick UDP Internet Connections",
    description: "Транспортный протокол от Google поверх UDP со встроенным шифрованием TLS 1.3, основа HTTP/3.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/QUIC.md`,
  },
  {
    kind: "protocol",
    id: "grpc",
    name: "gRPC",
    fullName: "gRPC Remote Procedure Calls",
    description: "Высокопроизводительный RPC-фреймворк на базе HTTP/2 и Protocol Buffers.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/gRPC.md`,
  },
  {
    kind: "protocol",
    id: "rdp",
    name: "RDP",
    fullName: "Remote Desktop Protocol",
    description: "Протокол удалённого рабочего стола от Microsoft для графического доступа к компьютеру.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/RDP.md`,
  },
  {
    kind: "protocol",
    id: "smtp",
    name: "SMTP",
    fullName: "Simple Mail Transfer Protocol",
    description: "Протокол отправки и маршрутизации сообщений электронной почты между серверами.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/SMTP.md`,
  },
  {
    kind: "protocol",
    id: "pop3",
    name: "POP3",
    fullName: "Post Office Protocol 3",
    description: "Протокол для скачивания входящих писем с почтового сервера на локальный клиент.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/POP3.md`,
  },
  {
    kind: "protocol",
    id: "imap",
    name: "IMAP",
    fullName: "Internet Message Access Protocol",
    description: "Протокол доступа и синхронизации почтовых ящиков с сохранением писем на сервере.",
    docUrl: `${GITHUB_REPO_URL}/blob/main/prot/IMAP.md`,
  },
];

const POPULAR_CODES = [200, 201, 204, 301, 302, 304, 400, 401, 403, 404, 418, 429, 500, 502, 503];

/**
 * Searches HTTP status codes and network protocols from Protocol-list.
 * Handles "hHelp:" to open GitHub repository directly.
 */
export function searchHttpCodes(query: string): NetworkSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // Exclude full URLs like "http://example.com"
  if (/^https?:\/\//i.test(trimmed)) {
    return [];
  }

  // Explicit GitHub Help commands: "hHelp:", "hhelp:", "hhelp", "h:help", "http:help"
  const helpMatch = /^(?:hhelp:?|(?:h|http):help)(?:\s*(.*))?$/i.exec(trimmed);
  if (helpMatch) {
    const sub = (helpMatch[1] ?? "").trim();
    if (sub) {
      const targetProt = NETWORK_PROTOCOLS.find(
        (p) => p.name.toLowerCase() === sub.toLowerCase() || p.id === sub.toLowerCase(),
      );
      if (targetProt) {
        return [
          {
            kind: "github-help",
            title: `${targetProt.name} — документация на GitHub`,
            url: targetProt.docUrl,
            hint: targetProt.docUrl,
          },
        ];
      }
    }
    return [
      {
        kind: "github-help",
        title: "Справочник протоколов lackyhy/Protocol-list",
        url: GITHUB_REPO_URL,
        hint: GITHUB_REPO_URL,
      },
    ];
  }

  let term = "";
  let matchedPrefix = false;

  // Only with a colon: "http something" is an ordinary search.
  const prefixMatch = /^(?:h|http):(.*)$/i.exec(trimmed);
  const shortCodeMatch = /^h(\d{3})$/i.exec(trimmed);

  if (prefixMatch) {
    matchedPrefix = true;
    term = prefixMatch[1].trim();
  } else if (shortCodeMatch) {
    matchedPrefix = true;
    term = shortCodeMatch[1];
  }

  if (!matchedPrefix) {
    return [];
  }

  // If user simply typed "h:" or "http:"
  if (!term) {
    const popular: NetworkSearchResult[] = [
      {
        kind: "github-help",
        title: "Справочник lackyhy/Protocol-list на GitHub (напиши hHelp:)",
        url: GITHUB_REPO_URL,
        hint: "Напиши hHelp: для перехода в репозиторий",
      },
      ...HTTP_CODES.filter((c) => POPULAR_CODES.includes(c.code)),
    ];
    return popular.slice(0, 6);
  }

  const lower = term.toLowerCase();

  // If term is purely numeric: search HTTP status codes
  if (/^\d+$/.test(term)) {
    const num = parseInt(term, 10);
    const exact = HTTP_CODES.find((c) => c.code === num);
    if (exact) {
      return [exact];
    }
    // Prefix match (e.g. "40" matches 400..409)
    return HTTP_CODES.filter((c) => c.code.toString().startsWith(term)).slice(0, 6);
  }

  // Text search in HTTP codes and network protocols
  const httpMatches: { item: NetworkSearchResult; score: number }[] = [];

  for (const item of HTTP_CODES) {
    let score = 0;
    const phraseLower = item.phrase.toLowerCase();
    const nameLower = item.nameRu.toLowerCase();
    const descLower = item.description.toLowerCase();

    if (phraseLower === lower || nameLower === lower) {
      score += 100;
    } else if (phraseLower.startsWith(lower) || nameLower.startsWith(lower)) {
      score += 60;
    } else if (phraseLower.includes(lower) || nameLower.includes(lower)) {
      score += 40;
    } else if (descLower.includes(lower)) {
      score += 15;
    }

    if (score > 0) {
      httpMatches.push({ item, score });
    }
  }

  const protocolMatches: { item: NetworkSearchResult; score: number }[] = [];

  for (const item of NETWORK_PROTOCOLS) {
    let score = 0;
    const nameLower = item.name.toLowerCase();
    const fullLower = item.fullName.toLowerCase();
    const descLower = item.description.toLowerCase();

    if (nameLower === lower || item.id === lower) {
      score += 120;
    } else if (nameLower.startsWith(lower)) {
      score += 80;
    } else if (fullLower.includes(lower) || nameLower.includes(lower)) {
      score += 50;
    } else if (descLower.includes(lower)) {
      score += 20;
    }

    if (score > 0) {
      protocolMatches.push({ item, score });
    }
  }

  const all = [...httpMatches, ...protocolMatches].sort((a, b) => b.score - a.score);
  return all.slice(0, 6).map((r) => r.item);
}

export function getDropletAccent(item: NetworkSearchResult): string {
  if (item.kind === "http") {
    switch (item.category) {
      case "1xx":
        return "#38bdf8";
      case "2xx":
        return "#4ade80";
      case "3xx":
        return "#facc15";
      case "4xx":
        return "#fb923c";
      case "5xx":
        return "#f87171";
    }
  }
  if (item.kind === "protocol") {
    return "#818cf8";
  }
  return "#c084fc";
}

export function getCategoryName(category: "1xx" | "2xx" | "3xx" | "4xx" | "5xx"): string {
  switch (category) {
    case "1xx":
      return "1xx Informational · Информационный";
    case "2xx":
      return "2xx Success · Успешно";
    case "3xx":
      return "3xx Redirection · Перенаправление";
    case "4xx":
      return "4xx Client Error · Ошибка клиента";
    case "5xx":
      return "5xx Server Error · Ошибка сервера";
  }
}

