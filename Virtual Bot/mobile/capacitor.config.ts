import type { CapacitorConfig } from '@capacitor/cli';

/*
 * Android shell around the dashboard the bot already serves.
 *
 * The shell deliberately ships no copy of the panel. The bot serves it at
 * /dash/ and updates it on every rebuild, so a bundled copy would go stale
 * the first time the panel changed and force an APK reinstall to catch up.
 * www/ therefore holds one bootstrap page whose only job is to send the
 * WebView at whichever address the bot answers on.
 *
 * That address is asked for rather than compiled in: the machine gets its
 * LAN address from DHCP, so a hardcoded one turns into a broken app the
 * first time the router hands out a different lease.
 */
const config: CapacitorConfig = {
  appId: 'dev.klodbot.panel',
  appName: 'Клод Бот',
  webDir: 'www',
  android: {
    // The bot speaks plain HTTP on the LAN — there is no certificate for a
    // private address. Android blocks cleartext by default, so it has to be
    // allowed explicitly or every request fails with no visible reason.
    allowMixedContent: true,
  },
  server: {
    cleartext: true,
    // Without this the WebView treats the bot as an outside site and hands
    // it to the system browser, which would leave the app showing a blank
    // page while the panel opened in Chrome.
    allowNavigation: [
      '192.168.*',
      '10.*',
      '172.16.*', '172.17.*', '172.18.*', '172.19.*',
      '172.20.*', '172.21.*', '172.22.*', '172.23.*',
      '172.24.*', '172.25.*', '172.26.*', '172.27.*',
      '172.28.*', '172.29.*', '172.30.*', '172.31.*',
      '*.local',
      'localhost',
      // Tunnelled access from outside the home network.
      '*.trycloudflare.com',
      '*.waveio.me',
    ],
  },
};

export default config;
