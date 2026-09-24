// Разбор адреса ПВЗ, скопированного из ВК одной строкой, на части (город, улица, дом, остальное)
// и обратная сборка строки из частей. Понимает адреса и с сокращениями («г.», «ул.», «д.»), и без
// них («Москва, Ленина 5»). Файл общий для браузера (подключается <script>) и сервера (import) —
// результат кладётся в globalThis.LabAddress.
(function () {
  const STREET_TYPES = [
    'улица', 'ул', 'проспект', 'пр-т', 'пр-кт', 'просп', 'пр', 'переулок', 'пер', 'бульвар', 'б-р',
    'бул', 'шоссе', 'ш', 'набережная', 'наб', 'площадь', 'пл', 'проезд', 'пр-д', 'тупик', 'туп',
    'микрорайон', 'мкр', 'мкрн', 'мр', 'аллея', 'тракт', 'линия', 'квартал', 'кв-л', 'тер', 'жк',
  ];
  const CITY_TYPES = [
    'город', 'г', 'гор', 'пгт', 'п.г.т', 'поселок', 'посёлок', 'пос', 'п', 'рабочий поселок', 'рабочий посёлок',
    'дачный поселок', 'дачный посёлок', 'поселок городского типа', 'посёлок городского типа', 'р.п', 'рп',
    'село', 'с', 'деревня', 'дер', 'станица', 'ст-ца', 'хутор', 'х', 'аул', 'слобода', 'сл', 'станция',
  ];
  // Части адреса крупнее улицы, но не сам город: регион, район, поселение, округ, СНТ…
  const REGION_WORDS = [
    'область', 'обл', 'край', 'республика', 'респ', 'автономный', 'ао', 'район', 'р-н',
    'поселение', 'пос-е', 'округ', 'городской', 'муниципальный', 'мо', 'го', 'мр-н',
    'снт', 'днт', 'тсн', 'кп', 'нп', 'территория',
  ];
  const HOUSE_TYPES = ['дом', 'д', 'владение', 'вл', 'участок', 'уч'];
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

  // Служебные пометки, а не улица: «ТЦ Мега», «ПВЗ Ozon», «вход со двора», «2 этаж», «офис 5».
  const SERVICE_RE = /^(тц|трц|тк|пвз|ozon|озон|сдэк|вход|этаж|офис|оф|пом|помещение|кв|\d+\s*этаж)(?![а-яё])/i;

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
    // Город, регион, поселение и т.п. — в том порядке, как в исходной строке.
    const localities = [];
    let hasCity = false;
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
      // «ул. поселение Десёновское» — на самом деле поселение/округ/СНТ, «ул.» лишнее.
      if (STREET_PREFIX.test(seg) && REGION_ANY.test(seg.replace(STREET_PREFIX, '')) && !parts.street) {
        localities.push(clean(seg.replace(STREET_PREFIX, '')));
        continue;
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
      // «г. Москва», «п. Внуковское», «д. Ивановка» — населённые пункты (их может быть несколько).
      const village = HOUSE_PREFIX.test(seg) && !/^\d/.test(seg.replace(HOUSE_PREFIX, ''));
      if ((CITY_PREFIX.test(seg) || village) && !parts.street) { localities.push(seg); hasCity = true; continue; }
      if (REGION_ANY.test(seg) && !parts.street) { localities.push(seg); continue; }
      if (HOUSE_NUMBER.test(seg) && !parts.house) { parts.house = seg; continue; }
      if (SERVICE_RE.test(seg)) { extra.push(seg); continue; }

      // Сегмент без маркеров: сначала город, потом улица (с возможным номером дома в конце).
      if (!hasCity && !parts.street) {
        const words = seg.split(' ');
        // «Москва Ленина 5» — всё в одном сегменте.
        if (words.length >= 3 && /^\d/.test(words[words.length - 1]) && !parts.house) {
          localities.push(words[0]);
          hasCity = true;
          parts.house = words[words.length - 1];
          parts.street = words.slice(1, -1).join(' ');
          continue;
        }
        localities.push(seg);
        hasCity = true;
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
    parts.city = localities.join(', ');
    // Улица не нашлась, а в «дополнительно» есть похожее на улицу (не ТЦ/ПВЗ/номер) — это она:
    // «…, д. 3, 2-я Нововатутинская».
    if (!parts.street && extra.length) {
      const idx = extra.findIndex((e) => !SERVICE_RE.test(e) && /[а-яё]{3,}/i.test(e));
      if (idx >= 0) parts.street = extra.splice(idx, 1)[0];
    }
    parts.extra = extra.join(', ');
    return parts;
  }

  function hasRegion(s) { return REGION_ANY.test(s); }

  function isVillage(s) { return HOUSE_PREFIX.test(s) && !/^\d/.test(s.replace(HOUSE_PREFIX, '')); }

  // Индекс куска «города» в поле «Город»: последний, который не регион/район/поселение.
  function cityChunkIndex(chunks) {
    for (let i = chunks.length - 1; i >= 0; i--) if (!hasRegion(chunks[i])) return i;
    return chunks.length - 1;
  }

  function stripLocalityType(chunk) {
    return clean(chunk.replace(CITY_PREFIX, '').replace(isVillage(chunk) ? HOUSE_PREFIX : /^$/, ''));
  }

  // Населённые пункты из поля «Город» без регионов/районов/поселений, от самого мелкого:
  // «Москва, п. Внуковское» → ['Внуковское', 'Москва']. Если есть только регион — он сам.
  function cityNames(parts) {
    const chunks = String(parts.city || '').split(',').map(clean).filter(Boolean);
    const places = chunks.filter((c) => !hasRegion(c));
    return (places.length ? places : chunks.slice(-1)).reverse().map(stripLocalityType).filter(Boolean);
  }

  // Само название населённого пункта: «Московская обл., г. Химки» → «Химки».
  function cityName(parts) {
    return cityNames(parts)[0] || '';
  }

  // Сборка строки из частей: недостающие «г.», «ул.», «д.» дописываются.
  function formatAddress(parts) {
    const city = clean(parts.city);
    const street = clean(parts.street);
    const house = clean(parts.house);
    const out = [];
    if (city) {
      // Регион/поселение оставляем как есть, к самому городу добавляем «г.», если маркера нет.
      const chunks = city.split(',').map(clean).filter(Boolean);
      const idx = cityChunkIndex(chunks);
      const c = chunks[idx];
      if (!CITY_PREFIX.test(c) && !hasRegion(c) && !isVillage(c)) chunks[idx] = `г. ${c}`;
      out.push(...chunks);
    }
    if (street) out.push(STREET_PREFIX.test(street) || STREET_SUFFIX.test(street) ? street : `ул. ${street}`);
    if (house) out.push(HOUSE_PREFIX.test(house) ? house : `д. ${house}`);
    if (clean(parts.extra)) out.push(clean(parts.extra));
    return out.join(', ');
  }

  // Для сравнения адресов: нижний регистр, ё→е, без маркеров и знаков препинания;
  // «2-я»/«2я» → «2я», «4к2» → «4», «к2»; однобуквенные маркеры (р., п., с.) отбрасываются.
  const DROP_WORDS = new Set(
    [...STREET_TYPES, ...CITY_TYPES, ...HOUSE_TYPES, ...BUILDING_TYPES, ...REGION_WORDS, 'россия', 'рабочий', 'дачный', 'городского', 'типа',
      'сельское', 'городское', 'поселение', 'рн', 'пвз', 'ozon', 'озон', 'сдэк', 'пункт', 'выдачи']
      .flatMap((w) => [w.toLowerCase(), w.toLowerCase().replace(/ё/g, 'е')]),
  );
  function normalizeWords(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/(\d+)\s*-\s*([а-я]{1,3})(?![а-я])/g, '$1$2') // 2-я, 2 - ой → 2я, 2ой
      .replace(/(\d+[а-я]?)(к|корп|стр|с)(\d+)/g, '$1 $2$3') // 4к2 → 4 к2
      .replace(/[.,;:()"'«»№#/\\]/g, ' ')
      .split(/\s+/)
      .map((w) => w.replace(/^-+|-+$/g, ''))
      .filter((w) => w && !DROP_WORDS.has(w) && !/^\d{6}$/.test(w) && !(w.length === 1 && /[а-я]/.test(w)));
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

  globalThis.LabAddress = { parseAddress, formatAddress, normalizeWords, cityName, cityNames, bindAddressFields };
})();
