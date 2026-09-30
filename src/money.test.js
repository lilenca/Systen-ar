import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, roundAmount } from './money.js';

test('suma dos prendas sin perder un guaraní', () => {
  assert.equal(roundAmount(parseAmount('150000') + parseAmount('120000')), 270000);
});

test('interpreta el precio de venta con separador de miles local', () => {
  assert.equal(parseAmount('150.000'), 150000);
});

test('redondea residuos decimales del cálculo monetario', () => {
  assert.equal(roundAmount(269999.99999999994), 270000);
});

test('el pagaré conserva el total entero multiplicado por cinco', () => {
  assert.equal(roundAmount(roundAmount(150000 + 120000) * 5), 1350000);
});