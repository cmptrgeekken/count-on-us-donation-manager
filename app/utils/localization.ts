export default function l10n(currency: string = 'EUR', locale: string = 'de-DE') {
  const percentFormatter = new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 2
  })

  const currencyFormatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency
  });

  const currencySymbol = currencyFormatter.formatToParts(1)
                          .find(p => p.type === 'currency')?.value;

  return {
    getCurrencySymbol: () : string | undefined => currencySymbol,
    formatMoney: (amount: string | number) => {
      return currencyFormatter.format(+amount);
    },
    formatPct: (percent: string | number) => {
      return percentFormatter.format(+percent);
    }
  }
}