import { expect, it } from 'vitest';
import { reviewCost } from '../src/review-cost';
it('estimates known successful-response usage and never substitutes token estimates or absent prices', () => {
  const rates = JSON.stringify({
    'test/model': { inputUsdPerMillion: 2, outputUsdPerMillion: 5 },
  });
  expect(
    reviewCost(rates, 'test', 'model', {
      input_tokens: 1000,
      output_tokens: 200,
    }),
  ).toMatchObject({
    status: 'ESTIMATE',
    microUsd: 3000,
    scope: 'successful-final-response',
  });
  for (const usage of [
    undefined,
    {},
    { input_tokens: -1, output_tokens: 2 },
    { input_tokens: 1.5, output_tokens: 2 },
  ])
    expect(reviewCost(rates, 'test', 'model', usage).status).toBe(
      'UNAVAILABLE',
    );
  expect(
    reviewCost(undefined, 'test', 'model', {
      input_tokens: 2,
      output_tokens: 2,
    }).status,
  ).toBe('UNAVAILABLE');
  expect(
    reviewCost(rates, 'test', 'other', { input_tokens: 2, output_tokens: 2 })
      .status,
  ).toBe('UNAVAILABLE');
});
