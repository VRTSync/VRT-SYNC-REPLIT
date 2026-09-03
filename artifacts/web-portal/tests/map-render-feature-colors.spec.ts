/**
 * map-render-feature-colors.spec.ts
 *
 * Covers the public per-feature colour API with a deterministic iframe bridge.
 * The bridge records commands and can emit the same viewAssetDetail message
 * used by the canonical Leaflet template, so this test does not need Leaflet,
 * Mapbox, a database, or a session.
 */

import { test, expect, type Page } from '@playwright/test';

const MOCK_LEAFLET_IFRAME = `<!DOCTYPE html>
<html><body><script>
  window.receivedCmds = [];
  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (typeof msg === 'string') {
      try { msg = JSON.parse(msg); } catch (_) { return; }
    }
    if (msg && msg.type === 'cmd') {
      window.receivedCmds.push({ fn: msg.fn, args: msg.args });
    }
  });

  window._tapFeature = function (featureRef) {
    parent.postMessage({
      type: 'viewAssetDetail',
      data: {
        featureRef: String(featureRef),
        featureId: String(featureRef),
        layerKey: 'custom',
        label: 'Parcel',
        assetType: 'parcel',
        layerName: 'Custom parcels'
      }
    }, '*');
  };

  setTimeout(function () {
    parent.postMessage({ type: 'mapReady' }, '*');
  }, 100);
</script></body></html>`;

const HARNESS_HTML = `<!DOCTYPE html>
<html><body>
  <iframe id="map-frame" src="/leaflet-map.html"></iframe>
  <script src="/common-static/map-render.js"></script>
  <script>
    window.testRenderer = window.VRTMapRenderer.create({
      iframe: document.getElementById('map-frame'),
      adapter: {
        fetchLayers: function () { return Promise.resolve([]); },
        fetchLayerGeojson: function () { return Promise.resolve(null); }
      },
      hierarchy: {}
    });
  </script>
</body></html>`;

type Command = { fn: string; args: unknown[] };

async function receivedCommands(page: Page): Promise<Command[]> {
  return page.frameLocator('#map-frame').locator('body').evaluate(
    () => (window as unknown as { receivedCmds: Command[] }).receivedCmds ?? [],
  );
}

async function setup(page: Page): Promise<void> {
  await page.route('**/test/map-render-feature-colors', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: HARNESS_HTML }),
  );
  await page.route('**/leaflet-map.html', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: MOCK_LEAFLET_IFRAME }),
  );
  await page.goto('/test/map-render-feature-colors');
}

