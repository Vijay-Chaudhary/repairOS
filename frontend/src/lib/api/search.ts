import { apiGet } from './client';

export type SearchType =
  | 'customer' | 'lead' | 'job' | 'invoice' | 'product' | 'technician' | 'payment' | 'purchase_order';

export interface SearchResult {
  type: SearchType;
  id: string;
  label: string;
  sublabel: string;
  route: string;
}

export const searchApi = {
  query: (q: string) => apiGet<{ results: SearchResult[] }>('/search/', { q }),
};
