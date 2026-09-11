/**
 * Interpreta importes escritos con separadores argentinos (849.986,68) y
 * también formatos usuales con punto decimal (849986.68).
 */
export function parsearNumeroLocal(valor: string | number): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;

  const texto = valor.trim().replace(/\s/g, '');
  if (!texto) return null;

  // Solo se admiten dígitos y separadores: evita que una entrada incompleta o
  // con símbolos termine guardándose como un importe distinto.
  if (!/^\d[\d.,]*$/.test(texto)) return null;

  const ultimoPunto = texto.lastIndexOf('.');
  const ultimaComa = texto.lastIndexOf(',');
  let normalizado: string;

  if (ultimoPunto >= 0 && ultimaComa >= 0) {
    // Cuando hay ambos, el último separador es el decimal.
    const indiceDecimal = Math.max(ultimoPunto, ultimaComa);
    const entero = texto.slice(0, indiceDecimal).replace(/[.,]/g, '');
    const decimal = texto.slice(indiceDecimal + 1).replace(/[.,]/g, '');
    normalizado = `${entero}.${decimal}`;
  } else if (ultimaComa >= 0) {
    normalizado = texto.replace(/\./g, '').replace(',', '.');
  } else {
    // Un punto seguido de exactamente tres dígitos se considera separador de
    // miles; en los demás casos conserva su papel de separador decimal.
    normalizado = /\.\d{3}$/.test(texto) ? texto.replace(/\./g, '') : texto;
  }

  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
}
