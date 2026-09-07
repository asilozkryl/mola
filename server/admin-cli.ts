import 'dotenv/config';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDatabase, Repository } from './db.js';
import { recordAudit } from './admin.js';

/** Local operator entry point only. Public registration and HTTP cannot grant this flag. */
export function manageSiteAdmin(databasePath: string, operation: 'grant' | 'revoke', email: string) {
  if (!['grant', 'revoke'].includes(operation)) throw new Error('Geçersiz yönetici işlemi. grant veya revoke kullanın.');
  if (!existsSync(databasePath)) throw new Error('Veritabanı bulunamadı. Önce uygulamada gerçek bir hesap oluşturun; DATA_DIR değerini kontrol edin.');
  const repo = new Repository(openDatabase(databasePath));
  try {
    return repo.transaction(() => {
      const user = repo.get('SELECT u.*,w.is_demo FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE u.email=?', email.trim().toLowerCase());
      if (!user || user.is_demo || !user.email_verified || !user.password_hash || user.suspended_at) throw new Error('Mevcut, e-postası doğrulanmış, aktif ve kendi parolası olan gerçek bir hesap gerekli.');
      if (operation === 'revoke' && user.site_admin && repo.get('SELECT count(*) AS n FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE u.site_admin=1 AND u.suspended_at IS NULL AND u.email_verified=1 AND u.password_hash IS NOT NULL AND w.is_demo=0')!.n <= 1) throw new Error('Son uygulama yöneticisinin yetkisi kaldırılamaz. Önce başka bir doğrulanmış hesaba grant uygulayın.');
      repo.run('UPDATE users SET site_admin=? WHERE id=?', operation === 'grant' ? 1 : 0, user.id);
      repo.run('DELETE FROM sessions WHERE user_id=?', user.id);
      recordAudit(repo, null, user.workspace_id, `site_admin.${operation === 'grant' ? 'granted' : 'revoked'}`, 'user', user.id);
      return { userId: user.id, granted: operation === 'grant' };
    });
  } finally { repo.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [operation, flag, email, ...extra] = process.argv.slice(2);
  if (!['grant', 'revoke'].includes(operation) || flag !== '--email' || !email || extra.length) {
    console.error('Kullanım: npm run admin -- grant|revoke --email hesap@example.com'); process.exitCode = 1;
  } else {
    try {
      const result = manageSiteAdmin(join(resolve(process.env.DATA_DIR || 'data'), 'mola.sqlite'), operation as 'grant' | 'revoke', email);
      console.log(`Uygulama yöneticisi yetkisi ${result.granted ? 'verildi' : 'kaldırıldı'}. Hesabın tüm oturumları kapatıldı; tekrar giriş yapması gerekir.`);
    } catch (error) { console.error(error instanceof Error ? error.message : 'Yönetici işlemi tamamlanamadı.'); process.exitCode = 1; }
  }
}
