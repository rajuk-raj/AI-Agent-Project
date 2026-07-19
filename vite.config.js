import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev-time bridge for /api routes.
 *
 * In production these are Vercel serverless functions. Locally, Vite serves
 * static assets and knows nothing about them, so this plugin mounts the same
 * handler modules on the dev server and adapts Node's raw req/res to the
 * Express-ish shape the handlers expect.
 *
 * The point is that api/*.js is written once and runs unchanged in both
 * places — no dev-only fork of the tools.
 */
function apiDevServer(env) {
  return {
    name: 'api-dev-server',
    configureServer(server) {
      // Handlers read process.env; Vite only exposes VITE_-prefixed vars to the
      // client. This keeps the key server-side, exactly as in production.
      for (const [k, v] of Object.entries(env)) {
        if (!k.startsWith('VITE_')) process.env[k] = v;
      }

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();

        const route = req.url.split('?')[0].replace('/api/', '');
        try {
          const mod = await server.ssrLoadModule(`/api/${route}.js`);

          const body = await new Promise((resolve, reject) => {
            let raw = '';
            req.on('data', (c) => (raw += c));
            req.on('end', () => {
              try {
                resolve(raw ? JSON.parse(raw) : {});
              } catch (e) {
                reject(e);
              }
            });
            req.on('error', reject);
          });
          req.body = body;

          // Minimal Vercel-style response shim.
          res.status = (code) => {
            res.statusCode = code;
            return res;
          };
          res.json = (payload) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(payload));
            return res;
          };

          await mod.default(req, res);
        } catch (err) {
          console.error(`[api/${route}]`, err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // '' loads every var, not just VITE_-prefixed ones.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), apiDevServer(env)],
    server: { port: 5173 },
  };
});
