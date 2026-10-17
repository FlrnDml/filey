import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';

/**
 * Packaging (arc42 §7): a universal macOS app (arm64 + x64), shipped as a DMG (plus a zip) on GitHub Releases.
 * Build on a Mac with `npm run make:mac`; the GitHub workflows `prerelease.yml` and `release.yml` build and upload it. The app is not signed or notarized yet (arc42 §7, risk 4).
 */
const config: ForgeConfig = {
  packagerConfig: {
    name: 'Filey',
    executableName: 'Filey',
    appBundleId: 'io.github.flrndml.filey',
    appCategoryType: 'public.app-category.productivity',
    // Without extension: Packager picks assets/icon/icon.icns on macOS.
    icon: 'assets/icon/icon',
    asar: true,
    extendInfo: {
      // A menu-bar app: no Dock icon and no app menu from the very first frame, before `app.dock.hide()` runs.
      LSUIElement: true,
      // Shown by macOS when the user points the inbox or target folder at one of these protected locations.
      NSDocumentsFolderUsageDescription: 'Filey watches your inbox folder and files scanned PDFs into your target folder.',
      NSDesktopFolderUsageDescription: 'Filey watches your inbox folder and files scanned PDFs into your target folder.',
      NSDownloadsFolderUsageDescription: 'Filey watches your inbox folder and files scanned PDFs into your target folder.',
    },
    // Read from process.resourcesPath at runtime: the sample scan for "Test connection" (arc42 §6.2) and the
    // menu-bar template images (copied as the folder Resources/tray, see src/main/tray.ts), plus the license texts
    // (`npm run licenses` regenerates THIRD_PARTY_LICENSES.md).
    extraResource: ['assets/sample-scan.pdf', 'assets/tray', 'LICENSE', 'THIRD_PARTY_LICENSES.md'],
  },
  rebuildConfig: {},
  hooks: {
    /**
     * Ad-hoc signs the finished .app (no identity, so still "unsigned" for Gatekeeper). Apple Silicon refuses to
     * run code without a valid signature, and packaging (Info.plist changes, fuses, the universal merge) breaks
     * the one Electron ships with. With a valid ad-hoc signature a downloaded Filey gets the usual "Open Anyway"
     * flow (arc42 risk 4) instead of "Filey is damaged and can't be opened". Remove once Filey is signed and
     * notarized with a Developer ID (`packagerConfig.osxSign`/`osxNotarize`).
     */
    postPackage: async (forgeConfig, { platform, outputPaths }) => {
      if (platform !== 'darwin' || process.platform !== 'darwin' || forgeConfig.packagerConfig.osxSign) return;
      for (const dir of outputPaths) {
        const app = path.join(dir, `${forgeConfig.packagerConfig.name ?? 'Filey'}.app`);
        execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
        execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
      }
    },
  },
  makers: [
    new MakerDMG({ icon: 'assets/icon/icon.icns' }),
    // A zip of the .app, for a future in-app updater (ZIP is what Squirrel.Mac and update.electronjs.org expect).
    new MakerZIP({}, ['darwin']),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: './src/renderer/index.html',
            js: './src/renderer/index.tsx',
            name: 'main_window',
            preload: {
              js: './src/preload/index.ts',
            },
          },
        ],
      },
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      // The plugin would otherwise deep-sign only the arm64 slice of a universal build, adding
      // `_CodeSignature/CodeResources` files the x64 slice lacks, and @electron/universal then refuses to merge
      // them. The postPackage hook above signs the finished (merged) app instead.
      resetAdHocDarwinSignature: false,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
