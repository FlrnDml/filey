import type { ModuleOptions } from 'webpack';

type Rules = Required<ModuleOptions>['rules'];

/** TypeScript for every bundle (main, preload, renderer). */
export const tsRules: Rules = [
  {
    test: /\.tsx?$/,
    exclude: /(node_modules|\.webpack)/,
    use: {
      loader: 'ts-loader',
      options: {
        transpileOnly: true,
      },
    },
  },
];

/**
 * Native-module support, for the main process only. The asset relocator rewrites file references in
 * node_modules and injects `__webpack_require__.ab = __dirname + "/native_modules/"` into the bundle's
 * runtime. The renderer and preload are sandboxed without Node, so `__dirname` does not exist there and the
 * production renderer bundle would throw a ReferenceError on load; they must not use these loaders.
 */
export const nativeModuleRules: Rules = [
  {
    // We're specifying native_modules in the test because the asset relocator loader generates a
    // "fake" .node file which is really a cjs file.
    test: /native_modules[/\\].+\.node$/,
    use: 'node-loader',
  },
  {
    test: /[/\\]node_modules[/\\].+\.(m?js|node)$/,
    parser: { amd: false },
    use: {
      loader: '@vercel/webpack-asset-relocator-loader',
      options: {
        outputAssetBase: 'native_modules',
      },
    },
  },
];
