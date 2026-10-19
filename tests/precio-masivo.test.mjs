import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const { loadEnvConfig } = require('@next/env');
const { createClient } = require('@supabase/supabase-js');

loadEnvConfig(process.cwd());

const helperPath = new URL('../lib/calculos/precio-masivo.ts', import.meta.url);
const helperSource = await readFile(helperPath, 'utf8');
const transpiled = ts.transpileModule(helperSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const helperUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`;
const { calcularNuevoPrecio } = await import(helperUrl);

const casos = [
  { anterior: 12000, tipo: 'porcentaje', valor: 5, redondeo: 0, esperado: 12600 },
  { anterior: 12000, tipo: 'porcentaje', valor: -5, redondeo: 0, esperado: 11400 },
  { anterior: 165.86, tipo: 'monto_fijo', valor: 3.25, redondeo: 0, esperado: 169.11 },
  { anterior: 123.45, tipo: 'porcentaje', valor: 5, redondeo: 10, esperado: 130 },
  { anterior: 165866.25, tipo: 'porcentaje', valor: 5, redondeo: 1000, esperado: 174000 },
  { anterior: 100.12, tipo: 'monto_fijo', valor: -0.13, redondeo: 0, esperado: 99.99 },
  { anterior: 0, tipo: 'monto_fijo', valor: -0.5, redondeo: 1, esperado: -1 },
  { anterior: 1, tipo: 'monto_fijo', valor: 0.005, redondeo: 0, esperado: 1.01 },
];

test('calcularNuevoPrecio aplica la fórmula y redondeo esperados', () => {
  for (const caso of casos) {
    assert.equal(calcularNuevoPrecio(caso.anterior, caso.tipo, caso.valor, caso.redondeo), caso.esperado);
  }
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
test('calcularNuevoPrecio coincide con public.calcular_nuevo_precio en PostgreSQL', { skip: !supabaseUrl || !supabaseAnonKey ? 'Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY.' : false }, async (t) => {
  const supabase = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  for (const caso of casos) {
    const { data, error } = await supabase.rpc('calcular_nuevo_precio', {
      p_precio_anterior: caso.anterior,
      p_tipo_ajuste: caso.tipo,
      p_valor: caso.valor,
      p_redondeo: caso.redondeo,
    });
    if (error?.code === 'PGRST202') {
      t.skip('La migración 20 aún no está aplicada en la base configurada.');
      return;
    }
    assert.ifError(error);
    assert.equal(Number(data), calcularNuevoPrecio(caso.anterior, caso.tipo, caso.valor, caso.redondeo));
  }
});
