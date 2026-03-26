import assert from 'node:assert/strict';
import { connect } from '../packages/sdk/dist/index.js';

const browserId = 'smoke-managed';
const html = `
<!doctype html>
<html lang="en">
  <body>
    <main>
      <label for="name">Name</label>
      <input id="name" data-testid="name-input" />
      <label for="notes">Notes</label>
      <textarea id="notes" data-testid="notes-input"></textarea>
      <button type="button" id="submit">Submit</button>
      <button type="button" id="load-more">Load more</button>
      <p data-testid="status">Idle</p>
      <p data-testid="load-status">Loads: 0</p>
    </main>
    <script>
      const input = document.querySelector('#name');
      const notes = document.querySelector('#notes');
      const status = document.querySelector('[data-testid="status"]');
      const loadStatus = document.querySelector('[data-testid="load-status"]');
      let loadCount = 0;
      document.querySelector('#submit').addEventListener('click', () => {
        status.textContent = 'Saved: ' + input.value + ' / ' + notes.value;
      });
      document.querySelector('#load-more').addEventListener('click', (event) => {
        loadCount += 1;
        loadStatus.textContent = 'Loads: ' + loadCount;
        if (loadCount >= 3) {
          event.currentTarget.remove();
        }
      });
    </script>
  </body>
</html>
`;
const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

const client = await connect();

try {
  const browser = await client.launchManaged({
    browserId,
    label: 'Managed smoke browser',
    headless: true,
    url: dataUrl,
  });

  assert.equal(browser.id, browserId);

  const pages = await client.pages(browserId);
  assert.equal(pages.length, 1);
  const resolvedBeforeAlias = await client.resolvePage(pages[0].targetId, browserId);
  assert.equal(resolvedBeforeAlias.targetId, pages[0].targetId);

  const initialDoctor = await client.doctor(browserId);
  assert.equal(initialDoctor.browser.id, browserId);

  const aliased = await client.alias(pages[0].targetId, 'smoke-form', browserId);
  assert.equal(aliased.alias, 'smoke-form');
  const resolvedAlias = await client.resolvePage('smoke-form', browserId);
  assert.equal(resolvedAlias.alias, 'smoke-form');

  const warmed = await client.warm(['smoke-form'], browserId);
  assert.equal(warmed.length, 1);

  const page = client.page('smoke-form', browserId);
  const initialSnapshot = await page.snapshot('smoke');
  assert.equal(initialSnapshot.title, '');
  assert.ok(initialSnapshot.nodes.length > 0);

  await page.hover('role=button|Submit');
  await page.click('#name');
  await page.insertText('Example');
  await page.type('label=Name', ' User');
  await page.fill('label=Notes', 'Focused insert');
  const submitPoint = await page.evaluate(`(() => {
    const rect = document.querySelector('#submit').getBoundingClientRect();
    return {
      x: rect.left + (rect.width / 2),
      y: rect.top + (rect.height / 2)
    };
  })()`);
  await page.clickPoint(submitPoint.value.x, submitPoint.value.y);
  await page.waitForText('Saved: Example User / Focused insert', 5_000);
  const loadAll = await page.loadAll('text=Load more', 25);
  assert.equal(loadAll.value.clicks, 3);
  assert.equal(loadAll.value.completed, true);
  assert.equal(loadAll.value.stopReason, 'missing');
  await page.waitForText('Loads: 3', 5_000);

  const htmlResult = await page.html('testid=status');
  assert.match(htmlResult.value ?? '', /Saved: Example User \/ Focused insert/);

  const evalResult = await page.evaluate(`document.querySelector('[data-testid="status"]')?.textContent`);
  assert.equal(evalResult.value, 'Saved: Example User / Focused insert');

  const cdpReadyState = await page.cdp('Runtime.evaluate', {
    expression: 'document.readyState',
    returnByValue: true,
    awaitPromise: true,
  });
  assert.equal(cdpReadyState.result.value, 'complete');

  const screenshot = await page.screenshot();
  assert.ok(screenshot.value);
  assert.ok(screenshot.diagnostics?.devicePixelRatio);

  const reloaded = await page.reload();
  assert.ok(reloaded.value);

  const navigated = await page.goto(dataUrl);
  assert.equal(navigated.value, dataUrl);

  const network = await page.networkSummary();
  assert.equal(network.page.alias, 'smoke-form');

  const extraPage = await client.open('about:blank', browserId);
  const closed = await client.close(extraPage.targetId, browserId);
  assert.equal(closed.value, extraPage.targetId);

  const finalDoctor = await client.doctor(browserId, 'smoke-form');
  assert.equal(finalDoctor.page?.summary.alias, 'smoke-form');
  const detached = await client.detach(browserId);
  assert.equal(detached.id, browserId);
  assert.equal(detached.connected, false);

  console.log(
    JSON.stringify(
      {
        browser,
        initialDoctor,
        finalDoctor,
        page: network.page,
        loadAll: loadAll.value,
        screenshotPath: screenshot.value,
        detached,
      },
      null,
      2,
    ),
  );
} finally {
  await client.stopDaemon().catch(() => undefined);
  await client.disconnect().catch(() => undefined);
}
