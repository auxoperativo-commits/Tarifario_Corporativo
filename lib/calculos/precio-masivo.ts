export type TipoAjusteMasivo = 'porcentaje' | 'monto_fijo';

type Fraccion = { numerador: bigint; denominador: bigint };

function potenciaDeDiez(exponente: number): bigint {
  let resultado = BigInt(1);
  for (let i = 0; i < exponente; i += 1) resultado *= BigInt(10);
  return resultado;
}

function fraccionDecimal(valor: number): Fraccion {
  if (!Number.isFinite(valor)) throw new Error('El valor debe ser finito.');
  const negativo = valor < 0;
  const [mantisa, exponenteTexto] = Math.abs(valor).toString().toLowerCase().split('e');
  const exponente = Number(exponenteTexto ?? 0);
  const [entero, decimal = ''] = mantisa.split('.');
  const digitos = BigInt(`${entero}${decimal}` || '0');
  const escala = decimal.length - exponente;
  const base: Fraccion = escala > 0
    ? { numerador: digitos, denominador: potenciaDeDiez(escala) }
    : { numerador: digitos * potenciaDeDiez(-escala), denominador: BigInt(1) };
  return { ...base, numerador: negativo ? -base.numerador : base.numerador };
}

function redondearFraccion(fraccion: Fraccion): bigint {
  const negativo = fraccion.numerador < 0n;
  const absoluto = negativo ? -fraccion.numerador : fraccion.numerador;
  const entero = absoluto / fraccion.denominador;
  const resto = absoluto % fraccion.denominador;
  const redondeado = entero + (resto * BigInt(2) >= fraccion.denominador ? BigInt(1) : BigInt(0));
  return negativo ? -redondeado : redondeado;
}

/** Misma fórmula que public.calcular_nuevo_precio; redondea mitades alejándose de cero como PostgreSQL numeric. */
export function calcularNuevoPrecio(
  anterior: number,
  tipo: TipoAjusteMasivo,
  valorFirmado: number,
  redondeo: 0 | 1 | 10 | 100 | 1000
): number {
  const base = fraccionDecimal(anterior);
  const ajuste = fraccionDecimal(valorFirmado);
  let nuevo: Fraccion;

  if (tipo === 'porcentaje') {
    nuevo = {
      numerador: base.numerador * (BigInt(100) * ajuste.denominador + ajuste.numerador),
      denominador: base.denominador * BigInt(100) * ajuste.denominador,
    };
  } else {
    nuevo = {
      numerador: base.numerador * ajuste.denominador + ajuste.numerador * base.denominador,
      denominador: base.denominador * ajuste.denominador,
    };
  }

  if (redondeo !== 0) {
    const unidades = redondearFraccion({ numerador: nuevo.numerador, denominador: nuevo.denominador * BigInt(redondeo) });
    nuevo = { numerador: unidades * BigInt(redondeo), denominador: BigInt(1) };
  }

  const centavos = redondearFraccion({ numerador: nuevo.numerador * BigInt(100), denominador: nuevo.denominador });
  return Number(centavos) / 100;
}
