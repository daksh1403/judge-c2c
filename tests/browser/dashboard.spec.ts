import { test, expect } from '@playwright/test';
test('judges can filter submissions and follow criterion evidence', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Follow the evidence.' }),
  ).toBeVisible();
  await expect(
    page.getByText('All displayed evidence is synthetic.', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'hackathon/CampaignOS' }),
  ).toBeVisible();
  await page.getByRole('searchbox').fill('does-not-exist');
  await expect(
    page.getByText('No submissions match.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('searchbox').fill('');
  await page.getByRole('combobox').selectOption('COMPLETED');
  await page.getByRole('button', { name: 'hackathon/CampaignOS' }).click();
  await expect(
    page.getByRole('heading', { name: 'Assigned requirements' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Evidence ledger' }),
  ).toBeVisible();
  await expect(
    page
      .getByText(
        'Runtime scheduling behavior needs isolated execution evidence.',
        { exact: false },
      )
      .first(),
  ).toBeVisible();
  await page.getByRole('button', { name: '↗ criterion-docs-heading' }).click();
  await expect(page.locator('#e-criterion-docs-heading')).toBeInViewport();
  await page.getByRole('button', { name: 'All submissions' }).click();
  await page.getByRole('button', { name: 'Repositories' }).click();
  await expect(
    page.getByRole('heading', { name: 'Registered challenge repositories' }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test('review APIs reject writes and expose security headers', async ({
  request,
}) => {
  const response = await request.get('/health');
  expect(response.ok()).toBeTruthy();
  expect(response.headers()['content-security-policy']).toContain(
    "frame-ancestors 'none'",
  );
  expect((await response.json()).mode).toBe('synthetic-review');
  expect((await request.post('/api/contracts', { data: {} })).status()).toBe(
    403,
  );
  expect((await request.post('/webhooks/github', { data: {} })).status()).toBe(
    503,
  );
});
test('the workspace fits a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Submission activity' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});
