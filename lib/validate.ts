/** Input checks for vehicles, crew and users. */

const PLATE_PATTERNS = [
  /^[A-Z]{2} \d{2} [A-Z]{2} GP$/, // Gauteng, current format: "JK 21 LM GP"
  /^[A-Z]{3} \d{3} (GP|EC|FS|MP|NW|NC|ZN|L)$/, // "TKD 482 GP", "HGF 123 EC"
  /^C[A-Z]{1,2} \d{1,3}-\d{3}$/, // Western Cape: "CA 123-456"
  /^C[A-Z]{1,2} \d{1,6}$/, // Western Cape: "CFM 12345"
  /^N[A-Z]{1,2} \d{1,3}-\d{3}$/, // KwaZulu-Natal, older format: "ND 123-456"
  /^[A-Z0-9]{1,7} (GP|EC|FS|MP|NW|NC|ZN|L|WP)$/, // personalised: "VOTE2026 GP"
];

export const normalisePlate = (input: string) => input.trim().toUpperCase().replace(/\s+/g, " ");
export const isSaPlate = (plate: string) => PLATE_PATTERNS.some((pattern) => pattern.test(plate));

/** "082 123 4567" or "+27 82 123 4567" -> "+27821234567" */
export function normalisePhone(input: string): string {
  const compact = input.replace(/[\s()-]/g, "");
  return compact.startsWith("0") ? `+27${compact.slice(1)}` : compact;
}
export const isSaMobile = (phone: string) => /^\+27[1-9]\d{8}$/.test(phone);

/** RFID tags are 96-bit EPCs: 24 hex characters, stored without spaces. */
export const normaliseTag = (input: string) => input.replace(/\s+/g, "").toUpperCase();
export const isEpc = (tag: string) => /^[0-9A-F]{24}$/.test(tag);
/** "E2801170A1B2..." -> "E280 1170 A1B2 ..." for reading aloud and matching labels. */
export const formatTag = (tag: string) => tag.replace(/(.{4})(?=.)/g, "$1 ");

/** A random EPC with the given prefix, for new tags and badges. */
export function randomEpc(prefix: string): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return (prefix + hex).slice(0, 24);
}

export const isEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
