// 25/11/2026 (Munchis, "una ramita de jengibre" → 1 kg): un renglón con cantidad VAGA no trae número y usa una palabra
// de "poquito". El intérprete carga la última cantidad del cliente en duda, y la memoria del cliente NO aprende la
// cantidad de estos renglones cuando solo se confirman sin cambiar nada (aprendería el "1" que inventó el modelo).
const PALABRAS_VAGAS = /\b(ramitas?|un poco|poquito|algo de|manojos?|manojitos?|pizca|punado)\b/i;

export function esCantidadVaga(rawLine: string | null | undefined): boolean {
  const s = (rawLine ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  return !!s.trim() && !/\d/.test(s) && PALABRAS_VAGAS.test(s);
}
