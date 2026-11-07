import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { database, nowIso } from '../../../lib/database';
import siteCatalog from '../../../data/websites.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const asText = (value: unknown) => typeof value === 'string' ? value : '';
const uuid = () => randomUUID();
const fail = (detail: string, status: number) => NextResponse.json({ detail }, { status });
const json = (body: unknown, status = 200) => NextResponse.json(body, { status });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
type FindingCandidate = { source_name: string; url: string; title: string; snippet: string; risk: string; risk_score: number; risk_keywords: string[]; result_kind: string; removal_url: string | null; discovered_at: string; };
function deriveKey(password: string, salt: Buffer, length: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, length, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}

function secretKey(name: 'PII_ENCRYPTION_KEY' | 'AUTH_SECRET'): Buffer {
  const secret = process.env[name];
  if (!secret && process.env.NODE_ENV === 'production') throw new Error(`Configure ${name}.`);
  const fallback = name === 'AUTH_SECRET' ? 'fingerprintscanner-local-auth-key' : 'fingerprintscanner-local-email-encryption-key';
  return createHash('sha256').update(secret || fallback).digest();
}

function emailDigest(email: string): string {
  return createHmac('sha256', secretKey('AUTH_SECRET')).update(email.trim().toLowerCase()).digest('hex');
}

