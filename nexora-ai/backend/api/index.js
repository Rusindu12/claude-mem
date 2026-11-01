const serverless = require('./../dist/serverless');
const handler = serverless.default || serverless;

const INDEX_HTML = "<!DOCTYPE html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"utf-8\" />\n    <meta httpEquiv=\"X-UA-Compatible\" content=\"IE=edge\" />\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1, shrink-to-fit=no\" />\n    <title>NEXORA AI \u2014 Intelligence Without Limits</title>\n    <!-- The `react-native-web` recommended style reset: https://necolas.github.io/react-native-web/docs/setup/#root-element -->\n    <style id=\"expo-reset\">\n      /* These styles make the body full-height */\n      html,\n      body {\n        height: 100%;\n      }\n      /* These styles disable body scrolling if you are using <ScrollView> */\n      body {\n        overflow: hidden;\n      }\n      /* These styles make the root element full-height */\n      #root {\n        display: flex;\n        height: 100%;\n        flex: 1;\n      }\n    </style>\n  <link rel=\"shortcut icon\" href=\"./favicon.ico\" />    <meta name=\"theme-color\" content=\"#05050A\" />\n    <meta name=\"mobile-web-app-capable\" content=\"yes\" />\n    <meta name=\"apple-mobile-web-app-capable\" content=\"yes\" />\n    <meta name=\"apple-mobile-web-app-status-bar-style\" content=\"black-translucent\" />\n    <meta name=\"apple-mobile-web-app-title\" content=\"NEXORA AI\" />\n    <link rel=\"manifest\" href=\"./manifest.json\" />\n    <link rel=\"apple-touch-icon\" href=\"./icon-192.png\" />\n    <style>html, body { background-color: #05050A; }</style>\n  </head>\n\n  <body>\n    <!-- Use static rendering with Expo Router to support running without JavaScript. -->\n    <noscript>\n      You need to enable JavaScript to run this app.\n    </noscript>\n    <!-- The root element for your Expo app. -->\n    <div id=\"root\"></div>\n  <script src=\"./_expo/static/js/web/index-a0b34301e55cb833957ea71e4e87ada3.js\" defer></script>\n  <script>\n    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {\n      window.addEventListener('load', function() {\n        navigator.serviceWorker.register('./sw.js').catch(function() {});\n      });\n    }\n  </script>\n</body>\n</html>\n";
const MANIFEST_JSON = "{\n  \"name\": \"NEXORA AI \\u2014 Intelligence Without Limits\",\n  \"short_name\": \"NEXORA AI\",\n  \"description\": \"Commercial Multi-Model AI Workspace (Chat, Coding, Image, Video, Sinhala & English)\",\n  \"start_url\": \"./index.html\",\n  \"scope\": \"./\",\n  \"display\": \"standalone\",\n  \"orientation\": \"portrait\",\n  \"background_color\": \"#05050A\",\n  \"theme_color\": \"#7C3AED\",\n  \"icons\": [\n    {\n      \"src\": \"./icon-192.png\",\n      \"sizes\": \"192x192\",\n      \"type\": \"image/png\",\n      \"purpose\": \"any maskable\"\n    },\n    {\n      \"src\": \"./icon-512.png\",\n      \"sizes\": \"512x512\",\n      \"type\": \"image/png\",\n      \"purpose\": \"any maskable\"\n    }\n  ]\n}";

module.exports = async function nexoraApi(req, res) {
  const rawUrl = req.url || '/';
  const pathname = rawUrl.split('?')[0];
  if (req.method === 'GET' && pathname === '/manifest.json') {
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    return res.status(200).send(MANIFEST_JSON);
  }
  if (
    req.method === 'GET' &&
    !pathname.startsWith('/api') &&
    !pathname.startsWith('/download') &&
    !pathname.startsWith('/ws') &&
    !pathname.startsWith('/socket.io')
  ) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(INDEX_HTML);
  }
  return handler(req, res);
};
