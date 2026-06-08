import { queryClient } from '@/lib/query/client';
import { qk } from '@/lib/query/keys';
import { toast } from 'sonner';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:8000';

type WsEvent =
  | { type: 'job.status_changed'; data: { job_id: string; status: string; assigned_to?: string } }
  | { type: 'payment.received'; data: { invoice_id: string } }
  | { type: 'stock.low_alert'; data: { product_id: string; shop_id: string; qty: number } }
  | { type: 'task.due_soon'; data: { task_id: string; title: string } }
  | { type: 'stage.handoff'; data: { job_id: string; stage_id: string; assigned_to: string } }
  | { type: 'tenant.db_provisioned'; data: { tenant_id: string; status: string } };

class WsClient {
  private socket: WebSocket | null = null;
  private activeShopId: string | null = null;
  private currentUserId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30_000;
  private shouldConnect = false;

  subscribe(shopId: string | null) {
    if (this.activeShopId === shopId) return;
    this.activeShopId = shopId;
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ action: 'subscribe', shop_id: shopId }));
    }
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
    queryClient.invalidateQueries({ queryKey: ['stock'] });
  }

  connect(shopId: string | null, userId: string) {
    this.shouldConnect = true;
    this.activeShopId = shopId;
    this.currentUserId = userId;
    this.openSocket();
  }

  disconnect() {
    this.shouldConnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
  }

  private openSocket() {
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return;

    try {
      this.socket = new WebSocket(`${WS_URL}/ws/`);

      this.socket.onopen = () => {
        this.reconnectDelay = 1000;
        if (this.activeShopId) {
          this.socket!.send(JSON.stringify({ action: 'subscribe', shop_id: this.activeShopId }));
        }
        queryClient.invalidateQueries({ queryKey: ['jobs'] });
        queryClient.invalidateQueries({ queryKey: ['stock'] });
        queryClient.invalidateQueries({ queryKey: ['payments'] });
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
      };

      this.socket.onmessage = (event) => {
        try {
          const message: WsEvent = JSON.parse(event.data as string);
          this.handleEvent(message);
        } catch {
          // malformed message
        }
      };

      this.socket.onclose = () => {
        if (this.shouldConnect) this.scheduleReconnect();
      };

      this.socket.onerror = () => {
        // Transport-level WS errors are not the same as the app being offline —
        // `isOnline` is driven solely by the browser's online/offline events
        // (see AppLayout). A down realtime channel must not block REST-based
        // flows like job creation, invoicing, and payments.
      };
    } catch {
      if (this.shouldConnect) this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this.openSocket();
    }, this.reconnectDelay);
  }

  private handleEvent(event: WsEvent) {
    switch (event.type) {
      case 'job.status_changed':
        queryClient.invalidateQueries({ queryKey: qk.jobs() });
        queryClient.invalidateQueries({ queryKey: qk.job(event.data.job_id) });
        queryClient.invalidateQueries({ queryKey: qk.dashboard(this.activeShopId) });
        if (event.data.assigned_to === this.currentUserId) {
          toast.info('Job status updated');
        }
        break;

      case 'payment.received':
        queryClient.invalidateQueries({ queryKey: qk.dashboard(this.activeShopId) });
        queryClient.invalidateQueries({ queryKey: qk.invoice(event.data.invoice_id) });
        queryClient.invalidateQueries({ queryKey: qk.invoices() });
        break;

      case 'stock.low_alert':
        toast.warning('Low stock alert', { description: 'A product has fallen below minimum stock' });
        queryClient.invalidateQueries({ queryKey: qk.stockAlerts(event.data.shop_id) });
        break;

      case 'task.due_soon':
        toast.info(`Task due soon: ${event.data.title}`);
        queryClient.invalidateQueries({ queryKey: qk.tasks() });
        break;

      case 'stage.handoff':
        if (event.data.assigned_to === this.currentUserId) {
          toast.info('A job stage has been assigned to you');
          queryClient.invalidateQueries({ queryKey: qk.jobs() });
          queryClient.invalidateQueries({ queryKey: qk.job(event.data.job_id) });
        }
        break;

      case 'tenant.db_provisioned':
        queryClient.invalidateQueries({ queryKey: ['tenants'] });
        break;
    }
  }
}

export const wsClient = new WsClient();