function encryptEmail(email: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey('PII_ENCRYPTION_KEY'), iv);
  const encrypted = Buffer.concat([cipher.update(email.trim().toLowerCase(), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}

function decryptEmail(value: string): string {
  const [iv, tag, encrypted] = value.split('.').map(part => Buffer.from(part, 'base64url'));
  if (!iv || !tag || !encrypted) throw new Error('Stored email ciphertext is invalid.');
  const decipher = createDecipheriv('aes-256-gcm', secretKey('PII_ENCRYPTION_KEY'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function appOrigin() {
  const explicit = process.env.APP_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

async function sendVerificationEmail(email: string, link: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) throw new Error('Configure RESEND_API_KEY and EMAIL_FROM to send verification emails.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'Confirmez votre compte FingerprintScanner',
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#0f172a"><h1>Confirmez votre adresse e-mail</h1><p>Pour activer votre compte FingerprintScanner, confirmez que cette adresse vous appartient.</p><p><a href="${link}" style="display:inline-block;padding:13px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:10px">Confirmer mon adresse</a></p><p>Ce lien expire dans une heure. Si vous n’avez pas créé de compte, ignorez ce message.</p></div>`,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Le fournisseur d’e-mail a refusé la demande de confirmation.');
}

async function passwordHash(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, saltEncoded, keyEncoded] = encoded.split('$');
  if (algorithm !== 'scrypt' || !saltEncoded || !keyEncoded) return false;
  try {
    const salt = Buffer.from(saltEncoded, 'base64url');
    const expected = Buffer.from(keyEncoded, 'base64url');
    const actual = await deriveKey(password, salt, expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch { return false; }
}

async function createSession(db: Awaited<ReturnType<typeof database>>, userId: string) {
  const token = randomBytes(32).toString('base64url');
  await db.execute({ sql: 'INSERT INTO access_tokens(id,user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)', args: [uuid(), userId, hash(token), new Date(Date.now() + 7 * 864e5).toISOString(), nowIso()] });
  return token;
}

async function requireUser(request: NextRequest, db: Awaited<ReturnType<typeof database>>) {
  const header = request.headers.get('authorization') || '';
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  const result = await db.execute({ sql: `SELECT u.id,u.email_lookup_hash FROM access_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.consumed_at IS NULL AND t.expires_at>?`, args: [hash(token), nowIso()] });
  return result.rows[0] as unknown as { id: string; email_lookup_hash: string } | undefined || null;
}

function keywordRisk(text: string, groups: Record<string, string[]>) {
  const normalized = text.toLocaleLowerCase();
  const rank: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
  const matches = Object.entries(groups).flatMap(([level, words]) => words.filter(word => normalized.includes(word.toLocaleLowerCase())).map(word => ({ level, word })));
  const risk = matches.sort((a, b) => (rank[b.level] || 0) - (rank[a.level] || 0))[0]?.level || 'low';
  const base: Record<string, number> = { low: 10, medium: 35, high: 65, critical: 90 };
  return { risk, score: Math.min(100, (base[risk] || 10) + Math.max(0, Array.from(new Set(matches.map(item => item.word))).length - 1) * 4), keywords: Array.from(new Set(matches.map(item => item.word))) };
}

function catalogResults(): FindingCandidate[] {
  const groups = siteCatalog.danger_keywords as Record<string, string[]>;
  return siteCatalog.sites.map(site => {
    const risk = keywordRisk(site.keywords.join(' '), groups);
    return { source_name: site.name, url: site.url, title: `${site.category} · Source du catalogue`, snippet: 'Source informative uniquement. Cela ne confirme pas la présence de votre adresse sur ce site.', risk: risk.risk, risk_score: risk.score, risk_keywords: risk.keywords, result_kind: 'catalog', removal_url: site.removal_url, discovered_at: nowIso() };
  });
}

async function liveSearch(email: string): Promise<FindingCandidate[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return [];
  const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(`"${email}"`)}&count=20`, { headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(12000), cache: 'no-store' });
  if (!response.ok) return [];
  const payload = await response.json() as { web?: { results?: { url?: string; title?: string; description?: string }[] } };
  const groups = siteCatalog.danger_keywords as Record<string, string[]>;
  return (payload.web?.results || []).flatMap(item => {
    try {
      const parsed = new URL(item.url || '');
      if (!['http:', 'https:'].includes(parsed.protocol)) return [];
      const source = parsed.hostname;
      const title = (item.title || source).slice(0, 500);
      const snippet = (item.description || '').slice(0, 1200);
      const risk = keywordRisk(`${source} ${title} ${snippet}`, groups);
      return [{ source_name: source, url: parsed.toString(), title, snippet, risk: risk.risk, risk_score: risk.score, risk_keywords: risk.keywords, result_kind: 'live', removal_url: null, discovered_at: nowIso() }];
    } catch { return []; }
  });
}

async function main(request: NextRequest, parts: string[]) {
  const route = parts.join('/');
  const db = await database();
  if (route === 'health' && request.method === 'GET') return json({ status: 'ok' });
  if (route === 'catalog' && request.method === 'GET') return json(catalogResults());

  if (route === 'auth/register' && request.method === 'POST') {
    const body = await request.json();
    const email = asText(body.email).trim().toLowerCase();
    const password = asText(body.password);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 128) return fail('Adresse e-mail ou mot de passe invalide (8 caractères minimum).', 422);
    if (process.env.NODE_ENV === 'production' && (!process.env.PII_ENCRYPTION_KEY || !process.env.AUTH_SECRET)) return fail('La configuration de l’inscription est incomplète.', 503);
    const digest = emailDigest(email);
    let user = (await db.execute({ sql: 'SELECT id,password_hash,email_verified_at FROM users WHERE email_lookup_hash=?', args: [digest] })).rows[0] as unknown as { id: string; password_hash: string | null; email_verified_at: string | null } | undefined;
    if (user?.password_hash) return fail('Un compte existe déjà pour cette adresse. Connectez-vous.', 409);
    const encoded = await passwordHash(password);
    const verifiedAt = nowIso();
    if (!user) {
      user = { id: uuid(), password_hash: encoded, email_verified_at: verifiedAt };
      await db.execute({ sql: 'INSERT INTO users(id,email_ciphertext,email_lookup_hash,password_hash,email_verified_at,created_at) VALUES(?,?,?,?,?,?)', args: [user.id, encryptEmail(email), digest, encoded, verifiedAt, verifiedAt] });
    } else {
      await db.execute({ sql: 'UPDATE users SET password_hash=?,email_verified_at=COALESCE(email_verified_at,?) WHERE id=?', args: [encoded, verifiedAt, user.id] });
    }
    return json({ access_token: await createSession(db, user.id), token_type: 'bearer', user_id: user.id, scan_id: '' }, 201);
  }

  if (route === 'auth/login' && request.method === 'POST') {
    const body = await request.json();
    const email = asText(body.email).trim().toLowerCase();
    const password = asText(body.password);
    if (!email || !password) return fail('Adresse e-mail ou mot de passe incorrect', 401);
    const user = (await db.execute({ sql: 'SELECT id,password_hash,email_verified_at FROM users WHERE email_lookup_hash=?', args: [emailDigest(email)] })).rows[0] as unknown as { id: string; password_hash: string | null; email_verified_at: string | null } | undefined;
    if (!user || !user.password_hash || !await verifyPassword(password, user.password_hash)) return fail('Adresse e-mail ou mot de passe incorrect', 401);
    if (!user.email_verified_at) await db.execute({ sql: 'UPDATE users SET email_verified_at=? WHERE id=?', args: [nowIso(), user.id] });
    return json({ access_token: await createSession(db, user.id), token_type: 'bearer', user_id: user.id, scan_id: '' });
  }

  if (route === 'auth/verify' && request.method === 'POST') {
    const token = asText((await request.json()).token);
    const match = (await db.execute({ sql: 'SELECT id,user_id,scan_id FROM access_tokens WHERE token_hash=? AND consumed_at IS NULL AND expires_at>?', args: [hash(token), nowIso()] })).rows[0] as unknown as { id: string; user_id: string; scan_id: string | null } | undefined;
    if (!match) return fail('Ce lien de confirmation est invalide ou expiré.', 400);
    const now = nowIso();
    await db.batch([
      { sql: 'UPDATE access_tokens SET consumed_at=? WHERE id=?', args: [now, match.id] },
      { sql: 'UPDATE users SET email_verified_at=COALESCE(email_verified_at,?) WHERE id=?', args: [now, match.user_id] },
    ], 'write');
    const accessToken = await createSession(db, match.user_id);
    return json({ access_token: accessToken, token_type: 'bearer', user_id: match.user_id, scan_id: match.scan_id || '' });
  }

  if (route === 'auth/request-link' && request.method === 'POST') {
    const body = await request.json();
    const email = asText(body.email).trim().toLowerCase();
    if (!email) return fail('Adresse e-mail invalide.', 422);
    const user = (await db.execute({ sql: 'SELECT id FROM users WHERE email_lookup_hash=?', args: [emailDigest(email)] })).rows[0] as unknown as { id: string } | undefined;
    if (user) {
      if (process.env.NODE_ENV === 'production' && (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)) return fail('La confirmation d’adresse e-mail n’est pas configurée.', 503);
      const token = randomBytes(32).toString('base64url');
      const scanId = asText(body.scan_id);
      await db.execute({ sql: 'INSERT INTO access_tokens(id,user_id,token_hash,expires_at,scan_id,created_at) VALUES(?,?,?,?,?,?)', args: [uuid(), user.id, hash(token), new Date(Date.now() + 900_000).toISOString(), scanId || null, nowIso()] });
      const link = `${appOrigin()}/auth/verify?token=${token}`;
      if (process.env.NODE_ENV === 'production') await sendVerificationEmail(email, link);
      else console.info(`FingerprintScanner sign-in link (development only): ${link}`);
    }
    return json({ status: 'if_account_exists_link_sent' }, 202);
  }

  if (route === 'scans' && request.method === 'POST') {
    const body = await request.json();
    const email = asText(body.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || body.ownership_confirmed !== true) return fail('Confirmez que cette adresse e-mail vous appartient.', 422);
    const digest = emailDigest(email);
    const sessionUser = await requireUser(request, db);
    if (sessionUser && sessionUser.email_lookup_hash !== digest) return fail('L’adresse analysée doit correspondre au compte connecté.', 403);
    let user = (await db.execute({ sql: 'SELECT id FROM users WHERE email_lookup_hash=?', args: [digest] })).rows[0] as unknown as { id: string } | undefined;
    if (!user) {
      const userId = uuid();
      await db.execute({ sql: 'INSERT INTO users(id,email_ciphertext,email_lookup_hash,created_at) VALUES(?,?,?,?)', args: [userId, encryptEmail(email), digest, nowIso()] });
      user = { id: userId };
    }
    const scanId = uuid();
    await db.execute({ sql: 'INSERT INTO scans(id,user_id,status,ownership_confirmed,created_at) VALUES(?,?,?,?,?)', args: [scanId, user.id, 'running', 1, nowIso()] });
    let results = catalogResults();
    try { results = [...await liveSearch(email), ...results]; } catch { /* Catalog remains available if the search provider is unavailable. */ }
    const merged = new Map<string, typeof results[number]>();
    for (const item of results) {
      let host = item.source_name.toLowerCase().replace(/^www\./, '');
      try { host = new URL(item.url).hostname.toLowerCase().replace(/^www\./, ''); } catch { /* keep source name as key */ }
      if (!merged.has(host) || merged.get(host)?.result_kind === 'catalog' && item.result_kind === 'live') merged.set(host, item);
    }
    const ordered = Array.from(merged.values()).sort((a, b) => b.risk_score - a.risk_score || a.source_name.localeCompare(b.source_name));
    const created = nowIso();
    const commands = ordered.map(item => ({ sql: 'INSERT INTO findings(id,scan_id,source_name,url,title,snippet,risk,risk_score,risk_keywords,result_kind,removal_url,discovered_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', args: [uuid(), scanId, item.source_name, item.url, item.title, item.snippet, item.risk, item.risk_score, JSON.stringify(item.risk_keywords), item.result_kind, item.removal_url, created] }));
    commands.push({ sql: "UPDATE scans SET status='completed',completed_at=? WHERE id=?", args: [created, scanId] });
    if (commands.length) await db.batch(commands, 'write');
    return json({ id: scanId, user_id: user.id, status: 'completed', created_at: created, completed_at: created, findings: [] }, 202);
  }

  const scanMatch = route.match(/^scans\/([\w-]+)$/);
  if (scanMatch && request.method === 'GET') {
    const scan = (await db.execute({ sql: 'SELECT id,user_id,status,created_at,completed_at FROM scans WHERE id=?', args: [scanMatch[1]] })).rows[0] as unknown as { id: string; user_id: string; status: string; created_at: string; completed_at: string | null } | undefined;
    if (!scan) return fail('Analyse introuvable.', 404);
    const user = await requireUser(request, db);
    if (!user || user.id !== scan.user_id) return json({ ...scan, findings: [] });
    const findings = await db.execute({ sql: 'SELECT id,source_name,url,title,snippet,risk,risk_score,risk_keywords,result_kind,removal_url,discovered_at FROM findings WHERE scan_id=? ORDER BY discovered_at', args: [scan.id] });
    return json({ ...scan, findings: findings.rows.map(row => ({ ...row, risk_keywords: JSON.parse(asText(row.risk_keywords) || '[]') })) });
  }

  const dashboardMatch = route.match(/^users\/([\w-]+)\/dashboard$/);
  if (dashboardMatch && request.method === 'GET') {
    const user = await requireUser(request, db);
    if (!user || user.id !== dashboardMatch[1]) return fail('Connexion requise.', 401);
    const scans = await db.execute({ sql: 'SELECT id,user_id,status,created_at,completed_at FROM scans WHERE user_id=? ORDER BY created_at DESC', args: [user.id] });
    const orders = await db.execute({ sql: 'SELECT id,plan,amount_eur,amount_usd,currency,status FROM orders WHERE user_id=? ORDER BY created_at DESC', args: [user.id] });
    const items = await db.execute({ sql: 'SELECT oi.order_id,oi.source_name,oi.url FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.user_id=?', args: [user.id] });
    return json({ user_id: user.id, scans: scans.rows.map(scan => ({ ...scan, findings: [] })), orders: orders.rows.map(order => ({ ...order, selected_findings: items.rows.filter(item => item.order_id === order.id).map(item => ({ source_name: item.source_name, url: item.url })) })) });
  }

  const draftsListMatch = route.match(/^users\/([\w-]+)\/cleanup-drafts$/);
  if (draftsListMatch && request.method === 'GET') {
    const user = await requireUser(request, db);
    if (!user || user.id !== draftsListMatch[1]) return fail('Connexion requise.', 401);
    const drafts = await db.execute({ sql: 'SELECT id,finding_id,status,request_text,created_at FROM cleanup_requests WHERE user_id=? ORDER BY created_at DESC', args: [user.id] });
    return json(drafts.rows);
  }

  const draftCreateMatch = route.match(/^scans\/([\w-]+)\/cleanup-drafts$/);
  if (draftCreateMatch && request.method === 'POST') {
    const user = await requireUser(request, db);
    if (!user) return fail('Connexion requise.', 401);
    const scanId = draftCreateMatch[1];
    const findingId = asText((await request.json()).finding_id);
    const finding = (await db.execute({ sql: 'SELECT f.id,f.source_name,f.url FROM findings f JOIN scans s ON s.id=f.scan_id WHERE f.id=? AND f.scan_id=? AND s.user_id=? AND f.result_kind=?', args: [findingId, scanId, user.id, 'live'] })).rows[0] as unknown as { id: string; source_name: string; url: string } | undefined;
    if (!finding) return fail('Résultat réel introuvable pour ce compte.', 404);
    const draftId = uuid();
    const text = `Objet : Demande de suppression de données personnelles\n\nBonjour,\n\nJe vous demande de vérifier et de supprimer mes informations personnelles de cette page : ${finding.url}.\nJe n’ai pas donné mon accord pour que ces informations soient publiées. Merci de me confirmer la prise en compte de cette demande.\n\nCordialement`;
    await db.execute({ sql: 'INSERT INTO cleanup_requests(id,user_id,finding_id,status,request_text,created_at) VALUES(?,?,?,?,?,?)', args: [draftId, user.id, finding.id, 'draft', text, nowIso()] });
    return json({ id: draftId, status: 'draft', request_text: text, created_at: nowIso() }, 201);
  }

  const draftApproveMatch = route.match(/^cleanup-drafts\/([\w-]+)\/approve$/);
  if (draftApproveMatch && request.method === 'POST') {
    const user = await requireUser(request, db);
    if (!user) return fail('Connexion requise.', 401);
    const approvedAt = nowIso();
    const result = await db.execute({ sql: "UPDATE cleanup_requests SET status='approved_for_user_submission',approved_at=? WHERE id=? AND user_id=?", args: [approvedAt, draftApproveMatch[1], user.id] });
    if (!result.rowsAffected) return fail('Brouillon introuvable.', 404);
    const draft = (await db.execute({ sql: 'SELECT id,status,request_text,created_at FROM cleanup_requests WHERE id=?', args: [draftApproveMatch[1]] })).rows[0];
    return json(draft);
  }

  if (route === 'orders' && request.method === 'POST') {
    const user = await requireUser(request, db);
    if (!user) return fail('Connexion requise.', 401);
    const body = await request.json();
    if (body.user_id !== user.id) return fail('Compte non autorisé.', 403);
    const plan = body.plan === 'guided' ? 'guided' : body.plan === 'complete' ? 'complete' : '';
    const firstName = asText(body.first_name).trim();
    const lastName = asText(body.last_name).trim();
    const phone = body.phone && typeof body.phone === 'object' ? body.phone : {};
    const phoneNumber = asText(phone.number).replace(/\D/g, '');
    const countryCode = asText(phone.country_code).trim().toUpperCase();
    const selected = Array.from(new Set(Array.isArray(body.selected_finding_ids) ? body.selected_finding_ids.filter((x: unknown) => typeof x === 'string') as string[] : []));
    if (!plan || plan === 'guided' && selected.length > 1 || plan === 'complete' && selected.length > 5) return fail('Sélection invalide pour cette offre.', 400);
    if (!firstName || firstName.length > 50 || !lastName || lastName.length > 50 || phoneNumber.length < 6 || phoneNumber.length > 20 || !/^[A-Z]{2}$/.test(countryCode)) return fail('Renseignez votre prénom, votre nom et un numéro de téléphone valide.', 422);
    const apiKey = process.env.CHARIOW_API_KEY;
    const productId = plan === 'guided' ? process.env.CHARIOW_GUIDED_PRODUCT_ID : process.env.CHARIOW_COMPLETE_PRODUCT_ID;
    if (!apiKey || !productId) return fail('Le paiement Chariow n’est pas encore configuré pour cette offre.', 503);
    const findings = selected.length ? await db.execute({ sql: `SELECT f.id,f.source_name,f.url FROM findings f JOIN scans s ON s.id=f.scan_id WHERE s.user_id=? AND f.result_kind='live' AND f.id IN (${selected.map(() => '?').join(',')})`, args: [user.id, ...selected] }) : { rows: [] };
    if (findings.rows.length !== selected.length) return fail('Les éléments choisis doivent être des résultats réels de vos analyses.', 400);
    const account = (await db.execute({ sql: 'SELECT email_ciphertext FROM users WHERE id=?', args: [user.id] })).rows[0] as unknown as { email_ciphertext: string } | undefined;
    if (!account) return fail('Compte introuvable.', 404);
    const orderId = uuid();
    const amount = plan === 'guided' ? 199 : 299;
    const createdAt = nowIso();
    const commands = [{ sql: "INSERT INTO orders(id,user_id,plan,amount_eur,amount_usd,currency,status,chariow_product_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)", args: [orderId, user.id, plan, 0, amount, 'USD', 'checkout_pending', productId, createdAt] }, ...findings.rows.map((row: any) => ({ sql: 'INSERT INTO order_items(id,order_id,finding_id,source_name,url,created_at) VALUES(?,?,?,?,?,?)', args: [uuid(), orderId, row.id, row.source_name, row.url, createdAt] }))];
    await db.batch(commands, 'write');
    let checkout: any;
    try {
      const response = await fetch('https://api.chariow.com/v1/checkout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: productId,
          email: decryptEmail(account.email_ciphertext),
          first_name: firstName,
          last_name: lastName,
          phone: { number: phoneNumber, country_code: countryCode },
          payment_currency: 'USD',
          redirect_url: `${appOrigin()}/payment/return?order_id=${encodeURIComponent(orderId)}`,
          custom_metadata: { order_id: orderId, plan },
        }),
        signal: AbortSignal.timeout(15000),
        cache: 'no-store',
      });
      checkout = await response.json().catch(() => ({}));
      if (!response.ok) {
        await db.execute({ sql: "UPDATE orders SET status='checkout_failed' WHERE id=?", args: [orderId] });
        const detail = asText(checkout.message);
        return fail(detail && response.status < 500 ? `Chariow : ${detail}` : 'Chariow ne peut pas démarrer le paiement pour le moment.', 502);
      }
    } catch {
      await db.execute({ sql: "UPDATE orders SET status='checkout_failed' WHERE id=?", args: [orderId] });
      return fail('Impossible de joindre Chariow pour démarrer le paiement.', 502);
    }
    const result = checkout?.data || {};
    const saleId = asText(result.purchase?.id);
    if (result.step === 'already_purchased') {
      await db.execute({ sql: "UPDATE orders SET status='already_purchased',chariow_sale_id=? WHERE id=?", args: [saleId || null, orderId] });
      return fail('Ce compte a déjà accès à cette offre Chariow.', 409);
    }
    const checkoutUrl = asText(result.payment?.checkout_url);
    if (!['payment', 'awaiting_payment'].includes(asText(result.step)) || !saleId || !checkoutUrl) {
      await db.execute({ sql: "UPDATE orders SET status='checkout_failed' WHERE id=?", args: [orderId] });
      return fail('Chariow a renvoyé une réponse de paiement inattendue.', 502);
    }
    let parsedCheckoutUrl: URL;
    try { parsedCheckoutUrl = new URL(checkoutUrl); } catch { return fail('Lien de paiement Chariow invalide.', 502); }
    if (parsedCheckoutUrl.protocol !== 'https:') return fail('Lien de paiement Chariow invalide.', 502);
    await db.execute({ sql: "UPDATE orders SET status='pending_payment',chariow_sale_id=?,chariow_checkout_url=? WHERE id=?", args: [saleId, parsedCheckoutUrl.toString(), orderId] });
    return json({ id: orderId, plan, amount_usd: amount, currency: 'USD', status: 'pending_payment', checkout_url: parsedCheckoutUrl.toString(), selected_findings: findings.rows.map((row: any) => ({ source_name: row.source_name, url: row.url })) }, 201);
  }

  const deleteUserMatch = route.match(/^users\/([\w-]+)$/);
  if (deleteUserMatch && request.method === 'DELETE') {
    const user = await requireUser(request, db);
    if (!user || user.id !== deleteUserMatch[1]) return fail('Connexion requise.', 401);
    await db.execute({ sql: 'DELETE FROM users WHERE id=?', args: [user.id] });
    return new NextResponse(null, { status: 204 });
  }

  return fail('Route API inconnue.', 404);
}

async function handler(request: NextRequest, context: { params: { path: string[] } | Promise<{ path: string[] }> }) {
  try {
    const { path } = await context.params;
    return await main(request, path || []);
  } catch (error) {
    console.error('FingerprintScanner API error:', error);
    const message = error instanceof Error ? error.message : '';
    if (message.includes('TURSO_AUTH_TOKEN')) return fail('Ajoutez le jeton Turso dans TURSO_AUTH_TOKEN pour connecter la base distante.', 503);
    if (message.includes('TURSO_DATABASE_URL')) return fail('Configurez une base Turso distante et persistante.', 503);
    if (message.includes('AUTH_SECRET') || message.includes('PII_ENCRYPTION_KEY')) return fail('Configurez les clés secrètes AUTH_SECRET et PII_ENCRYPTION_KEY.', 503);
    return fail('Le service est temporairement indisponible.', 503);
  }
}

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
