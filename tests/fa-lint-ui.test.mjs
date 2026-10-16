/**
 * fa-lint-ui.test.mjs — سد خودکار نگارش فارسی روی رشته‌های رابط.
 * اجرای `npm test` هم همین بررسی را انجام می‌دهد؛ یعنی «رشته جدیِ مشکل‌دار
 * دیگر به شاخه اصلی نمی‌رسد» (افق کوتاه‌مدت گزارش ممیزی ۱٫۵٫۱، بند ۴).
 */
import { describe, it, expect } from 'vitest';
import { lintUiStrings, lintFile } from '../scripts/fa-lint-ui.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('lint نگارش فارسی رشته‌های رابط', () => {
  it('هیچ رشته رابطی ارقام لاتین، خط تیره بلند یا غلط واژه‌ای ندارد', () => {
    const issues = lintUiStrings();
    const pretty = issues.map((i) => `[${i.rule}] ${i.file}:${i.line} → ${i.value.slice(0, 60)}`).join('\n');
    expect(pretty, pretty === '' ? '' : `ایرادها:\n${pretty}`).toBe('');
  });

  it('مستثنی‌سازی با کامنت fa-lint:allow کار می‌کند', () => {
    const tmp = path.join(here, 'fixtures', 'fa-lint-allow.sample.ts');
    const content = `export const a = 'پیشرفت ۵۰ درصد';\nexport const b = 'پیشرفت 50 درصد'; // fa-lint:allow\n`;
    fs.writeFileSync(tmp, content, 'utf-8');
    try {
      expect(lintFile(tmp)).toHaveLength(0);
      // بدون کامنت allow، همان فایل یک ایراد (ارقام لاتین) می‌دهد
      fs.writeFileSync(tmp, content.replace(' // fa-lint:allow', ''), 'utf-8');
      const issues = lintFile(tmp);
      expect(issues).toHaveLength(1);
      expect(issues[0].rule).toBe('latin-digits');
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });
});
