#!/usr/bin/env node
/**
 * fa-lint-ui.mjs — سد خودکار نگارش فارسی روی رشته‌های رابط (افق کوتاه‌مدت گزارش ممیزی ۱٫۵٫۱)
 *
 * تا وقتی این بررسی در تست‌ها نبود، هر رشته جدید می‌توانست ارقام لاتین یا خط تیره بلند
 * بیاورد بدون آنکه هیچ رنگ قرمزی دیده شود (بخش ۶ گزارش: «نبود یک سد خودکار»).
 *
 * قواعد (روی رشته‌های دارای متن فارسی در src/):
 *   1. latin-digits  — ارقام لاتین 0-9 در رشته فارسی (باید faDigits/faPercent شود)
 *   2. em-dash       — خط تیره بلند (—) در رشته فارسی (به‌جای آن «،»/«؛»)
 *   3. straight-quote— نقل‌قول مستقیم (") داخل رشته فارسی (به‌جای «گیومه»)
 *   4. wordlist      — غلط‌های پرتکرار (مولفان → مؤلفان و…)
 *
 * خطوطی که کامنت «fa-lint:allow» دارند، مستثنی هستند (برای موارد عمدی).
 * اجرا: npm run lint:fa   (همچنین در npm test از tests/fa-lint-ui.test.mjs صدا زده می‌شود)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(__dirname, '..', 'src');

/** فایل‌هایی که عمداً حروف/ارقام عربی را-handle می‌کنند و باید مستثنا بمانند */
const EXCLUDED_FILES = [
  'services/normalize.ts', // جدول نرمال‌سازی — ي/ك عربی عمدی است
  'services/persian.ts', // تبدیل ارقام — تعریف ارقام لاتین عمدی است
];

const PERSIAN = /[\u0600-\u06FF]/;
const WORD_TYPOS = [
  { re: /مولفان/, fix: 'مؤلفان' },
];

/** استخراج رشته‌های یک‌خطی ('…' و "…") + بلوک‌های template literal */
function extractStrings(source) {
  const out = [];
  const lines = source.split('\n');
  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    // کامنت‌های سطری و بلوکی ساده نادیده گرفته می‌شوند
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;

    // رشته‌های یک‌خطی
    const re = /(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g;
    let m;
    while ((m = re.exec(rawLine)) !== null) {
      out.push({ lineNo, quote: m[1], value: m[2] });
    }
    // template literal یک‌خطی (بدون ${} در خط — رشته‌های چندخطی CSS جداگانه بررسی می‌شوند)
    if (rawLine.includes('`')) {
      const tm = /`([^`\n]*)`/g;
      while ((m = tm.exec(rawLine)) !== null) {
        out.push({ lineNo, quote: '`', value: m[1] });
      }
    }
  });
  return out;
}

/**
 * متن «مکتوب» رشته برای بررسی قواعد:
 * - محتوای عبارت‌های ${…} حذف می‌شود (ارقام/متغیرهای داخل بیان جزء متن نیستند؛
 *   اگر خروجی‌شان لاتین باشد، خطای واقعی در جایی است که مقدار ساخته می‌شود)
 * - توکن‌های فنی لاتین (مثل woff2 یا EPUB3) حذف می‌شوند — ارقام نام فنی،
 *   بخشی از نثر فارسی نیستند.
 */
function literalTextOf(value) {
  return value.replace(/\$\{[^}]*\}/g, ' ').replace(/[A-Za-z][A-Za-z0-9._-]*/g, ' ');
}

/** بررسی یک فایل؛ خروجی: فهرست ایرادها */
export function lintFile(absPath) {
  const rel = path.relative(SRC_ROOT, absPath).split(path.sep).join('/');
  if (EXCLUDED_FILES.includes(rel)) return [];
  const source = fs.readFileSync(absPath, 'utf-8');
  const issues = [];

  const allLines = source.split('\n');
  for (const { lineNo, quote, value } of extractStrings(source)) {
    if (!PERSIAN.test(value)) continue;
    // مستثنی‌سازی با کامنت «fa-lint:allow» در همان سطر یا سطر قبلش
    const near = `${allLines[lineNo - 1] ?? ''}\n${allLines[lineNo - 2] ?? ''}`;
    if (near.includes('fa-lint:allow')) continue;
    const text = literalTextOf(value);

    // 1) ارقام لاتین در متن فارسی (پس از حذف عبارت‌ها و توکن‌های فنی)
    if (/[0-9]/.test(text)) {
      issues.push({ file: rel, line: lineNo, rule: 'latin-digits', value });
    }
    // 2) خط تیره بلند (در متن مکتوب؛ جداکننده‌های کنار متغیر هم جزء متن‌اند)
    if (text.includes('—')) {
      issues.push({ file: rel, line: lineNo, rule: 'em-dash', value });
    }
    // 3) نقل‌قول مستقیم داخل رشته (غیر از کوتیشنِ محصورکننده)
    if ((quote === "'" && value.includes('"')) || (quote === '`' && value.includes('"'))) {
      issues.push({ file: rel, line: lineNo, rule: 'straight-quote', value });
    }
    // 4) غلط‌های واژه‌ای
    for (const { re: wRe, fix } of WORD_TYPOS) {
      if (wRe.test(value)) {
        issues.push({ file: rel, line: lineNo, rule: 'typo', value, fix });
      }
    }
  }
  return issues;
}

/** پیمایش src/ و بررسی همه فایل‌های ts/tsx */
export function lintUiStrings(root = SRC_ROOT) {
  const issues = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) issues.push(...lintFile(full));
    }
  };
  walk(root);
  return issues;
}

function main() {
  const issues = lintUiStrings();
  if (issues.length === 0) {
    console.log('fa-lint-ui: رشته‌های رابط فارسی سالم است (صفر ایراد).');
    return 0;
  }
  console.error(`fa-lint-ui: ${issues.length} ایراد در رشته‌های رابط:`);
  for (const it of issues) {
    console.error(`  [${it.rule}] ${it.file}:${it.line} → ${it.value.slice(0, 70)}${it.fix ? ` (اصلاح: ${it.fix})` : ''}`);
  }
  console.error('راهنما: ارقام را با faDigits/faPercent فارسی کنید؛ خط تیره بلند را با «؛» جایگزین کنید؛');
  console.error('برای موارد عمدی، کامنت «fa-lint:allow» را در همان سطر بگذارید.');
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
