import type { Locator, Page } from '@playwright/test';

export const SECTION_HTML = `<!doctype html>
<html>
  <body>
    <div class="body">
      <div class="contentsection">
        <button class="content" id="go">Go</button>
      </div>
    </div>
    <span id="badge">0</span>
    <script>
      document.getElementById('go').addEventListener('click', () => {
        document.getElementById('badge').textContent = '1';
      });
    </script>
  </body>
</html>`;

export class BrokenBodySection {
  readonly body: Locator;
  readonly contentsection: Locator;
  readonly content: Locator;

  constructor(page: Page) {
    this.body = page.locator('.old-body');
    this.contentsection = this.body.locator('.contentsection');
    this.content = this.contentsection.locator('.content');
  }
}

export class BrokenSectionLevel {
  readonly body: Locator;
  readonly contentsection: Locator;
  readonly content: Locator;

  constructor(page: Page) {
    this.body = page.locator('.body');
    this.contentsection = this.body.locator('.old-section');
    this.content = this.contentsection.locator('.content');
  }
}

export class BrokenContentLevel {
  readonly body: Locator;
  readonly contentsection: Locator;
  readonly content: Locator;

  constructor(page: Page) {
    this.body = page.locator('.body');
    this.contentsection = this.body.locator('.contentsection');
    this.content = this.contentsection.locator('.old-content');
  }
}
