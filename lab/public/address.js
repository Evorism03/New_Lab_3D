// Разбор адреса ПВЗ, скопированного из ВК одной строкой, на части (город, улица, дом, остальное)
// и обратная сборка строки из частей. Понимает адреса и с сокращениями («г.», «ул.», «д.»), и без
// них («Москва, Ленина 5»). Файл общий для браузера (подключается <script>) и сервера (import) —
// результат кладётся в globalThis.LabAddress.
(function () {
  const STREET_TYPES = [
    'улица', 'ул', 'проспект', 'пр-т', 'пр-кт', 'просп', 'пр', 'переулок', 'пер', 'бульвар', 'б-р',
    'бул', 'шоссе', 'ш', 'набережная', 'наб', 'площадь', 'пл', 'проезд', 'пр-д', 'тупик', 'туп',
    'микрорайон', 'мкр', 'мкрн', 'мр', 'аллея', 'тракт', 'линия', 'квартал', 'кв-л', 'тер',
  ];
  const CITY_TYPES = ['город', 'г', 'гор', 'пгт', 'поселок', 'посёлок', 'пос', 'п', 'село', 'с', 'деревня', 'дер', 'станица', 'ст-ца', 'рп'];
  const REGION_WORDS = ['область', 'обл', 'край', 'республика', 'респ', 'автономный', 'ао', 'район', 'р-н'];
  const HOUSE_TYPES = ['дом', 'д', 'владение', 'вл'];
  const BUILDING_TYPES = ['корпус', 'корп', 'к', 'строение', 'стр', 'литера', 'лит'];

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  const wordsRe = (list) => list.slice().sort((a, b) => b.length - a.length).map(escapeRe).join('|');
  // «ул.», «ул », «улица» в начале сегмента.
  const prefixRe = (list) => new RegExp(`^(?:${wordsRe(list)})(?:\\.\\s*|\\s+)`, 'i');
  const suffixRe = (list) => new RegExp(`\\s+(?:${wordsRe(list)})\\.?$`, 'i');

  const STREET_PREFIX = prefixRe(STREET_TYPES);
  const STREET_SUFFIX = suffixRe(STREET_TYPES);
  const CITY_PREFIX = prefixRe(CITY_TYPES);
  const HOUSE_PREFIX = prefixRe(HOUSE_TYPES);
  const BUILDING_PREFIX = prefixRe(BUILDING_TYPES);
  const REGION_ANY = new RegExp(`(^|\\s)(?:${wordsRe(REGION_WORDS)})\\.?(\\s|$)`, 'i');
  // Номер дома: «5», «5А», «5/2», «5к2», «5 к 2», «5 стр. 1».
  const HOUSE_NUMBER = /^\d+[а-яa-z]?(?:\s*\/\s*\d+[а-яa-z]?)?(?:\s*(?:к|корп|корпус|с|стр|строение|лит|литера)\.?\s*\d*[а-яa-z]?)*$/i;

  function clean(s) {
    return String(s || '').replace(/\s+/g, ' ').replace(/^[\s,.;]+|[\s,;]+$/g, '').trim();
  }

  // Строка без запятых («г Москва ул Ленина д 5») — режем перед маркерами.
  function splitSegments(text) {
    let s = String(text || '').replace(/[\n\r\t;]+/g, ',');
    const markers = wordsRe([...STREET_TYPES, ...CITY_TYPES.filter((w) => w.length > 1), ...HOUSE_TYPES, 'корпус', 'корп', 'строение', 'стр']);
    s = s.replace(new RegExp(`\\s(?=(?:${markers})(?:\\.|\\s)\\s*[^\\s,])`, 'gi'), ', ');
    return s.split(',').map(clean).filter(Boolean);
  }

  function parseAddress(text) {
    const parts = { city: '', street: '', house: '', extra: '' };
    const extra = [];
    const regions = [];
    for (let seg of splitSegments(text)) {
      if (/^россия$/i.test(seg) || /^\d{6}$/.test(seg)) continue; // страна и индекс не нужны
      seg = seg.replace(/^\d{6}\s+/, '');

      if (BUILDING_PREFIX.test(seg) && parts.house) {
        parts.house = `${parts.house} ${seg}`;
        continue;
      }
      // «д. 5» — дом, «д. Ивановка» — деревня.
      if (HOUSE_PREFIX.test(seg) && /\d/.test(seg.replace(HOUSE_PREFIX, '').slice(0, 1))) {
        if (!parts.house) { parts.house = clean(seg.replace(HOUSE_PREFIX, '')); continue; }
      }
      if (STREET_PREFIX.test(seg) || STREET_SUFFIX.test(seg)) {
        if (!parts.street) {
          // «ул. Ленина 5» — номер дома в том же сегменте.
          const m = seg.match(/^(.*?[^\d\s].*?)\s+(\d+[а-яa-z]?(?:\/\d+)?)$/i);
          if (m && !parts.house && !STREET_SUFFIX.test(seg)) { parts.street = clean(m[1]); parts.house = m[2]; }
          else parts.street = seg;
          continue;
        }
      }
      if (CITY_PREFIX.test(seg) && !parts.city) { parts.city = seg; continue; }
      if (REGION_ANY.test(seg)) { regions.push(seg); continue; }
      if (HOUSE_NUMBER.test(seg) && !parts.house) { parts.house = seg; continue; }

      // Сегмент без маркеров: сначала город, потом улица (с возможным номером дома в конце).
      if (!parts.city && !parts.street) {
        const words = seg.split(' ');
        // «Москва Ленина 5» — всё в одном сегменте.
        if (words.length >= 3 && /^\d/.test(words[words.length - 1]) && !parts.house) {
          parts.city = words[0];
          parts.house = words[words.length - 1];
          parts.street = words.slice(1, -1).join(' ');
          continue;
        }
        parts.city = seg;
        continue;
      }
      if (!parts.street) {
        const m = seg.match(/^(.*?[^\d\s].*?)\s+(\d+[а-яa-z]?(?:\/\d+)?)$/i);
        if (m && !parts.house) { parts.street = clean(m[1]); parts.house = m[2]; }
        else parts.street = seg;
        continue;
      }
      extra.push(seg);
    }
    if (regions.length) parts.city = [...regions, parts.city].filter(Boolean).join(', ');
    parts.extra = extra.join(', ');
    return parts;
  }

  function hasRegion(s) { return REGION_ANY.test(s); }

  // Сборка строки из частей: недостающие «г.», «ул.», «д.» дописываются.
  function formatAddress(parts) {
    const city = clean(parts.city);
    const street = clean(parts.street);
    const house = clean(parts.house);
    const out = [];
    if (city) {
      // Регион оставляем как есть, к последнему куску (сам город) добавляем «г.», если маркера нет.
      const chunks = city.split(',').map(clean).filter(Boolean);
      const last = chunks.pop();
      const village = HOUSE_PREFIX.test(last) && !/^\d/.test(last.replace(HOUSE_PREFIX, '')); // «д. Ивановка»
      const lastFmt = CITY_PREFIX.test(last) || hasRegion(last) || village ? last : `г. ${last}`;
      out.push(...chunks, lastFmt);
    }
    if (street) out.push(STREET_PREFIX.test(street) || STREET_SUFFIX.test(street) ? street : `ул. ${street}`);
    if (house) out.push(HOUSE_PREFIX.test(house) ? house : `д. ${house}`);
    if (clean(parts.extra)) out.push(clean(parts.extra));
    return out.join(', ');
  }

  // Для сравнения адресов: нижний регистр, ё→е, без маркеров и знаков препинания.
  function normalizeWords(s) {
    const drop = new Set([...STREET_TYPES, ...CITY_TYPES, ...HOUSE_TYPES, ...REGION_WORDS, 'россия'].map((w) => w.toLowerCase()));
    return String(s || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[.,;:()"«»№#]/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !drop.has(w) && !/^\d{6}$/.test(w));
  }

  // Браузер: связывает поле «Адрес ПВЗ» целиком с полями частей в блоке .address-parts.
  // Вставили/ввели адрес целиком — части разбираются; правите часть — строка собирается заново.
  function bindAddressFields(fullInput, partsRoot) {
    const inputs = {};
    for (const key of ['city', 'street', 'house', 'extra']) inputs[key] = partsRoot.querySelector(`[data-part="${key}"]`);
    function fillParts() {
      const parts = parseAddress(fullInput.value);
      for (const key of Object.keys(inputs)) inputs[key].value = parts[key] || '';
    }
    fullInput.addEventListener('input', fillParts);
    for (const input of Object.values(inputs)) {
      input.addEventListener('input', () => {
        fullInput.value = formatAddress({
          city: inputs.city.value, street: inputs.street.value, house: inputs.house.value, extra: inputs.extra.value,
        });
        fullInput.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    fillParts();
    return { refresh: fillParts };
  }

  globalThis.LabAddress = { parseAddress, formatAddress, normalizeWords, bindAddressFields };
})();
