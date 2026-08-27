import { protocol } from 'electron';
import fs from 'fs';
import path from 'path';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.html': 'text/html',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

// Handles requests with 'mailspring' protocol.
//
// It's created by {Application} upon instantiation and is used to create a
// custom resource loader for 'mailspring://' URLs.
//
// The following directories are searched in order:
//   * <config-dir>/assets
//   * <config-dir>/dev/packages (unless in safe mode)
//   * <config-dir>/packages
//   * RESOURCE_PATH/internal_packages
export default class MailspringProtocolHandler {
  loadPaths: string[] = [];

  constructor({ configDirPath, resourcePath, safeMode }) {
    if (!safeMode) {
      this.loadPaths.push(path.resolve(path.join(configDirPath, 'dev', 'packages')));
    }
    this.loadPaths.push(path.resolve(path.join(configDirPath, 'packages')));
    this.loadPaths.push(path.resolve(path.join(resourcePath, 'internal_packages')));

    this.registerProtocol();
  }

  registerProtocol() {
    const scheme = 'mailspring';

    protocol.handle(scheme, (request) => {
      const relativePath = this.relativePathFromRequest(request.url);

      let filePath = null;
      for (const loadPath of this.loadPaths) {
        const candidate = path.resolve(path.join(loadPath, relativePath));
        if (candidate !== loadPath && !candidate.startsWith(loadPath + path.sep)) {
          continue;
        }
        let fileStats: fs.Stats | false = false;
        try {
          fileStats = fs.statSync(candidate);
        } catch (e) {
          // path doesn't exist
        }
        if (fileStats && fileStats.isFile && fileStats.isFile()) {
          filePath = candidate;
          break;
        }
      }

      if (!filePath) {
        return new Response('Not Found', { status: 404 });
      }

      const mime = MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      return new Response(fs.readFileSync(filePath), {
        status: 200,
        headers: { 'Content-Type': mime },
      });
    });
  }

  // mailspring://onboarding/assets/foo.png → onboarding/assets/foo.png
  // substr() left a leading "//" which Windows treats as UNC, so path.join
  // dropped the package root and every SVG/PNG 404'd in the packaged exe.
  private relativePathFromRequest(requestUrl: string): string {
    try {
      const parsed = new URL(requestUrl);
      const parts = [parsed.hostname, ...parsed.pathname.split('/')].filter(Boolean);
      return path.normalize(parts.map((p) => decodeURIComponent(p)).join(path.sep));
    } catch {
      return path.normalize(requestUrl.replace(/^mailspring:/i, '')).replace(/^[/\\]+/, '');
    }
  }
}
