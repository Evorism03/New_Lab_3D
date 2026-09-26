// Разбор строк, скопированных из листа «Бухгалтерия» Google-таблицы (или CSV с «;»).
// Колонки по умолчанию — как в таблице: Поступление, Списание, Назначение, Дата, Гарантия?
// Если есть строка заголовков, порядок колонок берётся из неё.

const DEFAULT_COLUMNS = ['income', 'expense', 'description', 'date', 'warranty'];

const HEADER_RULES = [
  [/поступ|приход|доход/i, 'income'],
  [/спис|расход/i, 'expense'],
  [/назнач|описан/i, 'description'],
  [/^дата/i, 'date'],
  [/гарант/i, 'warranty'],
  [/категор/i, 'category'],
];

function splitLine(line, delimiter) {
  if (delimiter === '\t') return line.split('\t');
  // CSV: поля в кавычках могут содержать разделитель.
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// «3 500,00 ₽», «3500», «-294» → число (знак не важен: колонка уже говорит, приход это или расход).
export function parseMoney(value) {
  const s = String(value ?? '')
    .replace(/₽|руб\.?|р\./gi, '')
    .replace(/[\s  ]/g, '')
    .replace(',', '.');
  if (!s || s === '-') return 0;
  const n = Math.abs(Number(s));
  return Number.isFinite(n) ? n : NaN;
}

// «03.08.2026», «3.8.2026», «2026-08-03» → «2026-08-03».
export function parseDate(value) {
  const s = String(value ?? '').trim();
  let y, m, d;
  let match = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
  if (match) {
    [, d, m, y] = match.map(Number);
    if (y < 100) y += 2000;
  } else if ((match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) {
    [, y, m, d] = match.map(Number);
  } else {
    return null;
  }
  const date = new Date(y, m - 1, d);
  if (y < 2000 || y > 2100 || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseBool(value) {
  return /^(true|истина|да|1|yes|\+|✓|✔)$/i.test(String(value ?? '').trim());
}

export function parseLedgerText(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const delimiter = lines.some((l) => l.includes('\t')) ? '\t' : ';';
  let columns = DEFAULT_COLUMNS;
  const rows = [];
  const errors = [];

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (!line.trim()) return;
    const cells = splitLine(line, delimiter).map((c) => c.trim());

    // Строка заголовков: задаёт порядок колонок и сама не импортируется.
    const header = cells.map((c) => HEADER_RULES.find(([re]) => re.test(c))?.[1] || null);
    if (header.filter(Boolean).length >= 2) {
      columns = header;
      return;
    }

    const raw = {};
    columns.forEach((key, i) => {
      if (key && raw[key] === undefined) raw[key] = cells[i] ?? '';
    });
    const income = parseMoney(raw.income);
    const expense = parseMoney(raw.expense);
    const description = String(raw.description || '').trim();
    // Пустые строки таблицы (только галочка «Гарантия?» = FALSE) пропускаем молча.
    if (!income && !expense && !description) return;

    const problems = [];
    if (Number.isNaN(income)) problems.push(`не число в «Поступление»: ${raw.income}`);
    if (Number.isNaN(expense)) problems.push(`не число в «Списание»: ${raw.expense}`);
    if (!Number.isNaN(income) && !Number.isNaN(expense) && !income && !expense) problems.push('нет суммы');
    if (!description) problems.push('нет назначения');
    const date = parseDate(raw.date);
    if (!date) problems.push(`неверная дата: «${raw.date || ''}»`);
    if (problems.length) {
      errors.push({ line: lineNo, text: line.slice(0, 120), error: problems.join(', ') });
      return;
    }
    rows.push({
      line: lineNo,
      date,
      income,
      expense,
      description,
      warranty: parseBool(raw.warranty),
      category: raw.category ? String(raw.category).trim() : '',
    });
  });

  return { rows, errors };
}
