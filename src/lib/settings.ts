import { setFormatConfig } from "./format";

export type Branding = {
  id: string | null;
  business_name: string;
  business_tagline: string;
  logo_url: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  currency_symbol: string;
  date_format: string;
  invoice_footer: string;
};

export const DEFAULT_BRANDING: Branding = {
  id: null,
  business_name: "StockFlow",
  business_tagline: "Store Management & Distribution",
  logo_url: null,
  address: null,
  phone: null,
  email: null,
  currency_symbol: "PKR",
  date_format: "dd MMM yyyy",
  invoice_footer: "Thank you for your business.",
};

// Module-level cache so non-React code (PDF/print) can read synchronously.
let _branding: Branding = { ...DEFAULT_BRANDING };

export function getBranding(): Branding {
  return _branding;
}

export function setBranding(b: Partial<Branding>) {
  _branding = { ..._branding, ...b };
  setFormatConfig({
    currencySymbol: _branding.currency_symbol,
    dateFormat: _branding.date_format,
  });
}
