import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import type { WebhookEvent } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle,
  Clock,
  RotateCcw,
  Zap,
} from 'lucide-react';

const STATUS_FILTERS = ['all', 'processed', 'failed', 'pending_order', 'received'] as const;

const STATUS_COLORS: Record<string, string> = {
  processed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  pending_order: 'bg-yellow-100 text-yellow-800',
  received: 'bg-blue-100 text-blue-800',
  processing: 'bg-purple-100 text-purple-800',
};

const STATUS_ICONS: Record<string, typeof CheckCircle> = {
  processed: CheckCircle,
  failed: XCircle,
  pending_order: Clock,
  received: Zap,
  processing: RefreshCw,
};

export function WebhooksPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const pageSize = 20;

  // Failure state query
  const { data: failureData } = useQuery({
    queryKey: ['webhook-failures'],
    queryFn: () => adminApi.webhooks.failures(),
    refetchInterval: 30_000,
  });

  // Events list query
  const { data: eventsData, isLoading } = useQuery({
    queryKey: ['webhook-events', statusFilter, page],
    queryFn: () =>
      adminApi.webhooks.events({
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit: pageSize,
        offset: page * pageSize,
      }),
  });

  // Single event detail query (for expanded row)
  const { data: eventDetail } = useQuery({
    queryKey: ['webhook-event', expandedId],
    queryFn: () => (expandedId ? adminApi.webhooks.event(expandedId) : null),
    enabled: !!expandedId,
  });

  // Retry mutation
  const retryMutation = useMutation({
    mutationFn: (id: string) => adminApi.webhooks.retryEvent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhook-events'] });
      queryClient.invalidateQueries({ queryKey: ['webhook-failures'] });
    },
  });

  // Reset failures mutation
  const resetMutation = useMutation({
    mutationFn: () => adminApi.webhooks.resetFailures(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhook-failures'] });
    },
  });

  const failures = failureData?.data;
  const events = eventsData?.data ?? [];
  const pagination = eventsData?.pagination;
  const totalPages = pagination ? Math.ceil(pagination.total / pageSize) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Webhook Events</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor and retry Stripe webhook events
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: ['webhook-events'] });
            queryClient.invalidateQueries({ queryKey: ['webhook-failures'] });
          }}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Alert Banner */}
      {failures && failures.consecutiveFailures >= 3 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-red-800">
              {failures.consecutiveFailures} consecutive webhook failures
            </p>
            {failures.lastFailure && (
              <p className="text-sm text-red-600 mt-1">
                Last error: {failures.lastFailure.error}
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => resetMutation.mutate()}
            disabled={resetMutation.isPending}
          >
            Reset Counter
          </Button>
        </div>
      )}

      {/* Failure Stats */}
      {failures && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            label="Consecutive Failures"
            value={failures.consecutiveFailures}
            danger={failures.consecutiveFailures >= 3}
          />
          <StatCard
            label="Failures (1h)"
            value={failures.hourlyFailures}
            danger={failures.hourlyFailures >= 5}
          />
          <StatCard
            label="Backend"
            value={failures.backend.toUpperCase()}
          />
          <StatCard
            label="Last Alert"
            value={
              failures.lastAlertSentAt
                ? new Date(failures.lastAlertSentAt).toLocaleTimeString()
                : 'None'
            }
          />
        </div>
      )}

      {/* Status Filter Tabs */}
      <div className="flex gap-2 flex-wrap">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => {
              setStatusFilter(s);
              setPage(0);
            }}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              statusFilter === s
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {s === 'all' ? 'All' : s.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Events Table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Event</th>
              <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Type</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Error</th>
              <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">Retries</th>
              <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">Time</th>
              <th className="text-right px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  Loading...
                </td>
              </tr>
            ) : events.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  No webhook events found
                </td>
              </tr>
            ) : (
              events.map((evt) => (
                <EventRow
                  key={evt.id}
                  event={evt}
                  expanded={expandedId === evt.id}
                  onToggle={() => setExpandedId(expandedId === evt.id ? null : evt.id)}
                  onRetry={() => retryMutation.mutate(evt.id)}
                  retrying={retryMutation.isPending && retryMutation.variables === evt.id}
                  detail={expandedId === evt.id ? eventDetail?.data : undefined}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, pagination!.total)} of{' '}
            {pagination!.total}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  danger,
}: {
  label: string;
  value: string | number;
  danger?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        danger ? 'border-red-200 bg-red-50' : 'bg-card'
      }`}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`text-2xl font-bold mt-1 ${
          danger ? 'text-red-600' : ''
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function EventRow({
  event,
  expanded,
  onToggle,
  onRetry,
  retrying,
  detail,
}: {
  event: WebhookEvent;
  expanded: boolean;
  onToggle: () => void;
  onRetry: () => void;
  retrying: boolean;
  detail?: (WebhookEvent & { payload: unknown }) | null;
}) {
  const StatusIcon = STATUS_ICONS[event.status] ?? Clock;
  const canRetry = event.status === 'failed' || event.status === 'pending_order';

  return (
    <>
      <tr
        className="hover:bg-muted/30 cursor-pointer transition-colors"
        onClick={onToggle}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {expanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            )}
            <code className="text-xs truncate max-w-[140px]">
              {event.stripeEventId}
            </code>
          </div>
        </td>
        <td className="px-4 py-3 hidden sm:table-cell">
          <span className="text-xs">{event.eventType}</span>
        </td>
        <td className="px-4 py-3">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
              STATUS_COLORS[event.status] ?? 'bg-gray-100 text-gray-800'
            }`}
          >
            <StatusIcon className="h-3 w-3" />
            {event.status}
          </span>
        </td>
        <td className="px-4 py-3 hidden md:table-cell">
          <span className="text-xs text-muted-foreground truncate block max-w-[200px]">
            {event.errorMessage ?? '—'}
          </span>
        </td>
        <td className="px-4 py-3 hidden lg:table-cell">
          <span className="text-xs">{event.retryCount}</span>
        </td>
        <td className="px-4 py-3 hidden lg:table-cell">
          <span className="text-xs text-muted-foreground">
            {new Date(event.createdAt).toLocaleString()}
          </span>
        </td>
        <td className="px-4 py-3 text-right">
          {canRetry && (
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onRetry();
              }}
              disabled={retrying}
            >
              <RotateCcw className={`h-3 w-3 mr-1 ${retrying ? 'animate-spin' : ''}`} />
              Retry
            </Button>
          )}
        </td>
      </tr>

      {/* Expanded detail row */}
      {expanded && (
        <tr>
          <td colSpan={7} className="px-4 py-4 bg-muted/20">
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Event ID</span>
                  <p className="font-mono mt-0.5 break-all">{event.stripeEventId}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Order ID</span>
                  <p className="font-mono mt-0.5 break-all">{event.orderId ?? '—'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Payment Intent</span>
                  <p className="font-mono mt-0.5 break-all">{event.paymentIntentId ?? '—'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Processed At</span>
                  <p className="mt-0.5">
                    {event.processedAt
                      ? new Date(event.processedAt).toLocaleString()
                      : '—'}
                  </p>
                </div>
              </div>

              {event.errorMessage && (
                <div className="bg-red-50 border border-red-200 rounded p-3">
                  <p className="text-xs font-medium text-red-800">Error Message</p>
                  <p className="text-xs text-red-600 mt-1 font-mono">{event.errorMessage}</p>
                </div>
              )}

              {detail?.payload && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Payload</p>
                  <pre className="bg-card border rounded p-3 text-xs overflow-x-auto max-h-[300px]">
                    {JSON.stringify(detail.payload, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
