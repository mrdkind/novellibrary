/** تنظیمات مرکزی سایت — نام سایت و پیوندها را از همین‌جا تغییر دهید */

/** نام سایت (در سربرگ، صفحات و متا) */
export const SITE_NAME = 'روایت بی‌پایان';

/** نام لاتین سایت (در عنوان تب و برندینگ دوزبانه) */
export const SITE_NAME_EN = 'Novel Library';

/** عنوان کامل تب مرورگر */
export const SITE_TITLE = `${SITE_NAME} | ${SITE_NAME_EN}`;

/** شعار سایت در سربرگ */
export const SITE_TAGLINE = 'کتابخانه آنلاین ناول و کتاب‌خوان EPUB';

/**
 * نشانی کانال تلگرام (اطلاع‌رسانی کتاب‌های جدید و ادامه ترجمه‌ها)
 */
export const TELEGRAM_URL = 'https://t.me/NOVEl_WO';

/** نام نمایشی کانال تلگرام */
export const TELEGRAM_HANDLE = 't.me/NOVEl_WO';

/**
 * نشانی مخزن GitHub (بدون اسلش انتهایی).
 * اگر خالی باشد، لینک‌های مخزن در فوتر/درباره نمایش داده نمی‌شوند.
 * پس از انتشار مخزن خودتان، این مقدار را در این فایل تنظیم کنید.
 */
export const REPO_URL = '';

/**
 * نشانی تماس/گزارش مشکل. اگر خالی باشد نمایش داده نمی‌شود.
 * (اطلاعات تماس ساختگی عمداً درج نشده است.)
 */
export const CONTACT_URL = '';

/** نسخه پشتیبان Export/Import */
export const APP_VERSION = '1.4.0';

/** سقف پیشرفت‌های ذخیره‌شده در تاریخچه */
export const HISTORY_LIMIT = 60;

/** مهلت درخواست‌های شبکه (میلی‌ثانیه) */
export const FETCH_TIMEOUT_MS = 30_000;

/**
 * شناسه قالب فایل پشتیبان (Export/Import).
 * توجه: برای سازگاری با پشتیبان‌های نسخه‌های قبلی عمداً «NovelShelf» حفظ شده است.
 */
export const BACKUP_APP_ID = 'NovelShelf';
