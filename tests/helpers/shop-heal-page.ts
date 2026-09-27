export const SHOP_HEAL_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Shop</title>
    <style>
      body {
        margin: 0;
        font-family: "Iowan Old Style", Palatino, Georgia, serif;
        background: #f4efe6;
        color: #1c1915;
      }
      main {
        max-width: 420px;
        margin: 48px auto;
        padding: 24px;
      }
      .top {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 24px;
      }
      h1 { font-size: 28px; font-weight: 500; margin: 0; }
      .count {
        font-family: ui-sans-serif, system-ui, sans-serif;
        font-size: 14px;
      }
      article {
        background: white;
        border-radius: 16px;
        padding: 20px;
        box-shadow: 0 12px 40px rgba(40, 30, 10, 0.08);
      }
      .swatch {
        height: 180px;
        border-radius: 12px;
        background: #9c2f2f;
      }
      h2 { font-size: 22px; font-weight: 500; margin: 16px 0 4px; }
      p { margin: 0 0 16px; color: #5c564c; }
      button {
        width: 100%;
        border: 0;
        border-radius: 999px;
        padding: 12px 16px;
        background: #1c1915;
        color: white;
        font: 600 15px ui-sans-serif, system-ui, sans-serif;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="top">
        <h1>Shop</h1>
        <div class="count">Basket <span id="count">0</span></div>
      </div>
      <article class="card">
        <div class="swatch"></div>
        <h2>Red medium shirt</h2>
        <p>£28</p>
        <button class="add-to-cart" id="add">Add to cart</button>
      </article>
    </main>
    <script>
      document.getElementById('add').addEventListener('click', () => {
        const count = document.getElementById('count');
        count.textContent = String(Number(count.textContent) + 1);
      });
    </script>
  </body>
</html>`;
