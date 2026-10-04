import { z } from "zod";

export function plainTextIntent(value: string): string {
  if (!/<\/?(?:div|p|br|span|b|strong|i|em|ul|ol|li|script|style)\b[^>]*>/i.test(value)) return value.trim();
  const entities: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\b[^>]*>|<\/(?:div|p|li)\s*>/gi, "\n")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/&(#x[\da-f]+|#\d+|nbsp|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
      if (!entity.startsWith("#")) return entities[entity.toLowerCase()] ?? match;
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : match;
    })
    .trim();
}

export const IntentTextSchema = z.string().max(8000).transform(plainTextIntent).pipe(z.string().min(1).max(2000));
