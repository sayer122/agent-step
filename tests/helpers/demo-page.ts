export const DEMO_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Agentic Demo Shop</title>
  </head>
  <body>
    <h1>Agentic Demo Shop</h1>
    <section aria-label="Products">
      <article>
        <h2>Red medium shirt</h2>
        <button id="add-red">Add to basket</button>
      </article>
      <article>
        <h2>Blue large shirt</h2>
        <button id="add-blue">Add to basket</button>
      </article>
    </section>
    <aside aria-label="Basket">
      <p>Basket badge: <span id="badge">0</span></p>
      <ul id="basket-items"></ul>
    </aside>
    <section aria-label="Login">
      <label>
        Email
        <input id="email" type="email" />
      </label>
      <button id="login">Sign in</button>
      <p id="login-status">Signed out</p>
    </section>
    <script>
      const badge = document.getElementById('badge');
      const basketItems = document.getElementById('basket-items');
      const loginStatus = document.getElementById('login-status');

      function addItem(name) {
        const count = Number(badge.textContent || '0') + 1;
        badge.textContent = String(count);
        const li = document.createElement('li');
        li.textContent = name;
        basketItems.appendChild(li);
      }

      document.getElementById('add-red').addEventListener('click', () => addItem('Red medium shirt'));
      document.getElementById('add-blue').addEventListener('click', () => addItem('Blue large shirt'));
      document.getElementById('login').addEventListener('click', () => {
        const email = document.getElementById('email').value;
        loginStatus.textContent = email ? 'Signed in as ' + email : 'Signed out';
      });
    </script>
  </body>
</html>`;
