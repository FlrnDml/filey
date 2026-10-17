import type { Configuration } from 'webpack';

import { tsRules } from './webpack.rules';
import { plugins } from './webpack.plugins';

/**
 * Renderer and preload bundles. Both run sandboxed without Node, so they get no native-module loaders
 * (see `nativeModuleRules` in webpack.rules.ts): those inject `__dirname`, which does not exist there.
 */
export const rendererConfig: Configuration = {
  // Forge defaults to 'eval-source-map' in development, which needs 'unsafe-eval'. A non-eval source map
  // lets the same Content-Security-Policy (src/renderer/index.html) apply in development and production.
  devtool: 'source-map',
  module: {
    rules: [
      ...tsRules,
      {
        test: /\.css$/,
        use: [{ loader: 'style-loader' }, { loader: 'css-loader' }],
      },
    ],
  },
  plugins,
  // The bundle is loaded from the app package on disk, not over the network: the web size hints do not apply.
  performance: { hints: false },
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css'],
  },
};
