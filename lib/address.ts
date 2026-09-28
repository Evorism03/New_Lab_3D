// Delivery options and the address line the CRM (lab) expects: it keeps the pickup address as one
// string ("pvz_address") and splits it into city / street / house / extra itself (lab/public/address.js),
// which understands both "г Казань, ул Ленина, д 5, ПВЗ №12" and "Казань, Ленина, д. 5".

/** Carriers exactly as the CRM names them (lab db.js DELIVERY_SERVICES). */
export const DELIVERY_SERVICES = ["СДЭК", "Озон", "Почта России"] as const;
export type DeliveryService = (typeof DELIVERY_SERVICES)[number];

export type AddressParts = {
  /** City with its type when known ("г Казань"), else as typed. */
  city: string;
  street: string;
  house: string;
  /** Pickup point number, mall, entrance… */
  extra?: string;
};

export function formatAddressLine({ city, street, house, extra }: AddressParts): string {
  // A house typed by hand gets "д." so the CRM recognises it; one from the suggestions already has it.
  const houseWithType = /^(д|дом|вл|владение|уч)\.?\s/i.test(house.trim()) ? house.trim() : `д. ${house.trim()}`;
  return [city.trim(), street.trim(), houseWithType, extra?.trim()].filter(Boolean).join(", ");
}
