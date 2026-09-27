import type { Locator, Page } from '@playwright/test';

const TARGET_INVOICE = 1042;

export function crowdedCheckoutHtml(count = 30): string {
  const start = TARGET_INVOICE - Math.floor(count / 2);
  const sections = Array.from({ length: count }, (_, index) => {
    const invoice = start + index;
    return `<section class="invoice" data-invoice="${invoice}">
      <h2>Invoice ${invoice}</h2>
      <button class="action">View invoice ${invoice}</button>
      <button class="action" data-qa="pay-${invoice}">Pay invoice ${invoice}</button>
      <button class="action">Download invoice ${invoice}</button>
    </section>`;
  }).join('\n');

  return `<!doctype html>
<html>
  <body>
    <main class="checkout">
      ${sections}
    </main>
    <p id="chosen">none</p>
    <script>
      document.querySelectorAll('button').forEach((button) => {
        button.addEventListener('click', () => {
          document.getElementById('chosen').textContent = button.textContent;
        });
      });
    </script>
  </body>
</html>`;
}

export class CrowdedCheckoutPage {
  readonly invoice: Locator;
  readonly pay: Locator;

  constructor(page: Page) {
    this.invoice = page.locator('.invoice-1042');
    this.pay = this.invoice.locator('.pay-button');
  }
}

export class CrowdedCheckoutChain {
  readonly checkout: Locator;
  readonly invoice: Locator;
  readonly pay: Locator;

  constructor(page: Page) {
    this.checkout = page.locator('.checkout');
    this.invoice = this.checkout.locator('.invoice-1042');
    this.pay = this.invoice.locator('.pay-button');
  }
}
