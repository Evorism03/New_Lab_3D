// Разбор строк, скопированных из листа «Продажи» Google-таблицы:
// #, С / Н, Ревизия, Цвет, Разъем, Дата сборки, Прим. Главное — сам серийник: ревизия, цвет,
// разъём и номер берутся из него. Строки-заготовки без цвета/разъёма («AL1R030059») пропускаются.
import { splitLine, parseDate } from './ledger-import.js';

const DEFAULT_COLUMNS = ['number', 'serial', 'revision', 'color', 'connector', 'assembled_at', 'note'];

const HEADER_RULES = [
  [/^#$|^№/, 'number'],
  [/с\s*\/\s*н|серийн/i, 'serial'],
  [/ревизи/i, 'revision'],
  [/цвет/i, 'color'],
  [/разъ[её]м/i, 'connector'],
  [/дата/i, 'assembled_at'],
  [/прим|коммент/i, 'note'],
];

const SERIAL_RE = /^[A-Z0-9]+?R\d{2}[A-Z][A-Z]\d{4}$/;
const PLACEHOLDER_RE = /^[A-Z0-9]+?R\d{2}\d{4}$/;

export function parseSerialsText(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const delimiter = lines.some((l) => l.includes('\t')) ? '\t' : ';';
  let columns = DEFAULT_COLUMNS;
  const rows = [];
  const errors = [];

  lines.forEach((line, index) => {
    if (!line.trim()) return;
    const cells = splitLine(line, delimiter).map((c) => c.trim());
    const header = cells.map((c) => HEADER_RULES.find(([re]) => re.test(c))?.[1] || null);
    if (header.filter(Boolean).length >= 2) {
      columns = header;
      return;
    }
    const raw = {};
    columns.forEach((key, i) => {
      if (key && raw[key] === undefined) raw[key] = cells[i] ?? '';
    });
    const serial = String(raw.serial || '').replace(/\s/g, '').toUpperCase();
    if (!serial || PLACEHOLDER_RE.test(serial)) return; // пустая строка или заготовка без цвета/разъёма
    if (!SERIAL_RE.test(serial)) {
      errors.push({ line: index + 1, text: line.slice(0, 120), error: `серийник не в формате AL1R03TT0043: «${raw.serial}»` });
      return;
    }
    // «31.08.2026- Не активен» → дата сборки + пометка в примечание.
    const dateText = String(raw.assembled_at || '').trim();
    const assembled = parseDate(dateText) || '';
    const dateRest = assembled ? dateText.replace(/^[\d./-]+/, '').replace(/^[\s\-–—,]+/, '').trim() : dateText;
    const note = [dateRest, String(raw.note || '').trim()].filter(Boolean).join(' · ');
    rows.push({ line: index + 1, serial, assembled_at: assembled, note });
  });
  return { rows, errors };
}
