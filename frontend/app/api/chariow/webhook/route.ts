import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { database, nowIso } from '../../../../lib/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export async function POST(request: NextRequest) {
  const secret = process.env.CHARIOW_PULSE_SECRET;
  if (!secret) return json({ detail: 'Webhook Chariow non configuré.' }, 503);

  const raw = Buffer.from(await request.arrayBuffer());
  const received = request.headers.get('x-chariow-signature') || '';
  const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  if (receivedBytes.length !== expectedBytes.length || !timingSafeEqual(receivedBytes, expectedBytes)) {
    return json({ detail: 'Signature Chariow invalide.' }, 401);
  }

  let payload: any;
  try { payload = JSON.parse(raw.toString('utf8')); } catch { return json({ detail: 'Payload invalide.' }, 400); }
  const deliveryId = request.headers.get('x-pulse-delivery-id') || '';
  if (!deliveryId || deliveryId.length > 255) return json({ detail: 'Identifiant de livraison manquant.' }, 400);
  const event = typeof payload?.event === 'string' ? payload.event : request.headers.get('x-pulse-event') || '';
  if (!['successful.sale', 'failed.sale', 'abandoned.sale'].includes(event)) return json({ received: true, ignored: true });

  const orderId = typeof payload?.sale?.custom_metadata?.order_id === 'string' ? payload.sale.custom_metadata.order_id : '';
  if (!orderId) return json({ received: true, ignored: true });

  try {
    const db = await database();
    const order = (await db.execute({
      sql: 'SELECT id,plan,amount_usd,currency,status,chariow_product_id FROM orders WHERE id=?',
      args: [orderId],
    })).rows[0] as unknown as { id: string; plan: string; amount_usd: number; currency: string; status: string; chariow_product_id: string | null } | undefined;
    if (!order) return json({ received: true, ignored: true });

    const saleId = typeof payload?.sale?.id === 'string' ? payload.sale.id : '';
    const productId = typeof payload?.product?.id === 'string' ? payload.product.id : '';
    const configuredProductId = order.plan === 'guided' ? process.env.CHARIOW_GUIDED_PRODUCT_ID : process.env.CHARIOW_COMPLETE_PRODUCT_ID;
    if (!saleId || !productId || productId !== configuredProductId || productId !== order.chariow_product_id) {
      return json({ detail: 'La vente ne correspond pas à la commande.' }, 400);
    }

    if (event === 'successful.sale') {
      const amount = Number(payload?.sale?.amount?.value);
      const currency = typeof payload?.sale?.amount?.currency === 'string' ? payload.sale.amount.currency.toUpperCase() : '';
      if (payload?.sale?.status !== 'completed' || currency !== 'USD' || order.currency !== 'USD' || !Number.isFinite(amount) || Math.abs(amount - Number(order.amount_usd)) > 0.001) {
        return json({ detail: 'Le montant ou le statut de la vente ne correspond pas à la commande.' }, 400);
      }
    }

    const inserted = await db.execute({
      sql: 'INSERT OR IGNORE INTO chariow_pulse_deliveries(delivery_id,received_at) VALUES(?,?)',
      args: [deliveryId, nowIso()],
    });
    if (!inserted.rowsAffected) return json({ received: true, duplicate: true });

    const status = event === 'successful.sale' ? 'paid' : event === 'failed.sale' ? 'payment_failed' : 'abandoned';
    await db.execute({
      sql: 'UPDATE orders SET status=?,chariow_sale_id=? WHERE id=?',
      args: [status, saleId, order.id],
    });
    return json({ received: true });
  } catch (error) {
    console.error('Chariow webhook error:', error);
    return json({ detail: 'Le webhook est temporairement indisponible.' }, 503);
  }
}
