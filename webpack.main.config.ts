import type { Configuration } from 'webpack';

import { nativeModuleRules, tsRules } from './webpack.rules';
import { plugins } from './webpack.plugins';

export const mainConfig: Configuration = {
  /**
   * This is the main entry point for your application, it's the first file
   * that runs in the main process.
   */
  entry: './src/main/index.ts',
  // Put your normal webpack config below here
  module: {
    rules: [...nativeModuleRules, ...tsRules],
  },
  plugins,
  // node:sqlite is built into Electron's Node; load it at runtime instead of bundling it.
  externals: { 'node:sqlite': 'commonjs node:sqlite' },
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.json'],
  },
};
