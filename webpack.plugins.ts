import type IForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ForkTsCheckerWebpackPlugin: typeof IForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

export const plugins = [
  new ForkTsCheckerWebpackPlugin({
    logger: 'webpack-infrastructure',
    // Only type-check the app code that gets bundled. By default the plugin follows tsconfig.json, which also
    // covers test/, scripts/ and the config files, and then watches every file they pull in (vitest, jsdom,
    // eslint, drizzle-kit, ...): tens of thousands of file watchers, so `npm start` died with EMFILE.
    // `npm run typecheck` still checks everything.
    typescript: { configOverwrite: { include: ['src/**/*'] } },
  }),
];
