import { describe, it, expect } from 'vitest';
import { amountInWordsMUR } from './index';

describe('amountInWordsMUR', () => {
  it.each([
    [8878000, 'EIGHTY EIGHT THOUSAND SEVEN HUNDRED EIGHTY RUPEES ONLY'],
    [3200000, 'THIRTY TWO THOUSAND RUPEES ONLY'],
    [380000, 'THREE THOUSAND EIGHT HUNDRED RUPEES ONLY'],
    [100, 'ONE RUPEES ONLY'],
    [0, 'ZERO RUPEES ONLY'],
    [150075, 'ONE THOUSAND FIVE HUNDRED RUPEES AND SEVENTY FIVE CENTS ONLY'],
    [50, 'ZERO RUPEES AND FIFTY CENTS ONLY'],
    [18000000000, 'ONE HUNDRED EIGHTY MILLION RUPEES ONLY'],
    [11100, 'ONE HUNDRED ELEVEN RUPEES ONLY'],
  ])('%d cents → %s', (input, out) => expect(amountInWordsMUR(input)).toBe(out));
});
