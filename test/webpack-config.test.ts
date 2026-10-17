import { describe, expect, it } from 'vitest';
import { mainConfig } from '../webpack.main.config';
import { rendererConfig } from '../webpack.renderer.config';

const loaders = (config: { module?: { rules?: unknown[] } }) => JSON.stringify(config.module?.rules ?? []);

describe('webpack configs', () => {
  it('keeps the native-module loaders out of the sandboxed renderer and preload bundles', () => {
    // The asset relocator injects `__dirname`, which does not exist without Node: the production renderer
    // would throw "ReferenceError: __dirname is not defined" and show an empty window.
    expect(loaders(rendererConfig)).not.toContain('asset-relocator');
    expect(loaders(rendererConfig)).not.toContain('node-loader');
    expect(loaders(rendererConfig)).toContain('css-loader');
  });

  it('gives the main bundle native-module support, but no CSS loaders', () => {
    expect(loaders(mainConfig)).toContain('asset-relocator');
    expect(loaders(mainConfig)).not.toContain('css-loader');
  });
});
