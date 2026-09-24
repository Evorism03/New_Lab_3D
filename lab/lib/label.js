import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import bwipjs from 'bwip-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { colorShortLabel, connectorPlugLabel, modelRevisionLabel } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(__dirname, '..', 'assets');

const logoSvg = fs.readFileSync(path.join(assetsDir, '..', 'Logo.svg'), 'utf8');
const ruSvg = fs.readFileSync(path.join(assetsDir, '..', 'ru.svg'), 'utf8');
const fontRegular = path.join(assetsDir, 'fonts', 'DejaVuSans.ttf');
const fontBold = path.join(assetsDir, 'fonts', 'DejaVuSans-Bold.ttf');

function svgViewBox(svg, fallback) {
  const m = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : fallback;
}
const LOGO_VIEWBOX = svgViewBox(logoSvg, { w: 826, h: 262 });
const RU_VIEWBOX = svgViewBox(ruSvg, { w: 455, h: 651 });

const MM = 72 / 25.4;
const mm = (v) => v * MM;

function formatDate(isoOrNull) {
  const d = isoOrNull ? new Date(isoOrNull) : new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mo}/${yyyy}`;
}

async function barcodePng(text) {
  return bwipjs.toBuffer({
    bcid: 'code128',
    text,
    scale: 3,
    height: 10,
    includetext: false,
    backgroundcolor: 'FFFFFF',
  });
}

// svg-to-pdfkit fits the SVG to its own width/height attributes, not to the
// {width, height} option — so we rewrite the root element's attributes to
// the target box (viewBox scaling then does the rest, aspect ratio kept).
function drawSvg(doc, svgSource, x, y, targetW, targetH) {
  const resized = svgSource
    .replace(/(<svg\b[^>]*\bwidth=")[^"]*(")/, `$1${targetW}$2`)
    .replace(/(<svg\b[^>]*\bheight=")[^"]*(")/, `$1${targetH}$2`);
  SVGtoPDF(doc, resized, x, y, {});
}

// Уменьшает шрифт, пока строка не влезет в maxWidth, чтобы длинные модификации
// (например "Песочный - Mini Tamiya") не наезжали на соседнюю строку.
function fittedFontSize(doc, text, font, maxWidth, startSize, minSize = 5) {
  doc.font(font);
  let size = startSize;
  while (size > minSize && doc.fontSize(size).widthOfString(text) > maxWidth) {
    size -= 0.2;
  }
  return size;
}

// Вся вёрстка снята напрямую с эталонного PDF заказчика (58x40мм), который
// рендерился в PyMuPDF при zoom=20 и измерялся по пикселям — числа ниже это
// не оценка на глаз, а фактические координаты того макета в мм.
const LAYOUT = {
  marginX: 1.7,
  topRowY: 1.9,
  topRowH: 11.9, // логотип и RU — одной высоты, в одну строку
  textStartY: 14.0,
  lineH: 2.9,
  barcodeY: 26.0,
  barcodeH: 6.2,
  captionY: 36.3,
  captionH: 2.6,
};

export async function buildLabelPdf({ item, model, assembledAt }) {
  const width = mm(58);
  const height = mm(40);
  const doc = new PDFDocument({ size: [width, height], margin: 0 });
  doc.registerFont('Body', fontBold);
  doc.registerFont('BodyRegular', fontRegular);

  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const contentX = mm(LAYOUT.marginX);
  const contentW = width - 2 * mm(LAYOUT.marginX);

  // Логотип TACLAB слева, RU-марка справа — одной высоты, как в эталоне
  const topRowH = mm(LAYOUT.topRowH);
  const logoW = (topRowH / LOGO_VIEWBOX.h) * LOGO_VIEWBOX.w;
  drawSvg(doc, logoSvg, contentX, mm(LAYOUT.topRowY), logoW, topRowH);

  const ruW = (topRowH / RU_VIEWBOX.h) * RU_VIEWBOX.w;
  drawSvg(doc, ruSvg, contentX + contentW - ruW, mm(LAYOUT.topRowY), ruW, topRowH);

  // Текстовые поля — размер шрифта подбирается под ширину, чтобы длинные
  // модификации не наезжали на следующую строку.
  const lines = [
    ['Модель: ', modelRevisionLabel(model)],
    ['Модификация: ', `${colorShortLabel(item.color)} - ${connectorPlugLabel(item.connector)}`],
    ['Дата сборки: ', formatDate(assembledAt)],
    ['Серийный номер: ', item.serial_number],
  ];
  let y = mm(LAYOUT.textStartY);
  const lineH = mm(LAYOUT.lineH);
  for (const [label, value] of lines) {
    const text = label + value;
    const size = fittedFontSize(doc, text, 'Body', contentW, 7.2);
    doc.font('Body').fontSize(size).fillColor('black').text(text, contentX, y, {
      width: contentW,
      height: lineH,
      lineBreak: false,
      ellipsis: false,
    });
    y += lineH;
  }

  // Штрихкод серийного номера
  const barcodeBuf = await barcodePng(item.serial_number);
  const barcodeY = mm(LAYOUT.barcodeY);
  const barcodeH = mm(LAYOUT.barcodeH);
  doc.image(barcodeBuf, contentX, barcodeY, { width: contentW, height: barcodeH });

  doc
    .font('BodyRegular')
    .fontSize(4.3)
    .text(item.serial_number, contentX, mm(LAYOUT.captionY), {
      width: contentW,
      height: mm(LAYOUT.captionH),
      align: 'center',
      lineBreak: false,
    });

  doc.end();
  return done;
}