test.describe('VRTMapRenderer.setFeatureColors', () => {
  test('queues before mapReady, passes an empty map fallback, and preserves the existing API', async ({ page }) => {
    await setup(page);

    const apiShape = await page.evaluate(() => {
      const renderer = (window as any).testRenderer;
      renderer.setFeatureColors('custom-layer', undefined, '#cccccc');
      return {
        setFeatureColors: typeof renderer.setFeatureColors,
        addCustomLayer: typeof renderer.addCustomLayer,
        applyColorLive: typeof renderer.applyColorLive,
        cmdToIframe: typeof renderer.cmdToIframe,
      };
    });
    expect(apiShape).toEqual({
      setFeatureColors: 'function',
      addCustomLayer: 'function',
      applyColorLive: 'function',
      cmdToIframe: 'function',
    });

    await expect.poll(async () => (await receivedCommands(page)).filter((c) => c.fn === 'updateLayerColorMap')).toHaveLength(1);
    const queued = (await receivedCommands(page)).find((c) => c.fn === 'updateLayerColorMap');
    expect(queued?.args).toEqual(['custom-layer', {}, '#cccccc']);
  });

  test('updates feature colours repeatedly without re-adding, refitting, or failing for unknown layers', async ({ page }) => {
    await setup(page);

    await page.evaluate(() => {
      const renderer = (window as any).testRenderer;
      renderer.addCustomLayer({
        id: 'custom-layer',
        layerKey: 'custom',
        subLayerKey: 'custom',
        color: '#888888',
        geojson: { type: 'FeatureCollection', features: [] },
      });
      renderer.setFeatureColors('custom-layer', { parcelA: '#ff0000' }, '#cccccc');
      renderer.setFeatureColors('custom-layer', { parcelA: '#00ff00', parcelB: '#0000ff' }, '#dddddd');
      renderer.setFeatureColors('does-not-exist', { parcelA: '#ff0000' }, '#cccccc');
    });

    await expect.poll(async () => (await receivedCommands(page)).filter((c) => c.fn === 'updateLayerColorMap')).toHaveLength(3);
    const commands = await receivedCommands(page);
    expect(commands.filter((c) => c.fn === 'addLayers')).toHaveLength(1);
    expect(commands.filter((c) => c.fn === 'fitBounds')).toHaveLength(0);
    expect(commands.filter((c) => c.fn === 'showLayerIds')).toHaveLength(0);
    expect(commands.filter((c) => c.fn === 'updateLayerColorMap').map((c) => c.args)).toEqual([
      ['custom-layer', { parcelA: '#ff0000' }, '#cccccc'],
      ['custom-layer', { parcelA: '#00ff00', parcelB: '#0000ff' }, '#dddddd'],
      ['does-not-exist', { parcelA: '#ff0000' }, '#cccccc'],
    ]);
  });

  test('assetTap exposes a feature key usable directly with setFeatureColors', async ({ page }) => {
    await setup(page);

    await page.evaluate(() => {
      const renderer = (window as any).testRenderer;
      renderer.on('assetTap', (payload: unknown) => { (window as any)._capturedAssetTap = payload; });
    });
    // The mock iframe owns the tap trigger; invoking it through the frame
    // mirrors a user feature click and preserves the public event boundary.
    await page.frameLocator('#map-frame').locator('body').evaluate(() => (window as any)._tapFeature('parcel-42'));
    await expect.poll(() => page.evaluate(() => Boolean((window as any)._capturedAssetTap))).toBe(true);
    const payload = await page.evaluate(() => (window as any)._capturedAssetTap) as {
      featureRef: string;
      featureId: string;
      layerKey: string;
    };

    expect(payload.featureRef).toBe('parcel-42');
    expect(payload.featureId).toBe(payload.featureRef);
    expect(payload.layerKey).toBe('custom');

    await page.evaluate((featureRef) => {
      (window as any).testRenderer.setFeatureColors(
        'custom-layer',
        { [featureRef]: '#ff0000' },
        '#cccccc',
      );
    }, payload.featureRef);
    await expect.poll(async () => (await receivedCommands(page)).filter((c) => c.fn === 'updateLayerColorMap')).toHaveLength(1);
    const colorCommand = (await receivedCommands(page)).find((c) => c.fn === 'updateLayerColorMap');
    expect(colorCommand?.args).toEqual(['custom-layer', { 'parcel-42': '#ff0000' }, '#cccccc']);
  });
});

test.describe('VRTMapRenderer custom-layer fitting', () => {
  test('fits only currently shown custom geometry and ignores hidden layers', async ({ page }) => {
    await setup(page);

    await page.evaluate(() => {
      const renderer = (window as any).testRenderer;
      renderer.addCustomLayer({
        id: 'denver',
        layerKey: 'branch',
        geojson: {
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', geometry: { type: 'Point', coordinates: [-105.03, 39.87] } },
            { type: 'Feature', geometry: { type: 'Point', coordinates: [-104.80, 39.89] } },
          ],
        },
      });
      renderer.addCustomLayer({
        id: 'hidden',
        layerKey: 'branch',
        geojson: {
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', geometry: { type: 'Point', coordinates: [-73.98, 40.75] } },
          ],
        },
      });
      renderer.showCustomLayers(['denver']);
      renderer.fit();
    });

    await expect.poll(async () => (await receivedCommands(page)).filter((c) => c.fn === 'fitBounds')).toHaveLength(1);
    let fits = (await receivedCommands(page)).filter((c) => c.fn === 'fitBounds');
    expect(fits[0].args[0]).toEqual([[39.87, -105.03], [39.89, -104.8]]);

    await page.evaluate(() => {
      const renderer = (window as any).testRenderer;
      renderer.showCustomLayers(['hidden']);
      renderer.fit();
    });
    await expect.poll(async () => (await receivedCommands(page)).filter((c) => c.fn === 'fitBounds')).toHaveLength(2);
    fits = (await receivedCommands(page)).filter((c) => c.fn === 'fitBounds');
    expect(fits[1].args[0]).toEqual([[40.75, -73.98], [40.75, -73.98]]);

    await page.evaluate(() => {
      const renderer = (window as any).testRenderer;
      renderer.showCustomLayers([]);
      renderer.fit();
    });
    await page.waitForTimeout(50);
    expect((await receivedCommands(page)).filter((c) => c.fn === 'fitBounds')).toHaveLength(2);
  });
});
