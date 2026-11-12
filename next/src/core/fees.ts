// Broker fees (Dime!): 0.15% commission + 7% VAT on that commission.
// A "no commission" trade waives the commission only. The VAT on it is still owed, so tax always
// derives from the trade value, never from the possibly-zeroed commission. The sheet-side formula
// written by Apps Script (`=G*0.15%*7%`) mirrors this and the two must stay in step.
export const COMMISSION_RATE = 0.0015;
export const VAT_RATE = 0.07;

export interface Fees { comm: number; tax: number; total: number }

export function feesOn(tradeValue: number, noCommission = false): Fees {
  const gross = tradeValue * COMMISSION_RATE;
  const comm = noCommission ? 0 : gross;
  const tax = gross * VAT_RATE;
  return { comm, tax, total: comm + tax };
}
