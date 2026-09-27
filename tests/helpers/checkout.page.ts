import type { Page } from '@playwright/test';

export function checkoutHtml(changed: 'header' | 'body' | 'button'): string {
  const header = changed === 'header' ? 'site-header' : 'header';
  const body = changed === 'body' ? 'checkout-panel' : 'body-custom-name';
  const button = changed === 'button' ? 'submit-payment' : 'pay-now';
  return `<!doctype html>
<html>
  <body>
    <div class="${header}">
      <div class="${body}">
        <div class="sub-element">
          <button class="${button}" id="pay">Pay</button>
        </div>
      </div>
    </div>
    <span id="badge">0</span>
    <script>
      document.getElementById('pay').addEventListener('click', () => {
        document.getElementById('badge').textContent = '1';
      });
    </script>
  </body>
</html>`;
}

export class CheckoutPage {
  constructor(private readonly page: Page) {}

  payButton() {
    return this.page.locator('.header .body-custom-name:visible .sub-element .pay-now');
  }
}
