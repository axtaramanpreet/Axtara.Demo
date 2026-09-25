import type { ComboOption } from '@/components/ui/combobox';

/**
 * Every ISO 4217 currency the runtime knows, with its English name:
 * { value: 'INR', label: 'Indian Rupee' }.
 *
 * Read from Intl rather than kept as a list here, so it is complete and never
 * goes stale. The fallback only covers a runtime without Intl.supportedValuesOf.
 */
export const CURRENCIES: ComboOption[] = (() => {
  try {
    const names = new Intl.DisplayNames(['en'], { type: 'currency' });
    return Intl.supportedValuesOf('currency').map((code) => ({ value: code, label: names.of(code) ?? code }));
  } catch {
    return ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CHF', 'SGD', 'HKD', 'AUD', 'CAD'].map((c) => ({ value: c, label: c }));
  }
})();
